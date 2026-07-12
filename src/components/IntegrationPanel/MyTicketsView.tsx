import { useState } from 'react'
import { useMyTickets } from '../../hooks/useMyTickets'
import type { Ticket, WorktreeMeta } from '../../types'

// worktree:create actually resolves to this union (see the handler in
// electron/main.ts); the bridge type in src/types.ts predates it and still
// says Promise<WorktreeMeta>, so we narrow here through unknown.
type WorktreeCreateResult = { ok: true; meta: WorktreeMeta } | { ok: false; error: string }

interface Props {
  pluginId: string
  /** null when no repo tab is active — Work on this needs a repo to branch from */
  repoPath: string | null
  /** login for the branch prefix (from useGitHub or the profile) */
  githubLogin: string | null
  /** the caller opens the pane flow on the new worktree (setAddingPane) */
  onOpenWorktree: (worktreePath: string) => void
}

export default function MyTicketsView({ pluginId, repoPath, githubLogin, onOpenWorktree }: Props) {
  const { tickets, loading, error, reload } = useMyTickets(pluginId)
  const [working, setWorking] = useState<string | null>(null) // key in flight: blocks double click
  const [actionError, setActionError] = useState<string | null>(null)

  async function workOn(t: Ticket) {
    if (working) return
    if (!repoPath) { setActionError('Open a repo tab first to create a worktree'); return }
    setWorking(t.key)
    setActionError(null)
    try {
      const branch = await window.tickets.branchName(githubLogin ?? '', t.key, t.title)
      const res = await window.worktree.create({ repoPath, branch }) as unknown as WorktreeCreateResult
      if (!res.ok) { setActionError(res.error || 'worktree failed'); return }
      await window.tickets.startWork({ pluginId, ticket: t, branch, worktreePath: res.meta.repoPath })
      onOpenWorktree(res.meta.repoPath)
    } finally {
      setWorking(null)
    }
  }

  if (loading) return <div className="tk-empty">Loading tickets…</div>
  if (error) return <div className="tk-empty">{error} <button className="tk-retry" onClick={() => void reload()}>Retry</button></div>
  if (tickets.length === 0) return <div className="tk-empty">No open tickets assigned to you</div>

  return (
    <div className="tk-list">
      {actionError && <div className="tk-error" role="alert">{actionError}</div>}
      {tickets.map(t => (
        <div key={t.key} className="tk-row">
          <div className="tk-info">
            <span className="tk-key">{t.key}</span>
            <span className="tk-title">{t.title}</span>
          </div>
          <button
            className="tk-work-btn"
            disabled={working !== null}
            onClick={() => void workOn(t)}
          >
            {working === t.key ? 'Creating…' : 'Work on this'}
          </button>
        </div>
      ))}
    </div>
  )
}
