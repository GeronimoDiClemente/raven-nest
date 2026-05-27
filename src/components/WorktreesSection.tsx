import { useEffect, useState } from 'react'
import type { WorktreeMeta } from '../types'
import { useBridge } from '../lib/bridge'
import { IDEPickerMenu } from './IDEPickerMenu'
import { useGitHub } from '../hooks/useGitHub'
import { useGitlab } from '../hooks/useGitlab'

interface Props {
  repoPath: string | null
  activeRepoPath: string | undefined
  onSelect: (worktreePath: string) => void
  onNewClick: () => void
  refreshKey?: number
}

interface DiffStat { additions: number; deletions: number }
interface PRChipInfo { number: number; url: string }

function basenameOf(p: string): string {
  // Strip trailing separators, then take the last segment. Handles both `/` and `\`.
  const trimmed = p.replace(/[\\/]+$/, '')
  const idx = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'))
  return idx >= 0 ? trimmed.slice(idx + 1) : trimmed
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
  const bridge = useBridge()
  const [worktrees, setWorktrees] = useState<WorktreeMeta[]>([])
  const [expanded, setExpanded] = useState(true)
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null)
  const [spotlightPath, setSpotlightPath] = useState<string | null>(null)
  const [idePickerAt, setIdePickerAt] = useState<{ x: number; y: number; worktreePath: string } | null>(null)
  const [pushingPath, setPushingPath] = useState<string | null>(null)
  // Diff stats and PR chips are loaded asynchronously after the worktree list
  // renders, so the sidebar never blocks on network or git calls.
  const [diffStats, setDiffStats] = useState<Record<string, DiffStat>>({})
  const [prChips, setPrChips] = useState<Record<string, PRChipInfo>>({})
  const { githubToken } = useGitHub()
  const { gitlabToken } = useGitlab()

  useEffect(() => {
    void bridge.spotlight.status().then((s) => {
      if (s.active && s.worktreePath) setSpotlightPath(s.worktreePath)
      else setSpotlightPath(null)
    })
    bridge.spotlight.onStatus((s) => {
      setSpotlightPath(s.active && s.worktreePath ? s.worktreePath : null)
    })
    return () => bridge.spotlight.removeListeners()
  }, [bridge])

  useEffect(() => {
    if (!repoPath) { setWorktrees([]); return }
    let cancelled = false
    void bridge.worktree.list(repoPath).then((res) => {
      if (cancelled) return
      if (res.ok) setWorktrees(res.worktrees)
      else { console.error('worktree:list failed', res.error); setWorktrees([]) }
    }).catch((err) => {
      console.error('worktree:list failed', err)
      if (!cancelled) setWorktrees([])
    })
    return () => { cancelled = true }
  }, [repoPath, refreshKey, bridge])

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
    bridge.preset.onSetupState(onState)
    return () => bridge.preset.removeListeners()
  }, [repoPath, bridge])

  // Fetch diff stats for all non-root worktrees in parallel. Each result drops
  // into state independently, so the list never waits for the slowest one.
  useEffect(() => {
    if (worktrees.length === 0) { setDiffStats({}); return }
    let cancelled = false
    setDiffStats({})
    const targets = worktrees.filter((w) => w.repoPath !== w.rootRepoPath)
    void Promise.allSettled(
      targets.map(async (wt) => {
        const res = await bridge.git.shortstat(wt.repoPath).catch(() => null)
        if (cancelled || !res) return
        if (res.additions === 0 && res.deletions === 0) return
        setDiffStats((prev) => ({
          ...prev,
          [wt.repoPath]: { additions: res.additions, deletions: res.deletions },
        }))
      }),
    )
    return () => { cancelled = true }
  }, [worktrees, refreshKey, bridge])

  // Fetch PR chips for all non-root worktrees in parallel.
  useEffect(() => {
    if (worktrees.length === 0) { setPrChips({}); return }
    let cancelled = false
    setPrChips({})
    const targets = worktrees.filter((w) => w.repoPath !== w.rootRepoPath && w.branch && w.branch !== 'HEAD')
    const tokens = { github: githubToken, gitlab: gitlabToken }
    void Promise.allSettled(
      targets.map(async (wt) => {
        const res = await bridge.git.findPRForBranch(wt.rootRepoPath, wt.branch, tokens).catch(() => null)
        if (cancelled || !res) return
        setPrChips((prev) => ({ ...prev, [wt.repoPath]: res }))
      }),
    )
    return () => { cancelled = true }
  }, [worktrees, refreshKey, githubToken, gitlabToken, bridge])

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
      await bridge.worktree.remove(target)
      const fresh = await bridge.worktree.list(repoPath)
      if (fresh.ok) setWorktrees(fresh.worktrees)
      else { console.error('worktree:list failed', fresh.error); setWorktrees([]) }
    } catch (err) {
      alert(`Failed: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  const handleCancelSetup = async (wtPath: string) => {
    try { await bridge.preset.cancel(wtPath) }
    catch (err) { console.error(err) }
    setContextMenu(null)
  }

  const handlePush = async (wtPath: string) => {
    setContextMenu(null)
    setPushingPath(wtPath)
    try {
      const res = await bridge.git.pushBranch(wtPath)
      if (!res.ok) {
        alert(`Push failed: ${res.error}`)
        return
      }
      if (res.compareUrl && confirm(`Pushed ${res.branch} to origin. Open "Create PR" in your browser?`)) {
        bridge.electronShell.openExternal(res.compareUrl)
      }
    } catch (err) {
      alert(`Push failed: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setPushingPath(null)
    }
  }

  const handleToggleSpotlight = async (wtPath: string) => {
    try {
      if (spotlightPath === wtPath) await bridge.spotlight.stop()
      else await bridge.spotlight.start(wtPath)
    } catch (err) {
      alert(`Spotlight: ${err instanceof Error ? err.message : String(err)}`)
    }
    setContextMenu(null)
  }

  return (
    <div className="worktrees-section">
      <div className="wt-section-header" data-tour-id="wt-header" onClick={() => setExpanded(!expanded)}>
        <span>{expanded ? '▾' : '▸'} Worktrees</span>
        <button
          className="wt-add-btn"
          data-tour-id="wt-add"
          onClick={(e) => { e.stopPropagation(); onNewClick() }}
          title="New worktree"
        >+</button>
      </div>
      {(() => {
      // Tour anchors must land on the FIRST worktree that actually RENDERS each
      // chip — not index 0 (the root never renders chips). Mirror the chips'
      // render conditions exactly, reading the same async diffStats/prChips
      // state so the anchor moves onto the element once that data loads.
      const firstDiffChipIdx = worktrees.findIndex((w) => {
        if (w.repoPath === w.rootRepoPath) return false
        const s = diffStats[w.repoPath]
        return !!s && (s.additions > 0 || s.deletions > 0)
      })
      const firstPrChipIdx = worktrees.findIndex(
        (w) => w.repoPath !== w.rootRepoPath && !!prChips[w.repoPath],
      )
      return (
      <>
      {expanded && (
        <div className="wt-list" data-tour-id="wt-list">
          {worktrees.map((wt, index) => {
            const isRoot = wt.repoPath === wt.rootRepoPath
            const stat = diffStats[wt.repoPath]
            const pr = prChips[wt.repoPath]
            const slug = basenameOf(wt.repoPath)
            return (
              <div
                key={wt.repoPath}
                className={`wt-item ${activeRepoPath === wt.repoPath ? 'wt-item-active' : ''}`}
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.effectAllowed = 'copy'
                  e.dataTransfer.setData('application/x-raven-worktree-path', wt.repoPath)
                  e.dataTransfer.setData('text/plain', wt.repoPath)
                }}
                onClick={() => onSelect(wt.repoPath)}
                onContextMenu={(e) => {
                  e.preventDefault()
                  setContextMenu({
                    x: e.clientX,
                    y: e.clientY,
                    worktreePath: wt.repoPath,
                    isRoot,
                  })
                }}
                title={wt.repoPath}
              >
                <div className="wt-item-main">
                  <span className={`wt-dot ${STATUS_DOT_CLASS[wt.setupState]}`} />
                  <span className="wt-branch">{wt.branch}</span>
                  {!isRoot && stat && (stat.additions > 0 || stat.deletions > 0) && (
                    <span className="wt-diff-chip" {...(index === firstDiffChipIdx ? { 'data-tour-id': 'wt-diff-chip' } : {})} title="Lines changed vs base">
                      {stat.additions > 0 && (
                        <span className="wt-diff-add">+{stat.additions}</span>
                      )}
                      {stat.deletions > 0 && (
                        <span className="wt-diff-del">-{stat.deletions}</span>
                      )}
                    </span>
                  )}
                  {!isRoot && pr && (
                    <button
                      type="button"
                      className="wt-pr-chip"
                      {...(index === firstPrChipIdx ? { 'data-tour-id': 'wt-pr-chip' } : {})}
                      title={`Open PR ${pr.url}`}
                      onClick={(e) => {
                        e.stopPropagation()
                        bridge.electronShell.openExternal(pr.url)
                      }}
                    >
                      #{pr.number}
                    </button>
                  )}
                  {spotlightPath === wt.repoPath && <span className="wt-spotlight" title="Spotlight active">⚡</span>}
                  <span className="wt-meta">{isRoot ? 'root' : ''}</span>
                </div>
                <div className="wt-slug" title={wt.repoPath}>{slug}</div>
              </div>
            )
          })}
          {worktrees.length === 0 && (
            <div className="wt-empty">No worktrees</div>
          )}
        </div>
      )}
      </>
      )
      })()}
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
            data-tour-id="wt-context-menu"
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
