import { useState, useEffect, useRef } from 'react'
import { AIType, AI_CONFIG, COLOR_PALETTE, CustomCLI, ShellInfo , PICKER_AI_TYPES } from '../types'
import { safeWriteText } from '../lib/clipboard'
import { bridge } from '../lib/bridge'
import { appendModelFlag } from '../lib/launch-cmd'
import { AI_LOGOS } from './AILogos'
import ConfirmDialog from './ConfirmDialog'
import { cn } from '@/lib/utils'

// Label de seccion chica (MAYUSCULA, tracking ancho) repetido en cuatro
// lugares de este dialogo ("Color", "Model", "Saved accounts", "New
// account") — era la clase `.account-list-label` de global.css, retirada
// porque no le quedaba ningun usuario fuera de este archivo. `--text-muted`
// no tiene equivalente Tailwind (no es `--muted-foreground`, ver el
// comentario en global.css) asi que sigue como var() a mano, no como clase.
const SECTION_LABEL_CLASS = 'text-fs-xs uppercase tracking-[0.8px] mb-2'

// Tratamiento B (task-12-brief.md): el logo de cada tile mantiene su color
// de marca; el label pasa de --text-primary fijo a reaccionar al :hover del
// tile (`.ai-card` de global.css sigue poniendo el `group` — necesita CSS
// propio por el color-mix con --ai-color, ver la nota ahi). Sin estado
// "seleccionado" todavia: hoy ningun tile queda marcado como elegido — un
// click en la grilla siempre navega al siguiente paso — asi que esa rama de
// la tabla de diseño no tiene ningún punto del código que la dispare; se
// deja afuera en vez de agregar CSS sin dueño.
const AI_CARD_LABEL_CLASS = 'relative z-10 text-fs-sm font-semibold tracking-[0.2px] text-muted-foreground group-hover:text-foreground'

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
  /** Board "Run with worker": zero-click launch on this agent with `presetModel`.
   *  Resolved once on mount — if the CLI is found and there's exactly one saved
   *  account (or the agent needs no account at all), it launches immediately
   *  with no dialog shown. Falls back to the normal account-step UI only when
   *  it's genuinely ambiguous (0 or >1 saved accounts) or impossible (CLI
   *  missing). Initial values only — the manual (no-preset) flow is untouched. */
  presetAgent?: AIType
  presetModel?: string
  /** Worker-step-configured account (see worker-spec-store.ts's WorkerStep.account).
   *  When it names an account that still exists in the saved list, the resolve
   *  effect launches with it directly and skips the manual account picker even
   *  when there are 0/>1 saved accounts. A stale/missing value (account deleted
   *  since the worker was configured) is ignored and the existing rules apply. */
  presetAccount?: string
}

type Step = 'select-ai' | 'select-account' | 'add-custom' | 'select-shell'

function TerminalIcon({ size = 36, color = 'var(--muted-foreground)' }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 36 36" fill="none">
      <path d="M6 12l7 6-7 6" stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M17 24h13" stroke={color} strokeWidth="2.5" strokeLinecap="round" opacity="0.6" />
    </svg>
  )
}

function CustomCLIIcon({ size = 36, color = 'var(--muted-foreground)' }: { size?: number; color?: string }) {
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

const CUSTOM_COLORS = ['#E07B54', '#4F9EFF', '#22C55E', 'var(--primary)', '#F59E0B', '#EC4899', '#14B8A6', '#60A5FA', '#888888']

export default function NewPaneDialog({ onConfirm, onCancel, presetAgent, presetModel, presetAccount }: Props) {
  const presetCfg = presetAgent ? AI_CONFIG[presetAgent] : null
  // While a preset resolves (see the mount effect below), render a minimal
  // placeholder instead of any step UI — no flash of an account form the user
  // never needs to touch. `step`/`selectedAI` still seed the manual-flow-shaped
  // fallback (select-account) the resolve effect uses when it can't launch blind.
  const [autoResolving, setAutoResolving] = useState<boolean>(!!presetAgent)
  const autoLaunchedRef = useRef(false)
  const [step, setStep] = useState<Step>('select-ai')
  const [selectedAI, setSelectedAI] = useState<AIType | null>(presetAgent ?? null)
  const [model, setModel] = useState<string>(presetModel ?? '') // '' = agent default; reset on agent change
  const [accounts, setAccounts] = useState<string[]>([])
  const [newAccountName, setNewAccountName] = useState('')
  const [creatingNew, setCreatingNew] = useState(false)
  const [borderColor, setBorderColor] = useState(presetCfg ? presetCfg.color : COLOR_PALETTE[0])
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
    onConfirm('terminal', 'default', '', SHELL_COLORS[shell.id] ?? 'var(--muted-foreground)', '', shell.label, SHELL_COLORS[shell.id] ?? 'var(--muted-foreground)', shell.id)
  }

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onCancel() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onCancel])

  useEffect(() => {
    bridge.customCLIs.list().then(setCustomCLIs)
  }, [])

  // Preset agent: resolve automatically so a worker launches with zero clicks —
  // no account picking, no Enter. Launches immediately when it's unambiguous
  // (noAccount agent with its CLI present; account agent with exactly one saved
  // account and its CLI present). Otherwise falls back to the normal
  // select-account UI — same shape `selectAI` produces for a manual pick — so
  // the user finishes by hand rather than auto-launching into a broken state.
  // Mount-only — preset is an initial value, not a live prop. `autoLaunchedRef`
  // guards against a double-launch if this ever re-runs (e.g. dev StrictMode).
  useEffect(() => {
    if (!presetAgent) return
    const cfg = AI_CONFIG[presetAgent]
    let cancelled = false
    ;(async () => {
      try {
        if (cfg.noAccount) {
          const found = cfg.cmd ? (await bridge.cli.check(cfg.cmd)).found : true
          if (cancelled || autoLaunchedRef.current) return
          if (found) {
            autoLaunchedRef.current = true
            onConfirm(presetAgent, 'default', '', cfg.color, appendModelFlag(cfg.cmd, cfg.modelFlag, presetModel ?? ''))
            return
          }
          // CLI missing: same install-banner UI a manual noAccount pick shows
          // (see selectAI below) — can't launch blind without the CLI.
          setCliFound(false)
          setStep('select-account')
          setAutoResolving(false)
          return
        }

        const existing = await bridge.accounts.list(presetAgent)
        if (cancelled || autoLaunchedRef.current) return
        setAccounts(existing)

        // A worker-configured account that's still valid bypasses the "exactly
        // one saved account" requirement entirely — it's an explicit choice,
        // not a guess, so it wins even with 0 (unless the account itself has
        // since been deleted — in that case it wouldn't be in `existing`) or
        // >1 saved accounts. A missing/stale presetAccount falls back to the
        // original "auto-launch only when unambiguous" rule.
        const chosenAccount = presetAccount && existing.includes(presetAccount)
          ? presetAccount
          : existing.length === 1 ? existing[0] : null

        if (chosenAccount) {
          const { found } = await bridge.cli.check(cfg.cmd)
          if (cancelled || autoLaunchedRef.current) return
          if (found) {
            const dir = await bridge.accounts.getDir(presetAgent, chosenAccount)
            if (cancelled || autoLaunchedRef.current) return
            autoLaunchedRef.current = true
            onConfirm(presetAgent, chosenAccount, dir, cfg.color, appendModelFlag(cfg.cmd, cfg.modelFlag, presetModel ?? ''))
            return
          }
          setCliFound(false)
        }

        // 0 accounts (login needed), >1 with no valid stored pick (ambiguous),
        // or CLI missing → the user finishes manually on the account step,
        // accounts already loaded above.
        setStep('select-account')
        setAutoResolving(false)
      } catch {
        if (!cancelled) setAutoResolving(false)
      }
    })()
    return () => { cancelled = true }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

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
    setModel('') // switching agents: don't let a leftover model pick leak into the new one
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
      // This launch happens for a just-selected agent, before any model dropdown for it
      // could have rendered — pass '' explicitly rather than the `model` state var, which
      // (inside this same closure) would still hold the PREVIOUS agent's stale value.
      onConfirm(aiType, 'default', '', cfg.color, appendModelFlag(cfg.cmd, cfg.modelFlag, ''))
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
    const cfg = AI_CONFIG[selectedAI]
    onConfirm(selectedAI, name, dir, borderColor, appendModelFlag(cfg.cmd, cfg.modelFlag, model))
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
        onConfirm(ai, 'default', '', cfg.color, appendModelFlag(cfg.cmd, cfg.modelFlag, model))
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
    const cfg = AI_CONFIG[selectedAI]
    onConfirm(selectedAI, newAccountName.trim(), dir, borderColor, appendModelFlag(cfg.cmd, cfg.modelFlag, model))
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

  if (autoResolving) {
    // Preset resolve is in flight (see the mount effect above): no account
    // form, no agent grid — just a brief "Opening…" beat. onCancel (overlay
    // click / Escape) still works while this is up.
    return (
      <div className="dialog-overlay" onClick={onCancel}>
        <div className="dialog" onClick={(e) => e.stopPropagation()}>
          <div className="flex items-center justify-center gap-2.5 py-10 text-muted-foreground text-fs">
            <span
              className="size-3.5 shrink-0 rounded-full border-2 border-border border-t-primary animate-spin"
              style={presetCfg ? { borderTopColor: presetCfg.color } : undefined}
            />
            <span>
              Opening{presetCfg ? <> <span style={{ color: presetCfg.color }}>{presetCfg.label}</span></> : null}…
            </span>
          </div>
        </div>
      </div>
    )
  }

  if (step === 'add-custom') {
    return (
      <div className="dialog-overlay" onClick={onCancel}>
        <div className="dialog" onClick={(e) => e.stopPropagation()}>
          <button className="dialog-back" onClick={() => setStep('select-ai')}>← Back</button>
          <h2 className="dialog-title">Add Custom CLI</h2>
          <div className="flex flex-col gap-2.5">
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
              <p className={SECTION_LABEL_CLASS} style={{ color: 'var(--text-muted)' }}>Color</p>
              <div className="flex gap-1.5 flex-wrap">
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
              className="btn-primary mt-1"
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
              <div className="bg-warn/10 border border-warn rounded-md px-3 py-2 mb-3 text-fs-xs text-warn">
                ⚠ Couldn't detect Windows shells: {shellsError}
              </div>
            )}
            <div className="grid grid-cols-4 gap-2 mb-4">
              {PICKER_AI_TYPES.map((aiType) => {
                const cfg = AI_CONFIG[aiType]
                const Logo = AI_LOGOS[aiType]
                return (
                  <button
                    key={aiType}
                    className="ai-card group"
                    style={{ '--ai-color': cfg.color } as React.CSSProperties}
                    onClick={() => selectAI(aiType)}
                  >
                    <div className="ai-card-logo">
                      {Logo
                        ? <Logo size={36} color={cfg.color} />
                        : <TerminalIcon size={36} color={cfg.color} />
                      }
                    </div>
                    <span className={AI_CARD_LABEL_CLASS}>{cfg.label}</span>
                  </button>
                )
              })}
              {customCLIs.map((cli) => (
                <button
                  key={cli.id}
                  className="ai-card group"
                  style={{ '--ai-color': cli.color } as React.CSSProperties}
                  onClick={() => selectCustomCLI(cli)}
                >
                  <div className="ai-card-logo relative">
                    <CustomCLIIcon size={36} color={cli.color} />
                    <button
                      className="hidden group-hover:flex absolute -top-1.5 -right-1.5 size-4 rounded-full items-center justify-center bg-accent text-fs-sm leading-none text-muted-foreground hover:bg-destructive/20 hover:text-destructive z-10"
                      onClick={(e) => deleteCustomCLI(cli.id, e)}
                      title="Remove"
                    >×</button>
                  </div>
                  <span className={AI_CARD_LABEL_CLASS}>{cli.label}</span>
                </button>
              ))}
              <button
                className="ai-card ai-card-add group"
                onClick={() => setStep('add-custom')}
              >
                <div className="ai-card-logo">
                  <span className="text-fs-2xl" style={{ color: 'var(--text-muted)' }}>+</span>
                </div>
                <span className={AI_CARD_LABEL_CLASS} style={{ color: 'var(--text-muted)' }}>Add CLI</span>
              </button>
            </div>
            <button className="dialog-cancel" onClick={onCancel}>Cancel</button>
          </>
        ) : step === 'select-shell' ? (
          <>
            <button className="dialog-back" onClick={() => setStep('select-ai')}>← Back</button>
            <h2 className="dialog-title">Choose shell</h2>
            <div className="grid grid-cols-4 gap-2 mb-4">
              {shells.map((shell) => {
                const color = SHELL_COLORS[shell.id] ?? 'var(--muted-foreground)'
                return (
                  <button
                    key={`shell-${shell.id}`}
                    className="ai-card group"
                    style={{ '--ai-color': color } as React.CSSProperties}
                    onClick={() => selectShell(shell)}
                    title={`Open ${shell.label}`}
                  >
                    <div className="ai-card-logo">
                      <TerminalIcon size={36} color={color} />
                    </div>
                    <span className={AI_CARD_LABEL_CLASS}>{shell.label}</span>
                  </button>
                )
              })}
              <button
                className="ai-card group"
                style={{ '--ai-color': 'var(--muted-foreground)' } as React.CSSProperties}
                onClick={() => onConfirm('terminal', 'default', '', 'var(--muted-foreground)', '')}
                title="System default shell"
              >
                <div className="ai-card-logo">
                  <TerminalIcon size={36} color="var(--muted-foreground)" />
                </div>
                <span className={AI_CARD_LABEL_CLASS}>Default</span>
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

            {AI_CONFIG[selectedAI!]?.models?.length ? (
              <div className="mb-4">
                <p className={SECTION_LABEL_CLASS} style={{ color: 'var(--text-muted)' }}>Model</p>
                <select
                  aria-label="Model"
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  className="w-full bg-popover border border-border rounded-lg px-3 py-2 text-foreground text-fs outline-none cursor-pointer transition-colors focus:border-primary"
                >
                  <option value="">Default model</option>
                  {AI_CONFIG[selectedAI!]!.models!.map((m) => (
                    <option key={m} value={m}>{m}</option>
                  ))}
                </select>
              </div>
            ) : null}

            {/* CLI detection banner */}
            {/* Cursor solo se instala bajando y ejecutando un script. Ese patron
                (`curl | bash`, `irm | iex`) es el que Defender levanta como
                troyano, asi que no lo ejecutamos en ningun SO: va a la web. */}
            {cliFound === false && selectedAI && CLI_INSTALL[selectedAI] && (
              <div className={cn(
                'rounded-md px-3 py-2.5 mb-3 text-fs-xs border',
                installState === 'done' || (installState === 'error' && installReason === 'not-on-path')
                  ? 'bg-ok/10 border-ok'
                  : installState === 'error'
                    ? 'bg-destructive/10 border-destructive'
                    : 'bg-warn/10 border-warn',
              )}>
                {installState === 'idle' && (
                  <>
                    <div className="text-warn font-semibold mb-1.5">
                      ⚠ {AI_CONFIG[selectedAI].label} CLI not found
                    </div>
                    <div className="text-muted-foreground mb-2">
                      {manualInstall
                        ? 'This one installs from its website.'
                        : 'Raven Nest can install it for you.'}
                    </div>
                    <div className="flex items-center gap-1.5">
                      {!manualInstall && (
                        <button
                          className="bg-warn text-background rounded-sm px-3 py-1 text-fs-xs font-semibold cursor-pointer shrink-0 transition hover:brightness-110"
                          onClick={installCli}
                        >
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
                    <div className="flex items-center gap-1.5 mb-0.5">
                      <span className="inline-block size-3 shrink-0 rounded-full border-2 border-warn border-t-transparent animate-spin" />
                      <div className="text-warn font-semibold flex-1">
                        Installing {AI_CONFIG[selectedAI].label} CLI…
                      </div>
                      <button
                        className="bg-transparent text-muted-foreground border border-border rounded-sm px-2.5 py-1 text-fs-xs cursor-pointer shrink-0"
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
                    <div className="text-ok font-semibold mb-1">
                      ✓ {AI_CONFIG[selectedAI].label} CLI installed
                    </div>
                    <div className="text-muted-foreground">Opening {AI_CONFIG[selectedAI].label}…</div>
                  </>
                )}

                {installState === 'error' && installReason === 'not-on-path' && (
                  <>
                    <div className="text-ok font-semibold mb-1.5">
                      ✓ {AI_CONFIG[selectedAI].label} CLI installed
                    </div>
                    <div className="text-muted-foreground mb-2">
                      Restart Raven Nest to pick it up.
                    </div>
                    <div className="flex items-center gap-1.5">
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
                    <div className="text-destructive font-semibold mb-1.5">
                      ✗ Install failed
                    </div>
                    <div className="text-muted-foreground mb-2">
                      Try it manually:
                    </div>
                    <div className="flex items-center gap-1.5">
                      <code className="flex-1 bg-background border border-border rounded-sm px-2 py-1 text-foreground text-fs-xs font-mono overflow-hidden text-ellipsis whitespace-nowrap">
                        {installCmdFor(CLI_INSTALL[selectedAI]!, isWindows)}
                      </code>
                      <button
                        className={cn(
                          'border-none rounded-sm px-2.5 py-1 text-fs-xs cursor-pointer shrink-0',
                          copied ? 'bg-ok text-background' : 'bg-accent text-foreground',
                        )}
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
                className="btn-primary w-full mb-2"
                onClick={() => {
                  const cfg = AI_CONFIG[selectedAI!]
                  onConfirm(selectedAI!, 'default', '', cfg.color, appendModelFlag(cfg.cmd, cfg.modelFlag, model))
                }}
              >
                Open anyway
              </button>
            )}

            {accounts.length > 0 && !AI_CONFIG[selectedAI!]?.noAccount && (
              <div className="mb-5">
                <p className={SECTION_LABEL_CLASS} style={{ color: 'var(--text-muted)' }}>Saved accounts</p>
                {accounts.map((name) => (
                  <button
                    key={name}
                    className="group w-full bg-popover border border-border rounded-lg px-3.5 py-2.5 text-foreground text-fs cursor-pointer flex items-center gap-2.5 mb-1.5 relative text-left transition-colors hover:bg-border hover:border-primary"
                    onClick={() => selectAccount(name)}
                  >
                    <span className="size-2 rounded-full shrink-0" style={{ background: borderColor }} />
                    <span className="flex-1 text-left">{name}</span>
                    <span
                      className="shrink-0 size-5 flex items-center justify-center rounded-sm text-fs opacity-0 transition-colors cursor-pointer group-hover:opacity-100 text-[var(--text-muted)] hover:text-destructive hover:bg-destructive/10"
                      role="button"
                      onClick={(e) => { e.stopPropagation(); setConfirmDelete({ type: 'account', name }) }}
                      title="Delete account and local folder"
                    >×</span>
                  </button>
                ))}
              </div>
            )}

            {selectedAI && !AI_CONFIG[selectedAI].noAccount && <div className="new-account-form">
              <p className={SECTION_LABEL_CLASS} style={{ color: 'var(--text-muted)' }}>New account</p>
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
              <p className={SECTION_LABEL_CLASS} style={{ color: 'var(--text-muted)' }}>Border color</p>
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
