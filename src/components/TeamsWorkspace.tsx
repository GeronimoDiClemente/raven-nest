import { useState, useEffect, useRef } from 'react'
import { useTeam } from '../hooks/useTeam'
import { useSharedSnippets } from '../hooks/useSharedSnippets'
import { useSharedWorkspaces } from '../hooks/useSharedWorkspaces'
import { useSharedMcpConfigs } from '../hooks/useSharedMcpConfigs'
import { useGitHub } from '../hooks/useGitHub'
import { useGitHubNotifications } from '../hooks/useGitHubNotifications'
import { useTeamRepos } from '../hooks/useTeamRepos'
import { useTeamPresence } from '../hooks/useTeamPresence'
import { useTeamsKeyboard } from '../hooks/useTeamsKeyboard'
import { Workspace } from '../types'
import NotificationPanel from './NotificationPanel'
import { useGitlab } from '../hooks/useGitlab'
import { ProviderAvatarPill, ProviderIcon } from './ProviderAvatar'
import ConfirmDialog from './ConfirmDialog'
import TeamChat from './TeamChat'
import { useTeamChat } from '../hooks/useTeamChat'
import { safeWriteText } from '../lib/clipboard'
import ErrorBoundary from './ErrorBoundary'
import JoinByCodeForm from './JoinByCodeForm'
import TeamJoinCodePanel from './TeamJoinCodePanel'
import TeamStats from './TeamStats'
import type { WorkspaceSection } from './teamSections'

interface TeamsWorkspaceProps {
  onClose: () => void
  onLoad?: (ws: Workspace) => void
  onRequireUpgrade?: () => void
  onPendingInvitesChange?: () => void
  /** When provided, the header shows a "?" button that launches the Teams tutorial. */
  onStartTutorial?: () => void
  /** Pending invites now live in Personal. When provided, call sites that used to jump to the local 'pendings' section call this instead. */
  onOpenPersonalInvites?: () => void
}

export { WORKSPACE_SECTIONS, type WorkspaceSection } from './teamSections'

const PRESENCE_COLORS = [
  'var(--primary)', '#00CC44', '#CC44FF', '#FFB800', '#FF6600',
  '#00CCCC', '#FF2D78', '#4455FF', '#88FF00',
]

export default function TeamsWorkspace({ onClose, onLoad, onPendingInvitesChange, onStartTutorial, onOpenPersonalInvites }: TeamsWorkspaceProps) {
  const [section, setSection] = useState<WorkspaceSection>('chat')
  const [acceptError, setAcceptError] = useState<string | null>(null)
  const [acceptingId, setAcceptingId] = useState<string | null>(null)
  const [showSwitcher, setShowSwitcher] = useState(false)
  const [creatingTeam, setCreatingTeam] = useState(false)
  const [newTeamName, setNewTeamName] = useState('')
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteError, setInviteError] = useState<string | null>(null)
  const [inviting, setInviting] = useState(false)
  const [terminalExpanded, setTerminalExpanded] = useState(false)
  const [showNotifications, setShowNotifications] = useState(false)
  const [emptyStateTab, setEmptyStateTab] = useState<'join' | 'create'>('join')
  const [showJoinCodeModal, setShowJoinCodeModal] = useState(false)
  const [joinRequestError, setJoinRequestError] = useState<string | null>(null)
  const [actingRequestId, setActingRequestId] = useState<string | null>(null)
  const switcherRef = useRef<HTMLDivElement>(null)
  const notifRef = useRef<HTMLDivElement>(null)

  const {
    teams, activeTeam, members, pendingInvites, myPendingRequests, loading, userId,
    switchTeam, createTeam, inviteMember, removeMember,
    promoteMember, demoteMember,
    acceptInvite, rejectInvite,
    requestJoin, cancelRequest, approveRequest, declineRequest,
    leaveTeam, deleteTeam, refresh,
  } = useTeam()

  const handleApproveRequest = async (memberId: string) => {
    setJoinRequestError(null)
    setActingRequestId(memberId)
    const r = await approveRequest(memberId)
    setActingRequestId(null)
    if (!r.ok) setJoinRequestError(r.error ?? 'Could not approve')
  }

  const handleDeclineRequest = async (memberId: string) => {
    setJoinRequestError(null)
    setActingRequestId(memberId)
    const r = await declineRequest(memberId)
    setActingRequestId(null)
    if (!r.ok) setJoinRequestError(r.error ?? 'Could not decline')
  }

  const handleAccept = async (memberId: string) => {
    setAcceptError(null)
    setAcceptingId(memberId)
    const result = await acceptInvite(memberId)
    setAcceptingId(null)
    if (!result.ok) {
      setAcceptError(result.error ?? 'Could not accept invite')
    } else {
      onPendingInvitesChange?.()
    }
  }

  const handleReject = async (memberId: string) => {
    setAcceptError(null)
    await rejectInvite(memberId)
    onPendingInvitesChange?.()
  }

  const { githubLogin, githubToken, isConnected: githubConnected, connectGitHub } = useGitHub()
  const { gitlabLogin, isConnected: gitlabConnected, connectGitlab } = useGitlab()
  const { notifications, unreadCount, markAsRead } = useGitHubNotifications(githubToken)
  const { repos, refresh: refreshRepos } = useTeamRepos(activeTeam?.id ?? null)
  const { presence } = useTeamPresence(activeTeam?.id ?? null, userId)

  const { items: teamSnippets, loading: snippetsLoading, userId: sUserId, refresh: refreshSnippets, remove: removeSnippet } = useSharedSnippets(activeTeam?.id)
  const { items: teamWorkspaces, loading: wsLoading, userId: wsUserId, refresh: refreshWorkspaces, remove: removeWorkspace } = useSharedWorkspaces(activeTeam?.id)
  const { items: teamMcpConfigs, loading: mcpLoading, userId: mcpUserId, refresh: refreshMcp, remove: removeMcpConfig } = useSharedMcpConfigs(activeTeam?.id)

  const teamChat = useTeamChat({
    teamId: activeTeam?.id ?? null,
    userId,
    userEmail: members.find(m => m.user_id === userId)?.email ?? null,
    githubLogin,
    githubToken,
    repos: repos.map(r => ({ repo_full_name: r.repo_full_name })),
  })

  useEffect(() => { refresh() }, [refresh])
  useEffect(() => { if (activeTeam?.id) refreshRepos() }, [activeTeam?.id, refreshRepos])

  useTeamsKeyboard({
    onClose,
    onSectionChange: setSection,
    currentSection: section,
  })

  // Close switcher / notifications on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (switcherRef.current && !switcherRef.current.contains(e.target as Node)) setShowSwitcher(false)
      if (notifRef.current && !notifRef.current.contains(e.target as Node)) setShowNotifications(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const [createTeamError, setCreateTeamError] = useState<string | null>(null)
  const [creatingTeamLoading, setCreatingTeamLoading] = useState(false)

  const handleCreateTeam = async () => {
    if (!newTeamName.trim()) return
    setCreateTeamError(null)
    setCreatingTeamLoading(true)
    const result = await createTeam(newTeamName.trim())
    setCreatingTeamLoading(false)
    if (result.ok) {
      setNewTeamName('')
      setCreatingTeam(false)
    } else {
      setCreateTeamError(result.error ?? 'Could not create team')
    }
  }

  const handleInvite = async () => {
    if (!inviteEmail.trim()) return
    setInviting(true)
    setInviteError(null)
    const result = await inviteMember(inviteEmail.trim())
    if (!result.ok) setInviteError(result.error ?? 'Error')
    else setInviteEmail('')
    setInviting(false)
  }

  const switchSection = (s: WorkspaceSection) => {
    setSection(s)
    setCreatingTeam(false)
    if (s === 'snippets') refreshSnippets()
    if (s === 'workspaces') refreshWorkspaces()
    if (s === 'mcp') refreshMcp()
  }

  const isTeamLeader = activeTeam && userId
    ? members.some(m => m.user_id === userId && m.role === 'leader' && m.status === 'active')
    : false
  // RLS allows DELETE on teams only to owner_id (decision B13). Render the
  // Delete button by ownership, not by leader role — otherwise non-owner
  // leaders see it and click into a silent RLS rejection.
  const isTeamOwner = activeTeam && userId ? activeTeam.owner_id === userId : false

  const [memberActionError, setMemberActionError] = useState<string | null>(null)
  const [confirmAction, setConfirmAction] = useState<{
    title: string
    message: string
    onConfirm: () => void | Promise<void>
  } | null>(null)

  const handlePromote = async (memberId: string) => {
    setMemberActionError(null)
    const r = await promoteMember(memberId)
    if (!r.ok) setMemberActionError(r.error ?? 'Error')
  }

  const handleDemote = async (memberId: string) => {
    setMemberActionError(null)
    const r = await demoteMember(memberId)
    if (!r.ok) setMemberActionError(r.error ?? 'Error')
  }

  const NAV_ITEMS: { id: WorkspaceSection; label: string; icon: React.ReactNode }[] = [
    {
      id: 'chat',
      label: 'Chat',
      icon: <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M2 4a1.5 1.5 0 011.5-1.5h9A1.5 1.5 0 0114 4v6a1.5 1.5 0 01-1.5 1.5H6L3 14v-2.5A1.5 1.5 0 012 10V4z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round"/></svg>,
    },
    {
      id: 'members',
      label: 'Members',
      icon: <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><circle cx="6" cy="5" r="2" stroke="currentColor" strokeWidth="1.3"/><path d="M2 13c0-2.21 1.79-4 4-4s4 1.79 4 4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/><circle cx="11.5" cy="5.5" r="1.5" stroke="currentColor" strokeWidth="1.2" opacity="0.7"/><path d="M13.5 12.5c0-1.38-.9-2.55-2.14-2.87" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" opacity="0.7"/></svg>,
    },
    // Stats is only for team leaders/managers — members don't see it.
    ...(isTeamLeader ? [{
      id: 'stats' as WorkspaceSection,
      label: 'Stats',
      icon: (
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
          <rect x="1" y="9" width="3" height="5" rx="0.5" stroke="currentColor" strokeWidth="1.3"/>
          <rect x="6" y="5" width="3" height="9" rx="0.5" stroke="currentColor" strokeWidth="1.3"/>
          <rect x="11" y="2" width="3" height="12" rx="0.5" stroke="currentColor" strokeWidth="1.3"/>
        </svg>
      ),
    }] : []),
    {
      id: 'snippets',
      label: 'Snippets',
      icon: <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M3 4h10M3 8h7M3 12h5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/></svg>,
    },
    {
      id: 'workspaces',
      label: 'Workspaces',
      icon: <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><rect x="1" y="2" width="14" height="10" rx="1.5" stroke="currentColor" strokeWidth="1.3"/><path d="M5 12v2M11 12v2M3 14h10" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/></svg>,
    },
    {
      id: 'mcp',
      label: 'MCP Servers',
      icon: <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><rect x="1" y="2" width="8" height="10" rx="1.2" stroke="currentColor" strokeWidth="1.3"/><path d="M4 5h2M4 7.5h3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/><circle cx="11" cy="5" r="2" stroke="currentColor" strokeWidth="1.3"/><path d="M11 7v4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/></svg>,
    },
  ]

  // Presence: merge Supabase Realtime data with member list
  const onlineUserIds = new Set(Object.keys(presence))

  return (
    <div className="teams-workspace teams-workspace--front">

      {/* Header */}
      <div className="teams-workspace-header">
        <button className="tw-back-btn" onClick={onClose}>
          <svg width="13" height="13" viewBox="0 0 13 13" fill="none" style={{ display: 'inline-block', verticalAlign: 'middle', marginRight: 5 }}>
            <path d="M8 2L4 6.5L8 11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          Back
        </button>

        <div className="tw-header-center">
          <svg width="15" height="15" viewBox="0 0 16 16" fill="none" style={{ color: 'var(--raven-blue)', flexShrink: 0 }}>
            <circle cx="6" cy="5" r="2" stroke="currentColor" strokeWidth="1.3"/>
            <path d="M2 13c0-2.21 1.79-4 4-4s4 1.79 4 4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
            <circle cx="11.5" cy="5.5" r="1.5" stroke="currentColor" strokeWidth="1.2" opacity="0.7"/>
            <path d="M13.5 12.5c0-1.38-.9-2.55-2.14-2.87" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" opacity="0.7"/>
          </svg>
          <span className="tw-header-title" data-tour-id="teams-header">Teams</span>

          {activeTeam && (
            <div className="team-switcher" ref={switcherRef}>
              <button className="team-switcher-btn" data-tour-id="team-switcher" onClick={() => setShowSwitcher(v => !v)}>
                <span className="team-switcher-name">{activeTeam.name}</span>
                <svg width="10" height="10" viewBox="0 0 10 10" fill="none" style={{ flexShrink: 0 }}>
                  <path d="M2 3.5L5 6.5L8 3.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </button>
              {showSwitcher && (
                <div className="team-switcher-dropdown">
                  {teams.map(t => (
                    <button
                      key={t.id}
                      className={`team-switcher-item${t.id === activeTeam.id ? ' active' : ''}`}
                      onClick={() => {
                        switchTeam(t.id)
                        setShowSwitcher(false)
                        setCreatingTeam(false)
                      }}
                    >
                      <span className="team-switcher-check">{t.id === activeTeam.id ? '✓' : ''}</span>
                      {t.name}
                    </button>
                  ))}
                  {pendingInvites.length > 0 && (
                    <>
                      <div className="team-switcher-sep" />
                      <button
                        className="team-switcher-item"
                        style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'space-between' }}
                        onClick={() => { setShowSwitcher(false); setCreatingTeam(false); onOpenPersonalInvites?.() }}
                        title="Review teams that invited you"
                      >
                        <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <svg width="13" height="13" viewBox="0 0 16 16" fill="none" style={{ flexShrink: 0 }}>
                            <path d="M3 4h10v8a1 1 0 01-1 1H4a1 1 0 01-1-1V4z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round"/>
                            <path d="M3 4l5 4 5-4" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round"/>
                          </svg>
                          Pending invites
                        </span>
                        <span
                          style={{
                            minWidth: 16, height: 16, padding: '0 5px', borderRadius: 8,
                            background: '#EF4444', color: '#fff',
                            fontSize: 10, fontWeight: 700,
                            display: 'flex', alignItems: 'center', justifyContent: 'center', lineHeight: 1,
                          }}
                        >
                          {pendingInvites.length > 9 ? '9+' : pendingInvites.length}
                        </span>
                      </button>
                    </>
                  )}
                  <div className="team-switcher-sep" />
                  <button
                    className="team-switcher-item"
                    style={{ display: 'flex', alignItems: 'center', gap: 8 }}
                    onClick={() => { setShowSwitcher(false); setShowJoinCodeModal(true) }}
                    title="Join an existing team using a code"
                  >
                    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" style={{ flexShrink: 0 }}>
                      <circle cx="6" cy="10" r="3" stroke="currentColor" strokeWidth="1.3"/>
                      <path d="M8.5 8L13 3.5M11 5.5L13 7.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
                    </svg>
                    Join with code
                  </button>
                  <button className="team-switcher-new" onClick={() => { setShowSwitcher(false); setCreatingTeam(true); setSection('members') }}>
                    ＋ New team
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Header right: GitHub status + notifications */}
        <div className="tw-header-right">
          {!githubConnected && (
            <button className="tw-connect-github-btn" onClick={connectGitHub} title="Connect GitHub">
              <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
                <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/>
              </svg>
              GitHub
            </button>
          )}
          {!gitlabConnected && (
            <button className="tw-connect-github-btn" onClick={connectGitlab} title="Connect GitLab" style={{ borderColor: 'rgba(252, 109, 38, 0.4)' }}>
              <ProviderIcon provider="gitlab" size={14} />
              GitLab
            </button>
          )}
          {(githubConnected && githubLogin) || (gitlabConnected && gitlabLogin) ? (
            <span className="tw-provider-avatars">
              {githubConnected && githubLogin && <ProviderAvatarPill provider="github" login={githubLogin} />}
              {gitlabConnected && gitlabLogin && <ProviderAvatarPill provider="gitlab" login={gitlabLogin} />}
            </span>
          ) : null}
          {onStartTutorial && (
            <button className="tour-help-btn" onClick={onStartTutorial} title="Tutorial: Teams">?</button>
          )}
          <div style={{ position: 'relative' }} ref={notifRef}>
            <button
              className="tw-notif-btn"
              onClick={() => setShowNotifications(v => !v)}
              title="Notifications"
            >
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                <path d="M8 2a5 5 0 00-5 5v3l-1 1h12l-1-1V7a5 5 0 00-5-5zM8 14a2 2 0 002-2H6a2 2 0 002 2z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round"/>
              </svg>
              {unreadCount > 0 && (
                <span className="tw-notif-badge">{unreadCount > 9 ? '9+' : unreadCount}</span>
              )}
            </button>
            {showNotifications && (
              <NotificationPanel
                notifications={notifications}
                onMarkRead={markAsRead}
                onClose={() => setShowNotifications(false)}
              />
            )}
          </div>
        </div>
      </div>

      {/* Body */}
      <div className="teams-workspace-body">

        {loading && (
          <div className="teams-workspace-content" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <p className="snippet-empty">Loading…</p>
          </div>
        )}

        {!loading && teams.length === 0 && (
          <div className="teams-workspace-content empty-state-wrap">
            <div className="empty-state-shell">
              <div className="empty-state-hero">
                <div className="empty-state-hero-icon">
                  <svg width="22" height="22" viewBox="0 0 16 16" fill="none">
                    <circle cx="6" cy="5" r="2" stroke="currentColor" strokeWidth="1.4"/>
                    <path d="M2 13c0-2.21 1.79-4 4-4s4 1.79 4 4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
                    <circle cx="11.5" cy="5.5" r="1.5" stroke="currentColor" strokeWidth="1.3" opacity="0.7"/>
                    <path d="M13.5 12.5c0-1.38-.9-2.55-2.14-2.87" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" opacity="0.7"/>
                  </svg>
                </div>
                <div className="empty-state-hero-title">Welcome to Teams</div>
                <div className="empty-state-hero-subtitle">
                  Join an existing team with a code or invite, or create your own to share snippets, workspaces and MCP configs.
                </div>
              </div>
              <div className="empty-state-card">
              <div className="empty-state-tabs" role="tablist">
                <button
                  role="tab"
                  aria-selected={emptyStateTab === 'join'}
                  className={`empty-state-tab${emptyStateTab === 'join' ? ' active' : ''}`}
                  onClick={() => setEmptyStateTab('join')}
                >
                  Join
                  {(pendingInvites.length + myPendingRequests.length) > 0 && (
                    <span className="empty-state-tab-badge">
                      {pendingInvites.length + myPendingRequests.length}
                    </span>
                  )}
                </button>
                <button
                  role="tab"
                  aria-selected={emptyStateTab === 'create'}
                  className={`empty-state-tab${emptyStateTab === 'create' ? ' active' : ''}`}
                  onClick={() => setEmptyStateTab('create')}
                >
                  Create
                </button>
              </div>

              {emptyStateTab === 'join' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
                  <JoinByCodeForm
                    myPendingRequests={myPendingRequests}
                    onRequestJoin={requestJoin}
                    onCancelRequest={cancelRequest}
                  />

                  {pendingInvites.length > 0 && (
                    <>
                      <div className="empty-state-divider"><span>Or accept an invite</span></div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                        {pendingInvites.map(inv => (
                          <div key={inv.memberId} className="team-pending-banner">
                            <div>
                              <div style={{ fontSize: 13, fontWeight: 600 }}>{inv.team.name}</div>
                              <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>
                                You have been invited to join
                              </div>
                            </div>
                            <div style={{ display: 'flex', gap: 6 }}>
                              <button
                                className="snippet-save-btn"
                                onClick={() => handleAccept(inv.memberId)}
                                disabled={acceptingId === inv.memberId}
                              >
                                {acceptingId === inv.memberId ? '…' : 'Accept'}
                              </button>
                              <button className="snippet-cancel-btn" onClick={() => handleReject(inv.memberId)}>Decline</button>
                            </div>
                          </div>
                        ))}
                      </div>
                      {acceptError && <p className="join-code-message error">{acceptError}</p>}
                    </>
                  )}
                </div>
              )}

              {emptyStateTab === 'create' && (
                <div>
                  <p style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>Create your team</p>
                  <p style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 16, lineHeight: 1.5 }}>
                    Share snippets, workspaces and MCP configs privately with your team.
                  </p>
                  <input
                    className="snippet-input"
                    style={{ width: '100%', marginBottom: 12 }}
                    placeholder="Team name…"
                    value={newTeamName}
                    onChange={e => { setNewTeamName(e.target.value); setCreateTeamError(null) }}
                    onKeyDown={e => { if (e.key === 'Enter') handleCreateTeam() }}
                    disabled={creatingTeamLoading}
                  />
                  {createTeamError && <p className="join-code-message error" style={{ marginBottom: 10 }}>{createTeamError}</p>}
                  <div className="snippet-form-actions">
                    <button
                      className="snippet-save-btn"
                      onClick={handleCreateTeam}
                      disabled={!newTeamName.trim() || creatingTeamLoading}
                    >
                      {creatingTeamLoading ? '…' : 'Create Team'}
                    </button>
                  </div>
                </div>
              )}
              </div>
            </div>
          </div>
        )}

        {!loading && activeTeam && (
          <>
            {/* Left nav */}
            <nav className="teams-workspace-nav">
              {NAV_ITEMS.map(item => (
                <button
                  key={item.id}
                  data-tour-id={`teams-nav-${item.id}`}
                  className={`tw-nav-btn${!creatingTeam && section === item.id ? ' active' : ''}`}
                  onClick={() => switchSection(item.id)}
                >
                  <span className="tw-nav-icon">{item.icon}</span>
                  {item.label}
                </button>
              ))}
              <div className="tw-nav-spacer" />
              {isTeamOwner ? (
                <button
                  className="tw-nav-danger"
                  onClick={() => setConfirmAction({
                    title: 'Delete team',
                    message: `Delete team "${activeTeam.name}"? This will remove all linked repos, snippets, workspaces, and shared MCP configs. This cannot be undone.`,
                    onConfirm: () => deleteTeam(),
                  })}
                >Delete team</button>
              ) : (
                <button
                  className="tw-nav-danger"
                  onClick={() => setConfirmAction({
                    title: 'Leave team',
                    message: `Leave "${activeTeam.name}"? You will lose access to all repos and shared content.`,
                    onConfirm: () => leaveTeam(),
                  })}
                >Leave team</button>
              )}
            </nav>

            {/* Content area */}
            <div className="teams-workspace-content">

              {/* Create new team (while already in a team) */}
              {creatingTeam && (
                <div className="team-tab-pane" style={{ flexDirection: 'column', display: 'flex', alignItems: 'flex-start' }}>
                  <button style={{ background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: 11, cursor: 'pointer', marginBottom: 16, padding: 0 }}
                    onClick={() => { setCreatingTeam(false); setNewTeamName(''); setCreateTeamError(null) }}>← Back</button>
                  <p style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>Create new team</p>
                  <p style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 14 }}>You can belong to multiple teams and switch between them.</p>
                  <input className="snippet-input" style={{ width: '100%' }} placeholder="Team name…"
                    value={newTeamName} onChange={e => { setNewTeamName(e.target.value); setCreateTeamError(null) }} autoFocus
                    onKeyDown={e => { if (e.key === 'Enter') handleCreateTeam() }}
                    disabled={creatingTeamLoading} />
                  {createTeamError && <p className="join-code-message error" style={{ marginTop: 8 }}>{createTeamError}</p>}
                  <div className="snippet-form-actions" style={{ marginTop: 10 }}>
                    <button
                      className="snippet-save-btn"
                      onClick={handleCreateTeam}
                      disabled={!newTeamName.trim() || creatingTeamLoading}
                    >
                      {creatingTeamLoading ? '…' : 'Create Team'}
                    </button>
                    <button className="snippet-cancel-btn" onClick={() => { setCreatingTeam(false); setNewTeamName(''); setCreateTeamError(null) }}>Cancel</button>
                  </div>
                </div>
              )}

              <ErrorBoundary label={section}><>
              {!creatingTeam && section === 'chat' && (
                <TeamChat
                  timeline={teamChat.timeline}
                  reactions={teamChat.reactions}
                  loading={teamChat.loading}
                  error={teamChat.error}
                  currentUserId={userId}
                  currentUserEmail={members.find(m => m.user_id === userId)?.email ?? null}
                  isLeader={isTeamLeader}
                  onPostMessage={teamChat.postMessage}
                  onDeleteMessage={teamChat.deleteMessage}
                  onToggleReaction={teamChat.toggleReaction}
                />
              )}

              {/* MEMBERS */}
              {!creatingTeam && section === 'members' && (
                <div className="team-tab-pane">
                  {pendingInvites.length > 0 && (
                    <div
                      className="team-pending-banner"
                      style={{ cursor: 'pointer' }}
                      onClick={() => onOpenPersonalInvites?.()}
                      title="View all pending invites"
                    >
                      <span>
                        {pendingInvites.length === 1
                          ? <>Invited to <strong>{pendingInvites[0].team.name}</strong></>
                          : <>You have <strong>{pendingInvites.length}</strong> pending invites</>}
                      </span>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button
                          className="snippet-save-btn"
                          style={{ fontSize: 11, padding: '3px 8px' }}
                          onClick={(e) => { e.stopPropagation(); onOpenPersonalInvites?.() }}
                        >View</button>
                      </div>
                    </div>
                  )}
                  {activeTeam && (
                    <div style={{ marginBottom: 14 }}>
                      <TeamJoinCodePanel teamId={activeTeam.id} isLeader={isTeamLeader} />
                    </div>
                  )}
                  {isTeamLeader && (
                    <div className="team-invite-row">
                      <input className="snippet-input" style={{ flex: 1 }} placeholder="Invite by email…"
                        type="email" value={inviteEmail} onChange={e => setInviteEmail(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') handleInvite() }} />
                      <button className="snippet-save-btn" onClick={handleInvite} disabled={inviting || !inviteEmail.trim()}>
                        {inviting ? '…' : 'Invite'}
                      </button>
                    </div>
                  )}
                  {inviteError && <p style={{ color: '#EF4444', fontSize: 11, marginBottom: 8 }}>{inviteError}</p>}
                  {memberActionError && <p style={{ color: '#EF4444', fontSize: 11, marginBottom: 8 }}>{memberActionError}</p>}
                  {joinRequestError && <p style={{ color: '#EF4444', fontSize: 11, marginBottom: 8 }}>{joinRequestError}</p>}
                  {members.length === 0 ? (
                    <p className="snippet-empty">No members yet.</p>
                  ) : (
                    <div className="team-member-list">
                      {members.map(m => (
                        <div key={m.id} className="team-member-row">
                          <div className="team-member-avatar">{m.email.charAt(0).toUpperCase()}</div>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div className="team-member-email">{m.email}</div>
                            <div className={`team-member-status${m.status === 'pending' || m.status === 'requested' ? ' pending' : ''}`}>
                              {m.status === 'pending'
                                ? 'Invite pending'
                                : m.status === 'requested'
                                ? 'Wants to join'
                                : m.role === 'leader' ? 'Leader' : 'Member'}
                            </div>
                          </div>
                          <div className="snippet-item-actions">
                            {isTeamLeader && m.status === 'requested' && (
                              <>
                                <button
                                  className="snippet-save-btn"
                                  style={{ fontSize: 10, padding: '2px 7px' }}
                                  onClick={() => handleApproveRequest(m.id)}
                                  disabled={actingRequestId === m.id}
                                  title="Approve join request"
                                >{actingRequestId === m.id ? '…' : 'Approve'}</button>
                                <button
                                  className="snippet-cancel-btn"
                                  style={{ fontSize: 10, padding: '2px 7px' }}
                                  onClick={() => handleDeclineRequest(m.id)}
                                  disabled={actingRequestId === m.id}
                                  title="Decline join request"
                                >Decline</button>
                              </>
                            )}
                            {isTeamLeader && m.status === 'active' && m.role === 'member' && (
                              <button
                                className="snippet-save-btn"
                                style={{ fontSize: 10, padding: '2px 7px' }}
                                onClick={() => handlePromote(m.id)}
                                title="Promote to leader"
                              >Promote</button>
                            )}
                            {isTeamLeader && m.status === 'active' && m.role === 'leader' && m.user_id !== userId && (
                              <button
                                className="snippet-save-btn"
                                style={{ fontSize: 10, padding: '2px 7px' }}
                                onClick={() => handleDemote(m.id)}
                                title="Remove leader role"
                              >Remove leader</button>
                            )}
                            {isTeamLeader && m.user_id !== userId && m.status !== 'requested' && (
                              <button
                                className="snippet-delete-btn"
                                onClick={() => setConfirmAction({
                                  title: m.status === 'pending' ? 'Cancel invitation' : 'Remove member',
                                  message: m.status === 'pending'
                                    ? `Cancel invitation for ${m.email}?`
                                    : `Remove ${m.email} from the team? They will lose access to all repos and shared content.`,
                                  onConfirm: () => removeMember(m.id),
                                })}
                                title="Remove"
                              >×</button>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* SNIPPETS */}
              {!creatingTeam && section === 'snippets' && (
                <div className="team-tab-pane">
                  {snippetsLoading && <p className="snippet-empty">Loading…</p>}
                  {!snippetsLoading && teamSnippets.length === 0 && (
                    <p className="snippet-empty">No snippets. Share from the Snippets panel using ↗.</p>
                  )}
                  <div className="snippet-list" style={{ maxHeight: 'none' }}>
                    {teamSnippets.map(s => (
                      <div key={s.id} className="snippet-item">
                        <span className="snippet-name">{s.name}</span>
                        <div className="snippet-item-actions">
                          {s.owner_id === sUserId && (
                            <button
                              className="snippet-delete-btn"
                              onClick={() => setConfirmAction({
                                title: 'Remove snippet',
                                message: `Remove "${s.name}" from the team?`,
                                onConfirm: () => removeSnippet(s.id),
                              })}
                              title="Remove"
                            >×</button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* WORKSPACES */}
              {!creatingTeam && section === 'workspaces' && (
                <div className="team-tab-pane">
                  {wsLoading && <p className="snippet-empty">Loading…</p>}
                  {!wsLoading && teamWorkspaces.length === 0 && (
                    <p className="snippet-empty">No workspaces. Share from the Workspaces panel using ↗.</p>
                  )}
                  <div className="snippet-list" style={{ maxHeight: 'none' }}>
                    {teamWorkspaces.map(ws => (
                      <div key={ws.id} className="snippet-item">
                        <span className="snippet-name">{ws.name}</span>
                        <div className="snippet-item-actions">
                          <button className="snippet-send-btn" onClick={() => { onLoad?.(ws.data); onClose() }}>Load</button>
                          {ws.owner_id === wsUserId && (
                            <button
                              className="snippet-delete-btn"
                              onClick={() => setConfirmAction({
                                title: 'Remove workspace',
                                message: `Remove workspace "${ws.name}" from the team?`,
                                onConfirm: () => removeWorkspace(ws.id),
                              })}
                              title="Remove"
                            >×</button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* MCP */}
              {!creatingTeam && section === 'mcp' && (
                <div className="team-tab-pane">
                  {mcpLoading && <p className="snippet-empty">Loading…</p>}
                  {!mcpLoading && teamMcpConfigs.length === 0 && (
                    <p className="snippet-empty">No MCP configs. Share from the MCP panel using ↗.</p>
                  )}
                  <div className="snippet-list" style={{ maxHeight: 'none' }}>
                    {teamMcpConfigs.map(mc => (
                      <div key={mc.id} className="snippet-item">
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <span className="snippet-name" style={{ display: 'block' }}>{mc.name}</span>
                          <span style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'monospace' }}>
                            {typeof mc.config.command === 'string' ? mc.config.command : ''}
                          </span>
                        </div>
                        <div className="snippet-item-actions">
                          <button className="snippet-send-btn" onClick={() => { void safeWriteText(JSON.stringify(mc.config, null, 2)) }}>Copy</button>
                          {mc.owner_id === mcpUserId && (
                            <button
                              className="snippet-delete-btn"
                              onClick={() => setConfirmAction({
                                title: 'Remove MCP config',
                                message: `Remove "${mc.name}" from the team?`,
                                onConfirm: () => removeMcpConfig(mc.id),
                              })}
                              title="Remove"
                            >×</button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* STATS */}
              {/* Defense in depth: only leaders render Stats, even though
                  the tab is already hidden from members in NAV_ITEMS. */}
              {!creatingTeam && section === 'stats' && isTeamLeader && (
                <TeamStats
                  repos={repos.map(r => ({ repo_full_name: r.repo_full_name }))}
                  githubToken={githubToken}
                  presence={presence}
                />
              )}
              </></ErrorBoundary>

            </div>

            {/* Right presence sidebar */}
            <div className="teams-workspace-presence">
              <p className="tw-presence-title">Presence</p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 8 }}>
                {members.map((m, idx) => {
                  const isOnline = m.user_id ? onlineUserIds.has(m.user_id) : false
                  const presenceData = m.user_id ? presence?.[m.user_id] : null
                  return (
                    <div key={m.id} className="tw-presence-member" title={presenceData ? `${presenceData.repo ?? '—'} · ${presenceData.branch ?? '—'}` : ''}>
                      <div className="tw-presence-avatar-wrap">
                        <div className="tw-presence-avatar" style={{
                          background: PRESENCE_COLORS[idx % PRESENCE_COLORS.length] + '22',
                          color: PRESENCE_COLORS[idx % PRESENCE_COLORS.length],
                        }}>
                          {m.email.charAt(0).toUpperCase()}
                        </div>
                        <div className="tw-presence-dot" style={{ background: isOnline ? '#22C55E' : '#555' }} />
                      </div>
                      <div className="tw-presence-info">
                        <div className="tw-presence-email">{m.email}</div>
                        <div className="tw-presence-role">
                          {isOnline && presenceData?.repo
                            ? presenceData.repo.split('/')[1] ?? presenceData.repo
                            : m.status === 'pending' ? 'Pending' : m.role}
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          </>
        )}

      </div>

      {/* Terminal panel */}
      <div className={`teams-workspace-terminal${terminalExpanded ? ' expanded' : ''}`}>
        <button className="tw-terminal-toggle" onClick={() => setTerminalExpanded(v => !v)}>
          <svg width="11" height="11" viewBox="0 0 11 11" fill="none"
            style={{ transition: 'transform 0.2s', transform: terminalExpanded ? 'rotate(180deg)' : 'rotate(0deg)', flexShrink: 0 }}>
            <path d="M1.5 3.5L5.5 7.5L9.5 3.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          Terminal
        </button>
        {terminalExpanded && (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <p style={{ fontSize: 11, color: 'var(--text-muted)' }}>Terminal active — press ⌘+Shift+T to return</p>
          </div>
        )}
      </div>

      {showJoinCodeModal && (
        <div className="confirm-overlay" onMouseDown={e => { if (e.target === e.currentTarget) setShowJoinCodeModal(false) }}>
          <div className="team-modal join-code-modal">
            <div className="team-modal-header">
              <div className="team-modal-header-left">
                <svg className="jcf-title-icon" width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                  <circle cx="6" cy="10" r="3" stroke="currentColor" strokeWidth="1.4"/>
                  <path d="M8.1 8.1L14 2.2M11.5 4.8l1.7 1.7M13 3.3l1.5 1.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
                <span className="team-modal-title">Join a team with code</span>
              </div>
              <button className="team-modal-close" onClick={() => setShowJoinCodeModal(false)}>×</button>
            </div>
            <div className="team-modal-body">
              <JoinByCodeForm
                myPendingRequests={myPendingRequests}
                onRequestJoin={requestJoin}
                onCancelRequest={cancelRequest}
              />
            </div>
          </div>
        </div>
      )}

      {confirmAction && (
        <ConfirmDialog
          title={confirmAction.title}
          message={confirmAction.message}
          confirmLabel="Confirm"
          confirmDanger
          onConfirm={async () => {
            await confirmAction.onConfirm()
            setConfirmAction(null)
          }}
          onCancel={() => setConfirmAction(null)}
        />
      )}

    </div>
  )
}
