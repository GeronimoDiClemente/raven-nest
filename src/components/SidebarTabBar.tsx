export type SidebarTabId = 'worktrees' | 'explorer' | 'personal' | 'tools'

interface Props {
  active: SidebarTabId
  onChange: (tab: SidebarTabId) => void
  pendingInvitesCount?: number
}

// Reuses the repo-header's branch-graph icon (worktrees ARE branches) so the
// tab reads as the same concept, not a new one.
const WorktreesIcon = (
  <svg width="15" height="15" viewBox="0 0 16 16" fill="none">
    <circle cx="4" cy="4" r="1.5" stroke="currentColor" strokeWidth="1.3"/>
    <circle cx="12" cy="4" r="1.5" stroke="currentColor" strokeWidth="1.3"/>
    <circle cx="4" cy="12" r="1.5" stroke="currentColor" strokeWidth="1.3"/>
    <path d="M4 5.5v5M4 5.5C4 7 5 8 8 8s4 1 4 2.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
  </svg>
)

const ExplorerIcon = (
  <svg width="15" height="15" viewBox="0 0 16 16" fill="none">
    <path d="M2 4h4l1.5 1.5H14v7a1 1 0 0 1-1 1H2a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"/>
  </svg>
)

// Same silhouette as the old standalone "Team" item.
const PersonalIcon = (
  <svg width="15" height="15" viewBox="0 0 16 16" fill="none">
    <circle cx="6" cy="5" r="2" stroke="currentColor" strokeWidth="1.3"/>
    <path d="M2 13c0-2.21 1.79-4 4-4s4 1.79 4 4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
  </svg>
)

const ToolsIcon = (
  <svg width="15" height="15" viewBox="0 0 16 16" fill="none">
    <path d="M9.5 2.5l1 1-6 6-2 1 1-2 6-6z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"/>
    <path d="M11 4l1 1" stroke="currentColor" strokeWidth="1.2"/>
  </svg>
)

const TABS: { id: SidebarTabId; label: string; icon: JSX.Element }[] = [
  { id: 'worktrees', label: 'Worktrees', icon: WorktreesIcon },
  { id: 'explorer', label: 'Explorer', icon: ExplorerIcon },
  { id: 'personal', label: 'Personal', icon: PersonalIcon },
  { id: 'tools', label: 'Tools', icon: ToolsIcon },
]

export default function SidebarTabBar({ active, onChange, pendingInvitesCount = 0 }: Props) {
  return (
    <div className="sidebar-tabbar" role="tablist">
      {TABS.map((tab) => (
        <button
          key={tab.id}
          type="button"
          role="tab"
          aria-selected={active === tab.id}
          className={`sidebar-tab${active === tab.id ? ' active' : ''}`}
          onClick={() => onChange(tab.id)}
          title={tab.label}
        >
          <span className="sidebar-tab-icon">
            {tab.icon}
            {tab.id === 'personal' && pendingInvitesCount > 0 && (
              <span className="sidebar-tab-badge">{pendingInvitesCount > 9 ? '9+' : pendingInvitesCount}</span>
            )}
          </span>
          <span className="sidebar-tab-label">{tab.label}</span>
        </button>
      ))}
    </div>
  )
}
