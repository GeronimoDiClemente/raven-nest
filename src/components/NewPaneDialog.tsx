import { useState, useEffect, useRef } from 'react'
import { AIType, AI_CONFIG, COLOR_PALETTE, CustomCLI, ShellInfo , PICKER_AI_TYPES } from '../types'
import { safeWriteText } from '../lib/clipboard'
import { bridge } from '../lib/bridge'
import { AI_LOGOS } from './AILogos'
import ConfirmDialog from './ConfirmDialog'

// El banner muestra el comando del SO en el que estas: el de Cursor difiere en
// Windows y ensenar el de curl ahi seria mentirle al usuario.
const CLI_INSTALL: Partial<Record<AIType, { cmd: string; cmdWin?: string; manual?: boolean; url: string }>> = {
  claude:   { cmd: 'npm install -g @anthropic-ai/claude-code', url: 'https://docs.anthropic.com/en/docs/claude-code/getting-started' },
  gemini:   { cmd: 'npm install -g @google/gemini-cli',        url: 'https://github.com/google-gemini/gemini-cli' },
  codex:    { cmd: 'npm install -g @openai/codex',             url: 'https://github.com/openai/codex' },
  copilot:  { cmd: 'gh extension install github/gh-copilot',   url: 'https://docs.github.com/en/copilot/github-copilot-in-the-cli' },
  opencode: { cmd: 'npm install -g opencode-ai',                url: 'https://opencode.ai' },
  deepseek: { cmd: 'npm install -g @deepseek-ai/dsh',          url: 'https://www.npmjs.com/package/@deepseek-ai/dsh' },
  grok:     { cmd: 'npm install -g @xai-official/grok',        url: 'https://docs.x.ai/build' },
  qwen:     { cmd: 'npm install -g @qwen-code/qwen-code',      url: 'https://github.com/QwenLM/qwen-code' },
  amp:      { cmd: 'npm install -g @ampcode/cli',              url: 'https://ampcode.com' },
  // Cursor no publica en npm: instalador propio. El de Windows es
  // irm 'https://cursor.com/install?win32=true' | iex — esta en la url.
  cursor:   { cmd: 'curl https://cursor.com/install -fsS | bash', manual: true, url: 'https://cursor.com/docs/cli/installation' },
}


/** El comando del SO en el que corre la app (Cursor difiere en Windows). */
function installCmdFor(entry: { cmd: string; cmdWin?: string }, isWindows: boolean): string {
  return isWindows && entry.cmdWin ? entry.cmdWin : entry.cmd
}

interface Props {
  onConfirm: (
    aiType: AIType,
    accountName: string,
    accountDir: string,
    borderColor: string,
    cmd: string,
    customLabel?: string,
    customColor?: string,
    shellId?: string
  ) => void
  onCancel: () => void
  allowedAIs?: string[]
  onUpgrade?: () => void
}

type Step = 'select-ai' | 'select-account' | 'add-custom' | 'select-shell'

function TerminalIcon({ size = 36, color = '#888' }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 36 36" fill="none">
      <path d="M6 12l7 6-7 6" stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M17 24h13" stroke={color} strokeWidth="2.5" strokeLinecap="round" opacity="0.6" />
    </svg>
  )
}

function CustomCLIIcon({ size = 36, color = '#888' }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 36 36" fill="none">
      <circle cx="18" cy="18" r="10" stroke={color} strokeWidth="2" fill="none" />
      <path d="M18 13v5l3 3" stroke={color} strokeWidth="2" strokeLinecap="round" />
    </svg>
  )
}

const SHELL_COLORS: Record<string, string> = {
  powershell: '#1976D2',  // PowerShell blue
  cmd:        '#9CA3AF',  // neutral gray
  pwsh:       '#3B82F6',  // brighter blue (modern)
  gitbash:    '#F1502F',  // git orange-red
  wsl:        '#FFCC00',  // Tux/Linux yellow
}

const CUSTOM_COLORS = ['#E07B54', '#4F9EFF', '#22C55E', '#A78BFA', '#F59E0B', '#EC4899', '#14B8A6', '#60A5FA', '#888888']

export default function NewPaneDialog({ onConfirm, onCancel, allowedAIs, onUpgrade }: Props) {
  const [step, setStep] = useState<Step>('select-ai')
  const [selectedAI, setSelectedAI] = useState<AIType | null>(null)
  const [accounts, setAccounts] = useState<string[]>([])
  const [newAccountName, setNewAccountName] = useState('')
  const [creatingNew, setCreatingNew] = useState(false)
  const [borderColor, setBorderColor] = useState(COLOR_PALETTE[0])
  const [customCLIs, setCustomCLIs] = useState<CustomCLI[]>([])
  const [customCmd, setCustomCmd] = useState('')
  const [customLabel, setCustomLabel] = useState('')
  const [customColor, setCustomColor] = useState(CUSTOM_COLORS[0])
  const [confirmDelete, setConfirmDelete] = useState<{ type: 'account'; name: string } | { type: 'cli'; id: string; label: string; e: React.MouseEvent } | null>(null)
  const [cliFound, setCliFound] = useState<boolean | null>(null)
  const [copied, setCopied] = useState(false)
  const [installState, setInstallState] = useState<'idle' | 'installing' | 'done' | 'error'>('idle')
  const [installReason, setInstallReason] = useState<'failed' | 'not-on-path'>('failed')
  const [installLog, setInstallLog] = useState('')
  const logRef = useRef<HTMLDivElement>(null)
  const installAbortRef = useRef(false)
  const [shells, setShells] = useState<ShellInfo[]>([])
  const [shellsError, setShellsError] = useState<string | null>(null)
  const isWindows = bridge.platform?.isWin ?? false
  // Nest solo instala por gestor de paquetes; los que piden bajar y ejecutar
  // un script se instalan a mano desde la web (ver INSTALL_COMMANDS en el main).
  const manualInstall = !!(selectedAI && CLI_INSTALL[selectedAI]?.manual)

  useEffect(() => {
    bridge.shells?.detect()
      .then((list) => { setShells(list); setShellsError(null) })
      .catch((err) => {
        console.error('[shells.detect] failed', err)
        setShells([])
        setShellsError(err instanceof Error ? err.message : String(err))
      })
  }, [])

  function selectShell(shell: ShellInfo) {
    onConfirm('terminal', 'default', '', SHELL_COLORS[shell.id] ?? '#888888', '', shell.label, SHELL_COLORS[shell.id] ?? '#888888', shell.id)
  }

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onCancel() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onCancel])

  useEffect(() => {
    bridge.customCLIs.list().then(setCustomCLIs)
  }, [])

  useEffect(() => {
    if (step !== 'select-account' || !selectedAI) return
    const cmd = AI_CONFIG[selectedAI].cmd
    if (!cmd) { setCliFound(true); return }
    setCliFound(null)
    setInstallState('idle')
    setInstallLog('')
    bridge.cli.check(cmd).then(r => setCliFound(r.found))
  }, [step, selectedAI])

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight
  }, [installLog])

  useEffect(() => () => { installAbortRef.current = true }, [])

  async function selectAI(aiType: AIType) {
    const cfg = AI_CONFIG[aiType]
    setSelectedAI(aiType)
    setBorderColor(cfg.color)
    // Windows shell submenu: clicking "Terminal" on Windows with detected shells
    // opens a sub-step to pick which shell, instead of cluttering the main grid.
    if (aiType === 'terminal' && isWindows && shells.length > 0) {
      setStep('select-shell')
      return
    }
    if (cfg.noAccount) {
      // Check CLI availability before opening — show a brief warning but don't block
      if (cfg.cmd) {
        const { found } = await bridge.cli.check(cfg.cmd)
        if (!found && CLI_INSTALL[aiType]) {
          setCliFound(false)
          setStep('select-account') // Reuse the account step UI just to show the warning
          return
        }
      }
      onConfirm(aiType, 'default', '', cfg.color, cfg.cmd)
      return
    }
    const existing = await bridge.accounts.list(aiType)
    setAccounts(existing)
    setStep('select-account')
  }

  async function selectCustomCLI(cli: CustomCLI) {
    onConfirm('custom', 'default', '', cli.color, cli.cmd, cli.label, cli.color)
  }

  async function selectAccount(name: string) {
    if (!selectedAI) return
    const dir = await bridge.accounts.getDir(selectedAI, name)
    onConfirm(selectedAI, name, dir, borderColor, AI_CONFIG[selectedAI].cmd)
  }

  async function installCli() {
    if (!selectedAI) return
    const ai = selectedAI
    installAbortRef.current = false
    setInstallLog('')
    setInstallState('installing')
    const unsub = bridge.cli.onInstallProgress(({ aiType, line }) => {
      if (aiType === ai) setInstallLog((prev) => (prev ? `${prev}\n${line}` : line))
    })
    let result: { state: 'done' | 'failed' | 'cancelled'; log: string }
    try {
      result = await bridge.cli.install(ai)
    } finally {
      unsub()
    }
    if (result.state === 'cancelled') { setInstallState('idle'); return }
    if (result.state === 'failed') { setInstallReason('failed'); setInstallState('error'); return }
    // done → re-check that the binary is now on PATH
    const { found } = await bridge.cli.check(AI_CONFIG[ai].cmd)
    if (!found) { setInstallReason('not-on-path'); setInstallState('error'); return }
    setInstallState('done')
    setTimeout(() => {
      if (installAbortRef.current) return
      const cfg = AI_CONFIG[ai]
      if (cfg.noAccount) {
        onConfirm(ai, 'default', '', cfg.color, cfg.cmd)
      } else {
        setCliFound(true)
        setInstallState('idle')
      }
    }, 900)
  }

  async function createAccount() {
    if (!selectedAI || !newAccountName.trim()) return
    setCreatingNew(true)
    const dir = await bridge.accounts.save(selectedAI, newAccountName.trim())
    onConfirm(selectedAI, newAccountName.trim(), dir, borderColor, AI_CONFIG[selectedAI].cmd)
  }

  async function saveCustomCLI() {
    if (!customCmd.trim() || !customLabel.trim()) return
    const cli: CustomCLI = {
      id: `custom-${Date.now()}`,
      label: customLabel.trim(),
      cmd: customCmd.trim(),
      color: customColor,
    }
    await bridge.customCLIs.save(cli)
    setCustomCLIs((prev) => [...prev, cli])
    setStep('select-ai')
    setCustomCmd('')
    setCustomLabel('')
  }

  async function deleteCustomCLI(id: string, e: React.MouseEvent) {
    e.stopPropagation()
    const cli = customCLIs.find(c => c.id === id)
    setConfirmDelete({ type: 'cli', id, label: cli?.label ?? id, e })
  }

  if (step === 'add-custom') {
    return (
      <div className="dialog-overlay" onClick={onCancel}>
        <div className="dialog" onClick={(e) => e.stopPropagation()}>
          <button className="dialog-back" onClick={() => setStep('select-ai')}>← Back</button>
          <h2 className="dialog-title">Add Custom CLI</h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <input
              className="new-account-input"
              placeholder="Display name (e.g. Aider, LLM)"
              value={customLabel}
              onChange={(e) => setCustomLabel(e.target.value)}
              autoFocus
            />
            <input
              className="new-account-input"
              placeholder="Command (e.g. aider, llm, gh copilot)"
              value={customCmd}
              onChange={(e) => setCustomCmd(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && saveCustomCLI()}
            />
            <div>
              <p className="account-list-label" style={{ marginBottom: 8 }}>Color</p>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {CUSTOM_COLORS.map((c) => (
                  <button
                    key={c}
                    className={`color-swatch${customColor === c ? ' selected' : ''}`}
                    style={{ background: c }}
                    onClick={() => setCustomColor(c)}
                  />
                ))}
              </div>
            </div>
            <button
              className="btn-primary"
              style={{ marginTop: 4 }}
              onClick={saveCustomCLI}
              disabled={!customCmd.trim() || !customLabel.trim()}
            >
              Save CLI
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="dialog-overlay" onClick={onCancel}>
      <div className={`dialog${step === 'select-ai' ? ' dialog--picker' : ''}`} onClick={(e) => e.stopPropagation()}>
        {step === 'select-ai' ? (
          <>
            <h2 className="dialog-title">Choose AI</h2>
            {isWindows && shellsError && (
              <div style={{
                background: '#2a1a00',
                border: '1px solid #f59e0b',
                borderRadius: 6,
                padding: '8px 12px',
                marginBottom: 12,
                fontSize: 11,
                color: '#f59e0b',
              }}>
                ⚠ Couldn't detect Windows shells: {shellsError}
              </div>
            )}
            <div className="ai-grid">
              {PICKER_AI_TYPES.map((aiType) => {
                const cfg = AI_CONFIG[aiType]
                const Logo = AI_LOGOS[aiType]
                const locked = allowedAIs && !allowedAIs.includes(aiType)
                return (
                  <button
                    key={aiType}
                    className={`ai-card${locked ? ' locked' : ''}`}
                    style={{ '--ai-color': cfg.color, '--ai-bg': cfg.bg } as React.CSSProperties}
                    onClick={() => locked ? onUpgrade?.() : selectAI(aiType)}
                    title={locked ? 'Requires Pro plan' : undefined}
                  >
                    <div className="ai-card-logo">
                      {Logo
                        ? <Logo size={36} color={locked ? '#555' : cfg.color} />
                        : <TerminalIcon size={36} color={locked ? '#555' : cfg.color} />
                      }
                    </div>
                    <span className="ai-card-label">{cfg.label}</span>
                    {locked && <span className="ai-card-lock">Pro</span>}
                  </button>
                )
              })}
              {customCLIs.map((cli) => (
                <button
                  key={cli.id}
                  className="ai-card"
                  style={{ '--ai-color': cli.color, '--ai-bg': '#1a1a1a' } as React.CSSProperties}
                  onClick={() => selectCustomCLI(cli)}
                >
                  <div className="ai-card-logo" style={{ position: 'relative' }}>
                    <CustomCLIIcon size={36} color={cli.color} />
                    <button
                      className="custom-cli-delete"
                      onClick={(e) => deleteCustomCLI(cli.id, e)}
                      title="Remove"
                    >×</button>
                  </div>
                  <span className="ai-card-label">{cli.label}</span>
                </button>
              ))}
              <button
                className="ai-card ai-card-add"
                onClick={() => setStep('add-custom')}
              >
                <div className="ai-card-logo">
                  <span style={{ fontSize: 24, color: 'var(--text-muted)' }}>+</span>
                </div>
                <span className="ai-card-label" style={{ color: 'var(--text-muted)' }}>Add CLI</span>
              </button>
            </div>
            <button className="dialog-cancel" onClick={onCancel}>Cancel</button>
          </>
        ) : step === 'select-shell' ? (
          <>
            <button className="dialog-back" onClick={() => setStep('select-ai')}>← Back</button>
            <h2 className="dialog-title">Choose shell</h2>
            <div className="ai-grid">
              {shells.map((shell) => {
                const color = SHELL_COLORS[shell.id] ?? '#888888'
                return (
                  <button
                    key={`shell-${shell.id}`}
                    className="ai-card"
                    style={{ '--ai-color': color, '--ai-bg': '#15171a' } as React.CSSProperties}
                    onClick={() => selectShell(shell)}
                    title={`Open ${shell.label}`}
                  >
                    <div className="ai-card-logo">
                      <TerminalIcon size={36} color={color} />
                    </div>
                    <span className="ai-card-label">{shell.label}</span>
                  </button>
                )
              })}
              <button
                className="ai-card"
                style={{ '--ai-color': '#888888', '--ai-bg': '#1a1a1a' } as React.CSSProperties}
                onClick={() => onConfirm('terminal', 'default', '', '#888888', '')}
                title="System default shell"
              >
                <div className="ai-card-logo">
                  <TerminalIcon size={36} color="#888888" />
                </div>
                <span className="ai-card-label">Default</span>
              </button>
            </div>
            <button className="dialog-cancel" onClick={onCancel}>Cancel</button>
          </>
        ) : (
          <>
            <button className="dialog-back" onClick={() => { installAbortRef.current = true; setStep('select-ai'); setCliFound(null) }}>← Back</button>
            <h2 className="dialog-title">
              <span style={{ color: AI_CONFIG[selectedAI!].color }}>{AI_CONFIG[selectedAI!].label}</span>
              {' '}Account
            </h2>

            {/* CLI detection banner */}
            {/* Cursor solo se instala bajando y ejecutando un script. Ese patron
                (`curl | bash`, `irm | iex`) es el que Defender levanta como
                troyano, asi que no lo ejecutamos en ningun SO: va a la web. */}
            {cliFound === false && selectedAI && CLI_INSTALL[selectedAI] && (
              <div style={{
                background:
                  installState === 'done' || (installState === 'error' && installReason === 'not-on-path')
                    ? '#07210f'
                    : installState === 'error'
                      ? '#2a0a0a'
                      : '#2a1a00',
                border: `1px solid ${
                  installState === 'done' || (installState === 'error' && installReason === 'not-on-path')
                    ? '#22c55e'
                    : installState === 'error'
                      ? '#ef4444'
                      : '#f59e0b'
                }`,
                borderRadius: 6,
                padding: '10px 12px',
                marginBottom: 12,
                fontSize: 11,
              }}>
                {installState === 'idle' && (
                  <>
                    <div style={{ color: '#f59e0b', fontWeight: 600, marginBottom: 6 }}>
                      ⚠ {AI_CONFIG[selectedAI].label} CLI not found
                    </div>
                    <div style={{ color: '#aaa', marginBottom: 8 }}>
                      {manualInstall
                        ? 'This one installs from its website.'
                        : 'Raven Nest can install it for you.'}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      {!manualInstall && (
                        <button className="cli-banner-install" onClick={installCli}>
                          Install {AI_CONFIG[selectedAI].label} CLI
                        </button>
                      )}
                      <button
                        className="cli-banner-link"
                        onClick={() => bridge.electronShell.openExternal(CLI_INSTALL[selectedAI!]!.url)}
                      >
                        Docs ↗
                      </button>
                    </div>
                  </>
                )}

                {installState === 'installing' && (
                  <>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                      <span className="cli-banner-spinner" />
                      <div style={{ color: '#f59e0b', fontWeight: 600, flex: 1 }}>
                        Installing {AI_CONFIG[selectedAI].label} CLI…
                      </div>
                      <button
                        style={{ background: 'transparent', color: '#888', border: '1px solid #333', borderRadius: 4, padding: '4px 10px', fontSize: 11, cursor: 'pointer', flexShrink: 0 }}
                        onClick={() => bridge.cli.cancelInstall(selectedAI!)}
                      >
                        Cancel
                      </button>
                    </div>
                    <div className="cli-banner-log" ref={logRef}>{installLog}</div>
                  </>
                )}

                {installState === 'done' && (
                  <>
                    <div style={{ color: '#22c55e', fontWeight: 600, marginBottom: 4 }}>
                      ✓ {AI_CONFIG[selectedAI].label} CLI installed
                    </div>
                    <div style={{ color: '#aaa' }}>Opening {AI_CONFIG[selectedAI].label}…</div>
                  </>
                )}

                {installState === 'error' && installReason === 'not-on-path' && (
                  <>
                    <div style={{ color: '#22c55e', fontWeight: 600, marginBottom: 6 }}>
                      ✓ {AI_CONFIG[selectedAI].label} CLI installed
                    </div>
                    <div style={{ color: '#aaa', marginBottom: 8 }}>
                      Restart Raven Nest to pick it up.
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <button
                        className="cli-banner-link"
                        onClick={() => bridge.electronShell.openExternal(CLI_INSTALL[selectedAI!]!.url)}
                      >
                        Docs ↗
                      </button>
                    </div>
                  </>
                )}

                {installState === 'error' && installReason === 'failed' && (
                  <>
                    <div style={{ color: '#ef4444', fontWeight: 600, marginBottom: 6 }}>
                      ✗ Install failed
                    </div>
                    <div style={{ color: '#aaa', marginBottom: 8 }}>
                      Try it manually:
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <code style={{
                        flex: 1,
                        background: '#111',
                        border: '1px solid #333',
                        borderRadius: 4,
                        padding: '4px 8px',
                        color: '#e2e8f0',
                        fontSize: 11,
                        fontFamily: 'monospace',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}>
                        {installCmdFor(CLI_INSTALL[selectedAI]!, isWindows)}
                      </code>
                      <button
                        style={{
                          background: copied ? '#22c55e' : '#333',
                          color: '#fff',
                          border: 'none',
                          borderRadius: 4,
                          padding: '4px 10px',
                          fontSize: 11,
                          cursor: 'pointer',
                          flexShrink: 0,
                        }}
                        onClick={() => {
                          void safeWriteText(CLI_INSTALL[selectedAI!]!.cmd).then(ok => {
                            if (ok) {
                              setCopied(true)
                              setTimeout(() => setCopied(false), 2000)
                            }
                          })
                        }}
                      >
                        {copied ? '✓' : 'Copy'}
                      </button>
                      <button
                        className="cli-banner-link"
                        onClick={() => bridge.electronShell.openExternal(CLI_INSTALL[selectedAI!]!.url)}
                      >
                        Docs ↗
                      </button>
                    </div>
                    {installLog && <div className="cli-banner-log" ref={logRef}>{installLog}</div>}
                  </>
                )}
              </div>
            )}

            {/* noAccount types (opencode) land here only when CLI not found — show open anyway */}
            {selectedAI && AI_CONFIG[selectedAI].noAccount && cliFound === false && installState === 'idle' && (
              <button
                className="btn-primary"
                style={{ width: '100%', marginBottom: 8 }}
                onClick={() => onConfirm(selectedAI!, 'default', '', AI_CONFIG[selectedAI!].color, AI_CONFIG[selectedAI!].cmd)}
              >
                Open anyway
              </button>
            )}

            {accounts.length > 0 && !AI_CONFIG[selectedAI!]?.noAccount && (
              <div className="account-list">
                <p className="account-list-label">Saved accounts</p>
                {accounts.map((name) => (
                  <button key={name} className="account-item" onClick={() => selectAccount(name)}>
                    <span className="account-dot" style={{ background: borderColor }} />
                    <span style={{ flex: 1, textAlign: 'left' }}>{name}</span>
                    <span
                      className="account-delete-btn"
                      role="button"
                      onClick={(e) => { e.stopPropagation(); setConfirmDelete({ type: 'account', name }) }}
                      title="Delete account and local folder"
                    >×</span>
                  </button>
                ))}
              </div>
            )}

            {selectedAI && !AI_CONFIG[selectedAI].noAccount && <div className="new-account-form">
              <p className="account-list-label">New account</p>
              <div className="new-account-row">
                <input
                  data-tour-id="account-field"
                  className="new-account-input"
                  placeholder="Account name (e.g. Personal, Work)"
                  value={newAccountName}
                  onChange={(e) => setNewAccountName(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && createAccount()}
                  autoFocus
                />
                <button
                  className="btn-primary"
                  onClick={createAccount}
                  disabled={!newAccountName.trim() || creatingNew}
                >
                  {creatingNew ? '...' : 'Login →'}
                </button>
              </div>
              <p className="new-account-hint">
                A new isolated session will be created. You'll need to log in inside the terminal.
              </p>
            </div>}

            {selectedAI && !AI_CONFIG[selectedAI].noAccount && <div className="color-picker-section">
              <p className="account-list-label">Border color</p>
              <div className="color-palette">
                {COLOR_PALETTE.map((c) => (
                  <button
                    key={c}
                    className={`color-swatch${borderColor === c ? ' selected' : ''}`}
                    style={{ background: c }}
                    onClick={() => setBorderColor(c)}
                    title={c}
                  />
                ))}
              </div>
            </div>}
          </>
        )}
      </div>

      {confirmDelete && (
        <ConfirmDialog
          title={confirmDelete.type === 'account' ? 'Delete account' : 'Delete CLI'}
          message={confirmDelete.type === 'account'
            ? `Delete account "${confirmDelete.name}"? The local folder with its configuration will be removed. This action cannot be undone.`
            : `Delete "${(confirmDelete as { type: 'cli'; label: string }).label}"?`}
          confirmLabel="Delete"
          confirmDanger
          onConfirm={async () => {
            if (confirmDelete.type === 'account') {
              await bridge.accounts.delete(selectedAI!, confirmDelete.name)
              setAccounts((prev) => prev.filter((a) => a !== (confirmDelete as { name: string }).name))
            } else {
              const c = confirmDelete as { type: 'cli'; id: string; e: React.MouseEvent }
              c.e.stopPropagation()
              await bridge.customCLIs.delete(c.id)
              setCustomCLIs((prev) => prev.filter((x) => x.id !== c.id))
            }
            setConfirmDelete(null)
          }}
          onCancel={() => setConfirmDelete(null)}
        />
      )}
    </div>
  )
}
