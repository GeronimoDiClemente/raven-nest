// src/tutorial/DemoWorkspaceMock.tsx
//
// Purely-visual static replica of the real workspace (tab bar + a terminal
// pane), used to fill the tutorial sandbox's right side so it reads like the
// real app instead of an empty void. No PTYs, no hooks, no bridge — just the
// real CSS classes with canned content tied to the demo worktree story.
import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { WORKTREE_DRAG_MIME } from '../lib/dragTypes'

const PANE_BLUE = '#0066FF'
const PANE_GREEN = '#3fb950'

/** The window-wide tab bar, with the demo worktree as the active tab. */
export function DemoTabBar() {
  return (
    <div className="tabbar" aria-hidden style={{ pointerEvents: 'none' }}>
      <div className="tabbar-tabs">
        <div className="tab">
          <span className="tab-name">main</span>
          <span className="tab-color-dot" style={{ background: '#3a3a42' }} />
        </div>
        <div className="tab active" style={{ ['--tab-accent' as string]: PANE_BLUE } as CSSProperties}>
          <span className="tab-activity-dot" />
          <span className="tab-name">feat/dark-mode</span>
          <span className="tab-color-dot" style={{ background: PANE_BLUE }} />
          <span className="tab-close">✕</span>
        </div>
      </div>
      <button className="tab-new" tabIndex={-1}>+</button>
      <div className="tabbar-drag" style={{ flex: 1 }} />
    </div>
  )
}

/** A single terminal pane showing a canned Claude Code session. */
export function DemoWorkspacePane() {
  return (
    <div className="workspace" style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, pointerEvents: 'none' }}>
      <div className="grid-workspace" style={{ flex: 1, display: 'flex', padding: 4, minHeight: 0 }}>
        <div style={{ flex: 1, minWidth: 0, display: 'flex' }}>
          <div className="terminal-pane" style={{ ['--pane-color' as string]: PANE_BLUE } as CSSProperties}>
            <div className="pane-header">
              <div className="pane-header-left">
                <span className="pane-color-btn" style={{ background: PANE_BLUE }} />
                <span className="pane-ai-label" style={{ color: PANE_BLUE, fontWeight: 600, fontSize: 11, letterSpacing: '.04em' }}>
                  CLAUDE
                </span>
                <span
                  style={{
                    fontSize: 10,
                    color: PANE_BLUE,
                    background: 'rgba(0,102,255,.12)',
                    border: '1px solid rgba(0,102,255,.3)',
                    padding: '1px 6px',
                    borderRadius: 3,
                  }}
                >
                  5173
                </span>
                <span className="pane-note" style={{ color: '#7f8694', fontSize: 12 }}>dark mode toggle</span>
              </div>
              <div style={{ display: 'flex', gap: 6, color: '#5a5a63' }}>
                <span className="pane-zoom-btn">⛶</span>
                <span className="pane-close-btn">×</span>
              </div>
            </div>
            <div className="terminal-container">
              <DemoTerminalBody />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function DemoTerminalBody() {
  const mono = '"SF Mono", "JetBrains Mono", Menlo, Consolas, monospace'
  return (
    <div
      style={{
        height: '100%',
        background: '#000',
        color: '#d6d6dc',
        fontFamily: mono,
        fontSize: 12.5,
        lineHeight: 1.55,
        padding: '8px 10px',
        overflow: 'hidden',
        whiteSpace: 'pre-wrap',
      }}
    >
      <div style={{ color: '#6b6b74' }}>~/nest-web · <span style={{ color: PANE_BLUE }}>feat/dark-mode</span></div>
      <div style={{ height: 8 }} />
      <div><span style={{ color: '#5a8cff' }}>{'>'}</span> add a dark theme toggle to the settings panel</div>
      <div style={{ height: 8 }} />
      <div><span style={{ color: '#9cc0ff' }}>●</span> I'll add a ThemeToggle and wire it to the settings store.</div>
      <div style={{ height: 6 }} />
      <div style={{ color: '#8a8a93' }}>  Updated <span style={{ color: '#d6d6dc' }}>src/theme.ts</span>  <span style={{ color: '#3fb950' }}>+8</span> <span style={{ color: '#f85149' }}>-1</span></div>
      <div style={{ color: '#8a8a93' }}>  Added   <span style={{ color: '#d6d6dc' }}>src/components/ThemeToggle.tsx</span>  <span style={{ color: '#3fb950' }}>+24</span></div>
      <div style={{ height: 6 }} />
      <div style={{ color: '#3fb950' }}>  ✓ dev server ready on http://localhost:5173</div>
      <div style={{ height: 10 }} />
      <div><span style={{ color: '#5a8cff' }}>{'>'}</span> <span style={{ background: '#d6d6dc', color: '#000' }}>&nbsp;</span></div>
    </div>
  )
}

interface FakePane {
  id: string
  label: string
  color: string
  branch: string
  /** Folder the pane is pointed at (changes when the user selects another worktree). */
  repoPath: string
  /** Folder the (fake) process is actually running in. Diverges from repoPath → Sync cwd. */
  runningRepoPath: string
  kind: 'claude' | 'tests'
}

let dropPaneCounter = 0

const SEED_FEAT = 'C:/demo/.worktrees/nest-web/feat-dark-mode'
const SEED_ROOT = 'C:/demo/nest-web'

interface DemoWorkspaceProps {
  /** Resolve a dropped worktree path to its branch (reads the live demo store). */
  resolveBranch: (repoPath: string) => string | undefined
  /** The worktree the user last selected in the sidebar — diverges the focused pane. */
  selectedRepoPath: string | null
  /** Fired when a dropped worktree opens a fake terminal pane. */
  onPaneOpened?: () => void
  /** Fired when the user clicks Sync cwd. */
  onSyncCwd?: () => void
}

/**
 * Stateful, interactive replica of the workspace. Accepts real worktree drags
 * (same MIME as the live app) to "open" fake terminals, and shows a Sync cwd
 * button when the focused pane points at a different folder than it's running
 * in. No PTYs — everything is local React state.
 */
export function DemoWorkspace({ resolveBranch, selectedRepoPath, onPaneOpened, onSyncCwd }: DemoWorkspaceProps) {
  const [panes, setPanes] = useState<FakePane[]>(() => [
    { id: 'pane-claude', label: 'CLAUDE', color: PANE_BLUE, branch: 'feat/dark-mode', repoPath: SEED_FEAT, runningRepoPath: SEED_FEAT, kind: 'claude' },
    { id: 'pane-tests', label: 'CODEX', color: PANE_GREEN, branch: 'main', repoPath: SEED_ROOT, runningRepoPath: SEED_ROOT, kind: 'tests' },
  ])
  const [focusedId, setFocusedId] = useState('pane-claude')
  const [dropActive, setDropActive] = useState(false)
  const [restartingId, setRestartingId] = useState<string | null>(null)
  const restartTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Selecting a different worktree points the focused pane at it; its
  // runningRepoPath stays stale → the Sync cwd button appears.
  useEffect(() => {
    if (!selectedRepoPath) return
    setPanes((prev) => prev.map((p) => (p.id === focusedId ? { ...p, repoPath: selectedRepoPath } : p)))
  }, [selectedRepoPath, focusedId])

  useEffect(() => () => { if (restartTimer.current) clearTimeout(restartTimer.current) }, [])

  const onDragOver = (e: React.DragEvent) => {
    if (!Array.from(e.dataTransfer.types).includes(WORKTREE_DRAG_MIME)) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
    if (!dropActive) setDropActive(true)
  }
  const onDragLeave = (e: React.DragEvent) => {
    if (e.currentTarget.contains(e.relatedTarget as Node)) return
    setDropActive(false)
  }
  const onDrop = (e: React.DragEvent) => {
    const path = e.dataTransfer.getData(WORKTREE_DRAG_MIME)
    setDropActive(false)
    if (!path) return
    e.preventDefault()
    const branch = resolveBranch(path) ?? path
    const id = `pane-drop-${++dropPaneCounter}`
    setPanes((prev) => [...prev, { id, label: 'CLAUDE', color: PANE_BLUE, branch, repoPath: path, runningRepoPath: path, kind: 'claude' }])
    setFocusedId(id)
    onPaneOpened?.()
  }

  const syncCwd = (paneId: string) => {
    setRestartingId(paneId)
    setPanes((prev) => prev.map((p) => (p.id === paneId ? { ...p, runningRepoPath: p.repoPath } : p)))
    onSyncCwd?.()
    if (restartTimer.current) clearTimeout(restartTimer.current)
    restartTimer.current = setTimeout(() => setRestartingId(null), 600)
  }

  // Only the first diverged pane carries the tour anchor (avoid duplicate ids).
  const firstDivergedId = panes.find((p) => p.repoPath !== p.runningRepoPath)?.id ?? null

  return (
    <div
      className={`workspace${dropActive ? ' grid-workspace--drop-target' : ''}`}
      data-testid="demo-workspace"
      style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <div className="grid-workspace" style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 4, padding: 4, minHeight: 0 }}>
        {panes.map((p) => (
          <DemoPane
            key={p.id}
            pane={p}
            focused={p.id === focusedId}
            restarting={restartingId === p.id}
            tourAnchor={p.id === firstDivergedId}
            onFocus={() => setFocusedId(p.id)}
            onSync={() => syncCwd(p.id)}
          />
        ))}
      </div>
    </div>
  )
}

function DemoPane({
  pane,
  focused,
  restarting,
  tourAnchor,
  onFocus,
  onSync,
}: {
  pane: FakePane
  focused: boolean
  restarting: boolean
  tourAnchor: boolean
  onFocus: () => void
  onSync: () => void
}) {
  const diverged = pane.repoPath !== pane.runningRepoPath
  return (
    <div
      className="terminal-pane"
      style={{ flex: 1, minHeight: 0, outline: focused ? `1px solid ${pane.color}55` : 'none', ['--pane-color' as string]: pane.color } as CSSProperties}
      onClick={onFocus}
    >
      <div className="pane-header">
        <div className="pane-header-left">
          <span className="pane-color-btn" style={{ background: pane.color }} />
          <span className="pane-ai-label" style={{ color: pane.color, fontWeight: 600, fontSize: 11, letterSpacing: '.04em' }}>
            {pane.label}
          </span>
          <span
            style={{
              fontSize: 10,
              color: pane.color,
              background: `${pane.color}1f`,
              border: `1px solid ${pane.color}4d`,
              padding: '1px 6px',
              borderRadius: 3,
            }}
          >
            {pane.kind === 'claude' ? '5173' : 'test'}
          </span>
          <span className="pane-note" style={{ color: '#7f8694', fontSize: 12 }}>{pane.branch}</span>
          {diverged && (
            <button
              className="pane-sync-cwd-btn"
              {...(tourAnchor ? { 'data-tour-id': 'pane-sync-cwd-btn' } : {})}
              onClick={(e) => { e.stopPropagation(); onSync() }}
              title="Restart this terminal in the selected worktree's folder"
              style={{
                fontSize: 10,
                color: '#ffb454',
                background: 'rgba(255,180,84,.12)',
                border: '1px solid rgba(255,180,84,.35)',
                padding: '1px 7px',
                borderRadius: 4,
                cursor: 'pointer',
              }}
            >
              Sync cwd
            </button>
          )}
        </div>
        <div style={{ display: 'flex', gap: 6, color: '#5a5a63' }}>
          <span className="pane-zoom-btn">⛶</span>
          <span className="pane-close-btn">×</span>
        </div>
      </div>
      <div className="terminal-container">
        <DemoPaneBody pane={pane} restarting={restarting} />
      </div>
    </div>
  )
}

function basenameOf(p: string): string {
  const trimmed = p.replace(/[\\/]+$/, '')
  const idx = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'))
  return idx >= 0 ? trimmed.slice(idx + 1) : trimmed
}

function DemoPaneBody({ pane, restarting }: { pane: FakePane; restarting: boolean }) {
  const mono = '"SF Mono", "JetBrains Mono", Menlo, Consolas, monospace'
  const folder = basenameOf(pane.runningRepoPath)
  const base: CSSProperties = {
    height: '100%',
    background: '#000',
    color: '#d6d6dc',
    fontFamily: mono,
    fontSize: 12.5,
    lineHeight: 1.55,
    padding: '8px 10px',
    overflow: 'hidden',
    whiteSpace: 'pre-wrap',
  }
  if (restarting) {
    return (
      <div style={base}>
        <div style={{ color: '#ffb454' }}>↻ Restarting in {folder}…</div>
      </div>
    )
  }
  if (pane.kind === 'tests') {
    return (
      <div style={base}>
        <div style={{ color: '#6b6b74' }}><span style={{ color: PANE_GREEN }}>{`~/${folder} · ${pane.branch}`}</span></div>
        <div style={{ height: 8 }} />
        <div><span style={{ color: PANE_GREEN }}>$</span> npm test --watch</div>
        <div style={{ height: 6 }} />
        <div style={{ color: '#3fb950' }}>  ✓ theme toggles to dark (12 ms)</div>
        <div style={{ color: '#3fb950' }}>  ✓ persists preference (4 ms)</div>
        <div style={{ color: '#8a8a93' }}>  Tests: <span style={{ color: '#3fb950' }}>2 passed</span>, 2 total</div>
        <div style={{ height: 10 }} />
        <div><span style={{ color: PANE_GREEN }}>$</span> <span style={{ background: '#d6d6dc', color: '#000' }}>&nbsp;</span></div>
      </div>
    )
  }
  return (
    <div style={base}>
      <div style={{ color: '#6b6b74' }}><span style={{ color: PANE_BLUE }}>{`~/${folder} · ${pane.branch}`}</span></div>
      <div style={{ height: 8 }} />
      <div><span style={{ color: '#5a8cff' }}>{'>'}</span> add a dark theme toggle to the settings panel</div>
      <div style={{ height: 8 }} />
      <div><span style={{ color: '#9cc0ff' }}>●</span> I'll add a ThemeToggle and wire it to the settings store.</div>
      <div style={{ height: 6 }} />
      <div style={{ color: '#8a8a93' }}>  Updated <span style={{ color: '#d6d6dc' }}>src/theme.ts</span>  <span style={{ color: '#3fb950' }}>+8</span> <span style={{ color: '#f85149' }}>-1</span></div>
      <div style={{ color: '#8a8a93' }}>  Added   <span style={{ color: '#d6d6dc' }}>src/components/ThemeToggle.tsx</span>  <span style={{ color: '#3fb950' }}>+24</span></div>
      <div style={{ height: 6 }} />
      <div style={{ color: '#3fb950' }}>  ✓ dev server ready on http://localhost:5173</div>
      <div style={{ height: 10 }} />
      <div><span style={{ color: '#5a8cff' }}>{'>'}</span> <span style={{ background: '#d6d6dc', color: '#000' }}>&nbsp;</span></div>
    </div>
  )
}
