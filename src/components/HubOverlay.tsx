import { WorkspaceTab } from '../types'
import HubView from './HubView'
import { formatBinding } from '../lib/keybindings'

interface Props {
  tabs: WorkspaceTab[]
  activeTabId: string
  activePanes: Set<string>
  onClose: () => void
  onJump: (tabId: string, paneId: string) => void
  onTogglePin: (tabId: string, paneId: string) => void
}

export default function HubOverlay({ tabs, activeTabId, activePanes, onClose, onJump, onTogglePin }: Props) {
  return (
    <div className="hub-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="hub-panel">
        <div className="hub-title">
          <span>Hub — todas tus terminales</span>
          <span className="hub-title-hint">
            Esc volver · Tab siguiente · Enter ir al workspace · {formatBinding('Meta+Shift+O')} toggle
          </span>
        </div>
        <HubView
          tabs={tabs}
          activeTabId={activeTabId}
          activePanes={activePanes}
          onJump={onJump}
          onTogglePin={onTogglePin}
        />
      </div>
    </div>
  )
}
