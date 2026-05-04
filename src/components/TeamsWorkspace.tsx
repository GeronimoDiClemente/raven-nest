import { useState, useEffect, useRef } from 'react'
import { useTeam } from '../hooks/useTeam'
import { useSharedSnippets } from '../hooks/useSharedSnippets'
import { useSharedWorkspaces } from '../hooks/useSharedWorkspaces'
import { useSharedMcpConfigs } from '../hooks/useSharedMcpConfigs'
import { useGitHub } from '../hooks/useGitHub'
import { useGitHubNotifications } from '../hooks/useGitHubNotifications'
import { useTeamRepos, TeamRepo } from '../hooks/useTeamRepos'
import { useTeamPresence } from '../hooks/useTeamPresence'
import { useTeamsKeyboard } from '../hooks/useTeamsKeyboard'
import { Workspace } from '../types'
import PRList, { GitHubPR } from './PRList'
import PRReview from './PRReview'
import IssueList, { GitHubIssue } from './IssueList'
import IssueDetail from './IssueDetail'
import ActivityFeed from './ActivityFeed'
import DailyStandup from './DailyStandup'
import NotificationPanel from './NotificationPanel'
import RepoCIBadge from './RepoCIBadge'
import RepoActionsAccordion from './RepoActionsAccordion'
import { useGitlab } from '../hooks/useGitlab'
import { ProviderAvatarPill, ProviderIcon } from './ProviderAvatar'
import RepoPicker from './RepoPicker'
import ConfirmDialog from './ConfirmDialog'
import TeamChat from './TeamChat'
import RepoStatusPanel from './RepoStatusPanel'
import { useTeamChat } from '../hooks/useTeamChat'
import ErrorBoundary from './ErrorBoundary'
import JoinByCodeForm from './JoinByCodeForm'
import TeamJoinCodePanel from './TeamJoinCodePanel'

interface TeamsWorkspaceProps {
  onClose: () => void
  onLoad?: (ws: Workspace) => void
  onRequireUpgrade?: () => void
  onOpenRepoTerminal: (repoFullName: string, localPath: string) => void
  onPendingInvitesChange?: () => void
}

type WorkspaceSection = 'activity' | 'chat' | 'repos' | 'issues' | 'members' | 'snippets' | 'workspaces' | 'mcp' | 'pendings'
type ReposView = 'list' | 'prs' | 'pr-detail'
type IssuesView = 'repo-select' | 'list' | 'detail'

const PRESENCE_COLORS = [
  '#0066FF', '#00CC44', '#CC44FF', '#FFB800', '#FF6600',
  '#00CCCC', '#FF2D78', '#4455FF', '#88FF00',
]

export default function TeamsWorkspace({ onClose, onLoad, onOpenRepoTerminal, onPendingInvitesChange }: TeamsWorkspaceProps) {
  const [section, setSection] = useState<WorkspaceSection>('activity')
  const [acceptError, setAcceptError] = useState<string | null>(null)
  const [acceptingId, setAcceptingId] = useState<string | null>(null)
  const [showSwitcher, setShowSwitcher] = useState(false)
  const [creatingTeam, setCreatingTeam] = useState(false)
  const [newTeamName, setNewTeamName] = useState('')
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteError, setInviteError] = useState<string | null>(null)
  const [inviting, setInviting] = useState(false)
  const [terminalExpanded, setTerminalExpanded] = useState(false)
  const [activityView, setActivityView] = useState<'feed' | 'standup'>('feed')
  const [showNotifications, setShowNotifications] = useState(false)
  const [emptyStateTab, setEmptyStateTab] = useState<'join' | 'create'>('join')
  const [showJoinCodeModal, setShowJoinCodeModal] = useState(false)
  const [joinRequestError, setJoinRequestError] = useState<string | null>(null)
  const [actingRequestId, setActingRequestId] = useState<string | null>(null)
  const switcherRef = useRef<HTMLDivElement>(null)
  const notifRef = useRef<HTMLDivElement>(null)

  // Repos section state
  const [reposView, setReposView] = useState<ReposView>('list')
  const [selectedRepo, setSelectedRepo] = useState<TeamRepo | null>(null)
  const [selectedPR, setSelectedPR] = useState<GitHubPR | null>(null)
  const [showRepoPicker, setShowRepoPicker] = useState(false)
  const [statusRepo, setStatusRepo] = useState<TeamRepo | null>(null)

  // Issues section state
  const [issuesView, setIssuesView] = useState<IssuesView>('repo-select')
  const [selectedIssueRepo, setSelectedIssueRepo] = useState<TeamRepo | null>(null)
  const [selectedIssue, setSelectedIssue] = useState<GitHubIssue | null>(null)

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
  const { gitlabLogin, gitlabToken, isConnected: gitlabConnected, connectGitlab } = useGitlab()
  const tokenForProvider = (provider: 'github' | 'gitlab') =>
    provider === 'gitlab' ? gitlabToken : githubToken
  const { notifications, unreadCount, markAsRead } = useGitHubNotifications(githubToken)
  const { repos, userLocalPaths, refresh: refreshRepos, addRepo, updateUserLocalPath, removeRepo } = useTeamRepos(activeTeam?.id ?? null)
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
    onSectionChange: (s) => setSection(s as WorkspaceSection),
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
    if (s === 'repos') { setReposView('list'); setSelectedRepo(null); setSelectedPR(null) }
    if (s === 'issues') { setIssuesView('repo-select'); setSelectedIssueRepo(null); setSelectedIssue(null) }
  }

  const excludedRepoNames = new Set(repos.map(r => r.repo_full_name))

  const handlePickerAdd = async (repoFullName: string, provider: 'github' | 'gitlab', localPath: string | null) => {
    await addRepo(repoFullName, provider, localPath)
    setShowRepoPicker(false)
  }

  const handleLinkExisting = async (repo: TeamRepo) => {
    const folder = await window.git.pickRepoFolder()
    if (folder) await updateUserLocalPath(repo.id, folder)
  }

  const handleCloneExisting = async (repo: TeamRepo) => {
    const cloneUrl = `${repo.repo_url}.git`
    const result = await window.git.clone(cloneUrl, repo.repo_full_name)
    if (result.ok && result.path) await updateUserLocalPath(repo.id, result.path)
  }

  const handleOpenTerminal = async (repo: TeamRepo) => {
    if (terminalOpening) return
    setTerminalOpening(true)
    try {
      const userPath = userLocalPaths?.[repo.id]
      if (userPath && await window.pathUtils.exists(userPath)) {
        onOpenRepoTerminal(repo.repo_full_name, userPath)
        return
      }
      // Fall back to shared team path if it works on this machine
      if (repo.local_path && await window.pathUtils.exists(repo.local_path)) {
        await updateUserLocalPath(repo.id, repo.local_path)
        onOpenRepoTerminal(repo.repo_full_name, repo.local_path)
        return
      }
      // No valid path found — ask to clone or link
      setCloneTarget(repo)
    } finally {
      setTerminalOpening(false)
    }
  }

  const [cloneTarget, setCloneTarget] = useState<TeamRepo | null>(null)
  const [cloning, setCloning] = useState(false)
  const [terminalOpening, setTerminalOpening] = useState(false)

  const handleCloneTarget = async () => {
    if (!cloneTarget) return
    setCloning(true)
    const result = await window.git.clone(`${cloneTarget.repo_url}.git`, cloneTarget.repo_full_name)
    setCloning(false)
    if (result.ok && result.path) {
      await updateUserLocalPath(cloneTarget.id, result.path)
      setCloneTarget(null)
      onOpenRepoTerminal(cloneTarget.repo_full_name, result.path)
    }
  }

  const handleLinkTarget = async () => {
    if (!cloneTarget) return
    const folder = await window.git.pickRepoFolder()
    if (folder) {
      await updateUserLocalPath(cloneTarget.id, folder)
      setCloneTarget(null)
      onOpenRepoTerminal(cloneTarget.repo_full_name, folder)
    }
  }

  const isTeamLeader = activeTeam && userId
    ? members.some(m => m.user_id === userId && m.role === 'leader' && m.status === 'active')
    : false

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
      id: 'activity',
      label: 'Activity',
      icon: <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M2 8h3l2-5 3 10 2-5h2" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/></svg>,
    },
    {
      id: 'chat',
      label: 'Chat',
      icon: <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M2 4a1.5 1.5 0 011.5-1.5h9A1.5 1.5 0 0114 4v6a1.5 1.5 0 01-1.5 1.5H6L3 14v-2.5A1.5 1.5 0 012 10V4z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round"/></svg>,
    },
    {
      id: 'repos',
      label: 'Repos',
      icon: <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><circle cx="4" cy="4" r="1.5" stroke="currentColor" strokeWidth="1.3"/><circle cx="12" cy="4" r="1.5" stroke="currentColor" strokeWidth="1.3"/><circle cx="4" cy="12" r="1.5" stroke="currentColor" strokeWidth="1.3"/><path d="M4 5.5v5M5.5 4h5M4 5.5c2 0 4 1 4 3.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/></svg>,
    },
    {
      id: 'issues',
      label: 'Issues',
      icon: <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.3"/><path d="M8 5v4M8 11v.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/></svg>,
    },
    {
      id: 'members',
      label: 'Members',
      icon: <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><circle cx="6" cy="5" r="2" stroke="currentColor" strokeWidth="1.3"/><path d="M2 13c0-2.21 1.79-4 4-4s4 1.79 4 4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/><circle cx="11.5" cy="5.5" r="1.5" stroke="currentColor" strokeWidth="1.2" opacity="0.7"/><path d="M13.5 12.5c0-1.38-.9-2.55-2.14-2.87" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" opacity="0.7"/></svg>,
    },
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
    ...(pendingInvites.length > 0 ? [{
      id: 'pendings' as WorkspaceSection,
      label: `Pending invites (${pendingInvites.length})`,
      icon: <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M3 4h10v8a1 1 0 01-1 1H4a1 1 0 01-1-1V4z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round"/><path d="M3 4l5 4 5-4" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round"/></svg>,
    }] : []),
  ]

  // Presence: merge Supabase Realtime data with member list
  const onlineUserIds = new Set(Object.keys(presence))

  return (
    <div className="teams-workspace">

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
          <span className="tw-header-title">Teams</span>

          {activeTeam && (
            <div className="team-switcher" ref={switcherRef}>
              <button className="team-switcher-btn" onClick={() => setShowSwitcher(v => !v)}>
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
                      onClick={() => { switchTeam(t.id); setShowSwitcher(false); setCreatingTeam(false) }}
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
                        onClick={() => { setShowSwitcher(false); setCreatingTeam(false); setSection('pendings') }}
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
                  className={`tw-nav-btn${!creatingTeam && section === item.id ? ' active' : ''}`}
                  onClick={() => switchSection(item.id)}
                >
                  <span className="tw-nav-icon">{item.icon}</span>
                  {item.label}
                </button>
              ))}
              <div className="tw-nav-spacer" />
              {isTeamLeader ? (
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
              {/* ACTIVITY */}
              {!creatingTeam && section === 'activity' && (
                <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
                  <div style={{ display: 'flex', gap: 2, padding: '8px 16px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
                    <button
                      className={`tw-nav-btn${activityView === 'feed' ? ' active' : ''}`}
                      style={{ padding: '4px 10px', fontSize: 11 }}
                      onClick={() => setActivityView('feed')}
                    >Feed</button>
                    <button
                      className={`tw-nav-btn${activityView === 'standup' ? ' active' : ''}`}
                      style={{ padding: '4px 10px', fontSize: 11 }}
                      onClick={() => setActivityView('standup')}
                    >Standup</button>
                  </div>
                  <div style={{ flex: 1, overflow: 'auto' }}>
                    {activityView === 'feed' && (
                      <ActivityFeed repos={repos} githubToken={githubToken} teamMembers={members} />
                    )}
                    {activityView === 'standup' && (
                      <DailyStandup repos={repos} githubToken={githubToken} teamMembers={members} />
                    )}
                  </div>
                </div>
              )}

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

              {/* REPOS */}
              {!creatingTeam && section === 'repos' && (
                <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
                  {reposView === 'list' && (
                    <div className="team-tab-pane">
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
                        <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                          {repos.length} {repos.length === 1 ? 'repo' : 'repos'}
                        </span>
                        {isTeamLeader && (
                          <button className="repo-action-btn primary" onClick={() => setShowRepoPicker(true)}>
                            <svg className="ra-icon" width="11" height="11" viewBox="0 0 16 16" fill="none">
                              <path d="M8 3.5v9M3.5 8h9" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/>
                            </svg>
                            Add repo
                          </button>
                        )}
                      </div>

                      {repos.length === 0 ? (
                        <div className="tw-placeholder">
                          <p style={{ fontSize: 13, fontWeight: 500, marginBottom: 6 }}>No repos linked</p>
                          <p style={{ fontSize: 12 }}>{isTeamLeader ? 'Click ＋ Add repo to pick one from GitHub' : 'Wait for a team leader to add repos'}</p>
                        </div>
                      ) : (
                        <div className="snippet-list" style={{ maxHeight: 'none' }}>
                          {repos.map(repo => {
                            const myPath = userLocalPaths?.[repo.id]
                            const repoProvider: 'github' | 'gitlab' =
                              ((repo as { provider?: 'github' | 'gitlab' }).provider) ?? 'github'
                            return (
                            <div key={repo.id} className="snippet-item" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 6 }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                <div style={{ flex: 1, minWidth: 0 }}>
                                  <span className="snippet-name">{repo.repo_full_name}</span>
                                  {myPath ? (
                                    <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                      📁 {myPath}
                                    </div>
                                  ) : (
                                    <div style={{ fontSize: 10, color: '#f59e0b', marginTop: 2 }}>
                                      No local folder
                                    </div>
                                  )}
                                </div>
                                <div className="snippet-item-actions">
                                  {repoProvider === 'github' && (
                                    <RepoCIBadge repoFullName={repo.repo_full_name} githubToken={githubToken} />
                                  )}
                                  {myPath ? (
                                    <button
                                      className="repo-action-btn"
                                      onClick={() => setStatusRepo(repo)}
                                      title="Git status"
                                    >
                                      <svg className="ra-icon" width="11" height="11" viewBox="0 0 16 16" fill="none">
                                        <circle cx="8" cy="8" r="5.5" stroke="currentColor" strokeWidth="1.4"/>
                                        <path d="M8 5.5v3l2 1.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
                                      </svg>
                                      Status
                                    </button>
                                  ) : null}
                                  <button
                                    className="repo-action-btn subtle-accent"
                                    onClick={() => handleOpenTerminal(repo)}
                                    title="Open terminal in this repo"
                                  >
                                    <svg className="ra-icon" width="11" height="11" viewBox="0 0 16 16" fill="none">
                                      <path d="M3 4l3 3-3 3M7.5 10.5h5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
                                    </svg>
                                    Terminal
                                  </button>
                                  {repoProvider === 'github' && (
                                    <button
                                      className="repo-action-btn"
                                      onClick={() => { setSelectedRepo(repo); setReposView('prs') }}
                                      title="Pull requests"
                                    >
                                      <svg className="ra-icon" width="11" height="11" viewBox="0 0 16 16" fill="none">
                                        <circle cx="4" cy="3.5" r="1.4" stroke="currentColor" strokeWidth="1.3"/>
                                        <circle cx="4" cy="12.5" r="1.4" stroke="currentColor" strokeWidth="1.3"/>
                                        <circle cx="12" cy="12.5" r="1.4" stroke="currentColor" strokeWidth="1.3"/>
                                        <path d="M4 4.9v6.2M9 5.5l3 3v3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
                                        <path d="M9 5.5h2.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
                                      </svg>
                                      PRs
                                    </button>
                                  )}
                                  {isTeamLeader && (
                                    <button
                                      className="snippet-delete-btn"
                                      onClick={() => setConfirmAction({
                                        title: 'Remove repo',
                                        message: `Remove "${repo.repo_full_name}" from the team? All members will lose access. Local folder is not deleted.`,
                                        onConfirm: () => removeRepo(repo.id),
                                      })}
                                      title="Remove"
                                    >×</button>
                                  )}
                                </div>
                              </div>
                              <RepoActionsAccordion
                                repoFullName={repo.repo_full_name}
                                provider={repoProvider}
                                token={tokenForProvider(repoProvider)}
                              />
                            </div>
                            )
                          })}
                        </div>
                      )}
                    </div>
                  )}

                  {reposView === 'prs' && selectedRepo && githubToken && (
                    <>
                      <div className="tw-subnav">
                        <button className="tw-back-btn" onClick={() => { setReposView('list'); setSelectedRepo(null) }}>← Repos</button>
                        <span className="tw-subnav-title">{selectedRepo.repo_full_name} · Pull Requests</span>
                      </div>
                      <PRList
                        repoFullName={selectedRepo.repo_full_name}
                        githubToken={githubToken}
                        onSelectPR={(pr) => { setSelectedPR(pr); setReposView('pr-detail') }}
                      />
                    </>
                  )}

                  {reposView === 'pr-detail' && selectedRepo && selectedPR && githubToken && (
                    <PRReview
                      repoFullName={selectedRepo.repo_full_name}
                      pr={selectedPR}
                      githubToken={githubToken}
                      canReview={true}
                      onBack={() => { setSelectedPR(null); setReposView('prs') }}
                    />
                  )}

                  {(reposView === 'prs' || reposView === 'pr-detail') && !githubToken && (
                    <div className="tw-placeholder">
                      <p style={{ fontSize: 12, marginBottom: 12 }}>Connect your GitHub account to view PRs</p>
                      <button className="snippet-save-btn" onClick={connectGitHub}>Connect GitHub</button>
                    </div>
                  )}
                </div>
              )}

              {/* ISSUES */}
              {!creatingTeam && section === 'issues' && (
                <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
                  {issuesView === 'repo-select' && (
                    <div className="team-tab-pane">
                      {repos.length === 0 ? (
                        <div className="tw-placeholder">
                          <p style={{ fontSize: 13, fontWeight: 500, marginBottom: 6 }}>No repos linked</p>
                          <p style={{ fontSize: 12 }}>Add a repo in the Repos section first</p>
                        </div>
                      ) : (
                        <>
                          <p style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 10 }}>Select a repo to view its issues:</p>
                          <div className="snippet-list" style={{ maxHeight: 'none' }}>
                            {repos.map(repo => (
                              <div
                                key={repo.id}
                                className="snippet-item"
                                style={{ cursor: 'pointer' }}
                                onClick={() => { setSelectedIssueRepo(repo); setIssuesView('list') }}
                              >
                                <span className="snippet-name">{repo.repo_full_name}</span>
                                <svg width="12" height="12" viewBox="0 0 12 12" fill="none" style={{ color: 'var(--text-muted)', flexShrink: 0 }}>
                                  <path d="M4 2l4 4-4 4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
                                </svg>
                              </div>
                            ))}
                          </div>
                        </>
                      )}
                    </div>
                  )}

                  {issuesView === 'list' && selectedIssueRepo && githubToken && (
                    <>
                      <div className="tw-subnav">
                        <button className="tw-back-btn" onClick={() => { setIssuesView('repo-select'); setSelectedIssueRepo(null) }}>← Repos</button>
                        <span className="tw-subnav-title">{selectedIssueRepo.repo_full_name} · Issues</span>
                      </div>
                      <IssueList
                        repoFullName={selectedIssueRepo.repo_full_name}
                        githubToken={githubToken}
                        currentUserLogin={githubLogin ?? ''}
                        onSelectIssue={(issue) => { setSelectedIssue(issue); setIssuesView('detail') }}
                      />
                    </>
                  )}

                  {issuesView === 'detail' && selectedIssueRepo && selectedIssue && githubToken && (
                    <IssueDetail
                      repoFullName={selectedIssueRepo.repo_full_name}
                      issue={selectedIssue}
                      githubToken={githubToken}
                      onBack={() => { setSelectedIssue(null); setIssuesView('list') }}
                    />
                  )}

                  {issuesView !== 'repo-select' && !githubToken && (
                    <div className="tw-placeholder">
                      <p style={{ fontSize: 12, marginBottom: 12 }}>Connect your GitHub account to view issues</p>
                      <button className="snippet-save-btn" onClick={connectGitHub}>Connect GitHub</button>
                    </div>
                  )}
                </div>
              )}

              {/* PENDINGS */}
              {!creatingTeam && section === 'pendings' && (
                <div className="team-tab-pane">
                  {pendingInvites.length === 0 ? (
                    <p className="snippet-empty">No pending invites.</p>
                  ) : (
                    <>
                      <p style={{ fontSize: 11, color: 'var(--text-secondary)', marginBottom: 12 }}>
                        Accept or decline invitations to other teams.
                      </p>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                        {pendingInvites.map(inv => (
                          <div key={inv.memberId} className="team-pending-banner" style={{ alignItems: 'center' }}>
                            <div>
                              <div style={{ fontSize: 13, fontWeight: 600 }}>{inv.team.name}</div>
                              <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>
                                Invited {new Date(inv.invitedAt).toLocaleDateString()}
                              </div>
                            </div>
                            <div style={{ display: 'flex', gap: 6 }}>
                              <button
                                className="snippet-save-btn"
                                style={{ fontSize: 11, padding: '3px 8px' }}
                                onClick={() => handleAccept(inv.memberId)}
                                disabled={acceptingId === inv.memberId}
                              >
                                {acceptingId === inv.memberId ? '…' : 'Accept'}
                              </button>
                              <button
                                className="snippet-cancel-btn"
                                style={{ fontSize: 11, padding: '3px 8px' }}
                                onClick={() => handleReject(inv.memberId)}
                              >Decline</button>
                            </div>
                          </div>
                        ))}
                      </div>
                      {acceptError && <p style={{ color: '#EF4444', fontSize: 11, marginTop: 10 }}>{acceptError}</p>}
                    </>
                  )}
                </div>
              )}

              {/* MEMBERS */}
              {!creatingTeam && section === 'members' && (
                <div className="team-tab-pane">
                  {pendingInvites.length > 0 && (
                    <div
                      className="team-pending-banner"
                      style={{ cursor: 'pointer' }}
                      onClick={() => setSection('pendings')}
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
                          onClick={(e) => { e.stopPropagation(); setSection('pendings') }}
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
                          <button className="snippet-send-btn" onClick={() => navigator.clipboard.writeText(JSON.stringify(mc.config, null, 2))}>Copy</button>
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

      {showRepoPicker && (
        <RepoPicker
          githubToken={githubToken}
          gitlabToken={gitlabToken}
          excludedFullNames={excludedRepoNames}
          onAdd={handlePickerAdd}
          onClose={() => setShowRepoPicker(false)}
        />
      )}

      {showJoinCodeModal && (
        <div className="confirm-overlay" onMouseDown={e => { if (e.target === e.currentTarget) setShowJoinCodeModal(false) }}>
          <div className="team-modal" style={{ width: 440 }}>
            <div className="team-modal-header">
              <span className="team-modal-title">Join a team with code</span>
              <button className="team-modal-close" onClick={() => setShowJoinCodeModal(false)}>×</button>
            </div>
            <div className="team-modal-body" style={{ padding: '16px' }}>
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

      {statusRepo && userLocalPaths?.[statusRepo.id] && (
        <div className="confirm-overlay" onMouseDown={e => { if (e.target === e.currentTarget) setStatusRepo(null) }}>
          <RepoStatusPanel
            localPath={userLocalPaths![statusRepo.id]}
            repoFullName={statusRepo.repo_full_name}
            onClose={() => setStatusRepo(null)}
          />
        </div>
      )}

      {cloneTarget && (
        <div className="confirm-overlay" onMouseDown={e => { if (e.target === e.currentTarget) setCloneTarget(null) }}>
          <div className="team-modal" style={{ width: 380 }}>
            <div className="team-modal-header">
              <span className="team-modal-title">Open terminal — {cloneTarget.repo_full_name}</span>
              <button className="team-modal-close" onClick={() => setCloneTarget(null)}>×</button>
            </div>
            <div className="team-modal-body" style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
              <p style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 4 }}>
                No local folder found for this repo on this machine. Choose an option:
              </p>
              <button
                className="snippet-save-btn"
                style={{ width: '100%', padding: '8px', fontSize: 12 }}
                onClick={handleCloneTarget}
                disabled={cloning}
              >
                {cloning ? 'Cloning…' : '⬇ Clone repo'}
              </button>
              <button
                className="snippet-save-btn"
                style={{ width: '100%', padding: '8px', fontSize: 12 }}
                onClick={handleLinkTarget}
                disabled={cloning}
              >
                📁 Link existing folder
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  )
}
