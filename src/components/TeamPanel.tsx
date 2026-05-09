import { useState, useEffect, useRef } from 'react'
import { useTeam } from '../hooks/useTeam'
import { useSharedSnippets } from '../hooks/useSharedSnippets'
import { useSharedWorkspaces } from '../hooks/useSharedWorkspaces'
import { useSharedMcpConfigs } from '../hooks/useSharedMcpConfigs'
import { useProfile } from '../hooks/useProfile'
import { Workspace } from '../types'
import { safeWriteText } from '../lib/clipboard'

interface Props {
  onRequireUpgrade?: () => void
  onLoad?: (ws: Workspace) => void
}

type Tab = 'members' | 'snippets' | 'workspaces' | 'mcp'

export default function TeamPanel({ onRequireUpgrade, onLoad }: Props) {
  const [open, setOpen] = useState(false)
  const [tab, setTab] = useState<Tab>('members')
  const [showSwitcher, setShowSwitcher] = useState(false)
  const [creatingTeam, setCreatingTeam] = useState(false)
  const [newTeamName, setNewTeamName] = useState('')
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteError, setInviteError] = useState<string | null>(null)
  const [inviting, setInviting] = useState(false)
  const switcherRef = useRef<HTMLDivElement>(null)

  const { plan } = useProfile()
  const {
    teams, activeTeam, members, pendingInvite, loading, userId,
    switchTeam, createTeam, inviteMember, removeMember,
    acceptInvite, rejectInvite, leaveTeam, deleteTeam, refresh,
  } = useTeam()

  const { items: teamSnippets, loading: snippetsLoading, userId: sUserId, refresh: refreshSnippets, remove: removeSnippet } = useSharedSnippets(activeTeam?.id)
  const { items: teamWorkspaces, loading: wsLoading, userId: wsUserId, refresh: refreshWorkspaces, remove: removeWorkspace } = useSharedWorkspaces(activeTeam?.id)
  const { items: teamMcpConfigs, loading: mcpLoading, userId: mcpUserId, refresh: refreshMcp, remove: removeMcpConfig } = useSharedMcpConfigs(activeTeam?.id)

  useEffect(() => {
    if (open) refresh()
  }, [open, refresh])

  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [open])

  // Close switcher on outside click
  useEffect(() => {
    if (!showSwitcher) return
    const handler = (e: MouseEvent) => {
      if (switcherRef.current && !switcherRef.current.contains(e.target as Node)) {
        setShowSwitcher(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [showSwitcher])

  const handleCreateTeam = async () => {
    if (!newTeamName.trim()) return
    const ok = await createTeam(newTeamName.trim())
    if (ok) { setNewTeamName(''); setCreatingTeam(false) }
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

  const switchTab = (t: Tab) => {
    setTab(t)
    setCreatingTeam(false)
    if (t === 'snippets') refreshSnippets()
    if (t === 'workspaces') refreshWorkspaces()
    if (t === 'mcp') refreshMcp()
  }

  const NAV_ITEMS: { id: Tab; label: string; icon: React.ReactNode }[] = [
    {
      id: 'members',
      label: 'Members',
      icon: (
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
          <circle cx="6" cy="5" r="2" stroke="currentColor" strokeWidth="1.3"/>
          <path d="M2 13c0-2.21 1.79-4 4-4s4 1.79 4 4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
          <circle cx="11.5" cy="5.5" r="1.5" stroke="currentColor" strokeWidth="1.2" opacity="0.7"/>
          <path d="M13.5 12.5c0-1.38-.9-2.55-2.14-2.87" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" opacity="0.7"/>
        </svg>
      ),
    },
    {
      id: 'snippets',
      label: 'Snippets',
      icon: (
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
          <path d="M3 4h10M3 8h7M3 12h5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
        </svg>
      ),
    },
    {
      id: 'workspaces',
      label: 'Workspaces',
      icon: (
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
          <rect x="1" y="2" width="14" height="10" rx="1.5" stroke="currentColor" strokeWidth="1.3"/>
          <path d="M5 12v2M11 12v2M3 14h10" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
        </svg>
      ),
    },
    {
      id: 'mcp',
      label: 'MCP Servers',
      icon: (
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
          <rect x="1" y="2" width="8" height="10" rx="1.2" stroke="currentColor" strokeWidth="1.3"/>
          <path d="M4 5h2M4 7.5h3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
          <circle cx="11" cy="5" r="2" stroke="currentColor" strokeWidth="1.3"/>
          <path d="M11 7v4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
        </svg>
      ),
    },
  ]

  return (
    <>
      <button
        className="titlebar-btn"
        onClick={() => {
          if (plan !== 'team') { onRequireUpgrade?.(); return }
          setOpen(v => !v)
        }}
        title="Team"
      />

      {open && (
        <>
          <div className="team-modal-overlay" onClick={() => setOpen(false)} />

          <div className="team-modal">

            {/* Header */}
            <div className="team-modal-header">
              <div className="team-modal-header-left">
                <svg width="15" height="15" viewBox="0 0 16 16" fill="none">
                  <circle cx="6" cy="5" r="2" stroke="currentColor" strokeWidth="1.3"/>
                  <path d="M2 13c0-2.21 1.79-4 4-4s4 1.79 4 4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
                  <circle cx="11.5" cy="5.5" r="1.5" stroke="currentColor" strokeWidth="1.2" opacity="0.7"/>
                  <path d="M13.5 12.5c0-1.38-.9-2.55-2.14-2.87" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" opacity="0.7"/>
                </svg>
                <span className="team-modal-title">Team</span>

                {/* Team switcher */}
                {activeTeam && (
                  <div className="team-switcher" ref={switcherRef}>
                    <button
                      className="team-switcher-btn"
                      onClick={() => setShowSwitcher(v => !v)}
                    >
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
                            <span className="team-switcher-check">
                              {t.id === activeTeam.id ? '✓' : ''}
                            </span>
                            {t.name}
                          </button>
                        ))}
                        <div className="team-switcher-sep" />
                        <button
                          className="team-switcher-new"
                          onClick={() => { setShowSwitcher(false); setCreatingTeam(true) }}
                        >
                          + New team
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
              <button className="team-modal-close" onClick={() => setOpen(false)}>×</button>
            </div>

            {/* Body */}
            <div className="team-modal-body">

              {/* LOADING */}
              {loading && (
                <div className="team-modal-center">
                  <p className="snippet-empty">Loading…</p>
                </div>
              )}

              {/* PENDING INVITE */}
              {!loading && teams.length === 0 && pendingInvite && (
                <div className="team-modal-center">
                  <div className="team-invite-card">
                    <p style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 4 }}>You've been invited to join</p>
                    <p style={{ fontSize: 18, fontWeight: 600, marginBottom: 20 }}>{pendingInvite.team.name}</p>
                    <div className="snippet-form-actions">
                      <button className="snippet-save-btn" onClick={acceptInvite}>Accept</button>
                      <button className="snippet-cancel-btn" onClick={rejectInvite}>Decline</button>
                    </div>
                  </div>
                </div>
              )}

              {/* CREATE FIRST TEAM */}
              {!loading && teams.length === 0 && !pendingInvite && (
                <div className="team-modal-center">
                  <div className="team-invite-card">
                    <p style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>Create your team</p>
                    <p style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 16 }}>
                      Share snippets, workspaces and MCP configs privately with your team.
                    </p>
                    <input
                      className="snippet-input"
                      placeholder="Team name…"
                      value={newTeamName}
                      onChange={e => setNewTeamName(e.target.value)}
                      autoFocus
                      onKeyDown={e => { if (e.key === 'Enter') handleCreateTeam() }}
                    />
                    <div className="snippet-form-actions" style={{ marginTop: 10 }}>
                      <button className="snippet-save-btn" onClick={handleCreateTeam} disabled={!newTeamName.trim()}>
                        Create Team
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* TEAM CONTENT */}
              {!loading && activeTeam && (
                <>
                  {/* Left nav */}
                  <nav className="team-modal-nav">
                    {NAV_ITEMS.map(item => (
                      <button
                        key={item.id}
                        className={`team-nav-btn${!creatingTeam && tab === item.id ? ' active' : ''}`}
                        onClick={() => switchTab(item.id)}
                      >
                        <span className="team-nav-icon">{item.icon}</span>
                        {item.label}
                      </button>
                    ))}

                    <div className="team-nav-spacer" />

                    {userId === activeTeam.owner_id ? (
                      <button
                        className="team-nav-danger"
                        onClick={async () => {
                          if (window.confirm('Delete team? Content will move to Community.')) await deleteTeam()
                        }}
                      >
                        Delete team
                      </button>
                    ) : (
                      <button className="team-nav-danger" onClick={leaveTeam}>
                        Leave team
                      </button>
                    )}
                  </nav>

                  {/* Content area */}
                  <div className="team-modal-content">

                    {/* CREATE NEW TEAM (while already in a team) */}
                    {creatingTeam && (
                      <div className="team-tab-pane" style={{ display: 'flex', alignItems: 'flex-start', gap: 0, flexDirection: 'column' }}>
                        <button
                          style={{ background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: 11, cursor: 'pointer', marginBottom: 16, padding: 0 }}
                          onClick={() => setCreatingTeam(false)}
                        >← Back</button>
                        <p style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>Create new team</p>
                        <p style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 14 }}>
                          You can belong to multiple teams and switch between them.
                        </p>
                        <input
                          className="snippet-input"
                          style={{ width: '100%' }}
                          placeholder="Team name…"
                          value={newTeamName}
                          onChange={e => setNewTeamName(e.target.value)}
                          autoFocus
                          onKeyDown={e => { if (e.key === 'Enter') handleCreateTeam() }}
                        />
                        <div className="snippet-form-actions" style={{ marginTop: 10 }}>
                          <button className="snippet-save-btn" onClick={handleCreateTeam} disabled={!newTeamName.trim()}>
                            Create Team
                          </button>
                          <button className="snippet-cancel-btn" onClick={() => { setCreatingTeam(false); setNewTeamName('') }}>
                            Cancel
                          </button>
                        </div>
                      </div>
                    )}

                    {/* MEMBERS */}
                    {!creatingTeam && tab === 'members' && (
                      <div className="team-tab-pane">
                        {/* Pending invite banner (when already in a team) */}
                        {pendingInvite && (
                          <div className="team-pending-banner">
                            <span>Invited to <strong>{pendingInvite.team.name}</strong></span>
                            <div style={{ display: 'flex', gap: 6 }}>
                              <button className="snippet-save-btn" style={{ fontSize: 11, padding: '3px 8px' }} onClick={acceptInvite}>Accept</button>
                              <button className="snippet-cancel-btn" style={{ fontSize: 11, padding: '3px 8px' }} onClick={rejectInvite}>Decline</button>
                            </div>
                          </div>
                        )}

                        {userId === activeTeam.owner_id && (
                          <div className="team-invite-row">
                            <input
                              className="snippet-input"
                              style={{ flex: 1 }}
                              placeholder="Invite by email…"
                              type="email"
                              value={inviteEmail}
                              onChange={e => setInviteEmail(e.target.value)}
                              onKeyDown={e => { if (e.key === 'Enter') handleInvite() }}
                            />
                            <button className="snippet-save-btn" onClick={handleInvite} disabled={inviting || !inviteEmail.trim()}>
                              {inviting ? '…' : 'Invite'}
                            </button>
                          </div>
                        )}
                        {inviteError && <p style={{ color: '#EF4444', fontSize: 11, marginBottom: 8 }}>{inviteError}</p>}

                        {members.length === 0 ? (
                          <p className="snippet-empty">No members yet.</p>
                        ) : (
                          <div className="team-member-list">
                            {members.map(m => (
                              <div key={m.id} className="team-member-row">
                                <div className="team-member-avatar">
                                  {m.email.charAt(0).toUpperCase()}
                                </div>
                                <div style={{ flex: 1, minWidth: 0 }}>
                                  <div className="team-member-email">{m.email}</div>
                                  <div className={`team-member-status${m.status === 'pending' ? ' pending' : ''}`}>
                                    {m.status === 'pending' ? 'Pending invite' : m.role}
                                  </div>
                                </div>
                                <div className="snippet-item-actions">
                                  {userId === activeTeam.owner_id && m.user_id !== userId && (
                                    <button className="snippet-delete-btn" onClick={() => removeMember(m.id)} title="Remove">×</button>
                                  )}
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}

                    {/* SNIPPETS */}
                    {!creatingTeam && tab === 'snippets' && (
                      <div className="team-tab-pane">
                        {snippetsLoading && <p className="snippet-empty">Loading…</p>}
                        {!snippetsLoading && teamSnippets.length === 0 && (
                          <p className="snippet-empty">No snippets yet. Share from the Snippets panel using ↗.</p>
                        )}
                        <div className="snippet-list">
                          {teamSnippets.map(s => (
                            <div key={s.id} className="snippet-item">
                              <span className="snippet-name">{s.name}</span>
                              <div className="snippet-item-actions">
                                {s.owner_id === sUserId && (
                                  <button className="snippet-delete-btn" onClick={() => removeSnippet(s.id)} title="Remove">×</button>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* WORKSPACES */}
                    {!creatingTeam && tab === 'workspaces' && (
                      <div className="team-tab-pane">
                        {wsLoading && <p className="snippet-empty">Loading…</p>}
                        {!wsLoading && teamWorkspaces.length === 0 && (
                          <p className="snippet-empty">No workspaces yet. Share from the Workspaces panel using ↗.</p>
                        )}
                        <div className="snippet-list">
                          {teamWorkspaces.map(ws => (
                            <div key={ws.id} className="snippet-item">
                              <span className="snippet-name">{ws.name}</span>
                              <div className="snippet-item-actions">
                                <button className="snippet-send-btn" onClick={() => { onLoad?.(ws.data); setOpen(false) }}>Load</button>
                                {ws.owner_id === wsUserId && (
                                  <button className="snippet-delete-btn" onClick={() => removeWorkspace(ws.id)} title="Remove">×</button>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* MCP */}
                    {!creatingTeam && tab === 'mcp' && (
                      <div className="team-tab-pane">
                        {mcpLoading && <p className="snippet-empty">Loading…</p>}
                        {!mcpLoading && teamMcpConfigs.length === 0 && (
                          <p className="snippet-empty">No MCP configs yet. Share from the MCP panel using ↗.</p>
                        )}
                        <div className="snippet-list">
                          {teamMcpConfigs.map(mc => (
                            <div key={mc.id} className="snippet-item">
                              <div style={{ flex: 1, minWidth: 0 }}>
                                <span className="snippet-name" style={{ display: 'block' }}>{mc.name}</span>
                                <span style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'monospace' }}>
                                  {typeof mc.config.command === 'string' ? mc.config.command : ''}
                                </span>
                              </div>
                              <div className="snippet-item-actions">
                                <button
                                  className="snippet-send-btn"
                                  onClick={() => { void safeWriteText(JSON.stringify(mc.config, null, 2)) }}
                                >Copy</button>
                                {mc.owner_id === mcpUserId && (
                                  <button className="snippet-delete-btn" onClick={() => removeMcpConfig(mc.id)} title="Remove">×</button>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                  </div>
                </>
              )}

            </div>
          </div>
        </>
      )}
    </>
  )
}
