export interface Candidate {
  syncId: string
  updatedAt: number
  lamport: number
}

/**
 * The deterministic last-writer-wins rule, ported from electron/memory-merge.ts.
 *
 * Both ends compute this independently and must agree in every case: greater updatedAt,
 * then greater lamport, then greater syncId lexicographically. If the server's rule ever
 * drifts from the client's, replicas stop converging — which is silent, not loud, so the
 * ordering here is not a place to be clever.
 */
export function resolveTopicCollision(a: Candidate, b: Candidate): { winner: Candidate; loser: Candidate } {
  const winner = pick(a, b)
  return { winner, loser: winner === a ? b : a }
}

function pick(a: Candidate, b: Candidate): Candidate {
  if (a.updatedAt !== b.updatedAt) return a.updatedAt > b.updatedAt ? a : b
  if (a.lamport !== b.lamport) return a.lamport > b.lamport ? a : b
  return a.syncId > b.syncId ? a : b
}
