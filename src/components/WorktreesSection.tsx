import { useEffect, useState } from 'react'
import type { WorktreeMeta } from '../types'

interface Props {
  repoPath: string | null
  activeRepoPath: string | undefined
  onSelect: (worktreePath: string) => void
  onNewClick: () => void
  refreshKey?: number
}

const STATUS_DOT_CLASS: Record<WorktreeMeta['setupState'], string> = {
  idle: 'wt-dot-gray',
  running: 'wt-dot-yellow',
  done: 'wt-dot-green',
  failed: 'wt-dot-red',
  cancelled: 'wt-dot-gray',
  orphaned: 'wt-dot-gray',
}

interface ContextMenuState {
  x: number
  y: number
  worktreePath: string
  isRoot: boolean
}

export function WorktreesSection({ repoPath, activeRepoPath, onSelect, onNewClick, refreshKey }: Props) {
  const [worktrees, setWorktrees] = useState<WorktreeMeta[]>([])
  const [expanded, setExpanded] = useState(true)
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null)

  useEffect(() => {
    if (!repoPath) { setWorktrees([]); return }
    let cancelled = false
    void window.worktree.list(repoPath).then((wts) => {
      if (!cancelled) setWorktrees(wts)
    }).catch((err) => {
      console.error('worktree:list failed', err)
      if (!cancelled) setWorktrees([])
    })
    return () => { cancelled = true }
  }, [repoPath, refreshKey])

  useEffect(() => {
    if (!contextMenu) return
    const close = () => setContextMenu(null)
    window.addEventListener('click', close)
    return () => window.removeEventListener('click', close)
  }, [contextMenu])

  if (!repoPath) return null

  const handleRemove = async () => {
    if (!contextMenu || contextMenu.isRoot) { setContextMenu(null); return }
    if (!confirm(`Remove worktree at ${contextMenu.worktreePath}?`)) {
      setContextMenu(null); return
    }
    const target = contextMenu.worktreePath
    setContextMenu(null)
    try {
      await window.worktree.remove(target)
      const fresh = await window.worktree.list(repoPath)
      setWorktrees(fresh)
    } catch (err) {
      alert(`Failed: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

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
              onContextMenu={(e) => {
                e.preventDefault()
                setContextMenu({
                  x: e.clientX,
                  y: e.clientY,
                  worktreePath: wt.repoPath,
                  isRoot: wt.repoPath === wt.rootRepoPath,
                })
              }}
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
      {contextMenu && (
        <div
          className="wt-context-menu"
          style={{ top: contextMenu.y, left: contextMenu.x }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            className="wt-ctx-item"
            onClick={handleRemove}
            disabled={contextMenu.isRoot}
          >
            {contextMenu.isRoot ? 'Cannot remove root' : 'Remove worktree'}
          </button>
        </div>
      )}
    </div>
  )
}
