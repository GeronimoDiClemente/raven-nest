import { useState, useEffect, useRef } from 'react'
import LayoutPicker from './LayoutPicker'
import SnippetPanel from './SnippetPanel'
import CommandHistoryPanel from './CommandHistoryPanel'
import WorkspacePanel from './WorkspacePanel'
import MCPPanel from './MCPPanel'
import SettingsPanel from './SettingsPanel'
import UserMenu from './UserMenu'
import RepoActionsBar from './RepoActionsBar'
import { useGitHub } from '../hooks/useGitHub'
import { useGitlab } from '../hooks/useGitlab'
import { GridLayout, Workspace } from '../types'
import { supabase } from '../lib/supabase'
import { terminalJoinService } from '../lib/terminalJoinService'
import { basename } from '../lib/path'
import { useGitInfo } from '../hooks/useGitInfo'

interface Props {
  expanded: boolean
  onToggle: () => void
  broadcastMode: boolean
  onBroadcastToggle: () => void
  isListening: boolean
  isTranscribing: boolean
  isModelLoading: boolean
  onMicToggle: () => void
  layout: GridLayout
  onLayoutChange: (layout: GridLayout) => void
  onNewPane: () => void
  onHistoryOpen: () => void
  onSnippetSend: (content: string) => void
  onSnippetBroadcast: (content: string) => void
  onCommandRun?: (cmd: string) => void
  onWorkspaceSave: (name: string) => void
  onWorkspaceLoad: (ws: Workspace) => void
  isWin: boolean
  isTrialActive?: boolean
  trialDaysLeft?: number
  profileLoading?: boolean
  onUpgrade?: () => void
  onTeamsOpen?: () => void
  pendingInvitesCount?: number
  onMyReposOpen?: () => void
  plan?: 'free' | 'pro' | 'team'
  repoPath?: string
  onRepoLink: () => void
  onRepoUnlink: () => void
  onJoinTerminal: () => void
}

export default function Sidebar({
  expanded, onToggle, broadcastMode, onBroadcastToggle,
  isListening, isTranscribing, isModelLoading, onMicToggle,
  layout, onLayoutChange, onNewPane, onHistoryOpen,
  onSnippetSend, onSnippetBroadcast, onCommandRun, onWorkspaceSave, onWorkspaceLoad, isWin,
  isTrialActive, trialDaysLeft, profileLoading, onUpgrade, onTeamsOpen, pendingInvitesCount = 0, onMyReposOpen, plan, repoPath, onRepoLink, onRepoUnlink, onJoinTerminal
}: Props) {
  const { branch, githubUrl, isDirty } = useGitInfo(repoPath)
  const { githubToken } = useGitHub()
  const { gitlabToken } = useGitlab()
  const repoCi = (() => {
    if (!githubUrl) return null
    const m = githubUrl.match(/^https?:\/\/([^/]+)\/(.+?)(?:\.git)?\/?$/)
    if (!m) return null
    const host = m[1].toLowerCase()
    const fullName = m[2]
    if (host.includes('github')) return { provider: 'github' as const, repoFullName: fullName, token: githubToken }
    if (host.includes('gitlab')) return { provider: 'gitlab' as const, repoFullName: fullName, token: gitlabToken }
    return null
  })()
  const [updateState, setUpdateState] = useState<'idle' | 'checking' | 'up-to-date' | 'update-found' | 'error'>('idle')
  const [userEmail, setUserEmail] = useState('')
  const [joinOpen, setJoinOpen] = useState(false)
  const [joinInput, setJoinInput] = useState('')
  const [joinConnected, setJoinConnected] = useState(terminalJoinService.isConnected)
  const [, forceUpdate] = useState(0)
  const joinInputRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      setUserEmail(data.user?.email ?? '')
    })
  }, [])

  useEffect(() => {
    return terminalJoinService.subscribe(() => {
      setJoinConnected(terminalJoinService.isConnected)
      forceUpdate(n => n + 1) // re-render to pick up isConnecting / error
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
      // Download starts automatically — App.tsx shows the install banner
      setUpdateState('update-found')
      setTimeout(() => setUpdateState('idle'), 4000)
    } else {
      setUpdateState('error')
      setTimeout(() => setUpdateState('idle'), 3000)
    }
  }

  return (
    <div className={`sidebar${expanded ? ' expanded' : ''}`}>

      {/* Toggle */}
      <button className="sidebar-item sidebar-toggle" onClick={onToggle} title={expanded ? 'Collapse sidebar' : 'Expand sidebar'}>
        <span className="sidebar-icon">
          {expanded ? (
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M10 3L5 8l5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          ) : (
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <rect x="2" y="4" width="12" height="1.5" rx="0.75" fill="currentColor"/>
              <rect x="2" y="7.25" width="12" height="1.5" rx="0.75" fill="currentColor"/>
              <rect x="2" y="10.5" width="12" height="1.5" rx="0.75" fill="currentColor"/>
            </svg>
          )}
        </span>
      </button>

      {/* Broadcast */}
      <button
        className={`sidebar-item${broadcastMode ? ' active' : ''}`}
        onClick={onBroadcastToggle}
        title={broadcastMode ? 'Broadcast ON — click to turn off' : 'Broadcast OFF — click to turn on'}
      >
        <span className="sidebar-icon">
          <svg width="16" height="16" viewBox="0 0 14 14" fill="none">
            <circle cx="7" cy="7" r="2" fill="currentColor"/>
            <path d="M4 4a4.24 4.24 0 0 0 0 6M10 4a4.24 4.24 0 0 1 0 6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
            <path d="M2 2a7.07 7.07 0 0 0 0 10M12 2a7.07 7.07 0 0 1 0 10" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" opacity="0.5"/>
          </svg>
        </span>
        <span className="sidebar-label">{broadcastMode ? 'Broadcasting' : 'Broadcast'}</span>
      </button>

      {/* Join Terminal — popover panel to the right, same pattern as other sidebar panels */}
      <div className="sidebar-item-panel" style={{ position: 'relative' }}>
        <button
          className={`sidebar-item${joinConnected ? ' active' : ''}`}
          style={{ color: joinConnected ? '#22c55e' : undefined }}
          onClick={() => {
            if (joinConnected) { onJoinTerminal() }
            else { setJoinOpen(v => !v); setTimeout(() => joinInputRef.current?.focus(), 50) }
          }}
          title={joinConnected ? 'View shared terminal' : 'Join remote terminal'}
        >
          <span className="sidebar-icon">
            <svg width="16" height="16" viewBox="0 0 12 12" fill="none">
              <circle cx="10" cy="2" r="1.5" stroke="currentColor" strokeWidth="1.3"/>
              <circle cx="2" cy="6" r="1.5" stroke="currentColor" strokeWidth="1.3"/>
              <circle cx="10" cy="10" r="1.5" stroke="currentColor" strokeWidth="1.3"/>
              <path d="M3.5 5.2L8.5 2.8M3.5 6.8L8.5 9.2" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
            </svg>
          </span>
          <span className="sidebar-label">{joinConnected ? `● ${terminalJoinService.code}` : 'Join Terminal'}</span>
        </button>

        {/* Popover panel — opens to the right */}
        {joinOpen && !joinConnected && (
          <div className="ts-panel" style={{ position: 'absolute', top: 0, left: 'calc(100% + 4px)', zIndex: 200, width: 260 }}>
            <div className="ts-panel-header">
              <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>Join Terminal</span>
              <button className="ts-close" onClick={() => { setJoinOpen(false); setJoinInput('') }}>×</button>
            </div>
            <div className="ts-body">
              <p className="ts-desc">Enter the code shared by the host to connect to their terminal.</p>
              <input
                ref={joinInputRef}
                value={joinInput}
                onChange={e => setJoinInput(e.target.value.toUpperCase())}
                onKeyDown={e => {
                  if (e.key === 'Enter' && joinInput.length >= 8) {
                    terminalJoinService.join(joinInput.trim())
                    const unsub = terminalJoinService.subscribe(() => {
                      if (terminalJoinService.isConnected) {
                        unsub(); setJoinOpen(false); setJoinInput(''); onJoinTerminal()
                      }
                    })
                  }
                  if (e.key === 'Escape') { setJoinOpen(false); setJoinInput('') }
                }}
                maxLength={8}
                placeholder="Enter code…"
                autoFocus
                style={{
                  display: 'block',
                  width: '100%',
                  boxSizing: 'border-box',
                  background: 'var(--bg-elevated)',
                  border: '1px solid var(--border)',
                  borderRadius: 6,
                  color: 'var(--text-primary)',
                  fontSize: 20,
                  fontWeight: 700,
                  padding: '8px 12px',
                  letterSpacing: 4,
                  textAlign: 'center',
                  textTransform: 'uppercase',
                  marginBottom: 10,
                  outline: 'none',
                }}
              />
              {terminalJoinService.error && (
                <p style={{ color: '#EF4444', fontSize: 11, marginBottom: 8, margin: '0 0 8px' }}>{terminalJoinService.error}</p>
              )}
              <button
                disabled={joinInput.length < 8 || terminalJoinService.isConnecting}
                onClick={() => {
                  terminalJoinService.join(joinInput.trim())
                  const unsub = terminalJoinService.subscribe(() => {
                    if (terminalJoinService.isConnected) {
                      unsub(); setJoinOpen(false); setJoinInput(''); onJoinTerminal()
                    }
                  })
                }}
                style={{
                  width: '100%',
                  background: joinInput.length >= 8 ? '#0066FF' : 'var(--bg-elevated)',
                  color: joinInput.length >= 8 ? '#fff' : 'var(--text-muted)',
                  border: 'none',
                  borderRadius: 6,
                  padding: '8px 0',
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: joinInput.length >= 8 ? 'pointer' : 'default',
                }}
              >
                {terminalJoinService.isConnecting ? 'Connecting…' : 'Connect'}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Microphone */}
      <button
        className={`sidebar-item${isListening ? ' active' : (isTranscribing || isModelLoading) ? ' sidebar-transcribing' : ''}`}
        onClick={(isTranscribing || isModelLoading) ? undefined : onMicToggle}
        style={(isTranscribing || isModelLoading) ? { cursor: 'default', opacity: 0.7 } : undefined}
        title={isListening ? 'Click or press F5 to stop' : isTranscribing ? 'Processing…' : isModelLoading ? 'Loading voice model…' : 'Click or press F5 to speak'}
      >
        <span className="sidebar-icon">
          {(isTranscribing || isModelLoading) ? (
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" style={{ animation: 'spin 1s linear infinite' }}>
              <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.5" strokeDasharray="20 10" strokeLinecap="round"/>
            </svg>
          ) : (
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <rect x="5.5" y="1" width="5" height="8" rx="2.5" stroke="currentColor" strokeWidth="1.3"/>
              <path d="M3 7v1a5 5 0 0 0 10 0V7" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
              <path d="M8 13v2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
            </svg>
          )}
        </span>
        <span className="sidebar-label">
          {isListening ? 'Listening…' : isTranscribing ? 'Processing…' : isModelLoading ? 'Loading…' : 'Voice'}
        </span>
      </button>

      {/* History */}
      <button className="sidebar-item" onClick={onHistoryOpen} title="Conversation history">
        <span className="sidebar-icon">
          <svg width="16" height="16" viewBox="0 0 14 14" fill="none">
            <circle cx="7" cy="7" r="5.5" stroke="currentColor" strokeWidth="1.3"/>
            <path d="M7 4v3.5l2 1.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
          </svg>
        </span>
        <span className="sidebar-label">History</span>
      </button>

      {/* Workspaces */}
      <div className="sidebar-item sidebar-item-panel">
        <span className="sidebar-icon">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <rect x="1" y="2" width="14" height="10" rx="1.5" stroke="currentColor" strokeWidth="1.3"/>
            <path d="M5 12v2M11 12v2M3 14h10" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
          </svg>
        </span>
        <span className="sidebar-label">Workspaces</span>
        <WorkspacePanel onSave={onWorkspaceSave} onLoad={onWorkspaceLoad} onRequireUpgrade={onUpgrade} />
      </div>

      {/* MCP Servers */}
      <div className="sidebar-item sidebar-item-panel">
        <span className="sidebar-icon">
          <svg width="16" height="16" viewBox="0 0 14 14" fill="none">
            <rect x="1" y="2" width="8" height="10" rx="1.2" stroke="currentColor" strokeWidth="1.3"/>
            <path d="M4 5h2M4 7.5h3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
            <circle cx="11" cy="5" r="2" stroke="currentColor" strokeWidth="1.3"/>
            <path d="M11 7v4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
          </svg>
        </span>
        <span className="sidebar-label">MCP</span>
        <MCPPanel repoPath={repoPath} onRequireUpgrade={onUpgrade} />
      </div>

      {/* Snippets */}
      <div className="sidebar-item sidebar-item-panel">
        <span className="sidebar-icon">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path d="M3 4h10M3 8h7M3 12h5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
          </svg>
        </span>
        <span className="sidebar-label">Snippets</span>
        <SnippetPanel onSend={onSnippetSend} onBroadcast={onSnippetBroadcast} onRequireUpgrade={onUpgrade} />
      </div>

      {/* Command History */}
      <div className="sidebar-item sidebar-item-panel">
        <span className="sidebar-icon">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.4"/>
            <polyline points="8,5 8,8 10,10" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
          </svg>
        </span>
        <span className="sidebar-label">History</span>
        <CommandHistoryPanel onRun={onCommandRun} />
      </div>

      {/* Team */}
      <div
        className="sidebar-item sidebar-item-panel sidebar-item-team"
        style={{ cursor: 'pointer', position: 'relative' }}
        onClick={onTeamsOpen}
        title={pendingInvitesCount > 0 ? `Team — ${pendingInvitesCount} pending invite${pendingInvitesCount === 1 ? '' : 's'}` : 'Team'}
      >
        <span className="sidebar-icon" style={{ position: 'relative' }}>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <circle cx="6" cy="5" r="2" stroke="currentColor" strokeWidth="1.3"/>
            <path d="M2 13c0-2.21 1.79-4 4-4s4 1.79 4 4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
            <circle cx="11.5" cy="5.5" r="1.5" stroke="currentColor" strokeWidth="1.2" opacity="0.7"/>
            <path d="M13.5 12.5c0-1.38-.9-2.55-2.14-2.87" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" opacity="0.7"/>
          </svg>
          {pendingInvitesCount > 0 && (
            <span
              aria-label={`${pendingInvitesCount} pending invites`}
              style={{
                position: 'absolute',
                top: -4,
                right: -6,
                minWidth: 14,
                height: 14,
                padding: '0 3px',
                borderRadius: 7,
                background: '#EF4444',
                color: '#fff',
                fontSize: 9,
                fontWeight: 700,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                lineHeight: 1,
                boxShadow: '0 0 0 1.5px var(--bg-primary, #0a0a0a)',
              }}
            >
              {pendingInvitesCount > 9 ? '9+' : pendingInvitesCount}
            </span>
          )}
        </span>
        <span className="sidebar-label">Team</span>
      </div>

      {/* My Repos */}
      <div
        className="sidebar-item sidebar-item-panel sidebar-item-team"
        style={{ cursor: 'pointer' }}
        onClick={plan === 'pro' || plan === 'team' ? onMyReposOpen : onUpgrade}
        title="My Repos"
      >
        <span className="sidebar-icon">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <circle cx="4" cy="4" r="1.5" stroke="currentColor" strokeWidth="1.3"/>
            <circle cx="12" cy="4" r="1.5" stroke="currentColor" strokeWidth="1.3"/>
            <circle cx="4" cy="12" r="1.5" stroke="currentColor" strokeWidth="1.3"/>
            <path d="M4 5.5v5M5.5 4h5M4 5.5c2 0 4 1 4 3.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
          </svg>
        </span>
        <span className="sidebar-label">My Repos</span>
        {expanded && plan === 'free' && <span className="sidebar-plan-badge">Pro</span>}
      </div>

      {/* Repo */}
      <div
        className="sidebar-item sidebar-repo"
        title={repoPath ?? 'Link repo to this tab'}
        onClick={onRepoLink}
        style={{ cursor: 'pointer' }}
      >
        <span className="sidebar-icon">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <circle cx="4" cy="4" r="1.5" stroke="currentColor" strokeWidth="1.3"/>
            <circle cx="12" cy="4" r="1.5" stroke="currentColor" strokeWidth="1.3"/>
            <circle cx="4" cy="12" r="1.5" stroke="currentColor" strokeWidth="1.3"/>
            <path d="M4 5.5v5M4 5.5C4 7 5 8 8 8s4 1 4 2.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
          </svg>
        </span>
        {repoPath ? (
          <div className="sidebar-repo-info">
            <div className="sidebar-repo-row">
              <span className="sidebar-label sidebar-repo-name">{basename(repoPath)}</span>
              {expanded && githubUrl && (
                <button
                  className="sidebar-github-btn"
                  title="Open on GitHub"
                  onClick={e => { e.stopPropagation(); window.electronShell.openExternal(githubUrl!) }}
                >
                  <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
                    <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/>
                  </svg>
                </button>
              )}
              {expanded && (
                <button className="sidebar-repo-unlink" onClick={e => { e.stopPropagation(); onRepoUnlink() }} title="Unlink repo">×</button>
              )}
            </div>
            {branch && (
              <span className={`sidebar-branch-badge${isDirty ? ' dirty' : ''}`}>
                {branch}{isDirty ? ' ●' : ''}
              </span>
            )}
          </div>
        ) : (
          <button className="sidebar-label sidebar-repo-link">Link repo</button>
        )}
      </div>

      {/* Actions bar — sección D: último run del repo activo */}
      {expanded && repoPath && repoCi && (
        <div style={{ padding: '0 8px 4px' }}>
          <RepoActionsBar
            repoFullName={repoCi.repoFullName}
            provider={repoCi.provider}
            token={repoCi.token}
            branch={branch ?? undefined}
          />
        </div>
      )}

      {/* Layout */}
      <div className="sidebar-item sidebar-item-panel">
        <span className="sidebar-icon">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <rect x="2" y="2" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.3"/>
            <rect x="9" y="2" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.3"/>
            <rect x="2" y="9" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.3"/>
            <rect x="9" y="9" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.3"/>
          </svg>
        </span>
        <span className="sidebar-label">Layout</span>
        <LayoutPicker current={layout} onChange={onLayoutChange} />
      </div>

      {/* New Terminal */}
      <button
        className="sidebar-item"
        onClick={onNewPane}
        title={`New terminal (${isWin ? 'Ctrl+T' : '⌘T'})`}
      >
        <span className="sidebar-icon">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
          </svg>
        </span>
        <span className="sidebar-label">New Terminal</span>
      </button>

      <div style={{ flex: 1 }} />

      {/* User menu — hidden while loading to avoid flash */}
      {!profileLoading && (
        <UserMenu
          plan={plan ?? null}
          isTrialActive={!!isTrialActive}
          trialDaysLeft={trialDaysLeft ?? 0}
          onUpgrade={onUpgrade ?? (() => {})}
          expanded={expanded}
        />
      )}

      {/* Settings — always at the bottom */}
      <div className="sidebar-item sidebar-item-settings">
        <span className="sidebar-icon">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
            <path d="M19.43 12.98c.04-.32.07-.64.07-.98s-.03-.66-.07-.98l2.11-1.65a.5.5 0 0 0 .12-.64l-2-3.46a.5.5 0 0 0-.61-.22l-2.49 1a7.3 7.3 0 0 0-1.69-.98l-.38-2.65A.5.5 0 0 0 14 2h-4a.5.5 0 0 0-.49.42l-.38 2.65c-.61.25-1.17.58-1.69.98l-2.49-1a.5.5 0 0 0-.61.22l-2 3.46a.5.5 0 0 0 .12.64L4.57 11c-.04.32-.07.65-.07.99s.03.66.07.98l-2.11 1.65a.5.5 0 0 0-.12.64l2 3.46a.5.5 0 0 0 .61.22l2.49-1c.52.4 1.08.73 1.69.98l.38 2.65a.5.5 0 0 0 .49.43h4a.5.5 0 0 0 .49-.42l.38-2.65c.61-.25 1.17-.58 1.69-.98l2.49 1a.5.5 0 0 0 .61-.22l2-3.46a.5.5 0 0 0-.12-.64l-2.11-1.65zM12 15.5A3.5 3.5 0 1 1 12 8.5a3.5 3.5 0 0 1 0 7z" fill="currentColor"/>
          </svg>
        </span>
        <span className="sidebar-label">Settings</span>
        <SettingsPanel
          updateState={updateState}
          onCheckUpdates={handleCheckUpdates}
          userEmail={userEmail}
        />
      </div>

    </div>
  )
}
