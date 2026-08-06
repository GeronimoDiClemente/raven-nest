import type { Ticket, TicketState, WorktreeMeta, WorktreeSignalDTO } from '../types'

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

export interface BoardRow {
  key: string
  title: string
  url: string
  providerId: string
  pluginId: string
  ticketState: TicketState
  status: AgentStatus
  branch: string | null
  worktreePath: string | null
  repoFullName: string | null
  scope: Scope
  ci: WorktreeSignalDTO['ci'] | null
  changesRequested: boolean
  prNumber: number | null
}

export interface BoardInputs {
  tickets: Array<{ pluginId: string; ticket: Ticket }>
  worktrees: WorktreeMeta[]
  signals: WorktreeSignalDTO[]
  links: Array<{ branch: string; ticketKey: string }>
  personalLogin: string
  repoFullName: (repoPath: string) => string | null
}

/** Pure join: one BoardRow per ticket, enriched with its linked worktree/signal. */
export function projectBoard(inp: BoardInputs): BoardRow[] {
  const branchByKey = new Map(inp.links.map((l) => [l.ticketKey, l.branch]))
  const wtByBranch = new Map(inp.worktrees.map((w) => [w.branch, w]))
  const sigByPath = new Map(inp.signals.map((s) => [s.repoPath, s]))

  return inp.tickets.map(({ pluginId, ticket }) => {
    const branch = branchByKey.get(ticket.key) ?? null
    const wt = branch ? wtByBranch.get(branch) ?? null : null
    const sig = wt ? sigByPath.get(wt.repoPath) ?? null : null
    const full = wt ? inp.repoFullName(wt.repoPath) : null
    return {
      key: ticket.key,
      title: ticket.title,
      url: ticket.url,
      providerId: ticket.providerId,
      pluginId,
      ticketState: ticket.state,
      status: deriveStatus(
        ticket.state,
        wt?.setupState ?? null,
        sig ? { ci: sig.ci, changesRequested: sig.changesRequested } : null,
      ),
      branch,
      worktreePath: wt?.repoPath ?? null,
      repoFullName: full,
      scope: deriveScope(full, inp.personalLogin),
      ci: sig?.ci ?? null,
      changesRequested: sig?.changesRequested ?? false,
      prNumber: sig?.prNumber ?? null,
    }
  })
}
