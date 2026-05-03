import { useEffect, useState } from 'react'
import type { WorktreeMeta } from '../types'

interface Props {
  repoPath: string | null
  activeRepoPath: string | undefined
  onSelect: (worktreePath: string) => void
  onNewClick: () => void
}

const STATUS_DOT_CLASS: Record<WorktreeMeta['setupState'], string> = {
  idle: 'wt-dot-gray',
  running: 'wt-dot-yellow',
  done: 'wt-dot-green',
  failed: 'wt-dot-red',
  cancelled: 'wt-dot-gray',
  orphaned: 'wt-dot-gray',
}

export function WorktreesSection({ repoPath, activeRepoPath, onSelect, onNewClick }: Props) {
  const [worktrees, setWorktrees] = useState<WorktreeMeta[]>([])
  const [expanded, setExpanded] = useState(true)

  useEffect(() => {
    if (!repoPath) { setWorktrees([]); return }
    let cancelled = false
    void window.worktree.list(repoPath).then((wts) => {
      if (!cancelled) setWorktrees(wts)
    }).catch(() => { if (!cancelled) setWorktrees([]) })
    return () => { cancelled = true }
  }, [repoPath])

  if (!repoPath) return null

  return (
    <div className="worktrees-section">
      <div className="wt-section-header" onClick={() => setExpanded(!expanded)}>
        <span>{expanded ? '▾' : '▸'} Worktrees</span>
        <button
          className="wt-add-btn"
          onClick={(e) => { e.stopPropagation(); onNewClick() }}
          title="New worktree"
        >+</button>
      </div>
      {expanded && (
        <div className="wt-list">
          {worktrees.map((wt) => (
            <div
              key={wt.repoPath}
              className={`wt-item ${activeRepoPath === wt.repoPath ? 'wt-item-active' : ''}`}
              onClick={() => onSelect(wt.repoPath)}
              title={wt.repoPath}
            >
              <span className={`wt-dot ${STATUS_DOT_CLASS[wt.setupState]}`} />
              <span className="wt-branch">{wt.branch}</span>
              <span className="wt-meta">
                {wt.repoPath === wt.rootRepoPath ? 'root' : ''}
              </span>
            </div>
          ))}
          {worktrees.length === 0 && (
            <div className="wt-empty">No worktrees</div>
          )}
        </div>
      )}
    </div>
  )
}
