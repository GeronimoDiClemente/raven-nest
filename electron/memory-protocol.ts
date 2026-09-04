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
  // Task 4 (plan de memoria por cuenta multi-dispositivo): el resumen que un agente deja
  // en .nest/handoff.md, guardado ADEMÁS como observación para que "retomar en otra
  // máquina" funcione aunque el worktree local no tenga el archivo — ver
  // electron/main.ts's handoff:write/handoff:read.
  | 'handoff'

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
  // 'source_ref_updated' (review round 1, minor): Step 0's source_ref identity match
  // used to report 'topic_updated' even though the row may not have a topic_key at all
  // — the match was by import identity, not by a topic-key collision. Kept as a
  // distinct value from 'topic_updated' so a caller inspecting outcome can tell the two
  // resolution paths apart.
  outcome: 'inserted' | 'topic_updated' | 'source_ref_updated' | 'duplicate'
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

// M26: `refreshed` is only ever present (and only ever `true`) when memory-ipc-server.ts's
// pull-through search fallback fired — a local zero-result search triggered an immediate
// daemon pull before re-querying. Absent on every other response, including a fallback
// that ran but still found nothing locally after the pull — the field reports whether a
// server refresh was ATTEMPTED, not whether it changed the result.
export interface SearchMemoryResult {
  items: ObservationSummary[]
  refreshed?: boolean
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
  /**
   * El transcript que la CLI ya escribió. Opcional: un shim viejo no lo manda, y sin él
   * el cierre sigue funcionando — sólo que sin resumen.
   */
  transcriptPath?: string
}

export interface HookPreCompactParams {
  cwd: string
  sessionId: string
  transcriptPath?: string
}

// M12: local delete/tombstone origination. Not exposed as an MCP tool in Phase 1 (the
// doc's own Phase 1 tool scope is memory_save/search/context only, §9) — this is the
// store/protocol-level capability so a tombstone CAN be originated locally and replicate
// through the normal mutation_log/push path; a UI or future MCP tool wiring is a
// follow-up, not a Phase 1 gap in itself.
export interface DeleteMemoryParams {
  cwd: string
  syncId: string
}

export interface DeleteMemoryResult {
  ok: boolean
}

// Team Memory Layer 1, Parte 6/7 (lado cliente): promueve una observacion existente a
// scope 'team' — la unica forma de que una fila salga de 'personal'/'project'. Expuesta
// como la tool MCP memory_promote (memory-mcp/tools.ts) junto a memory_save/search/context.
export interface PromoteMemoryParams {
  cwd: string
  syncId: string
  reason?: string
}

export interface PromoteMemoryResult {
  promoted: boolean
}

// ── Request/response envelope ────────────────────────────────────────────────

export type MemoryMethod =
  | 'memory.save'
  | 'memory.search'
  | 'memory.context'
  | 'memory.delete'
  | 'memory.promote'
  | 'hook.sessionStart'
  | 'hook.stop'
  | 'hook.preCompact'
  | 'ping'

export interface MemoryRequest {
  id: string
  method: MemoryMethod
  params: unknown
  // C2: shared-secret handshake validated by memory-ipc-server.ts on every request.
  // Node's `net` module gives no way to set a custom Windows named-pipe DACL or verify
  // the connecting process's user SID, so an unpredictable pipe name alone is not
  // access control — see memory-local-auth.ts for the full rationale and the read-only
  // provenance of this token (a 0600 file under ravenHome, generated once).
  token: string
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

/**
 * Windows named pipe or POSIX unix socket path for the daemon's IPC server.
 *
 * C2 fix: `pipeId` must be an unpredictable, per-install random value (see
 * memory-local-auth.ts's `ensureLocalAuthMaterial`) — NOT a hash of ravenHomeDir. The
 * previous implementation derived the pipe suffix from a fast non-cryptographic hash of
 * a path that is itself guessable (the user's home directory), so any local process
 * could compute the exact pipe name and either connect to it (no Windows ACL restricts
 * named-pipe connections to the creating user by default via Node's `net` module) or
 * squat on the name before Nest starts. Making the name unguessable closes the squatting
 * angle; the `token` field on every MemoryRequest (validated in memory-ipc-server.ts) is
 * the actual access control for the "who can issue calls" angle.
 */
export function daemonSocketPath(ravenHomeDir: string, isWin: boolean, pipeId: string): string {
  if (isWin) {
    return `\\\\.\\pipe\\nest-memory-${pipeId}`
  }
  return `${ravenHomeDir}/.raven-nest/memory/daemon.sock`
}
