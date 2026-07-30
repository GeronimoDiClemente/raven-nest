// Named pipe (Windows) / unix socket (macOS/Linux) server hosting the daemon side of
// the Nest Memory protocol. Lives in Electron main next to the MemoryStore it wraps —
// see docs/nest-memory-architecture.md §1.1, §1.3. The stdio MCP shim
// (electron/memory-mcp/) is the only client; one connection per CLI session.

import { createServer, Server, Socket } from 'net'
import { existsSync, unlinkSync, mkdirSync, chmodSync } from 'fs'
import { dirname } from 'path'
import { isWin } from './platform'
import { MemoryStore } from './memory-store'
import { resolveProjectKey } from './memory-project-key'
import type {
  ContextMemoryParams,
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

export interface MemoryIpcServerDeps {
  store: MemoryStore
  socketPath: string
  resolveGitInfo?: GitInfoResolver
  onMutation?: () => void // called after any write — the daemon uses this to schedule a debounced push
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
    socket.on('data', (chunk: string) => {
      buffer += chunk
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
