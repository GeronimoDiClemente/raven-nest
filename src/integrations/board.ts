import type { TicketState, WorktreeMeta, WorktreeSignalDTO } from '../types'

export type Scope = { kind: 'org'; org: string } | { kind: 'personal' }

/** Org vs personal from a "owner/repo" full name. `null` repo → personal. */
export function deriveScope(repoFullName: string | null, personalLogin: string): Scope {
  if (!repoFullName) return { kind: 'personal' }
  const owner = repoFullName.split('/')[0]
  if (!owner || owner.toLowerCase() === personalLogin.toLowerCase()) {
    return { kind: 'personal' }
  }
  return { kind: 'org', org: owner }
}

export type AgentStatus = 'todo' | 'working' | 'needs_you' | 'done'

/**
 * Board status per task. Precedence: a red signal (changes requested / CI
 * failure) always surfaces as `needs_you`; then ticket `done`; then an active
 * worktree is `working`; a todo ticket with no worktree is `todo`; anything
 * else in flight is `working`. `idle`/`needs_input` are epic B, not here.
 */
export function deriveStatus(
  ticketState: TicketState,
  setupState: WorktreeMeta['setupState'] | null,
  signal: { ci: WorktreeSignalDTO['ci']; changesRequested: boolean } | null,
): AgentStatus {
  if (signal && (signal.changesRequested || signal.ci === 'failure')) return 'needs_you'
  if (ticketState === 'done') return 'done'
  if (setupState === 'running') return 'working'
  if (setupState == null) return ticketState === 'todo' ? 'todo' : 'working'
  return 'working'
}
