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
} from 'lucide-react'
import SettingsPanel from './SettingsPanel'
import UserMenu from './UserMenu'
import { supabase } from '../lib/supabase'
import type { PanelId } from '../types'

interface Props {
  // nav / activity-bar props
  activePanel: PanelId | null
  onSelectPanel: (id: PanelId) => void
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
}

export default function NavSidebar({
  activePanel,
  onSelectPanel,
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
}: Props) {
  // ── Update state (ported from ActivityBar) ───────────────────────────────
  const [updateState, setUpdateState] = useState<
    'idle' | 'checking' | 'up-to-date' | 'update-found' | 'error'
  >('idle')
  const [userEmail, setUserEmail] = useState('')

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

  function toggle(id: PanelId) {
    onSelectPanel(id)
  }

  return (
    <aside className="nav-sidebar">
      {/* ── Nav group ───────────────────────────────────────────────────── */}
      <div className="nav-group">
        {/* Worktrees */}
        <button
          className={`nav-item${activePanel === 'worktrees' ? ' active' : ''}`}
          onClick={() => toggle('worktrees')}
          title="Worktrees"
        >
          <GitBranch />
          <span className="nav-item-label">Worktrees</span>
        </button>

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
        <button
          className={`nav-item${activePanel === 'snippets' ? ' active' : ''}`}
          onClick={() => toggle('snippets')}
          title="Snippets"
        >
          <SquareCode />
          <span className="nav-item-label">Snippets</span>
        </button>

        {/* MCP */}
        <button
          className={`nav-item${activePanel === 'mcp' ? ' active' : ''}`}
          onClick={() => toggle('mcp')}
          title="MCP"
        >
          <Plug />
          <span className="nav-item-label">MCP</span>
        </button>

        {/* Workspaces */}
        <button
          className={`nav-item${activePanel === 'workspaces' ? ' active' : ''}`}
          onClick={() => toggle('workspaces')}
          title="Workspaces"
        >
          <Layers />
          <span className="nav-item-label">Workspaces</span>
        </button>

        {/* Command History */}
        <button
          className={`nav-item${activePanel === 'cmdhist' ? ' active' : ''}`}
          onClick={() => toggle('cmdhist')}
          title="Command History"
        >
          <SquareTerminal />
          <span className="nav-item-label">Command History</span>
        </button>

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
