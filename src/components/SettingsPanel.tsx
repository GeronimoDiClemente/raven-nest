import React, { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { supabase } from '../lib/supabase'
import { useSettings } from '../hooks/useSettings'
import { useGitHub } from '../hooks/useGitHub'
import { useGitlab } from '../hooks/useGitlab'
import { useMemory } from '../hooks/useMemory'
import { useProfile } from '../hooks/useProfile'
import { PLAN_LIMITS } from '../lib/stripe'
import { formatBinding, eventToBinding, Keybindings } from '../lib/keybindings'
import { PresetEditor } from './PresetEditor'
import { BenchmarkDashboard } from './BenchmarkDashboard'
import UpgradeModal from './UpgradeModal'

type Tab = 'keybinds' | 'presets' | 'benchmarks' | 'updates' | 'account' | 'tutorial'

interface KeybindRowProps {
  label: string
  action: keyof Keybindings
  binding: string
  onUpdate: (action: keyof Keybindings, key: string) => void
}

const isModifierKey = (k: string) =>
  k === 'Control' || k === 'Shift' || k === 'Alt' || k === 'Meta' || k === 'OS'

const collectMods = (e: React.KeyboardEvent | KeyboardEvent): string[] => {
  const mods: string[] = []
  if (e.ctrlKey) mods.push('Ctrl')
  if (e.metaKey) mods.push('Meta')
  if (e.altKey) mods.push('Alt')
  if (e.shiftKey) mods.push('Shift')
  return mods
}

function KeybindRow({ label, action, binding, onUpdate }: KeybindRowProps) {
  const [recording, setRecording] = useState(false)
  const [activeMods, setActiveMods] = useState<string[]>([])

  const stopRecording = () => { setRecording(false); setActiveMods([]) }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!recording) return
    e.preventDefault()
    e.stopPropagation()
    if (e.key === 'Escape') { stopRecording(); return }
    if (isModifierKey(e.key)) { setActiveMods(collectMods(e)); return }
    const newBinding = eventToBinding(e.nativeEvent)
    onUpdate(action, newBinding)
    stopRecording()
  }

  const handleKeyUp = (e: React.KeyboardEvent) => {
    if (!recording) return
    if (isModifierKey(e.key)) setActiveMods(collectMods(e))
  }

  const displayValue = recording
    ? (activeMods.length > 0 ? `${activeMods.join(' + ')} + …` : 'Press key…')
    : formatBinding(binding)

  return (
    <div
      className={`sp-keybind-row${recording ? ' recording' : ''}`}
      onClick={() => setRecording(true)}
      onKeyDown={handleKeyDown}
      onKeyUp={handleKeyUp}
      onBlur={stopRecording}
      tabIndex={0}
    >
      <span className="sp-keybind-label">{label}</span>
      <kbd className={`sp-kbd${recording ? ' recording' : ''}`}>
        {displayValue}
      </kbd>
    </div>
  )
}

interface Props {
  updateState: 'idle' | 'checking' | 'up-to-date' | 'update-found' | 'error'
  onCheckUpdates: () => void
  userEmail: string
  activeRepoPath?: string
  onOpenTutorial?: (tourId: import('../tutorial/types').TourId) => void
}

export default function SettingsPanel({ updateState, onCheckUpdates, userEmail, activeRepoPath, onOpenTutorial }: Props) {
  const [open, setOpen] = useState(false)
  const [tab, setTab] = useState<Tab>('keybinds')
  const { settings, updateKeybinding, updateVoiceLanguage } = useSettings()
  const { isConnected: githubConnected, githubLogin, connectGitHub, disconnectGitHub } = useGitHub()
  const { isConnected: gitlabConnected, gitlabLogin, connectGitlab, disconnectGitlab } = useGitlab()
  const memory = useMemory()
  const { plan } = useProfile()
  const [memoryUpgradeOpen, setMemoryUpgradeOpen] = useState(false)
  // M10 / §6.6 "Right to delete": disconnect never touches local data regardless of
  // this — it only controls whether main also calls memory-sync's delete-cloud-data
  // action (see electron/main.ts's memory:disconnect handler) before clearing the
  // local connection state.
  const [deleteCloudOnDisconnect, setDeleteCloudOnDisconnect] = useState(false)
  const kb = settings.keybindings

  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [open])

  const keybindRows: Array<{ label: string; action: keyof Keybindings }> = [
    { label: 'Voice input', action: 'voiceInput' },
    { label: 'New pane', action: 'newPane' },
    { label: 'Global search', action: 'globalSearch' },
    { label: 'Command palette', action: 'commandPalette' },
    { label: 'Next pane', action: 'nextPane' },
    { label: 'Previous pane', action: 'prevPane' },
    { label: 'Next tab', action: 'nextTab' },
    { label: 'Previous tab', action: 'prevTab' },
    { label: 'Zoom cell', action: 'toggleZoom' },
    { label: 'Font size +', action: 'fontSizeUp' },
    { label: 'Font size −', action: 'fontSizeDown' },
    { label: 'Font size reset', action: 'fontSizeReset' },
  ]

  const updateLabel = updateState === 'checking' ? 'Checking…'
    : updateState === 'up-to-date' ? '✓ Up to date'
    : updateState === 'update-found' ? 'Downloading…'
    : updateState === 'error' ? 'Error checking'
    : 'Check for updates'

  return (
    <>
      <button className="titlebar-btn" onClick={() => setOpen(v => !v)} title="Settings" />

      {open && createPortal(
        <>
          <div className="team-modal-overlay" onClick={() => setOpen(false)} />

          <div className="sp-modal">
            {/* Header */}
            <div className="sp-header">
              <div className="sp-header-left">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" style={{ opacity: 0.7 }}>
                  <path d="M19.43 12.98c.04-.32.07-.64.07-.98s-.03-.66-.07-.98l2.11-1.65a.5.5 0 0 0 .12-.64l-2-3.46a.5.5 0 0 0-.61-.22l-2.49 1a7.3 7.3 0 0 0-1.69-.98l-.38-2.65A.5.5 0 0 0 14 2h-4a.5.5 0 0 0-.49.42l-.38 2.65c-.61.25-1.17.58-1.69.98l-2.49-1a.5.5 0 0 0-.61.22l-2 3.46a.5.5 0 0 0 .12.64L4.57 11c-.04.32-.07.65-.07.99s.03.66.07.98l-2.11 1.65a.5.5 0 0 0-.12.64l2 3.46a.5.5 0 0 0 .61.22l2.49-1c.52.4 1.08.73 1.69.98l.38 2.65a.5.5 0 0 0 .49.43h4a.5.5 0 0 0 .49-.42l.38-2.65c.61-.25 1.17-.58 1.69-.98l2.49 1a.5.5 0 0 0 .61-.22l2-3.46a.5.5 0 0 0-.12-.64l-2.11-1.65zM12 15.5A3.5 3.5 0 1 1 12 8.5a3.5 3.5 0 0 1 0 7z" fill="currentColor"/>
                </svg>
                <span className="sp-title">Settings</span>
              </div>
              <button className="sp-close" onClick={() => setOpen(false)}>×</button>
            </div>

            {/* Tabs */}
            <div className="sp-tabs">
              {(['keybinds', 'presets', 'benchmarks', 'updates', 'account', 'tutorial'] as Tab[]).map(t => (
                <button
                  key={t}
                  className={`sp-tab${tab === t ? ' active' : ''}`}
                  onClick={() => setTab(t)}
                >
                  {t.charAt(0).toUpperCase() + t.slice(1)}
                </button>
              ))}
            </div>

            {/* Body */}
            <div className="sp-body">

              {tab === 'keybinds' && (
                <div className="sp-section">
                  <div className="sp-row">
                    <span className="sp-row-label">Voice language</span>
                    <select
                      className="sp-select"
                      value={settings.voiceLanguage ?? 'es'}
                      onChange={e => updateVoiceLanguage(e.target.value)}
                    >
                      <option value="es">Español</option>
                      <option value="en">English</option>
                      <option value="pt">Português</option>
                      <option value="fr">Français</option>
                      <option value="de">Deutsch</option>
                      <option value="it">Italiano</option>
                      <option value="zh">中文</option>
                      <option value="ja">日本語</option>
                    </select>
                  </div>
                  <div className="sp-divider" />
                  {keybindRows.map(row => (
                    <KeybindRow
                      key={row.action}
                      label={row.label}
                      action={row.action}
                      binding={kb[row.action]}
                      onUpdate={updateKeybinding}
                    />
                  ))}
                </div>
              )}

              {tab === 'presets' && (
                <div className="sp-section">
                  <PresetEditor repoPath={activeRepoPath ?? null} />
                </div>
              )}

              {tab === 'benchmarks' && (
                <div className="sp-section">
                  <BenchmarkDashboard />
                </div>
              )}

              {tab === 'updates' && (
                <div className="sp-section">
                  <button
                    className="sp-action-btn"
                    onClick={onCheckUpdates}
                    disabled={updateState === 'checking' || updateState === 'update-found'}
                  >
                    {updateLabel}
                  </button>
                </div>
              )}

              {tab === 'account' && (
                <div className="sp-section">
                  <p className="sp-email">{userEmail || '—'}</p>

                  <div className="sp-card">
                    <div className="sp-card-row">
                      <div className="sp-card-left">
                        <svg width="15" height="15" viewBox="0 0 16 16" fill="currentColor" style={{ opacity: 0.6 }}>
                          <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/>
                        </svg>
                        <span className="sp-card-label">GitHub</span>
                        {githubConnected && githubLogin && (
                          <span className="sp-avatar-inline">
                            <img src={`https://github.com/${githubLogin}.png?size=48`} alt="" loading="lazy" />
                          </span>
                        )}
                      </div>
                      {githubConnected ? (
                        <button className="sp-btn-danger" onClick={disconnectGitHub}>Disconnect</button>
                      ) : (
                        <button className="sp-btn-purple" onClick={connectGitHub}>Connect</button>
                      )}
                    </div>
                  </div>

                  <div className="sp-card">
                    <div className="sp-card-row">
                      <div className="sp-card-left">
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="#FC6D26" style={{ opacity: 0.85 }}>
                          <path d="M23.6 9.6L20.3.3a.8.8 0 00-1.5 0l-3 9.4H8.2L5.2.3a.8.8 0 00-1.5 0L.4 9.6c-.3 1 .1 2 .9 2.6L12 22l10.7-9.8c.8-.6 1.2-1.6.9-2.6z"/>
                        </svg>
                        <span className="sp-card-label">GitLab</span>
                        {gitlabLogin && (
                          <span className="sp-avatar-inline" title={`@${gitlabLogin}`}>
                            <img src={`https://gitlab.com/${gitlabLogin}.png?width=48`} alt="" loading="lazy" />
                          </span>
                        )}
                        {gitlabLogin && !gitlabConnected && (
                          <span style={{ fontSize: 10, color: '#f59e0b', marginLeft: 6 }}>
                            sign-in only — connect for repo access
                          </span>
                        )}
                      </div>
                      {gitlabConnected ? (
                        <button className="sp-btn-danger" onClick={disconnectGitlab}>Disconnect</button>
                      ) : (
                        <button className="sp-btn-purple" onClick={connectGitlab}>Connect</button>
                      )}
                    </div>
                  </div>

                  <div className="sp-card">
                    <div className="sp-card-row">
                      <div className="sp-card-left">
                        <span aria-hidden="true">🧠</span>
                        <span className="sp-card-label">Nest Memory</span>
                        {memory.state === 'connected' && (
                          <span style={{ fontSize: 11, opacity: 0.65, marginLeft: 6 }}>
                            {memory.itemCount} items{memory.pendingCount > 0 ? ` · ${memory.pendingCount} pending` : ' · synced'}
                          </span>
                        )}
                        {memory.state === 'paused' && (
                          <span style={{ fontSize: 11, color: '#f59e0b', marginLeft: 6 }}>
                            Offline — {memory.pendingCount} change{memory.pendingCount === 1 ? '' : 's'} will sync when you're back
                          </span>
                        )}
                        {memory.state === 'error' && (
                          <span style={{ fontSize: 11, color: '#ef4444', marginLeft: 6 }}>
                            Couldn't sync{memory.error ? ` — ${memory.error}` : ''}
                          </span>
                        )}
                        {memory.state === 'disconnected' && !PLAN_LIMITS[plan].memoryCloud && (
                          <span style={{ fontSize: 11, opacity: 0.65, marginLeft: 6 }}>
                            Local memory active — cloud sync is a Pro feature
                          </span>
                        )}
                        {(memory.state === 'connecting' || memory.state === 'migrating') && (
                          <span style={{ fontSize: 11, opacity: 0.65, marginLeft: 6 }}>
                            {memory.state === 'connecting' ? 'Connecting…' : 'Importing your memory…'}
                          </span>
                        )}
                      </div>
                      {memory.state === 'connected' || memory.state === 'paused' ? (
                        <button className="sp-btn-danger" onClick={() => memory.disconnect(deleteCloudOnDisconnect)}>Disconnect</button>
                      ) : memory.state === 'error' ? (
                        <button className="sp-btn-purple" onClick={() => memory.connect()}>Retry</button>
                      ) : memory.state === 'connecting' || memory.state === 'migrating' ? (
                        <button className="sp-btn-purple" disabled>…</button>
                      ) : PLAN_LIMITS[plan].memoryCloud ? (
                        <button className="sp-btn-purple" onClick={() => memory.connect()}>Connect</button>
                      ) : (
                        <button className="sp-btn-purple" onClick={() => setMemoryUpgradeOpen(true)}>Upgrade</button>
                      )}
                    </div>
                    {(memory.state === 'connected' || memory.state === 'paused') && (
                      <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, opacity: 0.75, marginTop: 6 }}>
                        <input
                          type="checkbox"
                          checked={deleteCloudOnDisconnect}
                          onChange={(e) => setDeleteCloudOnDisconnect(e.target.checked)}
                        />
                        Also delete my cloud memory (your local memory is never affected)
                      </label>
                    )}
                  </div>

                  <button className="sp-action-btn" onClick={() => supabase.auth.signOut()}>
                    Sign out
                  </button>
                </div>
              )}

              {tab === 'tutorial' && (
                <div className="sp-section">
                  <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '0 0 12px' }}>
                    Recorré las secciones de Nest con datos de demostración, sin tocar tus repos.
                  </p>
                  <button className="sp-action-btn" onClick={() => onOpenTutorial?.('worktrees')}>
                    Tutorial: Worktrees
                  </button>
                </div>
              )}

              {memoryUpgradeOpen && (
                <UpgradeModal currentPlan={plan} onClose={() => setMemoryUpgradeOpen(false)} />
              )}

            </div>
          </div>
        </>,
        document.body
      )}
    </>
  )
}
