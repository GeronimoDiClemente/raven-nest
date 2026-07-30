// Shared wire types between the daemon-side IPC server (electron/memory-ipc-server.ts,
// runs inside Electron main with better-sqlite3) and the stdio MCP shim
// (electron/memory-mcp/, spawned with ELECTRON_RUN_AS_NODE by each AI CLI).
//
// Deliberately dependency-free (no better-sqlite3, no electron) so the shim can import
// it without pulling in native bindings — see docs/nest-memory-architecture.md §1.1.
//
// Transport: newline-delimited JSON over a named pipe (Windows) or unix socket
// (macOS/Linux). One request per line, one response per line. Not JSON-RPC 2.0 —
// this channel is internal-only (daemon <-> shim on the same machine), so there is no
// need for the wire compatibility JSON-RPC buys us. The MCP-facing protocol spoken by
// the shim to the AI CLI (stdio, JSON-RPC 2.0) is a separate, outer layer implemented
// in electron/memory-mcp/index.ts.

export type ObservationType =
  | 'decision'
  | 'bugfix'
  | 'architecture'
  | 'discovery'
  | 'pattern'
  | 'config'
  | 'preference'
  | 'session'

export type ObservationSource = 'mcp' | 'hook' | 'pty' | 'import' | 'ui'

export interface SaveMemoryParams {
  cwd: string
  title: string
  content: string
  type: ObservationType
  topicKey?: string
  tags?: string[]
  source: ObservationSource
  originAi?: string
  originAccount?: string
  gitBranch?: string
}

export interface SaveMemoryResult {
  syncId: string
  outcome: 'inserted' | 'topic_updated' | 'duplicate'
  redacted: boolean
}

export interface SearchMemoryParams {
  cwd: string
  query: string
  limit?: number
}

export interface ContextMemoryParams {
  cwd: string
  limit?: number
}

export interface ObservationSummary {
  syncId: string
  title: string
  content: string
  type: ObservationType
  topicKey: string | null
  tags: string[]
  updatedAt: number
  originAi: string | null
  gitBranch: string | null
}

export interface HookSessionStartParams {
  cwd: string
  sessionId: string
  aiType: string
  account: string
}

export interface HookSessionStartResult {
  additionalContext: string
}

export interface HookStopParams {
  cwd: string
  sessionId: string
}

export interface HookPreCompactParams {
  cwd: string
  sessionId: string
}

// ── Request/response envelope ────────────────────────────────────────────────

export type MemoryMethod =
  | 'memory.save'
  | 'memory.search'
  | 'memory.context'
  | 'hook.sessionStart'
  | 'hook.stop'
  | 'hook.preCompact'
  | 'ping'

export interface MemoryRequest {
  id: string
  method: MemoryMethod
  params: unknown
}

export interface MemoryResponseOk {
  id: string
  ok: true
  result: unknown
}

export interface MemoryResponseErr {
  id: string
  ok: false
  error: string
}

export type MemoryResponse = MemoryResponseOk | MemoryResponseErr

/** Windows named pipe or POSIX unix socket path for the daemon's IPC server. */
export function daemonSocketPath(ravenHomeDir: string, isWin: boolean): string {
  if (isWin) {
    // One pipe per ravenHome so RAVEN_HOME-isolated e2e/dev instances don't collide.
    const suffix = hashShort(ravenHomeDir)
    return `\\\\.\\pipe\\nest-memory-${suffix}`
  }
  return `${ravenHomeDir}/.raven-nest/memory/daemon.sock`
}

// Small, fast, non-cryptographic — only used to keep pipe names short and distinct
// per ravenHome, not for anything security-sensitive.
function hashShort(input: string): string {
  let h = 5381
  for (let i = 0; i < input.length; i++) {
    h = ((h << 5) + h + input.charCodeAt(i)) | 0
  }
  return (h >>> 0).toString(16)
}
