import type { ReactNode } from 'react'

export type SidebarTabId = 'worktrees' | 'explorer' | 'personal' | 'tools' | 'hub'

interface Props {
  active: SidebarTabId
  onChange: (tab: SidebarTabId) => void
  pendingInvitesCount?: number
  /** Which tabs to show, in order. Hub mode swaps Worktrees for Hub and drops
   *  Personal; the normal repo sidebar takes the default. */
  tabs?: readonly SidebarTabId[]
  /** Rendered below the tabs, inside the same box — the repo row. Under the
   *  tabs and not above them: on top it still read as a separate block sitting
   *  over the menu, which is what we were trying to get rid of. */
  footer?: ReactNode
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

// One tile per open workspace — the Hub's own shape, not a repo's.
const HubIcon = (
  <svg width="15" height="15" viewBox="0 0 16 16" fill="none">
    <rect x="2" y="2" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.2"/>
    <rect x="9" y="2" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.2"/>
    <rect x="2" y="9" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.2"/>
    <rect x="9" y="9" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.2"/>
  </svg>
)

const TAB_DEFS: Record<SidebarTabId, { label: string; icon: JSX.Element }> = {
  worktrees: { label: 'Worktrees', icon: WorktreesIcon },
  explorer: { label: 'Explorer', icon: ExplorerIcon },
  personal: { label: 'Personal', icon: PersonalIcon },
  tools: { label: 'Tools', icon: ToolsIcon },
  hub: { label: 'Hub', icon: HubIcon },
}

export const REPO_TABS = ['worktrees', 'explorer', 'personal', 'tools'] as const
export const HUB_TABS = ['hub', 'explorer', 'tools'] as const

export default function SidebarTabBar({ active, onChange, pendingInvitesCount = 0, tabs = REPO_TABS, footer }: Props) {
  return (
    <div className="sidebar-menu-box">
      <div className="sidebar-tabbar" role="tablist">
        {tabs.map((id) => ({ id, ...TAB_DEFS[id] })).map((tab) => (
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
      {footer}
    </div>
  )
}
