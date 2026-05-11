import { useEffect, useState } from 'react'
import type { WorktreeMeta } from '../types'
import { IDEPickerMenu } from './IDEPickerMenu'

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
  const [spotlightPath, setSpotlightPath] = useState<string | null>(null)
  const [idePickerAt, setIdePickerAt] = useState<{ x: number; y: number; worktreePath: string } | null>(null)
  const [pushingPath, setPushingPath] = useState<string | null>(null)

  useEffect(() => {
    void window.spotlight.status().then((s) => {
      if (s.active && s.worktreePath) setSpotlightPath(s.worktreePath)
      else setSpotlightPath(null)
    })
    window.spotlight.onStatus((s) => {
      setSpotlightPath(s.active && s.worktreePath ? s.worktreePath : null)
    })
    return () => window.spotlight.removeListeners()
  }, [])

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
    if (!repoPath) return
    const onState = (worktreePath: string, state: string) => {
      setWorktrees((prev) =>
        prev.map((wt) =>
          wt.repoPath === worktreePath
            ? { ...wt, setupState: state as WorktreeMeta['setupState'] }
            : wt
        )
      )
    }
    window.preset.onSetupState(onState)
    return () => window.preset.removeListeners()
  }, [repoPath])

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

  const handleCancelSetup = async (wtPath: string) => {
    try { await window.preset.cancel(wtPath) }
    catch (err) { console.error(err) }
    setContextMenu(null)
  }

  const handlePush = async (wtPath: string) => {
    setContextMenu(null)
    setPushingPath(wtPath)
    try {
      const res = await window.git.pushBranch(wtPath)
      if (!res.ok) {
        alert(`Push failed: ${res.error}`)
        return
      }
      if (res.compareUrl && confirm(`Pushed ${res.branch} to origin. Open "Create PR" in your browser?`)) {
        window.electronShell.openExternal(res.compareUrl)
      }
    } catch (err) {
      alert(`Push failed: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setPushingPath(null)
    }
  }

  const handleToggleSpotlight = async (wtPath: string) => {
    try {
      if (spotlightPath === wtPath) await window.spotlight.stop()
      else await window.spotlight.start(wtPath)
    } catch (err) {
      alert(`Spotlight: ${err instanceof Error ? err.message : String(err)}`)
    }
    setContextMenu(null)
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
              {spotlightPath === wt.repoPath && <span className="wt-spotlight" title="Spotlight active">⚡</span>}
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
      {idePickerAt && (
        <IDEPickerMenu
          worktreePath={idePickerAt.worktreePath}
          position={{ x: idePickerAt.x, y: idePickerAt.y }}
          onClose={() => setIdePickerAt(null)}
        />
      )}
      {contextMenu && (() => {
        const wt = worktrees.find((w) => w.repoPath === contextMenu.worktreePath)
        const isRunning = wt?.setupState === 'running'
        return (
          <div
            className="wt-context-menu"
            style={{ top: contextMenu.y, left: contextMenu.x }}
            onClick={(e) => e.stopPropagation()}
          >
            {isRunning && (
              <button
                className="wt-ctx-item"
                onClick={() => handleCancelSetup(contextMenu.worktreePath)}
              >
                Cancel setup
              </button>
            )}
            {!contextMenu.isRoot && (
              <button
                className="wt-ctx-item"
                onClick={() => handleToggleSpotlight(contextMenu.worktreePath)}
              >
                {spotlightPath === contextMenu.worktreePath ? 'Stop Spotlight' : 'Start Spotlight'}
              </button>
            )}
            <button
              className="wt-ctx-item"
              onClick={() => {
                setIdePickerAt({ x: contextMenu.x, y: contextMenu.y, worktreePath: contextMenu.worktreePath })
                setContextMenu(null)
              }}
            >
              Open in IDE…
            </button>
            <button
              className="wt-ctx-item"
              onClick={() => handlePush(contextMenu.worktreePath)}
              disabled={pushingPath === contextMenu.worktreePath}
            >
              {pushingPath === contextMenu.worktreePath ? 'Pushing…' : 'Push to GitHub'}
            </button>
            <button
              className="wt-ctx-item"
              onClick={handleRemove}
              disabled={contextMenu.isRoot}
            >
              {contextMenu.isRoot ? 'Cannot remove root' : 'Remove worktree'}
            </button>
          </div>
        )
      })()}
    </div>
  )
}
