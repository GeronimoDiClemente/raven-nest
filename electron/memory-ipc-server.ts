// Named pipe (Windows) / unix socket (macOS/Linux) server hosting the daemon side of
// the Nest Memory protocol. Lives in Electron main next to the MemoryStore it wraps —
// see docs/nest-memory-architecture.md §1.1, §1.3. The stdio MCP shim
// (electron/memory-mcp/) is the only client; one connection per CLI session.

import { createServer, Server, Socket } from 'net'
import { existsSync, readFileSync, unlinkSync, mkdirSync, chmodSync } from 'fs'
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
import { buildSessionRollup } from './memory-rollup'
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
  SearchMemoryResult,
} from './memory-protocol'
import { generateSyncId } from './memory-store'
// M26: type-only import — memory-daemon.ts has no `electron` import in its own chain
// (same reasoning as the isWin inlining above for MemoryStore), so this doesn't
// reintroduce the "unloadable outside real Electron" problem the isWin comment warns
// about. `Pick<...>` (not the whole class) is what MemoryIpcServerDeps.daemon actually
// needs, and it's what memory-ipc-server.test.ts's fakes implement.
import type { MemoryDaemon } from './memory-daemon'

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

// M26: how long a zero-result memory_search will wait on a triggered daemon pull before
// giving up and answering from local data anyway. The daemon's own pull interval is 5
// minutes (memory-daemon.ts's INTERVAL_MS) — this fallback exists BECAUSE that's too
// slow for "I just saved this on my other laptop, search for it now"; 8s is long enough
// for one real pull round-trip (a page fetch + apply, see doPull()) but short enough that
// a bad network never turns a memory_search tool call into a hang the agent is left
// waiting on. Overridable via deps for tests only — production wiring (main.ts) never
// sets it, so this default is what actually runs.
const DEFAULT_SEARCH_PULL_TIMEOUT_MS = 8_000

/**
 * M26: the subset of MemoryDaemon the pull-through search fallback needs. Narrower than
 * the whole class so memory-ipc-server.test.ts can pass a plain `{ pull, isOnline }`
 * fake instead of constructing (or fully mocking) a real MemoryDaemon.
 */
export type MemoryIpcServerDaemon = Pick<MemoryDaemon, 'pull' | 'isOnline'>

export interface MemoryIpcServerDeps {
  store: MemoryStore
  socketPath: string
  /** C2: shared secret every request must present — see memory-local-auth.ts. */
  authToken: string
  resolveGitInfo?: GitInfoResolver
  onMutation?: () => void // called after any write — the daemon uses this to schedule a debounced push
  // M26: optional so a degraded memory subsystem (main.ts's try/catch around
  // `new MemoryStore(...)` — a construction failure there leaves `memory` null and skips
  // this entirely) and existing tests that don't care about the fallback keep working
  // unchanged. When absent, memory.search behaves exactly as it did before M26.
  daemon?: MemoryIpcServerDaemon
  /** M26: test-only override of DEFAULT_SEARCH_PULL_TIMEOUT_MS — see that constant. */
  searchPullTimeoutMs?: number
}

/**
 * M26: races `promise` against a timer so a hanging daemon.pull() can never hang the
 * memory_search tool call it was triggered from. Deliberately resolves (never rejects)
 * on both the timeout AND a pull() rejection (bad network, 401, etc.) — either way the
 * caller falls back to whatever is already on disk, and memory-daemon.ts already records
 * the failure into its own status/backoff state, so there is nothing left to report here.
 */
function withTimeout(promise: Promise<void>, ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms)
    promise.then(
      () => { clearTimeout(timer); resolve() },
      () => { clearTimeout(timer); resolve() }
    )
  })
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
    // C2: reject before dispatch — an invalid/missing token never reaches the store.
    if (typeof request.token !== 'string' || !tokensMatch(request.token, this.deps.authToken)) {
      const response: MemoryResponse = { id: request.id, ok: false, error: 'unauthorized' }
      socket.write(`${JSON.stringify(response)}\n`)
      return
    }
    // M26: dispatch() is now async (memory.search may await a bounded pull-through
    // fallback) — every other method still resolves synchronously inside it, so this is
    // a no-op timing-wise for them. One line per connection in practice (client.ts opens
    // a fresh socket per call), so there's no request-ordering concern from not awaiting
    // this inline.
    this.dispatch(request).then(
      (result) => {
        const response: MemoryResponse = { id: request.id, ok: true, result }
        socket.write(`${JSON.stringify(response)}\n`)
      },
      (err: unknown) => {
        const response: MemoryResponse = { id: request.id, ok: false, error: err instanceof Error ? err.message : String(err) }
        socket.write(`${JSON.stringify(response)}\n`)
      }
    )
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

  /**
   * Guarda el resumen de la sesión como una observación. Best-effort de punta a punta: que
   * no se pueda leer el transcript no puede impedir que la sesión cierre.
   *
   * El `sourceRef` lleva el sessionId, así que el índice `UNIQUE (source, source_ref)` del
   * store convierte un segundo Stop —o el PreCompact seguido del Stop— en un update de la
   * misma memoria en vez de una fila nueva por cada vez.
   */
  private guardarRollup(sessionId: string, cwd: string, transcriptPath: string | undefined, origen: string): void {
    if (!transcriptPath) return  // shim viejo, o una CLI que no pasa transcript
    try {
      if (!existsSync(transcriptPath)) return
      const rollup = buildSessionRollup(readFileSync(transcriptPath, 'utf8'))
      if (!rollup) return  // sesión sin prompts: no hay nada que recordar

      const session = this.deps.store.getSession(sessionId)
      const projectKey = session?.project_key ?? this.projectKeyForCwd(cwd)
      this.deps.store.save({
        projectKey,
        scope: 'personal',
        type: 'session',
        title: rollup.title,
        content: rollup.content,
        source: 'hook',
        sourceRef: `session:${sessionId}`,
      })
    } catch (err) {
      console.warn('[memory-ipc] no se pudo guardar el rollup de la sesion', origen, err)
    }
  }

  private async dispatch(request: MemoryRequest): Promise<unknown> {
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
        const limit = params.limit ?? 10
        const items = store.search(projectKey, params.query, limit)
        if (items.length > 0) return { items } as SearchMemoryResult

        // M26 pull-through search: a LOCAL zero-result miss is exactly the shape of "an
        // agent asks about something just saved on another device" — sync only lands
        // locally on the daemon's own ~5-minute interval (memory-daemon.ts's
        // INTERVAL_MS), so without this the answer is a false "nothing here" for up to
        // that long. Server data stays non-authoritative for reads: this only narrows a
        // MISS, it never runs (or overrides) a local HIT — see the `items.length > 0`
        // return above. Skip entirely (no pull attempt at all) when there's no daemon
        // wired or it reports offline/disconnected — daemon.pull() already dedupes
        // concurrent callers via pullInFlight (M19) and chains full pages via M25, so
        // calling it here piggybacks on whatever pull is already in flight rather than
        // starting a redundant one.
        const daemon = this.deps.daemon
        if (!daemon || !daemon.isOnline()) return { items } as SearchMemoryResult

        const timeoutMs = this.deps.searchPullTimeoutMs ?? DEFAULT_SEARCH_PULL_TIMEOUT_MS
        await withTimeout(daemon.pull(), timeoutMs)
        const refreshedItems = store.search(projectKey, params.query, limit)
        return { items: refreshedItems, refreshed: true } as SearchMemoryResult
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
        this.guardarRollup(params.sessionId, params.cwd, params.transcriptPath, 'stop')
        store.closeSession(params.sessionId)
        this.deps.onMutation?.()
        return { ok: true }
      }

      case 'hook.preCompact': {
        const params = request.params as HookPreCompactParams
        // Antes escribía un placeholder que decía "rollup pending on session close" — y ese
        // rollup NUNCA llegaba, porque `Stop` no escribía nada. Ahora guarda el resumen de
        // verdad: si la sesión se compacta, lo hablado hasta acá ya quedó.
        this.guardarRollup(params.sessionId, params.cwd, params.transcriptPath, 'precompact')
        this.deps.onMutation?.()
        return { ok: true }
      }

      default:
        throw new Error(`Unknown method: ${request.method}`)
    }
  }
}
