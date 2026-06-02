import { useState, useEffect } from 'react'
import {
  GitBranch,
  Users,
  FolderGit2,
  SquareCode,
  Plug,
  Layers,
  SquareTerminal,
  Clock,
  Cable,
  Plus,
  Settings,
  ChevronRight,
} from 'lucide-react'
import SettingsPanel from './SettingsPanel'
import UserMenu from './UserMenu'
import NavPopover from './NavPopover'
import SidePanel from './SidePanel'
import SnippetPanel from './SnippetPanel'
import MCPPanel from './MCPPanel'
import WorkspacePanel from './WorkspacePanel'
import CommandHistoryPanel from './CommandHistoryPanel'
import { supabase } from '../lib/supabase'
import type { Workspace } from '../types'

interface Props {
  // nav / activity-bar props
  onTeamsOpen: () => void
  onMyReposOpen: () => void
  onHistoryOpen: () => void
  onNewPane: () => void
  onJoinTerminal: () => void
  pendingInvitesCount: number
  plan: 'free' | 'pro' | 'team' | null
  isTrialActive: boolean
  trialDaysLeft: number
  profileLoading: boolean
  onUpgrade: () => void
  activeCellRepoPath?: string
  // panel props (moved from SidePanel)
  repoPath?: string
  onWorktreeSelect: (worktreePath: string) => void
  onNewWorktree: () => void
  worktreeRefreshKey?: number
  onRepoLink: () => void
  onRepoUnlink: () => void
  onSnippetSend: (content: string) => void
  onSnippetBroadcast: (content: string) => void
  onWorkspaceSave: (name: string) => void
  onWorkspaceLoad: (ws: Workspace) => void
  onCommandRun: (cmd: string) => void
}

export default function NavSidebar({
  onTeamsOpen,
  onMyReposOpen,
  onHistoryOpen,
  onNewPane,
  onJoinTerminal,
  pendingInvitesCount,
  plan,
  isTrialActive,
  trialDaysLeft,
  profileLoading,
  onUpgrade,
  activeCellRepoPath,
  repoPath,
  onWorktreeSelect,
  onNewWorktree,
  worktreeRefreshKey,
  onRepoLink,
  onRepoUnlink,
  onSnippetSend,
  onSnippetBroadcast,
  onWorkspaceSave,
  onWorkspaceLoad,
  onCommandRun,
}: Props) {
  // ── Update state (ported from ActivityBar) ───────────────────────────────
  const [updateState, setUpdateState] = useState<
    'idle' | 'checking' | 'up-to-date' | 'update-found' | 'error'
  >('idle')
  const [userEmail, setUserEmail] = useState('')
  // Worktrees is "working context", not a quick action — it lives inline in the
  // sidebar as a collapsible accordion (open by default) rather than a popover.
  const [worktreesOpen, setWorktreesOpen] = useState(true)

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      setUserEmail(data.user?.email ?? '')
    })
  }, [])

  async function handleCheckUpdates() {
    if (updateState === 'checking') return
    setUpdateState('checking')
    const result = await window.updater.checkForUpdates()
    if (result === 'up-to-date') {
      setUpdateState('up-to-date')
      setTimeout(() => setUpdateState('idle'), 3000)
    } else if (result === 'update-found') {
      setUpdateState('update-found')
      setTimeout(() => setUpdateState('idle'), 4000)
    } else {
      setUpdateState('error')
      setTimeout(() => setUpdateState('idle'), 3000)
    }
  }

  const badgeLabel = pendingInvitesCount > 9 ? '9+' : String(pendingInvitesCount)

  return (
    <aside className="nav-sidebar">
      {/* ── Nav group ───────────────────────────────────────────────────── */}
      <div className="nav-group">
        {/* Worktrees — inline collapsible accordion (working context, not a popover) */}
        <button
          className={`nav-item${worktreesOpen ? ' active' : ''}`}
          onClick={() => setWorktreesOpen((v) => !v)}
          title="Worktrees"
          aria-expanded={worktreesOpen}
        >
          <GitBranch />
          <span className="nav-item-label">Worktrees</span>
          <ChevronRight
            style={{
              marginLeft: 'auto',
              width: 15,
              height: 15,
              transition: 'transform .15s ease',
              transform: worktreesOpen ? 'rotate(90deg)' : 'none',
            }}
          />
        </button>
        {worktreesOpen && (
          <div className="nav-accordion-body">
            <SidePanel
              embedded
              panel="worktrees"
              onClose={() => {}}
              repoPath={repoPath}
              activeCellRepoPath={activeCellRepoPath}
              onWorktreeSelect={onWorktreeSelect}
              onNewWorktree={onNewWorktree}
              worktreeRefreshKey={worktreeRefreshKey}
              onRepoLink={onRepoLink}
              onRepoUnlink={onRepoUnlink}
              onSnippetSend={onSnippetSend}
              onSnippetBroadcast={onSnippetBroadcast}
              onUpgrade={onUpgrade}
              onWorkspaceSave={onWorkspaceSave}
              onWorkspaceLoad={onWorkspaceLoad}
              onCommandRun={onCommandRun}
            />
          </div>
        )}

        {/* Team */}
        <button
          className="nav-item"
          onClick={onTeamsOpen}
          title={
            pendingInvitesCount > 0
              ? `Team — ${pendingInvitesCount} pending invite${pendingInvitesCount === 1 ? '' : 's'}`
              : 'Team'
          }
        >
          <Users />
          <span className="nav-item-label">Team</span>
          {pendingInvitesCount > 0 && (
            <span className="nav-item-badge" aria-label={`${pendingInvitesCount} pending invites`}>
              {badgeLabel}
            </span>
          )}
        </button>

        {/* My Repos */}
        <button
          className="nav-item"
          onClick={onMyReposOpen}
          title="My Repos"
        >
          <FolderGit2 />
          <span className="nav-item-label">My Repos</span>
        </button>

        {/* Snippets */}
        <NavPopover icon={<SquareCode />} label="Snippets">
          <SnippetPanel
            docked
            onSend={onSnippetSend}
            onBroadcast={onSnippetBroadcast}
            onRequireUpgrade={onUpgrade}
          />
        </NavPopover>

        {/* MCP */}
        <NavPopover icon={<Plug />} label="MCP">
          <MCPPanel docked repoPath={repoPath} onRequireUpgrade={onUpgrade} />
        </NavPopover>

        {/* Workspaces */}
        <NavPopover icon={<Layers />} label="Workspaces">
          <WorkspacePanel
            docked
            onSave={onWorkspaceSave}
            onLoad={onWorkspaceLoad}
            onRequireUpgrade={onUpgrade}
          />
        </NavPopover>

        {/* Command History */}
        <NavPopover icon={<SquareTerminal />} label="Command History">
          <CommandHistoryPanel docked onRun={onCommandRun} />
        </NavPopover>

        {/* History */}
        <button
          className="nav-item"
          onClick={onHistoryOpen}
          title="History"
        >
          <Clock />
          <span className="nav-item-label">History</span>
        </button>

        {/* Join Terminal */}
        <button
          className="nav-item"
          onClick={onJoinTerminal}
          title="Join Terminal"
        >
          <Cable />
          <span className="nav-item-label">Join Terminal</span>
        </button>
      </div>

      {/* Spacer pushes the footer to the bottom */}
      <div className="nav-spacer" />

      {/* ── Footer ──────────────────────────────────────────────────────── */}
      <div className="nav-footer">
        {/* New Terminal */}
        <button
          className="nav-item nav-item-primary"
          onClick={onNewPane}
          title="New terminal (Ctrl+T)"
        >
          <Plus />
          <span className="nav-item-label">New Terminal</span>
        </button>

        {/* Settings — wrap so SettingsPanel's transparent trigger overlays the row */}
        <div className="nav-item" style={{ position: 'relative', cursor: 'pointer' }}>
          <Settings style={{ width: 17, height: 17, color: 'var(--text-muted)', pointerEvents: 'none', flexShrink: 0 }} />
          <span className="nav-item-label" style={{ pointerEvents: 'none' }}>Settings</span>
          <SettingsPanel
            updateState={updateState}
            onCheckUpdates={handleCheckUpdates}
            userEmail={userEmail}
            activeRepoPath={activeCellRepoPath}
          />
        </div>

        {/* Account */}
        {!profileLoading && (
          <UserMenu
            plan={plan}
            isTrialActive={isTrialActive}
            trialDaysLeft={trialDaysLeft}
            onUpgrade={onUpgrade}
            expanded={true}
          />
        )}
      </div>
    </aside>
  )
}
