import { useState } from 'react'
import type { WorktreeMeta } from '../types'

interface Props {
  open: boolean
  repoPath: string
  onClose: () => void
  onCreated: (meta: WorktreeMeta) => void
}

export function NewWorktreeModal({ open, repoPath, onClose, onCreated }: Props) {
  const [branch, setBranch] = useState('')
  const [path, setPath] = useState('')
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!open) return null

  const slug = branch.replace(/[\/]/g, '-').replace(/[^a-zA-Z0-9._\-]/g, '')
  const suggestedPath = path || `${repoPath}/.git/worktrees/${slug || '<branch>'}`

  const handleCreate = async () => {
    if (!branch.trim()) { setError('Branch name required'); return }
    setError(null); setCreating(true)
    try {
      const meta = await window.worktree.create({
        repoPath,
        branch: branch.trim(),
        path: path.trim() || undefined,
      })
      onCreated(meta)
      setBranch(''); setPath(''); onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setCreating(false)
    }
  }

  return (
    <div className="dialog-overlay" onClick={onClose}>
      <div className="dialog new-worktree-modal" onClick={(e) => e.stopPropagation()}>
        <div className="dialog-title">New worktree</div>
        <div className="dialog-sub">{repoPath.split(/[\/\\]/).pop()}</div>

        <label className="field-label">Branch</label>
        <input
          className="field-input"
          value={branch}
          onChange={(e) => setBranch(e.target.value)}
          placeholder="feat/billing"
          autoFocus
          disabled={creating}
        />

        <label className="field-label">Path (optional)</label>
        <input
          className="field-input"
          value={path}
          onChange={(e) => setPath(e.target.value)}
          placeholder={suggestedPath}
          disabled={creating}
        />

        {error && <div className="modal-error">{error}</div>}

        <div className="dialog-actions">
          <button className="dialog-cancel" onClick={onClose} disabled={creating}>Cancel</button>
          <button className="btn-primary" onClick={handleCreate} disabled={creating || !branch.trim()}>
            {creating ? 'Creating…' : 'Create'}
          </button>
        </div>
      </div>
    </div>
  )
}
