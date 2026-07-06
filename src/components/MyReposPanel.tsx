import { useState, useEffect, useMemo, useRef } from 'react'
import { useUserRepos, UserRepo } from '../hooks/useUserRepos'
import { useGitHubNotifications } from '../hooks/useGitHubNotifications'
import PRList, { GitHubPR } from './PRList'
import PRReview from './PRReview'
import IssueList, { GitHubIssue } from './IssueList'
import IssueDetail from './IssueDetail'
import ActivityFeed from './ActivityFeed'
import DailyStandup from './DailyStandup'
import NotificationPanel from './NotificationPanel'
import RepoCIBadge from './RepoCIBadge'
import RepoPicker from './RepoPicker'
import ConfirmDialog from './ConfirmDialog'
import RepoStatusPanel from './RepoStatusPanel'
import RepoSettingsPanel from './RepoSettingsPanel'
import RepoActionsAccordion from './RepoActionsAccordion'
import RepoActionsMenu, { type RepoAction } from './RepoActionsMenu'
import { useGitlab } from '../hooks/useGitlab'
import { ProviderAvatarPill, providerAvatar } from './ProviderAvatar'
import { IntegrationsMarketplaceView } from './IntegrationsMarketplace'
import { useInstalledPlugins } from '../hooks/useInstalledPlugins'
import { useGitInfo } from '../hooks/useGitInfo'
import { BUILTIN_CATALOG } from '../lib/plugins/builtinCatalog'
import { getAdapter, hasAdapter } from '../integrations/registry'
import { IntegrationPanelShell } from './IntegrationPanel/IntegrationPanelShell'
import { captureTerminalOutput } from '../integrations/terminalCapture'

interface MyReposPanelProps {
  onClose: () => void
  githubToken: string | null
  githubLogin: string | null
  onConnectGitHub: () => void
  onOpenRepoTerminal: (repoFullName: string, localPath: string) => void
  /** When provided, the header shows a "?" button that launches the My Repos tutorial. */
  onStartTutorial?: () => void
  /** Repo path of the currently active tab — feeds the worktreeContext of an embedded integration panel. */
  activeRepoPath: string | null
  /** Pane currently focused in the terminal grid — feeds the "attach terminal output" action of an embedded integration panel. */
  focusedPaneId: string | null
}

type Section = 'activity' | 'repos' | 'issues' | 'standup' | 'integrations'
// Sección de un panel de integración instalada embebido (ej. 'integration:demo').
type IntegrationSection = `integration:${string}`
type SectionState = Section | IntegrationSection
type ReposView = 'list' | 'prs' | 'pr-detail'
type IssuesView = 'repo-select' | 'list' | 'detail'

export default function MyReposPanel({ onClose, githubToken, githubLogin, onConnectGitHub, onOpenRepoTerminal, onStartTutorial, activeRepoPath, focusedPaneId }: MyReposPanelProps) {
  const { repos, loading, refresh, addRepo, updateLocalPath, removeRepo } = useUserRepos()
  const { notifications, unreadCount, markAsRead } = useGitHubNotifications(githubToken)
  const { gitlabLogin, gitlabToken } = useGitlab()
  const tokenForProvider = (provider: 'github' | 'gitlab') =>
    provider === 'gitlab' ? gitlabToken : githubToken

  const [section, setSection] = useState<SectionState>('repos')
  const [showPicker, setShowPicker] = useState(false)
  const [showNotifications, setShowNotifications] = useState(false)
  const [statusRepo, setStatusRepo] = useState<UserRepo | null>(null)
  const [confirmAction, setConfirmAction] = useState<{
    title: string
    message: string
    onConfirm: () => void | Promise<void>
  } | null>(null)
  const notifRef = useRef<HTMLDivElement>(null)

  // Repos section
  const [reposView, setReposView] = useState<ReposView>('list')
  const [selectedRepo, setSelectedRepo] = useState<UserRepo | null>(null)
  const [selectedPR, setSelectedPR] = useState<GitHubPR | null>(null)
  const [stackedOnPR, setStackedOnPR] = useState<GitHubPR | null>(null)
  const [repoPermission, setRepoPermission] = useState<string | null>(null)
  const [showRepoSettings, setShowRepoSettings] = useState(false)

  // Issues section
  const [issuesView, setIssuesView] = useState<IssuesView>('repo-select')
  const [selectedIssueRepo, setSelectedIssueRepo] = useState<UserRepo | null>(null)
  const [selectedIssue, setSelectedIssue] = useState<GitHubIssue | null>(null)

  useEffect(() => { refresh() }, [refresh])

  // Close notifications on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (notifRef.current && !notifRef.current.contains(e.target as Node)) setShowNotifications(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const excludedNames = useMemo(() => new Set(repos.map(r => r.repo_full_name)), [repos])

  // Ítems instalados con adapter registrado → grupo "Installed" del nav interno.
  // useInstalledPlugins ya se sincroniza via 'nest:plugins-changed', así que
  // instalar/desinstalar desde la sección Integrations refresca este grupo sin remount.
  const { installed: installedPlugins } = useInstalledPlugins()
  const installedIntegrations = useMemo(
    () => installedPlugins.filter(p => p.enabled && hasAdapter(p.pluginId)),
    [installedPlugins],
  )

  const activeIntegrationId = section.startsWith('integration:') ? section.slice('integration:'.length) : null
  const activeIntegrationAdapter = useMemo(
    () => (activeIntegrationId ? getAdapter(activeIntegrationId) : null),
    [activeIntegrationId],
  )
  // Solo consultar git cuando hay un panel de integración activo: git:info es
  // IPC síncrono en main (execSync x3) y useGitInfo lo re-dispara en cada
  // focus de la ventana. Sin repoPath, el hook no llama a window.git.info.
  const { branch: activeRepoBranch } = useGitInfo(activeIntegrationId ? (activeRepoPath ?? undefined) : undefined)

  // Si se desinstala la integración cuya sección está abierta, volver al marketplace.
  useEffect(() => {
    if (!activeIntegrationId) return
    if (!installedIntegrations.some(p => p.pluginId === activeIntegrationId)) {
      setSection('integrations')
    }
  }, [activeIntegrationId, installedIntegrations])

  const handlePickerAdd = async (repoFullName: string, provider: 'github' | 'gitlab', localPath: string | null) => {
    await addRepo(repoFullName, provider, localPath)
    setShowPicker(false)
  }

  const handleLinkExisting = async (repo: UserRepo) => {
    const folder = await window.git.pickRepoFolder(repo.repo_url)
    if (folder) await updateLocalPath(repo.id, folder)
  }

  const [cloningRepoId, setCloningRepoId] = useState<string | null>(null)
  const [cloneErrorMsg, setCloneErrorMsg] = useState<string | null>(null)
  const [terminalOpening, setTerminalOpening] = useState<string | null>(null)
  // When the linked folder is missing or its remote doesn't match the repo,
  // surface the same "Clone vs Link" dialog TeamsWorkspace uses instead of
  // silently opening a terminal pointed at a dead/wrong path.
  const [openTarget, setOpenTarget] = useState<UserRepo | null>(null)
  const [openTargetReason, setOpenTargetReason] = useState<string | null>(null)
  const [openTargetCloning, setOpenTargetCloning] = useState(false)
  const [openTargetError, setOpenTargetError] = useState<string | null>(null)

  const handleCloneExisting = async (repo: UserRepo) => {
    if (cloningRepoId) return
    setCloningRepoId(repo.id)
    setCloneErrorMsg(null)
    const token = repo.provider === 'gitlab' ? gitlabToken : githubToken
    const result = await window.git.clone(
      `${repo.repo_url}.git`,
      repo.repo_full_name,
      undefined,
      { provider: repo.provider, token: token ?? null },
    )
    setCloningRepoId(null)
    if (result.ok && result.path) {
      await updateLocalPath(repo.id, result.path)
    } else {
      setCloneErrorMsg(result.error ?? 'Clone failed')
    }
  }

  // Normalize remote URLs (strip .git suffix, trailing slashes, embedded
  // basic-auth credentials, case) so a comparison against repo.repo_url
  // doesn't flag identical repos as mismatches. Mirrors TeamsWorkspace.
  const normalizeRemote = (u: string) => u
    .replace(/\.git$/, '')
    .replace(/\/+$/, '')
    .replace(/^https?:\/\/[^@/]+@/, 'https://')
    .toLowerCase()

  const handleOpenTerminal = async (repo: UserRepo) => {
    if (terminalOpening) return
    if (!repo.local_path) {
      setOpenTargetReason(`No local folder linked for "${repo.repo_full_name}".`)
      setOpenTarget(repo)
      return
    }
    setTerminalOpening(repo.id)
    try {
      const exists = await window.pathUtils.exists(repo.local_path)
      if (!exists) {
        setOpenTargetReason(`La carpeta \`${repo.local_path}\` ya no existe. ¿Querés re-linkear o clonar de nuevo?`)
        setOpenTarget(repo)
        return
      }
      // Verify the remote actually matches the repo — guards against the
      // wrong-folder bug where a stale local_path points at a different repo.
      // New IPC shape: { ok: true, url } | { ok: false, reason }. Falls back
      // gracefully if main returns the legacy string|null.
      try {
        const rawResult: unknown = await (window.git as unknown as {
          getRemoteUrl: (folder: string) => Promise<unknown>
        }).getRemoteUrl(repo.local_path)
        let remoteUrl: string | null = null
        if (typeof rawResult === 'string') {
          remoteUrl = rawResult
        } else if (rawResult && typeof rawResult === 'object' && 'ok' in rawResult) {
          const r = rawResult as { ok: boolean; url?: string | null; reason?: string }
          if (r.ok && r.url) remoteUrl = r.url
        }
        if (remoteUrl && normalizeRemote(remoteUrl) !== normalizeRemote(repo.repo_url)) {
          setOpenTargetReason(`La carpeta \`${repo.local_path}\` apunta a otro repo (${remoteUrl}). ¿Querés re-linkear o clonar de nuevo?`)
          setOpenTarget(repo)
          return
        }
      } catch {
        // getRemoteUrl failures (git missing, IPC throw) are non-fatal — fall
        // through and open the terminal. The user can manually re-link later.
      }
      onOpenRepoTerminal(repo.repo_full_name, repo.local_path)
    } finally {
      setTerminalOpening(null)
    }
  }

  const handleOpenTargetClone = async () => {
    if (!openTarget) return
    setOpenTargetCloning(true)
    setOpenTargetError(null)
    const token = openTarget.provider === 'gitlab' ? gitlabToken : githubToken
    const result = await window.git.clone(
      `${openTarget.repo_url}.git`,
      openTarget.repo_full_name,
      undefined,
      { provider: openTarget.provider, token: token ?? null },
    )
    setOpenTargetCloning(false)
    if (result.ok && result.path) {
      await updateLocalPath(openTarget.id, result.path)
      const target = openTarget
      setOpenTarget(null)
      setOpenTargetReason(null)
      onOpenRepoTerminal(target.repo_full_name, result.path)
    } else {
      setOpenTargetError(result.error ?? 'Clone failed')
    }
  }

  const handleOpenTargetLink = async () => {
    if (!openTarget) return
    // pickRepoFolder accepts an `expectedRemote` arg in preload.ts but is
    // typed as 0-args in src/types.ts (pre-existing mismatch — see line 83
    // and TeamsWorkspace for the same call). Cast around the type until
    // types.ts is updated to match the preload signature.
    const folder = await (window.git.pickRepoFolder as unknown as (expected?: string) => Promise<string | null>)(openTarget.repo_url)
    if (folder) {
      await updateLocalPath(openTarget.id, folder)
      const target = openTarget
      setOpenTarget(null)
      setOpenTargetReason(null)
      onOpenRepoTerminal(target.repo_full_name, folder)
    }
  }

  const switchSection = (s: Section) => {
    setSection(s)
    if (s === 'repos') { setReposView('list'); setSelectedRepo(null); setSelectedPR(null) }
    if (s === 'issues') { setIssuesView('repo-select'); setSelectedIssueRepo(null); setSelectedIssue(null) }
  }

  const openIntegration = (pluginId: string) => setSection(`integration:${pluginId}`)

  const NAV_ITEMS: { id: Section; label: string; icon: React.ReactNode }[] = [
    {
      id: 'activity',
      label: 'Activity',
      icon: <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M2 8h3l2-5 3 10 2-5h2" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/></svg>,
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
      id: 'standup',
      label: 'Standup',
      icon: <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><rect x="2" y="3" width="12" height="11" rx="1.5" stroke="currentColor" strokeWidth="1.3"/><path d="M5 6h6M5 9h4M5 12h3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/></svg>,
    },
    {
      id: 'integrations',
      label: 'Integrations',
      icon: <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><rect x="1" y="1" width="6" height="6" rx="1.2" stroke="currentColor" strokeWidth="1.3"/><rect x="9" y="1" width="6" height="6" rx="1.2" stroke="currentColor" strokeWidth="1.3"/><rect x="1" y="9" width="6" height="6" rx="1.2" stroke="currentColor" strokeWidth="1.3"/><path d="M12 9v6M9 12h6" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/></svg>,
    },
  ]

  const myAvatar = githubLogin
    ? providerAvatar('github', githubLogin)
    : (gitlabLogin ? providerAvatar('gitlab', gitlabLogin) : null)

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
            <circle cx="4" cy="4" r="1.5" stroke="currentColor" strokeWidth="1.3"/>
            <circle cx="12" cy="4" r="1.5" stroke="currentColor" strokeWidth="1.3"/>
            <circle cx="4" cy="12" r="1.5" stroke="currentColor" strokeWidth="1.3"/>
            <path d="M4 5.5v5M5.5 4h5M4 5.5c2 0 4 1 4 3.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
          </svg>
          <span className="tw-header-title" data-tour-id="myrepos-header">My Repos</span>
        </div>

        <div className="tw-header-right">
          {!githubToken && (
            <button className="tw-connect-github-btn" onClick={onConnectGitHub} title="Connect GitHub">
              <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
                <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/>
              </svg>
              GitHub
            </button>
          )}
          {((githubToken && githubLogin) || (gitlabToken && gitlabLogin)) && (
            <span className="tw-provider-avatars">
              {githubToken && githubLogin && <ProviderAvatarPill provider="github" login={githubLogin} />}
              {gitlabToken && gitlabLogin && <ProviderAvatarPill provider="gitlab" login={gitlabLogin} />}
            </span>
          )}
          {onStartTutorial && (
            <button className="tour-help-btn" onClick={onStartTutorial} title="Tutorial: My Repos">?</button>
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

      {/* Body: sidebar + content */}
      <div className="teams-workspace-body">
        <nav className="teams-workspace-nav" data-tour-id="myrepos-nav">
          {NAV_ITEMS.map(item => (
            <button
              key={item.id}
              className={`tw-nav-btn${section === item.id ? ' active' : ''}`}
              onClick={() => switchSection(item.id)}
            >
              {item.icon}
              {item.label}
            </button>
          ))}

          {installedIntegrations.length > 0 && (
            // role="group" + aria-label le dan semántica al grupo (misma idea
            // que los <section aria-label> del marketplace); el label visual
            // queda oculto para lectores de pantalla para no duplicarlo.
            <div role="group" aria-label="Installed">
              <div aria-hidden style={{ fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5, color: 'var(--text-secondary)', padding: '10px 12px 2px' }}>
                Installed
              </div>
              {installedIntegrations.map(p => {
                const manifest = BUILTIN_CATALOG.find(m => m.id === p.pluginId)
                return (
                  <button
                    key={p.pluginId}
                    className={`tw-nav-btn${section === `integration:${p.pluginId}` ? ' active' : ''}`}
                    onClick={() => openIntegration(p.pluginId)}
                  >
                    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" style={{ color: manifest?.color }}>
                      <rect x="2" y="2" width="12" height="12" rx="3.5" stroke="currentColor" strokeWidth="1.4" />
                      <path d="M5.5 8h5M8 5.5v5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
                    </svg>
                    {manifest?.name ?? p.pluginId}
                  </button>
                )
              })}
            </div>
          )}
        </nav>

        <div className="teams-workspace-content">
          <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>

            {/* Integrations no depende de GitHub/GitLab: se excluye del gate genérico. */}
            {!githubToken && !gitlabToken && section !== 'integrations' && !activeIntegrationId && (
              <div className="tw-placeholder">
                <p className="tw-placeholder-title">Connect GitHub or GitLab to use My Repos</p>
                <p className="tw-placeholder-text">Activity, PRs and issues require GitHub. Repos and Actions work with both providers — connect one or both from Settings → Account.</p>
                <button className="snippet-save-btn" onClick={onConnectGitHub}>Connect GitHub</button>
              </div>
            )}

            {/* Fallback al marketplace si la sección activa apunta a un adapter que ya no existe. */}
            {(section === 'integrations' || (activeIntegrationId && !activeIntegrationAdapter)) && <IntegrationsMarketplaceView />}

            {activeIntegrationId && activeIntegrationAdapter && (
              <div className="ip-embedded">
                <IntegrationPanelShell
                  adapter={activeIntegrationAdapter}
                  worktreeContext={{ repoPath: activeRepoPath, branch: activeRepoBranch ?? null }}
                  getTerminalOutput={() => captureTerminalOutput(focusedPaneId)}
                />
              </div>
            )}

            {section === 'activity' && githubToken && (
              <div className="team-tab-pane">
                <ActivityFeed
                  repos={repos}
                  githubToken={githubToken}
                  teamMembers={[]}
                />
              </div>
            )}
            {section === 'activity' && !githubToken && gitlabToken && (
              <div className="tw-placeholder">
                <p className="tw-placeholder-title">Activity requires GitHub</p>
                <p className="tw-placeholder-text">Connect GitHub from Settings → Account to see your recent activity feed.</p>
                <button className="snippet-save-btn" onClick={onConnectGitHub}>Connect GitHub</button>
              </div>
            )}

            {/* REPOS — list */}
            {(githubToken || gitlabToken) && section === 'repos' && reposView === 'list' && (
              <div className="team-tab-pane" style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
                  <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                    {repos.length} {repos.length === 1 ? 'repo' : 'repos'}
                  </span>
                  <button className="repo-action-btn primary" data-tour-id="myrepos-add" onClick={() => setShowPicker(true)}>
                    <svg className="ra-icon" width="11" height="11" viewBox="0 0 16 16" fill="none">
                      <path d="M8 3.5v9M3.5 8h9" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/>
                    </svg>
                    Add repo
                  </button>
                </div>

                {loading && <p className="snippet-empty">Loading…</p>}

                {!loading && repos.length === 0 && (
                  <div className="tw-placeholder">
                    <p className="tw-placeholder-title">No repos</p>
                    <p style={{ fontSize: 12 }}>Click <strong>＋ Add repo</strong> to pick one from your connected accounts</p>
                  </div>
                )}

                {!loading && repos.length > 0 && (() => {
                  const groups: Array<{ provider: 'github' | 'gitlab'; label: string; items: typeof repos }> = []
                  const ghRepos = repos.filter(r => (r.provider ?? 'github') === 'github')
                  const glRepos = repos.filter(r => r.provider === 'gitlab')
                  if (ghRepos.length > 0) groups.push({ provider: 'github', label: 'GitHub', items: ghRepos })
                  if (glRepos.length > 0) groups.push({ provider: 'gitlab', label: 'GitLab', items: glRepos })
                  const showHeaders = groups.length > 1
                  return (
                    <div className="repo-list-scroll snippet-list" data-tour-id="myrepos-list" style={{ flex: 1, minHeight: 0, maxHeight: 'none' }}>
                      {groups.map(group => (
                        <div key={group.provider}>
                          {showHeaders && (
                            <div style={{ fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5, color: 'var(--text-secondary)', padding: '8px 4px 6px', borderBottom: '1px solid var(--border)', marginBottom: 6 }}>
                              {group.label} ({group.items.length})
                            </div>
                          )}
                          {group.items.map(repo => {
                            const repoProvider: 'github' | 'gitlab' = repo.provider ?? 'github'
                            const overflow: RepoAction[] = []
                            if (repo.local_path) {
                              overflow.push({
                                label: 'Git status',
                                onClick: () => setStatusRepo(repo),
                                icon: (
                                  <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
                                    <circle cx="8" cy="8" r="5.5" stroke="currentColor" strokeWidth="1.4"/>
                                    <path d="M8 5.5v3l2 1.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
                                  </svg>
                                ),
                              })
                              overflow.push({
                                label: 'Re-link folder',
                                onClick: () => handleLinkExisting(repo),
                                icon: (
                                  <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
                                    <path d="M6.5 9.5l3-3M6 5.5h-1a2.5 2.5 0 000 5h1M10 10.5h1a2.5 2.5 0 000-5h-1" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
                                  </svg>
                                ),
                              })
                            } else {
                              overflow.push({
                                label: 'Link existing folder',
                                onClick: () => handleLinkExisting(repo),
                                icon: (
                                  <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
                                    <path d="M6.5 9.5l3-3M6 5.5h-1a2.5 2.5 0 000 5h1M10 10.5h1a2.5 2.5 0 000-5h-1" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
                                  </svg>
                                ),
                              })
                            }
                            overflow.push({
                              label: 'Remove from list',
                              danger: true,
                              onClick: () => setConfirmAction({
                                title: 'Remove repo',
                                message: `Remove "${repo.repo_full_name}" from your list? The local folder will not be deleted.`,
                                onConfirm: () => removeRepo(repo.id),
                              }),
                              icon: (
                                <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
                                  <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                                </svg>
                              ),
                            })
                            return (
                              <div key={repo.id} className="snippet-item" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 6 }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                  <div style={{ flex: 1, minWidth: 0 }}>
                                    <span className="snippet-name">{repo.repo_full_name}</span>
                                    {repo.local_path ? (
                                      <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                        📁 {repo.local_path}
                                      </div>
                                    ) : (
                                      <div style={{ fontSize: 10, color: '#f59e0b', marginTop: 2 }}>
                                        No local folder
                                      </div>
                                    )}
                                  </div>
                                  <div className="snippet-item-actions" data-tour-id="myrepos-actions">
                                    {repoProvider === 'github' && (
                                      <RepoCIBadge repoFullName={repo.repo_full_name} githubToken={githubToken} />
                                    )}
                                    {repo.local_path ? (
                                      <button
                                        className="repo-action-btn subtle-accent"
                                        onClick={() => handleOpenTerminal(repo)}
                                        disabled={terminalOpening === repo.id}
                                        title="Open terminal in this repo"
                                      >
                                        <svg className="ra-icon" width="11" height="11" viewBox="0 0 16 16" fill="none">
                                          <path d="M3 4l3 3-3 3M7.5 10.5h5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
                                        </svg>
                                        Terminal
                                      </button>
                                    ) : (
                                      <button
                                        className="repo-action-btn subtle-accent"
                                        onClick={() => handleCloneExisting(repo)}
                                        title="Clone repository"
                                        disabled={cloningRepoId === repo.id}
                                      >
                                        <svg className="ra-icon" width="11" height="11" viewBox="0 0 16 16" fill="none">
                                          <path d="M8 2v8M5 7l3 3 3-3M3 13h10" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
                                        </svg>
                                        {cloningRepoId === repo.id ? 'Cloning…' : 'Clone'}
                                      </button>
                                    )}
                                    {repoProvider === 'github' && (
                                      <button
                                        className="repo-action-btn"
                                        title="Pull requests"
                                        onClick={async () => {
                                          setSelectedRepo(repo)
                                          setReposView('prs')
                                          setRepoPermission(null)
                                          if (githubToken && githubLogin) {
                                            try {
                                              const res = await fetch(
                                                `https://api.github.com/repos/${repo.repo_full_name}/collaborators/${githubLogin}/permission`,
                                                { headers: { Authorization: `Bearer ${githubToken}`, Accept: 'application/vnd.github.v3+json' } }
                                              )
                                              if (res.ok) {
                                                const data = await res.json()
                                                setRepoPermission(data.permission ?? null)
                                              }
                                            } catch { /* sin permiso = no merge */ }
                                          }
                                        }}
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
                                    <RepoActionsMenu actions={overflow} />
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
                      ))}
                    </div>
                  )
                })()}
              </div>
            )}

            {/* REPOS — PRs view */}
            {githubToken && section === 'repos' && reposView === 'prs' && selectedRepo && (
              <>
                <div className="tw-subnav">
                  <button className="tw-back-btn" onClick={() => { setSelectedRepo(null); setReposView('list') }}>← My Repos</button>
                  <span className="tw-subnav-title">{selectedRepo.repo_full_name} · Pull Requests</span>
                  {(repoPermission === 'admin' || repoPermission === 'maintain') && (
                    <button
                      className="snippet-cancel-btn"
                      style={{ marginLeft: 'auto', fontSize: 11, padding: '2px 8px' }}
                      onClick={() => setShowRepoSettings(true)}
                      title="Repo settings"
                    >
                      ⚙ Settings
                    </button>
                  )}
                </div>
                <PRList
                  repoFullName={selectedRepo.repo_full_name}
                  githubToken={githubToken}
                  onSelectPR={(pr, parent) => { setSelectedPR(pr); setStackedOnPR(parent ?? null); setReposView('pr-detail') }}
                />
              </>
            )}

            {/* REPOS — PR detail */}
            {githubToken && section === 'repos' && reposView === 'pr-detail' && selectedRepo && selectedPR && (
              <PRReview
                repoFullName={selectedRepo.repo_full_name}
                pr={selectedPR}
                githubToken={githubToken}
                canReview={true}
                canMerge={repoPermission === 'admin' || repoPermission === 'maintain'}
                onBack={() => { setSelectedPR(null); setStackedOnPR(null); setReposView('prs'); setRepoPermission(null) }}
                stackedOnPR={stackedOnPR ?? undefined}
              />
            )}

            {/* ISSUES — repo selector */}
            {githubToken && section === 'issues' && issuesView === 'repo-select' && (() => {
              // H1: GitHub Issues API doesn't apply to GitLab repos — filter them out.
              // GitLab has its own issues API and a different schema; the IssueList
              // component talks to api.github.com only, so showing GitLab repos here
              // would just produce 404s.
              const githubRepos = repos.filter(r => (r.provider ?? 'github') === 'github')
              return (
              <div className="team-tab-pane">
                {repos.length === 0 ? (
                  <div className="tw-placeholder">
                    <p style={{ fontSize: 13, fontWeight: 500, marginBottom: 6 }}>No repos linked</p>
                    <p style={{ fontSize: 12 }}>First add a repo in the Repos section</p>
                  </div>
                ) : githubRepos.length === 0 ? (
                  <div className="tw-placeholder">
                    <p style={{ fontSize: 13, fontWeight: 500, marginBottom: 6 }}>No GitHub repos</p>
                    <p style={{ fontSize: 12 }}>Issues only available for GitHub repos — connect your GitHub account or add a GitHub repo above.</p>
                  </div>
                ) : (
                  <>
                    <p style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 10 }}>Select a repo to view its issues:</p>
                    <div className="snippet-list" style={{ maxHeight: 'none' }}>
                      {githubRepos.map(repo => (
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
              )
            })()}

            {/* ISSUES — list */}
            {githubToken && section === 'issues' && issuesView === 'list' && selectedIssueRepo && (
              <>
                <div className="tw-subnav">
                  <button className="tw-back-btn" onClick={() => { setSelectedIssueRepo(null); setIssuesView('repo-select') }}>← Repos</button>
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

            {/* ISSUES — detail */}
            {githubToken && section === 'issues' && issuesView === 'detail' && selectedIssueRepo && selectedIssue && (
              <IssueDetail
                repoFullName={selectedIssueRepo.repo_full_name}
                issue={selectedIssue}
                githubToken={githubToken}
                localPath={selectedIssueRepo.local_path}
                onOpenRepoTerminal={onOpenRepoTerminal}
                onBack={() => { setSelectedIssue(null); setIssuesView('list') }}
              />
            )}

            {/* STANDUP */}
            {githubToken && section === 'standup' && (
              <div className="team-tab-pane">
                <DailyStandup
                  repos={repos}
                  githubToken={githubToken}
                  teamMembers={githubLogin ? [{ email: githubLogin, user_id: githubLogin }] : []}
                />
              </div>
            )}

            {!githubToken && gitlabToken && (section === 'issues' || section === 'standup') && (
              <div className="tw-placeholder">
                <p className="tw-placeholder-title">
                  {section === 'issues' ? 'Issues' : 'Standup'} requires GitHub
                </p>
                <p className="tw-placeholder-text">
                  This section uses the GitHub API. Connect GitHub from Settings → Account.
                </p>
                <button className="snippet-save-btn" onClick={onConnectGitHub}>Connect GitHub</button>
              </div>
            )}

          </div>
        </div>
      </div>

      {showPicker && (
        <RepoPicker
          githubToken={githubToken}
          gitlabToken={gitlabToken}
          excludedFullNames={excludedNames}
          onAdd={handlePickerAdd}
          onClose={() => setShowPicker(false)}
        />
      )}

      {confirmAction && (
        <ConfirmDialog
          title={confirmAction.title}
          message={confirmAction.message}
          confirmLabel="Remove"
          confirmDanger
          onConfirm={async () => {
            await confirmAction.onConfirm()
            setConfirmAction(null)
          }}
          onCancel={() => setConfirmAction(null)}
        />
      )}

      {cloneErrorMsg && (
        <div className="confirm-overlay" onMouseDown={e => { if (e.target === e.currentTarget) setCloneErrorMsg(null) }}>
          <div className="confirm-dialog" style={{ width: 380 }}>
            <div className="confirm-title">Clone failed</div>
            <div className="confirm-message" style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', color: '#FF4444' }}>
              {cloneErrorMsg}
            </div>
            <div className="confirm-actions">
              <button className="confirm-btn-cancel" onClick={() => setCloneErrorMsg(null)}>Close</button>
            </div>
          </div>
        </div>
      )}

      {openTarget && (
        <div className="confirm-overlay" onMouseDown={e => { if (e.target === e.currentTarget && !openTargetCloning) { setOpenTarget(null); setOpenTargetReason(null); setOpenTargetError(null) } }}>
          <div className="confirm-dialog" style={{ width: 420, padding: 18 }}>
            <div className="confirm-title" style={{ marginBottom: 4, fontSize: 14 }}>
              {openTarget.repo_full_name}
            </div>
            <div className="confirm-message" style={{ marginBottom: 14, color: 'var(--text-muted)', fontSize: 12, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
              {openTargetReason ?? 'No local folder for this repo on this machine.'}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <button
                className="clone-action-btn clone-action-btn--primary"
                onClick={handleOpenTargetClone}
                disabled={openTargetCloning}
              >
                <span className="clone-action-icon">
                  <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                    <path d="M8 2v8M4.5 6.5L8 10l3.5-3.5M3 13h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                </span>
                <span className="clone-action-body">
                  <span className="clone-action-label">{openTargetCloning ? 'Cloning…' : 'Clone repo'}</span>
                  <span className="clone-action-sub">Downloads a fresh copy into your RavenProjects folder</span>
                </span>
              </button>
              <button
                className="clone-action-btn"
                onClick={handleOpenTargetLink}
                disabled={openTargetCloning}
              >
                <span className="clone-action-icon">
                  <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                    <path d="M2 5.5A1.5 1.5 0 013.5 4h2.382a1.5 1.5 0 011.06.44l.618.618a1.5 1.5 0 001.061.44H12.5A1.5 1.5 0 0114 7v4.5A1.5 1.5 0 0112.5 13h-9A1.5 1.5 0 012 11.5v-6z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round"/>
                  </svg>
                </span>
                <span className="clone-action-body">
                  <span className="clone-action-label">Link existing folder</span>
                  <span className="clone-action-sub">Pick a folder you already cloned. We&apos;ll verify the remote matches.</span>
                </span>
              </button>
            </div>
            {openTargetError && (
              <div className="clone-action-error">{openTargetError}</div>
            )}
            <div className="confirm-actions" style={{ marginTop: 14 }}>
              <button
                className="confirm-btn-cancel"
                onClick={() => { setOpenTarget(null); setOpenTargetReason(null); setOpenTargetError(null) }}
                disabled={openTargetCloning}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {showRepoSettings && selectedRepo && githubToken && (
        <RepoSettingsPanel
          repoFullName={selectedRepo.repo_full_name}
          githubToken={githubToken}
          onClose={() => setShowRepoSettings(false)}
        />
      )}

      {statusRepo && statusRepo.local_path && (
        <div className="confirm-overlay" onMouseDown={e => { if (e.target === e.currentTarget) setStatusRepo(null) }}>
          <RepoStatusPanel
            localPath={statusRepo.local_path}
            repoFullName={statusRepo.repo_full_name}
            onClose={() => setStatusRepo(null)}
          />
        </div>
      )}
    </div>
  )
}
