import { useEffect, useMemo, useState } from 'react'
import { useGitHub } from '../hooks/useGitHub'
import { useUserRepos } from '../hooks/useUserRepos'
import type { BoardRow } from '../integrations/board'
import type { Ticket, WorktreeMeta } from '../types'

// worktree:create actually resolves to this union (see the handler in
// electron/main.ts); the bridge type in src/types.ts predates it and still
// says Promise<WorktreeMeta>, so we narrow here through unknown — same
// pattern as MyTicketsView/MyReposPanel.
type WorktreeCreateResult = { ok: true; meta: WorktreeMeta } | { ok: false; error: string }

interface Props {
  row: BoardRow
  onClose: () => void
  onCreated?: () => void
}

/** GitHub ticket keys encode the repo ("owner/repo#7", see tickets-github.ts);
 *  Jira/Linear keys ("PROJ-142") don't map to a single repo, so there's
 *  nothing to pre-select for them. */
function deriveRepoFullName(row: BoardRow): string | null {
  if (row.pluginId !== 'github') return null
  const i = row.key.indexOf('#')
  return i > 0 ? row.key.slice(0, i) : null
}

/**
 * Opens when a board task row is clicked (OrchestrationBoard/IntegrationsRail).
 * Unlinked rows (`row.branch === null`) get a "Create worktree" form that
 * reuses MyTicketsView.workOn's exact flow: tickets.branchName -> worktree.create
 * -> tickets.startWork. Linked rows get an "Open" action for the ticket URL —
 * opening a real terminal pane on the worktree is App-level and out of scope here.
 */
export function WorktreePicker({ row, onClose, onCreated }: Props) {
  const { githubLogin } = useGitHub()
  const { repos } = useUserRepos()

  // Only repos with a local folder can be worktree.create'd from.
  const candidates = useMemo(() => repos.filter((r) => r.local_path), [repos])
  const suggestedRepo = useMemo(() => deriveRepoFullName(row), [row])

  const [repoId, setRepoId] = useState('')
  useEffect(() => {
    if (repoId || candidates.length === 0) return
    const match = candidates.find((r) => r.repo_full_name === suggestedRepo)
    setRepoId(match?.id ?? candidates[0].id)
  }, [candidates, suggestedRepo, repoId])

  const [branch, setBranch] = useState('')
  const [branchTouched, setBranchTouched] = useState(false)
  useEffect(() => {
    if (branchTouched || row.branch) return
    let cancelled = false
    window.tickets.branchName(githubLogin ?? '', row.key, row.title).then((b) => {
      if (!cancelled) setBranch(b)
    })
    return () => { cancelled = true }
  }, [row.key, row.title, row.branch, githubLogin, branchTouched])

  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleCreate() {
    if (busy) return
    const repo = candidates.find((r) => r.id === repoId)
    if (!repo || !repo.local_path) { setError('Pick a repo with a local folder'); return }
    if (!branch.trim()) { setError('Branch name required'); return }
    setBusy(true)
    setError(null)
    try {
      const res = await window.worktree.create({ repoPath: repo.local_path, branch }) as unknown as WorktreeCreateResult
      if (!res.ok) { setError(res.error || 'worktree failed'); return }
      const ticket: Ticket = { key: row.key, providerId: row.providerId, title: row.title, url: row.url, state: row.ticketState, context: '' }
      const started = await window.tickets.startWork({ pluginId: row.pluginId, ticket, branch, worktreePath: res.meta.repoPath })
      if (!started.ok) { setError(`Could not start work: ${started.error}`); return }
      onCreated?.()
      onClose()
    } catch (e) {
      // Any bridge call can reject (handler threw, keyring locked, …): show it
      // instead of dying as an unhandled rejection with a silent spinner.
      setError(e instanceof Error ? e.message : 'Failed to create the worktree')
    } finally {
      setBusy(false)
    }
  }

  function handleOpen() {
    window.electronShell?.openExternal?.(row.url)
  }

  return (
    <div className="dialog-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onClose() }}>
      <div className="dialog wtp-dialog">
        <div className="dialog-title">{row.key}</div>
        <div className="dialog-sub">{row.title}</div>

        {row.branch ? (
          <>
            <label className="field-label">Worktree branch</label>
            <div className="wtp-branch">{row.branch}</div>
          </>
        ) : (
          <>
            <label className="field-label">Repo</label>
            <select
              className="field-input"
              value={repoId}
              onChange={(e) => setRepoId(e.target.value)}
              disabled={busy || candidates.length === 0}
            >
              {candidates.length === 0 && <option value="">No repos with a local folder</option>}
              {candidates.map((r) => (
                <option key={r.id} value={r.id}>{r.repo_full_name}</option>
              ))}
            </select>

            <label className="field-label">Branch</label>
            <input
              className="field-input"
              value={branch}
              onChange={(e) => { setBranch(e.target.value); setBranchTouched(true) }}
              disabled={busy}
            />
          </>
        )}

        {error && <div className="modal-error" role="alert">{error}</div>}

        <div className="confirm-actions">
          <button className="confirm-btn-cancel" onClick={onClose} disabled={busy}>Cancel</button>
          {row.branch ? (
            <button className="confirm-btn-ok" onClick={handleOpen}>Open</button>
          ) : (
            <button
              className="confirm-btn-ok"
              onClick={() => void handleCreate()}
              disabled={busy || !repoId || !branch.trim()}
            >
              {busy ? 'Creating…' : 'Create worktree'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
