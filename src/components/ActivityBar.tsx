import { useState, useEffect, useRef } from 'react'
import {
  GitBranch,
  Users,
  FolderGit2,
  SquareCode,
  Plug,
  Ellipsis,
  Plus,
  Settings,
  History,
  Terminal,
  Layers,
} from 'lucide-react'
import SettingsPanel from './SettingsPanel'
import UserMenu from './UserMenu'
import { supabase } from '../lib/supabase'
import type { PanelId } from '../types'

interface Props {
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

export default function ActivityBar({
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
  // ── Update state (ported from Sidebar) ──────────────────────────────────
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

  // ── "More" popover ───────────────────────────────────────────────────────
  const [moreOpen, setMoreOpen] = useState(false)
  const moreMenuRef = useRef<HTMLDivElement>(null)
  const moreBtnRef = useRef<HTMLButtonElement>(null)
  const [morePos, setMorePos] = useState<{ top: number; left: number } | null>(null)

  // Position the More menu to the right of the button
  useEffect(() => {
    if (!moreOpen || !moreBtnRef.current) return
    const rect = moreBtnRef.current.getBoundingClientRect()
    setMorePos({ top: rect.top, left: rect.right + 6 })
  }, [moreOpen])

  // Close on outside click
  useEffect(() => {
    if (!moreOpen) return
    const handler = (e: MouseEvent) => {
      if (
        moreBtnRef.current?.contains(e.target as Node) ||
        moreMenuRef.current?.contains(e.target as Node)
      )
        return
      setMoreOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMoreOpen(false)
    }
    document.addEventListener('mousedown', handler)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', handler)
      document.removeEventListener('keydown', onKey)
    }
  }, [moreOpen])

  const badgeLabel = pendingInvitesCount > 9 ? '9+' : String(pendingInvitesCount)
  const moreActive = activePanel === 'workspaces' || activePanel === 'cmdhist'

  function pickMore(id: PanelId) {
    onSelectPanel(id)
    setMoreOpen(false)
  }

  return (
    <div className="activity-bar">
      {/* ── Top group ───────────────────────────────────────────────────── */}

      {/* Worktrees */}
      <button
        className={`activity-btn${activePanel === 'worktrees' ? ' active' : ''}`}
        onClick={() => onSelectPanel('worktrees')}
        title="Worktrees"
        aria-label="Worktrees"
      >
        <GitBranch />
        {activePanel === 'worktrees' && <span className="activity-btn-indicator" />}
      </button>

      {/* Team */}
      <button
        className="activity-btn"
        onClick={onTeamsOpen}
        title={
          pendingInvitesCount > 0
            ? `Team — ${pendingInvitesCount} pending invite${pendingInvitesCount === 1 ? '' : 's'}`
            : 'Team'
        }
        aria-label="Team"
      >
        <Users />
        {pendingInvitesCount > 0 && (
          <span className="activity-badge" aria-label={`${pendingInvitesCount} pending invites`}>
            {badgeLabel}
          </span>
        )}
      </button>

      {/* My Repos */}
      <button
        className="activity-btn"
        onClick={onMyReposOpen}
        title="My Repos"
        aria-label="My Repos"
      >
        <FolderGit2 />
      </button>

      {/* Snippets */}
      <button
        className={`activity-btn${activePanel === 'snippets' ? ' active' : ''}`}
        onClick={() => onSelectPanel('snippets')}
        title="Snippets"
        aria-label="Snippets"
      >
        <SquareCode />
      </button>

      {/* MCP */}
      <button
        className={`activity-btn${activePanel === 'mcp' ? ' active' : ''}`}
        onClick={() => onSelectPanel('mcp')}
        title="MCP"
        aria-label="MCP"
      >
        <Plug />
      </button>

      {/* More */}
      <button
        ref={moreBtnRef}
        className={`activity-btn${moreActive ? ' active' : ''}`}
        onClick={() => setMoreOpen(v => !v)}
        title="More"
        aria-label="More"
        aria-expanded={moreOpen}
      >
        <Ellipsis />
      </button>

      {/* More popover — rendered inline to avoid portal complexity */}
      {moreOpen && morePos && (
        <div
          ref={moreMenuRef}
          className="activity-more-menu"
          style={{ top: morePos.top, left: morePos.left }}
        >
          <button
            className="activity-more-item"
            onClick={() => pickMore('workspaces')}
          >
            <Layers />
            Workspaces
          </button>
          <button
            className="activity-more-item"
            onClick={() => pickMore('cmdhist')}
          >
            <Terminal />
            Command History
          </button>
          <button
            className="activity-more-item"
            onClick={() => { onHistoryOpen(); setMoreOpen(false) }}
          >
            <History />
            History
          </button>
          <button
            className="activity-more-item"
            onClick={() => { onJoinTerminal(); setMoreOpen(false) }}
          >
            <Terminal />
            Join Terminal
          </button>
        </div>
      )}

      {/* ── Spacer ──────────────────────────────────────────────────────── */}
      <div className="activity-spacer" />

      {/* ── Bottom group ────────────────────────────────────────────────── */}

      {/* New terminal */}
      <button
        className="activity-btn"
        onClick={onNewPane}
        title="New terminal (Ctrl+T)"
        aria-label="New terminal"
      >
        <Plus />
      </button>

      {/* Settings — SettingsPanel renders its own trigger button internally.
          We wrap it in an activity-btn-sized slot and suppress its default
          titlebar-btn trigger by rendering SettingsPanel which owns the
          open/close state via its internal button. */}
      <div className="activity-btn" style={{ position: 'relative', cursor: 'pointer' }}>
        <Settings style={{ width: 22, height: 22, color: '#868686', pointerEvents: 'none' }} />
        {/* SettingsPanel renders a transparent trigger <button> on top */}
        <SettingsPanel
          updateState={updateState}
          onCheckUpdates={handleCheckUpdates}
          userEmail={userEmail}
          activeRepoPath={activeCellRepoPath}
        />
      </div>

      {/* User avatar (account menu) */}
      {!profileLoading && (
        <UserMenu
          plan={plan}
          isTrialActive={isTrialActive}
          trialDaysLeft={trialDaysLeft}
          onUpgrade={onUpgrade}
          expanded={false}
        />
      )}
    </div>
  )
}
