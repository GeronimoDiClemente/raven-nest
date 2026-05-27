import { useEffect, useState } from 'react'
import type { RavenPreset, WorktreeMeta } from '../types'
import { useBridge } from '../lib/bridge'

interface Props {
  open: boolean
  repoPath: string
  onClose: () => void
  onCreated: (meta: WorktreeMeta) => void
}

export function NewWorktreeModal({ open, repoPath, onClose, onCreated }: Props) {
  const bridge = useBridge()
  const [branch, setBranch] = useState('')
  const [path, setPath] = useState('')
  const [presets, setPresets] = useState<RavenPreset[]>([])
  const [presetId, setPresetId] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [branches, setBranches] = useState<string[]>([])
  const [fromBranch, setFromBranch] = useState<string>('')
  const [envFiles, setEnvFiles] = useState<string[]>([])
  const [copyEnvFiles, setCopyEnvFiles] = useState(true)

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
    void bridge.preset.list(repoPath).then(setPresets).catch(() => setPresets([]))
    void bridge.git.listBranches(repoPath).then((res) => {
      setBranches(res.branches)
      // Default to the repo's default branch (main/master/develop/origin HEAD).
      setFromBranch(res.defaultBranch ?? res.branches[0] ?? '')
    }).catch(() => {
      setBranches([])
      setFromBranch('')
    })
    // Detect untracked .env* files so we can warn — git worktree add does not
    // copy them, which silently breaks dev servers in the new worktree.
    void bridge.git.listUntrackedEnvFiles(repoPath).then(setEnvFiles).catch(() => setEnvFiles([]))
  }, [open, repoPath, bridge])

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
      const meta = await bridge.worktree.create({
        repoPath,
        branch: branch.trim(),
        fromBranch: fromBranch || undefined,
        path: path.trim() || undefined,
        presetId: presetId ?? undefined,
      })
      // Best-effort .env carry-over. Failures are logged but never abort the
      // create flow — the worktree already exists at this point.
      if (copyEnvFiles && envFiles.length > 0) {
        try {
          await bridge.worktree.copyFiles(repoPath, meta.repoPath, envFiles)
        } catch (copyErr) {
          console.warn('[NewWorktreeModal] env carry-over failed', copyErr)
        }
      }
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
      <div className="dialog new-worktree-modal" data-tour-id="wt-modal" onClick={(e) => e.stopPropagation()}>
        <div className="dialog-title">New worktree</div>
        <div className="dialog-sub">{repoPath.split(/[\/\\]/).pop()}</div>

        <label className="field-label">Branch</label>
        <input
          className="field-input"
          data-tour-id="wt-branch-input"
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
        <div className="preset-cards" data-tour-id="wt-presets">
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

        {envFiles.length > 0 && (
          <div className="wt-env-banner" data-tour-id="wt-env-banner">
            <div className="wt-env-banner-text">
              <span className="wt-env-banner-icon">⚠</span>
              <strong>{envFiles.length}</strong> untracked .env file{envFiles.length === 1 ? '' : 's'} won't be copied to the new worktree.
            </div>
            <ul className="wt-env-banner-list">
              {envFiles.slice(0, 6).map((f) => (
                <li key={f}>{f}</li>
              ))}
              {envFiles.length > 6 && <li>…and {envFiles.length - 6} more</li>}
            </ul>
            <label className="wt-env-banner-copy">
              <input
                type="checkbox"
                checked={copyEnvFiles}
                onChange={(e) => setCopyEnvFiles(e.target.checked)}
                disabled={creating}
              />
              Copy these files to the new worktree after creation
            </label>
          </div>
        )}

        <div className="dialog-actions">
          <button className="dialog-cancel" onClick={onClose} disabled={creating}>Cancel</button>
          <button className="btn-primary" data-tour-id="wt-create-btn" onClick={handleCreate} disabled={creating || !branch.trim()}>
            {creating ? 'Creating…' : 'Create'}
          </button>
        </div>
      </div>
    </div>
  )
}
