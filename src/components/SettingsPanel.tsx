import React, { useState, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { supabase } from '../lib/supabase'
import { useSettings } from '../hooks/useSettings'
import { useGitHub } from '../hooks/useGitHub'
import { useGitlab } from '../hooks/useGitlab'
import { useMemory } from '../hooks/useMemory'
import { useProfile } from '../hooks/useProfile'
import { useUserRepos } from '../hooks/useUserRepos'
import { PLAN_LIMITS } from '../lib/stripe'
import type { UserPreferencesApi } from '../hooks/useUserPreferences'
import { formatBinding, eventToBinding, Keybindings } from '../lib/keybindings'
import type { EditorPreferences, EditorTheme } from '../lib/ide-config-mappings'
import { BUNDLED_THEMES } from '../lib/shiki-monaco'
import { matchThemeName } from '../lib/theme-registry'
import type { InstalledThemeInfo, ScannedThemeInfo, OpenVSXThemeResult } from '../types'
import { PresetEditor } from './PresetEditor'
import { BenchmarkDashboard } from './BenchmarkDashboard'
import UpgradeModal from './UpgradeModal'
import MemoryHub from './MemoryHub'
import MemoryAdoptionDialog from './MemoryAdoptionDialog'
import MemoryVaultCard from './MemoryVaultCard'
import logoUrl from '../assets/logo.png'

type Tab = 'keybinds' | 'presets' | 'benchmarks' | 'updates' | 'account' | 'tutorial' | 'editor'

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
  // Lifted from App.tsx (the single shared instance) — see UserPreferencesApi's
  // doc comment for why this must not be a local useUserPreferences() call.
  userPrefs: UserPreferencesApi
}

export default function SettingsPanel({ updateState, onCheckUpdates, userEmail, activeRepoPath, onOpenTutorial, userPrefs }: Props) {
  const [open, setOpen] = useState(false)
  const [tab, setTab] = useState<Tab>('keybinds')
  const { settings, updateKeybinding, updateVoiceLanguage } = useSettings()
  const { isConnected: githubConnected, githubLogin, connectGitHub, disconnectGitHub } = useGitHub()
  const { isConnected: gitlabConnected, gitlabLogin, connectGitlab, disconnectGitlab } = useGitlab()
  const memory = useMemory()
  const { repos: userRepos } = useUserRepos()
  const { plan } = useProfile()
  const [memoryUpgradeOpen, setMemoryUpgradeOpen] = useState(false)
  // Reopen from Settings (Task 7 Step 3): local UI state only — never touches the
  // persisted `hasSeenMemoryHub` flag, so reopening here doesn't affect whether the
  // hub auto-shows again on next launch.
  const [memoryHubOpen, setMemoryHubOpen] = useState(false)
  // M10 / §6.6 "Right to delete": disconnect never touches local data regardless of
  // this — it only controls whether main also calls memory-sync's delete-cloud-data
  // action (see electron/main.ts's memory:disconnect handler) before clearing the
  // local connection state.
  const [deleteCloudOnDisconnect, setDeleteCloudOnDisconnect] = useState(false)
  const [memoryToken, setMemoryToken] = useState('')
  // Once the token has done its job, drop it. main.ts persists it in the credential
  // store, so keeping the plaintext value in React state for the rest of the session
  // buys nothing and leaves it in every heap snapshot and devtools inspection of the
  // panel. Keyed on the card reaching 'connected' so it covers both the Connect and the
  // Retry button.
  useEffect(() => {
    if (memory.state === 'connected') setMemoryToken('')
  }, [memory.state])
  // Sync push progress for the card's progress bar. itemCount is the running local
  // total; pendingCount is the outstanding push queue and can exceed itemCount
  // mid-migration (it also counts update mutations, not just inserts), so clamp.
  // Bytes legibles. Un valor entero no lleva decimal ("1 GB"), uno fraccionario lleva uno
  // ("3.0 MB"): la cuota tope suele ser redondo y el usado nunca lo es.
  const formatBytes = (bytes: number): string => {
    const unidades = ['B', 'KB', 'MB', 'GB', 'TB']
    let v = bytes
    let i = 0
    while (v >= 1024 && i < unidades.length - 1) { v /= 1024; i++ }
    return `${Number.isInteger(v) ? v : v.toFixed(1)} ${unidades[i]}`
  }

  // §9.2: Connect y Retry pasan a pedirle el token al servicio con el JWT del login. El
  // token pegado a mano (C7) sigue ganando cuando está: es el camino del beta de una cuenta
  // y el escape para cuando el emisor está caído.
  const conectarMemoria = () => {
    const pegado = memoryToken.trim()
    return pegado ? memory.connectWithToken(pegado) : memory.connectWithLogin()
  }

  const memorySyncProgress = memory.itemCount > 0
    ? Math.min(1, Math.max(0, (memory.itemCount - memory.pendingCount) / memory.itemCount))
    : 0
  const [importPreview, setImportPreview] = useState<{ source: 'vscode' | 'intellij'; options: EditorPreferences; theme?: EditorTheme; unmappedTheme?: string } | null>(null)
  const [importError, setImportError] = useState<string | null>(null)
  const kb = settings.keybindings

  // --- Sistema de temas del editor ---------------------------------------
  const [installedThemes, setInstalledThemes] = useState<InstalledThemeInfo[]>([])
  const [scannedThemes, setScannedThemes] = useState<ScannedThemeInfo[] | null>(null)
  const [themeError, setThemeError] = useState<string | null>(null)
  const [vsxOpen, setVsxOpen] = useState(false)
  const [vsxQuery, setVsxQuery] = useState('')
  const [vsxResults, setVsxResults] = useState<OpenVSXThemeResult[] | null>(null)
  const [vsxError, setVsxError] = useState<string | null>(null)
  const [vsxBusy, setVsxBusy] = useState(false)

  const refreshInstalledThemes = useCallback(async () => {
    try {
      setInstalledThemes(await window.themes.listInstalled())
    } catch {
      // sin bridge (o falla IPC): el selector muestra solo built-in + bundled
    }
  }, [])

  useEffect(() => {
    if (open && tab === 'editor') void refreshInstalledThemes()
  }, [open, tab, refreshInstalledThemes])

  const handleScanVSCodeThemes = useCallback(async () => {
    setThemeError(null)
    setScannedThemes(null)
    const res = await window.themes.scanVSCode()
    if (!res.ok) { setThemeError(res.error); return }
    setScannedThemes(res.themes)
  }, [])

  const handleInstallScanned = useCallback(async (path: string) => {
    setThemeError(null)
    const res = await window.themes.importVSCode(path)
    if (!res.ok) { setThemeError(res.error); return }
    await refreshInstalledThemes()
  }, [refreshInstalledThemes])

  const handleLoadThemeFile = useCallback(async () => {
    setThemeError(null)
    const res = await window.themes.loadFromFile()
    if (res === null) return  // diálogo cancelado
    if (!res.ok) { setThemeError(res.error); return }
    await refreshInstalledThemes()
  }, [refreshInstalledThemes])

  const handleVsxSearch = useCallback(async () => {
    setVsxError(null)
    setVsxResults(null)
    setVsxBusy(true)
    try {
      const res = await window.themes.searchOpenVSX(vsxQuery)
      if (!res.ok) { setVsxError(res.error); return }
      setVsxResults(res.results)
    } finally {
      setVsxBusy(false)
    }
  }, [vsxQuery])

  const handleVsxInstall = useCallback(async (namespace: string, name: string) => {
    setVsxError(null)
    setVsxBusy(true)
    try {
      const res = await window.themes.installOpenVSX(namespace, name)
      if (!res.ok) { setVsxError(res.error); return }
      await refreshInstalledThemes()
    } finally {
      setVsxBusy(false)
    }
  }, [refreshInstalledThemes])

  const handleImportEditorConfig = useCallback(async (source: 'vscode' | 'intellij') => {
    setImportError(null)
    setImportPreview(null)
    const result = await window.ideConfig.import(source)
    if (!result.ok) {
      setImportError(result.error)
      return
    }
    setImportPreview({ source, options: result.options, theme: result.theme, unmappedTheme: result.unmappedTheme })
  }, [])

  const confirmImportEditorConfig = useCallback(() => {
    if (!importPreview) return
    // unmappedTheme (workbench.colorTheme que no era vs/vs-dark): si matchea
    // un tema bundled o instalado, se aplica directo — cierra el loop que el
    // import de config dejaba abierto.
    // Match EXACTO primero (bundled/instalados); el heurístico vs/vs-dark de
    // parseVSCodeSettings es solo el fallback — al revés degradaba temas que
    // SÍ existen ("One Dark Pro" terminaba en vs-dark genérico).
    const exact = importPreview.unmappedTheme
      ? matchThemeName(importPreview.unmappedTheme, [...BUNDLED_THEMES, ...installedThemes])
      : undefined
    const theme = exact ?? importPreview.theme
    userPrefs.setEditorOptions(importPreview.options, theme)
    setImportPreview(null)
  }, [importPreview, userPrefs, installedThemes])

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

      {/* Task 2 (adopción con aviso): no depende de `open` — el login que lo dispara puede
          pasar con el panel de Settings cerrado, y el usuario tiene que verlo igual. */}
      {memory.pendingAdoption && createPortal(
        <MemoryAdoptionDialog
          count={memory.pendingAdoption.count}
          projects={memory.pendingAdoption.projects}
          onAdopt={() => memory.resolveAdoption(true)}
          onDecline={() => memory.resolveAdoption(false)}
        />,
        document.body
      )}

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
              {(['keybinds', 'presets', 'benchmarks', 'updates', 'account', 'tutorial', 'editor'] as Tab[]).map(t => (
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
                        <img src={logoUrl} alt="" aria-hidden="true" width={15} height={15} style={{ display: 'block' }} />
                        <span className="sp-card-label">Nest Memory</span>
                        <button
                          onClick={() => setMemoryHubOpen(true)}
                          style={{ fontSize: 11, opacity: 0.65, marginLeft: 6, background: 'transparent', border: 'none', textDecoration: 'underline', cursor: 'pointer', padding: 0 }}
                        >
                          Learn more
                        </button>
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
                        {memory.state === 'plan_required' && (
                          <span style={{ fontSize: 11, color: '#f59e0b', marginLeft: 6 }}>
                            Your plan doesn't include cloud sync — upgrade to resume
                          </span>
                        )}
                        {memory.state === 'unavailable' && (
                          <span style={{ fontSize: 11, color: '#f59e0b', marginLeft: 6 }}>
                            Memory didn't start on this machine — restart Nest
                          </span>
                        )}
                        {memory.state === 'disconnected' && !PLAN_LIMITS[plan].memoryCloud && (
                          <span style={{ fontSize: 11, opacity: 0.65, marginLeft: 6 }}>
                            Local memory active — cloud sync is a Cloud feature
                          </span>
                        )}
                        {(memory.state === 'connecting' || memory.state === 'migrating') && (
                          <span style={{ fontSize: 11, opacity: 0.65, marginLeft: 6 }}>
                            {memory.state === 'connecting' ? 'Connecting…' : 'Importing your memory…'}
                          </span>
                        )}
                      </div>
                      {memory.state === 'unavailable' ? (
                        <button className="sp-btn-purple" disabled>Unavailable</button>
                      ) : memory.state === 'connected' || memory.state === 'paused' ? (
                        <button className="sp-btn-danger" onClick={() => memory.disconnect(deleteCloudOnDisconnect)}>Disconnect</button>
                      ) : memory.state === 'error' ? (
                        // §6.6/§7.5 "right to delete": `error` here means a connection that
                        // WAS established (refresh() only reaches it when status.connected is
                        // true) whose daemon is now failing — the stored token is still valid,
                        // so Disconnect (and an optional cloud delete via the checkbox below)
                        // still authenticates. Without it, a user stuck in a persistent error
                        // state had no way to get their cloud copy deleted except fixing the
                        // underlying failure first.
                        <div style={{ display: 'flex', gap: 8 }}>
                          <button className="sp-btn-purple" onClick={() => void conectarMemoria()}>Retry</button>
                          <button className="sp-btn-danger" onClick={() => memory.disconnect(deleteCloudOnDisconnect)}>Disconnect</button>
                        </div>
                      ) : memory.state === 'plan_required' ? (
                        // Same right-to-delete gap as `error`: the connection still exists —
                        // the token is valid and the device is registered, the server is just
                        // refusing pushes for plan reasons — so Disconnect is meaningful and
                        // the delete-cloud-data call will authenticate. A downgraded user is
                        // exactly someone who may want their data off the server, and the
                        // Upgrade-only button gave them no way to ask for that.
                        <div style={{ display: 'flex', gap: 8 }}>
                          {/* Reuses the same Upgrade affordance the free-plan disconnected
                              branch below already has — no second upgrade path invented. */}
                          <button className="sp-btn-purple" onClick={() => setMemoryUpgradeOpen(true)}>Upgrade</button>
                          <button className="sp-btn-danger" onClick={() => memory.disconnect(deleteCloudOnDisconnect)}>Disconnect</button>
                        </div>
                      ) : memory.state === 'connecting' || memory.state === 'migrating' ? (
                        <button className="sp-btn-purple" disabled>…</button>
                      ) : PLAN_LIMITS[plan].memoryCloud ? (
                        <button className="sp-btn-purple" onClick={() => void conectarMemoria()}>Connect</button>
                      ) : (
                        <button className="sp-btn-purple" onClick={() => setMemoryUpgradeOpen(true)}>Upgrade</button>
                      )}
                    </div>
                    {((memory.state === 'disconnected' && PLAN_LIMITS[plan].memoryCloud) || memory.state === 'error') && (
                      <input
                        type="password"
                        className="sp-select"
                        style={{ width: '100%', marginTop: 8, cursor: 'text' }}
                        placeholder="Paste a sync token (optional)"
                        aria-label="Memory sync token"
                        value={memoryToken}
                        onChange={(e) => setMemoryToken(e.target.value)}
                      />
                    )}
                    {memory.state === 'disconnected' && userRepos.length === 0 && (
                      <div className="sp-mem-no-repos-banner">
                        <span className="sp-mem-no-repos-banner-icon">⚠</span>
                        <span>
                          No repositories linked yet. Link your repos first so imported memory gets
                          organized per project — memory connected without repos goes to the global
                          space and won't be re-organized later.
                        </span>
                      </div>
                    )}
                    {/* La cuota la manda el servidor. La condicion NO cuelga de
                        PLAN_LIMITS[plan].memoryCloud a proposito: gatear el dato del
                        servidor detras de una constante del cliente es justo lo que el
                        corte comercial saca del medio. Si el servidor reporto cuota, el
                        usuario tiene nube. */}
                    {memory.quota && (memory.state === 'connected' || memory.state === 'paused') && (
                      <div className="sp-mem-quota">
                        {formatBytes(memory.quota.used_bytes)} of {formatBytes(memory.quota.max_bytes)} used
                      </div>
                    )}
                    {memory.state === 'connected' && memory.pendingCount > 0 && (
                      <div className="sp-mem-progress" title={`${memory.itemCount} items · ${memory.pendingCount} pending`}>
                        <div className="sp-mem-progress-fill" style={{ width: `${memorySyncProgress * 100}%` }} />
                      </div>
                    )}
                    {(memory.state === 'connected' || memory.state === 'paused'
                      // Extends to the two states whose Disconnect button was just made
                      // reachable above — otherwise the button existing wouldn't actually
                      // let these users ask for deletion, since deleteCloudOnDisconnect
                      // would silently stay at its unchecked default with no control to
                      // flip it in this session.
                      || memory.state === 'error' || memory.state === 'plan_required') && (
                      <label className="sp-checkbox-row">
                        <input
                          type="checkbox"
                          checked={deleteCloudOnDisconnect}
                          onChange={(e) => setDeleteCloudOnDisconnect(e.target.checked)}
                        />
                        Also delete my cloud memory (your local memory is never affected)
                      </label>
                    )}
                  </div>

                  <MemoryVaultCard />

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

              {memoryHubOpen && (
                <MemoryHub
                  onClose={() => setMemoryHubOpen(false)}
                  onUpgrade={() => { setMemoryHubOpen(false); setMemoryUpgradeOpen(true) }}
                />
              )}
              {tab === 'editor' && (
                <div className="sp-section">
                  <div className="sp-row">
                    <span className="sp-row-label">Theme</span>
                    <select
                      className="sp-select"
                      data-testid="theme-select"
                      value={userPrefs.prefs.ui_settings.editorTheme ?? 'vs-dark'}
                      onChange={e => userPrefs.setEditorTheme(e.target.value)}
                    >
                      <optgroup label="Built-in">
                        <option value="vs-dark">Dark (Monaco)</option>
                        <option value="vs">Light (Monaco)</option>
                      </optgroup>
                      <optgroup label="Bundled">
                        {BUNDLED_THEMES.map(t => (
                          <option key={t.name} value={t.name}>{t.displayName}</option>
                        ))}
                      </optgroup>
                      <optgroup label="Installed">
                        {installedThemes.map(t => (
                          <option key={t.name} value={t.name}>{t.displayName}</option>
                        ))}
                      </optgroup>
                    </select>
                  </div>
                  <div style={{ display: 'flex', gap: 8, margin: '10px 0' }}>
                    <button className="sp-action-btn" onClick={handleScanVSCodeThemes}>Import themes from VS Code</button>
                    <button className="sp-action-btn" onClick={handleLoadThemeFile}>Load theme file…</button>
                    <button className="sp-action-btn" onClick={() => setVsxOpen(v => !v)}>Browse Open VSX…</button>
                  </div>
                  {themeError && <p style={{ color: '#ef4444', fontSize: 12 }}>{themeError}</p>}
                  {scannedThemes && (
                    <div data-testid="scanned-themes">
                      {scannedThemes.length === 0 && (
                        <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>No themes found in your VS Code extensions.</p>
                      )}
                      {scannedThemes.map(t => (
                        <div key={t.path} className="sp-row">
                          <span className="sp-row-label">{t.label}</span>
                          <button className="sp-action-btn" onClick={() => handleInstallScanned(t.path)}>Install</button>
                        </div>
                      ))}
                    </div>
                  )}
                  {vsxOpen && (
                    <div data-testid="openvsx-browser">
                      <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                        <input
                          className="sp-select"
                          style={{ flex: 1 }}
                          placeholder="Search themes on Open VSX"
                          value={vsxQuery}
                          onChange={e => setVsxQuery(e.target.value)}
                          onKeyDown={e => { if (e.key === 'Enter') void handleVsxSearch() }}
                        />
                        <button className="sp-action-btn" onClick={handleVsxSearch} disabled={vsxBusy}>Search</button>
                      </div>
                      {vsxError && <p style={{ color: '#ef4444', fontSize: 12 }}>{vsxError}</p>}
                      {vsxResults && vsxResults.length === 0 && (
                        <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>No theme extensions matched your search.</p>
                      )}
                      {vsxResults?.map(r => (
                        <div key={`${r.namespace}.${r.name}`} className="sp-row">
                          <span className="sp-row-label" title={r.description}>{r.displayName}</span>
                          <button
                            className="sp-action-btn"
                            disabled={vsxBusy}
                            onClick={() => handleVsxInstall(r.namespace, r.name)}
                          >Install</button>
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="sp-divider" />
                  <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '0 0 12px' }}>
                    Import your editor preferences from VS Code or IntelliJ.
                  </p>
                  <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
                    <button className="sp-action-btn" onClick={() => handleImportEditorConfig('vscode')}>Import from VS Code</button>
                    <button className="sp-action-btn" onClick={() => handleImportEditorConfig('intellij')}>Import from IntelliJ</button>
                  </div>
                  {importError && <p style={{ color: '#ef4444', fontSize: 12 }}>{importError}</p>}
                  {importPreview && (
                    <div data-testid="ide-config-preview">
                      <ul>
                        {Object.entries(importPreview.options).map(([key, value]) => (
                          <li key={key}>{key}: {JSON.stringify(value)}</li>
                        ))}
                      </ul>
                      <button className="sp-action-btn" onClick={confirmImportEditorConfig}>Apply</button>
                      <button className="sp-btn-danger" onClick={() => setImportPreview(null)}>Cancel</button>
                    </div>
                  )}
                </div>
              )}

            </div>
          </div>
        </>,
        document.body
      )}
    </>
  )
}
