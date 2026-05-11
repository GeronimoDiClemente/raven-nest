import { useEffect, useState } from 'react'
import type { RavenPreset, WorktreeMeta } from '../types'

interface Props {
  open: boolean
  repoPath: string
  onClose: () => void
  onCreated: (meta: WorktreeMeta) => void
}

export function NewWorktreeModal({ open, repoPath, onClose, onCreated }: Props) {
  const [branch, setBranch] = useState('')
  const [path, setPath] = useState('')
  const [presets, setPresets] = useState<RavenPreset[]>([])
  const [presetId, setPresetId] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [branches, setBranches] = useState<string[]>([])
  const [fromBranch, setFromBranch] = useState<string>('')

  useEffect(() => {
    if (!open) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !creating) onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open, creating, onClose])

  useEffect(() => {
    if (!open) return
    void window.preset.list(repoPath).then(setPresets).catch(() => setPresets([]))
    void window.git.listBranches(repoPath).then((res) => {
      setBranches(res.branches)
      // Default to the repo's default branch (main/master/develop/origin HEAD).
      setFromBranch(res.defaultBranch ?? res.branches[0] ?? '')
    }).catch(() => {
      setBranches([])
      setFromBranch('')
    })
  }, [open, repoPath])

  if (!open) return null

  const slug = branch.replace(/[\/]/g, '-').replace(/[^a-zA-Z0-9._\-]/g, '')
  // Sibling-directory default (matches what worktree:create uses on the main side).
  // The previous default pointed inside `.git/worktrees/`, which is git's internal
  // metadata folder and produces corrupt worktrees.
  const repoPosix = repoPath.replace(/\\/g, '/').replace(/\/$/, '')
  const lastSlash = repoPosix.lastIndexOf('/')
  const parentDir = lastSlash >= 0 ? repoPosix.slice(0, lastSlash) : ''
  const repoName = lastSlash >= 0 ? repoPosix.slice(lastSlash + 1) : repoPosix
  const suggestedPath = path || `${parentDir}/${repoName}-${slug || '<branch>'}`

  const handleCreate = async () => {
    if (!branch.trim()) { setError('Branch name required'); return }
    setError(null); setCreating(true)
    try {
      const meta = await window.worktree.create({
        repoPath,
        branch: branch.trim(),
        fromBranch: fromBranch || undefined,
        path: path.trim() || undefined,
        presetId: presetId ?? undefined,
      })
      onCreated(meta)
      setBranch(''); setPath(''); setPresetId(null); onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setCreating(false)
    }
  }

  return (
    <div className="dialog-overlay" onClick={creating ? undefined : onClose}>
      <div className="dialog new-worktree-modal" onClick={(e) => e.stopPropagation()}>
        <div className="dialog-title">New worktree</div>
        <div className="dialog-sub">{repoPath.split(/[\/\\]/).pop()}</div>

        <label className="field-label">Branch</label>
        <input
          className="field-input"
          value={branch}
          onChange={(e) => setBranch(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !creating && branch.trim()) handleCreate()
          }}
          placeholder="feat/billing"
          autoFocus
          disabled={creating}
        />

        {branches.length > 0 && (
          <>
            <label className="field-label">Create from</label>
            <select
              className="field-input"
              value={fromBranch}
              onChange={(e) => setFromBranch(e.target.value)}
              disabled={creating}
            >
              {branches.map((b) => (
                <option key={b} value={b}>{b}</option>
              ))}
            </select>
          </>
        )}

        <label className="field-label">Path (optional)</label>
        <input
          className="field-input"
          value={path}
          onChange={(e) => setPath(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !creating && branch.trim()) handleCreate()
          }}
          placeholder={suggestedPath}
          disabled={creating}
        />

        <label className="field-label">Preset</label>
        <div className="preset-cards">
          <button
            type="button"
            className={`preset-card ${presetId === null ? 'preset-card-selected' : ''}`}
            onClick={() => setPresetId(null)}
            disabled={creating}
          >
            <span className="preset-card-name">Empty</span>
            <span className="preset-card-desc">No setup, no ports</span>
          </button>
          {presets.map((p) => (
            <button
              key={p.id}
              type="button"
              className={`preset-card ${presetId === p.id ? 'preset-card-selected' : ''}`}
              onClick={() => setPresetId(p.id)}
              disabled={creating}
              title={p.description}
            >
              <span className="preset-card-name">{p.name}</span>
              <span className="preset-card-desc">
                {p.ports?.length ? `:${p.ports.join(' :')}` : ''}
                {p.dev ? ` · ${p.dev}` : ''}
              </span>
            </button>
          ))}
        </div>

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
