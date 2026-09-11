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
import { createInterface } from 'readline'
import { MemoryDaemonClient } from './client'
import { MemoryReadonlyClient } from './readonly'
import { ravenHome } from '../raven-home'
import type { MemoryMethod } from '../memory-protocol'
import { MCP_INSTRUCTIONS, TOOL_MANIFEST } from './tools'
import type { ObservationType } from '../memory-protocol'

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
interface ClienteDeMemoria {
  call<T = unknown>(method: MemoryMethod, params: unknown): Promise<T>
}

function resolverCliente(): { cliente: ClienteDeMemoria; conDaemon: boolean } {
  const socket = env('NEST_MEMORY_SOCKET')
  const token = env('NEST_MEMORY_TOKEN')
  if (socket && token) {
    return { cliente: new MemoryDaemonClient(socket, token), conDaemon: true }
  }
  console.error(
    '[nest-memory] sin daemon (Nest no está abierto) — modo sólo lectura: ' +
    'memory_graph funciona, guardar necesita la app'
  )
  return { cliente: new MemoryReadonlyClient(ravenHome()), conDaemon: false }
}

// ── MCP stdio server mode ────────────────────────────────────────────────────

interface JsonRpcRequest {
  jsonrpc: '2.0'
  id?: string | number
  method: string
  params?: Record<string, unknown>
}

function writeMessage(msg: unknown): void {
  process.stdout.write(`${JSON.stringify(msg)}\n`)
}

async function runMcpServer(): Promise<void> {
  const { cliente: client, conDaemon } = resolverCliente()
  const cwd = process.cwd()
  void conDaemon

  const rl = createInterface({ input: process.stdin, terminal: false })
  rl.on('line', (line) => {
    if (!line.trim()) return
    void handleLine(line)
  })

  async function handleLine(line: string): Promise<void> {
    let msg: JsonRpcRequest
    try {
      msg = JSON.parse(line)
    } catch {
      return
    }
    if (msg.id === undefined) return // notification — nothing to reply to

    try {
      switch (msg.method) {
        case 'initialize':
          writeMessage({
            jsonrpc: '2.0',
            id: msg.id,
            result: {
              protocolVersion: '2024-11-05',
              capabilities: { tools: {} },
              serverInfo: { name: 'nest-memory', version: '1.0.0' },
              // M27: server-wide behavioral protocol — see tools.ts's MCP_INSTRUCTIONS
              // for why this channel (not just per-tool descriptions) is the primary
              // lever. Not every MCP client surfaces `instructions` the same way the spec
              // recommends (folding it into the system prompt), which is why the search
              // tool's own description in tools.ts also restates the "don't invent" rule
              // as a redundant, cheaper-to-drop backup.
              instructions: MCP_INSTRUCTIONS,
            },
          })
          return

        case 'tools/list':
          writeMessage({ jsonrpc: '2.0', id: msg.id, result: { tools: TOOL_MANIFEST } })
          return

        case 'tools/call': {
          const params = msg.params as { name: string; arguments?: Record<string, unknown> }
          const args = params.arguments ?? {}
          const text = await callTool(client, cwd, params.name, args)
          writeMessage({ jsonrpc: '2.0', id: msg.id, result: { content: [{ type: 'text', text }] } })
          return
        }

        case 'ping':
          writeMessage({ jsonrpc: '2.0', id: msg.id, result: {} })
          return

        default:
          writeMessage({ jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: `Unknown method: ${msg.method}` } })
      }
    } catch (err) {
      writeMessage({
        jsonrpc: '2.0',
        id: msg.id,
        error: { code: -32000, message: err instanceof Error ? err.message : String(err) },
      })
    }
  }
}

async function callTool(client: ClienteDeMemoria, cwd: string, name: string, args: Record<string, unknown>): Promise<string> {
  switch (name) {
    case 'memory_save': {
      const result = await client.call('memory.save', {
        cwd,
        title: String(args.title ?? ''),
        content: String(args.content ?? ''),
        type: (args.type as ObservationType) ?? 'discovery',
        topicKey: args.topic_key as string | undefined,
        tags: args.tags as string[] | undefined,
        source: 'mcp',
        originAi: env('NEST_MEMORY_AI'),
        originAccount: env('NEST_MEMORY_ACCOUNT'),
      })
      return JSON.stringify(result)
    }
    case 'memory_search': {
      const result = await client.call('memory.search', {
        cwd,
        query: String(args.query ?? ''),
        limit: typeof args.limit === 'number' ? args.limit : undefined,
      })
      return JSON.stringify(result)
    }
    case 'memory_context': {
      const result = await client.call('memory.context', {
        cwd,
        limit: typeof args.limit === 'number' ? args.limit : undefined,
      })
      return JSON.stringify(result)
    }
    case 'memory_promote': {
      const result = await client.call('memory.promote', {
        cwd,
        syncId: String(args.sync_id ?? ''),
        reason: args.reason as string | undefined,
      })
      return JSON.stringify(result)
    }
    case 'memory_get': {
      const result = await client.call('memory.get', {
        cwd,
        syncId: String(args.sync_id ?? ''),
      })
      return JSON.stringify(result)
    }
    case 'memory_update': {
      const result = await client.call('memory.update', {
        cwd,
        syncId: String(args.sync_id ?? ''),
        title: args.title as string | undefined,
        content: args.content as string | undefined,
        tags: args.tags as string[] | undefined,
      })
      return JSON.stringify(result)
    }
    case 'memory_graph': {
      const result = await client.call<{ text: string }>('memory.graph', {
        cwd,
        tag: (args.tag as string | undefined) ?? null,
        projectKey: (args.project_key as string | undefined) ?? null,
        includeSimilar: Boolean(args.include_similar),
      })
      // Texto plano, no JSON: lo que devuelve ya ES el dibujo. Envolverlo en JSON obligaria
      // al agente a desescaparlo antes de imprimirlo, y ahi es donde se rompen los saltos de
      // linea que hacen al arbol.
      return result.text
    }
    default:
      throw new Error(`Unknown tool: ${name}`)
  }
}

// ── Hook mode ─────────────────────────────────────────────────────────────

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
    await runMcpServer()
  }
}

main().catch((err) => {
  console.error('[nest-memory] fatal', err)
  process.exit(1)
})
