import { WorkspaceTab } from '../types'
import HubView from './HubView'

interface Props {
  tabs: WorkspaceTab[]
  activeTabId: string
  activePanes: Set<string>
  onJump: (tabId: string, paneId: string) => void
  onTogglePin: (tabId: string, paneId: string) => void
}

export default function HubWorkspace(props: Props) {
  return (
    <div className="hub-workspace">
      <HubView {...props} />
    </div>
  )
}
