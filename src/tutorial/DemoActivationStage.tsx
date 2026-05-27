// src/tutorial/DemoActivationStage.tsx
import { useState } from 'react'
import NewPaneDialog from '../components/NewPaneDialog'

/**
 * High-fidelity demo surface for the activation tour. Replicates the app chrome
 * with the real global.css classes and mounts the REAL NewPaneDialog so the
 * coachmark anchors point at genuine UI. All actions are inert (demo only).
 */
export function DemoActivationStage() {
  const [dialogOpen, setDialogOpen] = useState(false)

  return (
    <div className="demo-stage" style={{ position: 'fixed', inset: 0, zIndex: 1500, background: 'var(--bg, #0b0b0c)' }}>
      <div className="titlebar" style={{ height: 36, display: 'flex', alignItems: 'center', gap: 8, padding: '0 12px', borderBottom: '1px solid #1b1b20' }}>
        <div data-tour-id="workspace-tabs" style={{ display: 'flex', gap: 6, marginLeft: 14 }}>
          <span className="tb-tab" style={{ fontSize: 11, color: '#b9bcc4', background: '#17171b', border: '1px solid #24242a', padding: '3px 12px', borderRadius: '7px 7px 0 0' }}>Workspace</span>
          <span className="tb-tab add" style={{ color: '#6b6b74' }}>+</span>
        </div>
      </div>

      <div style={{ position: 'absolute', left: 0, top: 36, bottom: 0, width: 54, borderRight: '1px solid #1b1b20', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16, paddingTop: 16 }}>
        <div data-tour-id="link-repo" className="sb-ico" style={{ width: 26, height: 26, borderRadius: 7, background: '#1a1a1f', border: '1px solid #24242a' }} />
        <div className="sb-ico" style={{ width: 26, height: 26, borderRadius: 7, background: '#1a1a1f', border: '1px solid #24242a', opacity: .5 }} />
      </div>

      <div style={{ position: 'absolute', left: 54, right: 0, top: 36, bottom: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 14 }}>
        <div className="logo" style={{ width: 52, height: 52, borderRadius: 14, background: 'linear-gradient(150deg,#2f6dff,#7c3aed)' }} />
        <div style={{ fontSize: 26, fontWeight: 700 }}>Nest</div>
        <button
          data-tour-id="new-terminal"
          className="btn-newterm"
          onClick={() => setDialogOpen(true)}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 9, fontSize: 14, fontWeight: 600, color: '#fff', background: '#2f6dff', border: 'none', borderRadius: 11, padding: '12px 20px', cursor: 'pointer' }}
        >
          <span style={{ fontSize: 17 }}>+</span> New Terminal
        </button>
      </div>

      {dialogOpen && (
        <div data-tour-id="ai-grid">
          <NewPaneDialog
            onConfirm={() => setDialogOpen(false)}
            onCancel={() => setDialogOpen(false)}
          />
        </div>
      )}
    </div>
  )
}
