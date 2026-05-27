// src/tutorial/DemoWorkspaceMock.tsx
//
// Purely-visual static replica of the real workspace (tab bar + a terminal
// pane), used to fill the tutorial sandbox's right side so it reads like the
// real app instead of an empty void. No PTYs, no hooks, no bridge — just the
// real CSS classes with canned content tied to the demo worktree story.
import type { CSSProperties } from 'react'

const PANE_BLUE = '#0066FF'

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
