// Pure, dependency-free conflict resolution functions for Nest Memory sync.
// Kept separate from memory-store.ts and memory-daemon.ts (which both need
// better-sqlite3 / network I/O) so the highest-risk-per-line logic in the whole
// system — see docs/nest-memory-architecture.md §4.3 — can be unit- and
// property-tested without a database or a server.

export interface LWWRow {
  syncId: string
  updatedAt: number // ms epoch — client_updated_at
  lamport: number
}

/**
 * Deterministic winner between two writes to the SAME logical record
 * (same sync_id, edited on two replicas). Every replica must compute the
 * same answer independently — see §4.3(a).
 *
 * Order: max(updatedAt) -> max(lamport) -> lexicographically greater syncId.
 */
export function resolveLWW<T extends LWWRow>(a: T, b: T): T {
  if (a.updatedAt !== b.updatedAt) return a.updatedAt > b.updatedAt ? a : b
  if (a.lamport !== b.lamport) return a.lamport > b.lamport ? a : b
  return a.syncId > b.syncId ? a : b
}

export interface TopicCollisionResult<T extends LWWRow> {
  winner: T
  loser: T
}

/**
 * Two DIFFERENT sync_ids independently created for the same
 * (project, scope, topic_owner, topic_key) — the common offline case (§4.3(b)).
 * Uses the same deterministic ordering as resolveLWW, but the caller must NOT
 * delete the loser — it sets `superseded_by = winner.syncId` and keeps the row.
 * Nothing is ever silently discarded ("append-first").
 */
export function resolveTopicCollision<T extends LWWRow>(a: T, b: T): TopicCollisionResult<T> {
  const winner = resolveLWW(a, b)
  const loser = winner === a ? b : a
  return { winner, loser }
}

export interface DeleteVsUpdateRow extends LWWRow {
  deleted: boolean
}

/**
 * A tombstone is just a row with deleted=1, so delete-vs-update uses the exact
 * same rule as resolveLWW (§4.3(c)) — an update at T2 resurrects over a delete
 * at T1, and a delete at T2 beats an update at T1. This function exists purely
 * to document/name that equivalence and to make the intent explicit at call
 * sites; it delegates to resolveLWW.
 */
export function resolveDeleteVsUpdate<T extends DeleteVsUpdateRow>(a: T, b: T): T {
  return resolveLWW(a, b)
}
