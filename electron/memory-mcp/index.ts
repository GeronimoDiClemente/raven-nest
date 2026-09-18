#!/usr/bin/env node
// nest-memory — stdio shim. Spawned once per AI CLI session with
// ELECTRON_RUN_AS_NODE=1 and Electron's own binary (§1.1: "none of the shim's code
// needs a shipped Node runtime"). Two modes, selected by argv:
//
//   nest-memory                      -> MCP server over stdio (spawned by the CLI's own
//                                        MCP config, one long-lived process per session)
//   nest-memory hook <event>         -> one-shot hook invocation (spawned by Claude Code
//                                        per hook firing, per docs/nest-memory-architecture.md §2.2)
//
// Holds no state and no database handle. Every call is forwarded to the daemon in
// Electron main over the local IPC channel (see client.ts, memory-ipc-server.ts).
import { MemoryDaemonClient } from './client'
import { MemoryReadonlyClient } from './readonly'
import { ravenHome } from '../raven-home'
import type { MemoryMethod } from '../memory-protocol'
import { runMcpServer, writeMessage, type ClienteDeMemoria } from './servidor'

function env(name: string): string | undefined {
  return process.env[name]
}

/**
 * Lo mínimo que el shim necesita para responder: el daemon si está, y si no, lectura directa
 * del disco.
 *
 * Antes esto era `process.exit(1)` cuando faltaba el socket, y esa línea era la que hacía que
 * la memoria fuera una función de la APP y no de la memoria: quien se llevaba el plugin a
 * otro editor sin Nest abierto se quedaba sin nada. Ahora degrada a sólo lectura y lo dice.
 */
function resolverCliente(): { cliente: ClienteDeMemoria; conDaemon: boolean } {
  const socket = env('NEST_MEMORY_SOCKET')
  const token = env('NEST_MEMORY_TOKEN')
  if (socket && token) {
    return { cliente: new MemoryDaemonClient(socket, token), conDaemon: true }
  }
  console.error(
    '[nest-memory] no daemon (Nest is not open) — read-only mode: ' +
    'search, read and the graph work; saving needs the app'
  )
  return { cliente: new MemoryReadonlyClient(ravenHome()), conDaemon: false }
}

// ── MCP stdio server mode ────────────────────────────────────────────────────


async function readStdin(): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk))
  return Buffer.concat(chunks).toString('utf8')
}

/**
 * El modo hook NO degrada a sólo lectura, y es a propósito: un hook existe para ESCRIBIR
 * (guarda lo que pasó en la sesión), y escribir sin el daemon es lo único que este diseño no
 * permite — es quien sincroniza, resuelve conflictos y lleva el lamport. Sin app, el hook no
 * tiene nada que hacer más que salir en silencio.
 */
function requireSocketPath(): string {
  const socket = env('NEST_MEMORY_SOCKET')
  if (!socket) {
    console.error('[nest-memory] NEST_MEMORY_SOCKET not set — memory is disabled for this session')
    process.exit(1)
  }
  return socket
}

function requireAuthToken(): string {
  const token = env('NEST_MEMORY_TOKEN')
  if (!token) {
    console.error('[nest-memory] NEST_MEMORY_TOKEN not set — memory is disabled for this session')
    process.exit(1)
  }
  return token
}

async function runHook(event: string): Promise<void> {
  const socketPath = requireSocketPath()
  const authToken = requireAuthToken()
  const client = new MemoryDaemonClient(socketPath, authToken)
  const raw = await readStdin()
  let payload: Record<string, unknown> = {}
  try { payload = raw.trim() ? JSON.parse(raw) : {} } catch { payload = {} }

  const cwd = (payload.cwd as string) ?? process.cwd()
  const sessionId = (payload.session_id as string) ?? `unknown-${Date.now()}`
  // Lo único que dice qué pasó en la sesión. El hook lo recibe y hasta ahora se tiraba, que
  // es la razón de fondo por la que `Stop` no tenía nada que guardar (Layer B).
  const transcriptPath = typeof payload.transcript_path === 'string' ? payload.transcript_path : undefined

  try {
    switch (event) {
      case 'session-start': {
        const result = await client.call<{ additionalContext: string }>('hook.sessionStart', {
          cwd,
          sessionId,
          aiType: env('NEST_MEMORY_AI') ?? 'claude',
          account: env('NEST_MEMORY_ACCOUNT') ?? '',
        })
        writeMessage({
          hookSpecificOutput: {
            hookEventName: 'SessionStart',
            additionalContext: result.additionalContext,
          },
        })
        return
      }
      case 'stop':
        await client.call('hook.stop', { cwd, sessionId, transcriptPath })
        return
      case 'pre-compact':
        await client.call('hook.preCompact', { cwd, sessionId, transcriptPath })
        return
      default:
        console.error(`[nest-memory] unknown hook event: ${event}`)
    }
  } catch (err) {
    // Hooks must never break the CLI session — log and exit 0 regardless of daemon state.
    console.error('[nest-memory] hook failed', err instanceof Error ? err.message : err)
  }
}

// ── Entry ─────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const [, , mode, hookEvent] = process.argv
  if (mode === 'hook' && hookEvent) {
    await runHook(hookEvent)
    process.exit(0)
  } else {
    await runMcpServer(resolverCliente().cliente, process.cwd())
  }
}

main().catch((err) => {
  console.error('[nest-memory] fatal', err)
  process.exit(1)
})
