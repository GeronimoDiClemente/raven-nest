// Named pipe (Windows) / unix socket (macOS/Linux) server hosting the daemon side of
// the Nest Memory protocol. Lives in Electron main next to the MemoryStore it wraps —
// see docs/nest-memory-architecture.md §1.1, §1.3. The stdio MCP shim
// (electron/memory-mcp/) is the only client; one connection per CLI session.

import { createServer, Server, Socket } from 'net'
import { existsSync, unlinkSync, mkdirSync, chmodSync } from 'fs'
import { dirname } from 'path'
import { timingSafeEqual } from 'crypto'
// Deliberately NOT importing isWin from ./platform — that module imports `electron`
// (for getIconsDir()) at module scope, which makes ANY importer unloadable outside a
// real Electron process (e.g. under plain-Node vitest, as memory-ipc-server.test.ts
// discovered — "Electron failed to install correctly" when this file pulled it in
// transitively). This check is a one-liner; inlining it avoids the whole chain.
const isWin = process.platform === 'win32'
import { MemoryStore } from './memory-store'
import { resolveProjectKey } from './memory-project-key'
import type {
  ContextMemoryParams,
  DeleteMemoryParams,
  HookPreCompactParams,
  HookSessionStartParams,
  HookSessionStartResult,
  HookStopParams,
  MemoryRequest,
  MemoryResponse,
  SaveMemoryParams,
  SearchMemoryParams,
} from './memory-protocol'
import { generateSyncId } from './memory-store'

export interface GitInfoResolver {
  (cwd: string): { remoteUrl?: string | null; branch?: string | null } | null
}

// M22: an unbounded per-connection buffer lets a misbehaving or malicious local client
// grow memory without limit by never sending a newline. 1 MiB comfortably covers any
// real request (the largest payload is a memory_save title+content) with headroom.
const MAX_LINE_BYTES = 1024 * 1024
// Idle connections (the shim should send-then-disconnect per call — see client.ts) are
// dropped after this so a hung/leaked socket doesn't accumulate server-side.
const CONNECTION_IDLE_TIMEOUT_MS = 30_000

export interface MemoryIpcServerDeps {
  store: MemoryStore
  socketPath: string
  /** C2: shared secret every request must present — see memory-local-auth.ts. */
  authToken: string
  resolveGitInfo?: GitInfoResolver
  onMutation?: () => void // called after any write — the daemon uses this to schedule a debounced push
}

function tokensMatch(a: string, b: string): boolean {
  const bufA = Buffer.from(a)
  const bufB = Buffer.from(b)
  // timingSafeEqual throws on length mismatch rather than returning false — length
  // itself isn't secret here (tokens are a fixed 64-hex-char length), so comparing
  // lengths first is safe and avoids the throw.
  if (bufA.length !== bufB.length) return false
  return timingSafeEqual(bufA, bufB)
}

export class MemoryIpcServer {
  private server: Server | null = null
  private readonly deps: MemoryIpcServerDeps

  constructor(deps: MemoryIpcServerDeps) {
    this.deps = deps
  }

  start(): void {
    const { socketPath } = this.deps
    if (!isWin) {
      mkdirSync(dirname(socketPath), { recursive: true })
      if (existsSync(socketPath)) {
        try { unlinkSync(socketPath) } catch { /* stale socket, ignore */ }
      }
    }
    this.server = createServer((socket) => this.handleConnection(socket))
    this.server.listen(socketPath, () => {
      if (!isWin) {
        try { chmodSync(socketPath, 0o600) } catch { /* best effort */ }
      }
    })
    this.server.on('error', (err) => {
      console.error('[memory-ipc-server] listen error', err)
    })
  }

  stop(): void {
    this.server?.close()
    this.server = null
    if (!isWin && existsSync(this.deps.socketPath)) {
      try { unlinkSync(this.deps.socketPath) } catch { /* ignore */ }
    }
  }

  private handleConnection(socket: Socket): void {
    let buffer = ''
    socket.setEncoding('utf8')
    socket.setTimeout(CONNECTION_IDLE_TIMEOUT_MS, () => socket.destroy())
    socket.on('data', (chunk: string) => {
      buffer += chunk
      if (Buffer.byteLength(buffer, 'utf8') > MAX_LINE_BYTES) {
        console.warn('[memory-ipc-server] connection exceeded max line size, dropping')
        socket.destroy()
        return
      }
      let newlineIdx: number
      while ((newlineIdx = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, newlineIdx)
        buffer = buffer.slice(newlineIdx + 1)
        if (!line.trim()) continue
        this.handleLine(socket, line)
      }
    })
    socket.on('error', () => { /* client disconnects are routine */ })
  }

  private handleLine(socket: Socket, line: string): void {
    let request: MemoryRequest
    try {
      request = JSON.parse(line) as MemoryRequest
    } catch {
      return
    }
    let response: MemoryResponse
    // C2: reject before dispatch — an invalid/missing token never reaches the store.
    if (typeof request.token !== 'string' || !tokensMatch(request.token, this.deps.authToken)) {
      response = { id: request.id, ok: false, error: 'unauthorized' }
      socket.write(`${JSON.stringify(response)}\n`)
      return
    }
    try {
      const result = this.dispatch(request)
      response = { id: request.id, ok: true, result }
    } catch (err) {
      response = { id: request.id, ok: false, error: err instanceof Error ? err.message : String(err) }
    }
    socket.write(`${JSON.stringify(response)}\n`)
  }

  private projectKeyForCwd(cwd: string): string {
    const info = this.deps.resolveGitInfo?.(cwd) ?? null
    const projectKey = resolveProjectKey({ remoteUrl: info?.remoteUrl, rootPath: cwd })
    this.deps.store.ensureProject({
      projectKey,
      displayName: cwd.split(/[\\/]/).filter(Boolean).pop() ?? cwd,
      rootPath: cwd,
      remoteUrl: info?.remoteUrl ?? null,
    })
    return projectKey
  }

  private dispatch(request: MemoryRequest): unknown {
    const { store } = this.deps
    switch (request.method) {
      case 'ping':
        return { pong: true }

      case 'memory.save': {
        const params = request.params as SaveMemoryParams
        const projectKey = this.projectKeyForCwd(params.cwd)
        const gitInfo = this.deps.resolveGitInfo?.(params.cwd) ?? null
        const result = store.save({
          projectKey,
          scope: 'personal', // auto-capture ALWAYS writes personal — no code path can override this (§2.1)
          topicKey: params.topicKey ?? null,
          type: params.type,
          title: params.title,
          content: params.content,
          tags: params.tags,
          source: params.source,
          originAi: params.originAi ?? null,
          originAccount: params.originAccount ?? null,
          gitBranch: params.gitBranch ?? gitInfo?.branch ?? null,
        })
        this.deps.onMutation?.()
        return result
      }

      case 'memory.search': {
        const params = request.params as SearchMemoryParams
        const projectKey = this.projectKeyForCwd(params.cwd)
        return { items: store.search(projectKey, params.query, params.limit ?? 10) }
      }

      case 'memory.context': {
        const params = request.params as ContextMemoryParams
        const projectKey = this.projectKeyForCwd(params.cwd)
        return { items: store.context(projectKey, params.limit ?? 10) }
      }

      case 'memory.delete': {
        const params = request.params as DeleteMemoryParams
        const ok = store.deleteObservation(params.syncId)
        if (ok) this.deps.onMutation?.()
        return { ok }
      }

      case 'hook.sessionStart': {
        const params = request.params as HookSessionStartParams
        const projectKey = this.projectKeyForCwd(params.cwd)
        const gitInfo = this.deps.resolveGitInfo?.(params.cwd) ?? null
        store.openSession({
          id: params.sessionId,
          projectKey,
          aiType: params.aiType,
          account: params.account,
          gitBranch: gitInfo?.branch ?? undefined,
        })
        const recent = store.context(projectKey, 5)
        const lines = recent.map((o) => `- [${o.type}] ${o.title}`)
        const additionalContext =
          recent.length > 0
            ? `Nest Memory — relevant context for this project:\n${lines.join('\n')}\n\nCall memory_context for full detail before answering.`
            : 'Nest Memory is active for this project. No prior memories yet — call memory_save after decisions, fixes, or discoveries.'
        const result: HookSessionStartResult = { additionalContext }
        return result
      }

      case 'hook.stop': {
        const params = request.params as HookStopParams
        store.closeSession(params.sessionId)
        this.deps.onMutation?.()
        return { ok: true }
      }

      case 'hook.preCompact': {
        const params = request.params as HookPreCompactParams
        const session = store.getSession(params.sessionId)
        if (session && !session.ended_at) {
          // Force a rollup marker so PreCompact-triggered summaries aren't lost — the
          // actual rollup observation is written by whichever hook closes the session.
          store.save({
            projectKey: session.project_key,
            scope: 'personal',
            type: 'session',
            title: `Pre-compaction checkpoint — ${new Date().toISOString()}`,
            content: 'Session reached context compaction. Rollup pending on session close.',
            source: 'hook',
            sourceRef: `precompact:${generateSyncId('sess')}`,
          })
          this.deps.onMutation?.()
        }
        return { ok: true }
      }

      default:
        throw new Error(`Unknown method: ${request.method}`)
    }
  }
}
