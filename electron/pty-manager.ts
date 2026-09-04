import { EventEmitter } from 'events'
import { join } from 'path'
import { mkdirSync } from 'fs'
import * as fs from 'fs'
import * as pty from 'node-pty'
import { SHELL, SHELL_ARGS, isWin, isMac } from './platform'
import { ravenHome, userHome } from './raven-home'

async function cwdReachable(p: string): Promise<boolean> {
  try {
    await Promise.race([
      fs.promises.stat(p),
      new Promise<never>((_, rej) => setTimeout(() => rej(new Error('timeout')), 1500))
    ])
    return true
  } catch { return false }
}

export interface ShellOverride {
  bin: string
  args: string[]
}

/**
 * Nest Memory integration point (docs/nest-memory-architecture.md §2.5). Injected as a
 * constructor dependency rather than imported directly so existing PtyManager tests
 * (worktree-integration, etc.) keep working with `new PtyManager()` and no memory
 * wiring at all.
 */
export interface PtyMemoryIntegration {
  socketPath: string
  /** C2: shared secret injected as NEST_MEMORY_TOKEN — see memory-local-auth.ts. */
  authToken: string
  isEnabled: () => boolean
  /**
   * M11 fix: this used to be `getClaudeSettingsFlagArgs`, a READ-ONLY check of whether
   * `.nest/memory-settings.json` already existed — nothing ever actually called
   * `provisionClaudeAccount` here. An account created before Connect Memory, or one
   * whose provisioning failed once (disk error, race with account creation), silently
   * never got the `--settings` flag or working hooks, forever, with no retry. Per
   * §2.5 ("defensively from PtyManager.create() before spawn"), this is now the
   * (idempotent) provisioning call itself — every AI pane spawn is the one integration
   * point that can self-heal a missing/stale provisioning state.
   *
   * Generalized (multi-AI memory registry, Step 1): this used to be
   * `ensureClaudeProvisioned(accountDir): string[]`, hardcoded to Claude. Dispatch by
   * binary name now lives in the caller (main.ts, via `adapterForBin` from
   * memory-cli-adapters.ts), so pty-manager.ts calls this the same way for every AI
   * type and needs no change when a Gemini/Codex adapter is registered — an
   * unrecognized `bin` simply comes back as `{args: [], env: {}}`, a no-op.
   */
  ensureProvisioned: (bin: string, accountDir: string) => { args: string[]; env: Record<string, string> }
}

const BUFFER_MAX_LINES = 10_000

/**
 * Minor hardening: `launchCmd` is typed literally into the shell via `ptyProcess.write()`
 * (see below), so a `--settings <path>` argument must be safely quoted for the
 * platform's shell — a path or account name containing a literal `"` would otherwise
 * break out of the quoted argument. PowerShell escapes an embedded `"` inside a
 * double-quoted string as `""`; POSIX shells (bash/zsh) escape it as `\"`.
 */
export function quoteShellArg(value: string, isWinShell: boolean): string {
  const escaped = isWinShell ? value.replace(/"/g, '""') : value.replace(/(["\\$`])/g, '\\$1')
  return `"${escaped}"`
}

/**
 * accountDir is always `{ravenHome}/.raven-nest/accounts/{aiType}/{accountName}` (see
 * account-store.ts `getDir`). Parsing it here — rather than widening
 * `PtyManager.create()`'s signature to take aiType/accountName explicitly — keeps every
 * existing call site (main.ts's `pty:create` handler, and transitively preload/renderer)
 * unchanged. docs/nest-memory-architecture.md §2.5 calls the signature-change path
 * "cleaner" but explicitly allows derivation from accountDir as the alternative.
 */
export function parseAccountDir(accountDir: string): { aiType: string; accountName: string } | null {
  const parts = accountDir.split(/[\\/]/).filter(Boolean)
  const idx = parts.lastIndexOf('accounts')
  if (idx === -1 || idx + 2 >= parts.length) return null
  return { aiType: parts[idx + 1], accountName: parts[idx + 2] }
}

/**
 * Provisioning target for an AI pane that runs with the REAL home — a headless graph
 * node whose agent has no saved account (main.ts's `accountDirForAgent` returns '' and
 * PtyManager deliberately does NOT redirect HOME, so the CLI keeps its own credentials).
 *
 * MEMORY_INTEGRATIONS_CONTRACT §3.2: the memory block used to live inside
 * `if (accountDir && cmd)`, so those nodes fell out of memory entirely. They need a
 * place to hold the Nest-owned hooks/MCP files, and it must NOT be the user's real home
 * — provisioning there would write `mcpServers.nest_memory` into the machine's global
 * ~/.claude.json. This dir is inside Nest's own storage root, shaped like any account
 * dir so `parseAccountDir` reads provenance out of it (`claude:__headless__`).
 */
export function headlessAccountDir(aiType: string): string {
  return join(ravenHome(), '.raven-nest', 'accounts', aiType, '__headless__')
}

export class PtyManager extends EventEmitter {
  private ptys = new Map<string, pty.IPty>()
  private buffers = new Map<string, string[]>()
  // Ultimo tamano REALMENTE enviado al pty, por pane. El renderer pide resize
  // en cada cambio de pixeles del contenedor (ResizeObserver), asi que llegan
  // muchos con cols/rows identicos; reenviarlos igual le llega al proceso como
  // un cambio de tamano y las TUIs tipo Ink (Claude Code) repintan su bloque
  // estatico, acumulando el banner de arranque una y otra vez.
  private lastSize = new Map<string, { cols: number; rows: number }>()
  // Un drag o un resize de split hace pasar al pane por decenas de tamanos
  // REALES distintos, uno por frame. Mandarlos todos hace repintar la TUI en
  // cada paso (el banner de Claude Code se multiplicaba, cada copia con un
  // ancho distinto), asi que esperamos a que el tamano se quede quieto y
  // mandamos solo el ultimo.
  private static readonly MIN_COLS = 20
  private static readonly MIN_ROWS = 5
  private static readonly RESIZE_SETTLE_MS = 150
  private resizeTimers = new Map<string, ReturnType<typeof setTimeout>>()
  private pendingSize = new Map<string, { cols: number; rows: number }>()
  // cwd at spawn time, per pane. Used by `killByCwdPrefix` so worktree:remove
  // can tear down every PTY whose working directory is inside the worktree
  // being deleted — otherwise Windows holds the directory handle open and
  // `rmSync` fails with EBUSY but the meta gets deleted anyway (ghost dir).
  private cwdByPaneId = new Map<string, string>()
  // Pending "write the cmd after shell warms up" timers per pane. Cleared on
  // kill() and on onExit so a teardown during the 3 s Windows delay doesn't
  // fire a write into a dead (or recreated) PTY.
  private startupTimers = new Map<string, NodeJS.Timeout>()
  private memory?: PtyMemoryIntegration

  constructor(memory?: PtyMemoryIntegration) {
    super()
    this.memory = memory
  }

  /** Late-binds the memory integration when it can't be ready at PtyManager construction
   *  time (main.ts constructs ptyManager before the memory subsystem). */
  setMemoryIntegration(memory: PtyMemoryIntegration): void {
    this.memory = memory
  }

  async create(paneId: string, cmd: string, accountDir: string, repoPath?: string, shell?: ShellOverride): Promise<{ ok: true } | { ok: false; error: string }> {
    if (this.ptys.has(paneId)) return { ok: true }  // already running, don't recreate

    const env: Record<string, string> = {
      ...process.env as Record<string, string>,
      TERM: 'xterm-256color',
      COLORTERM: 'truecolor',
    }

    // macOS: Electron inherits a minimal PATH from launchd. ~/.local/bin and
    // other user dirs only get added by .zshrc, which node-pty's login shell
    // may not source reliably. Inject them directly into the PTY env so tools
    // like claude, pipx, cargo, etc. are always found regardless of shell state.
    if (isMac) {
      const home = env.HOME || ''
      const extra = [
        `${home}/.local/bin`,
        '/opt/homebrew/bin',
        '/opt/homebrew/sbin',
        '/usr/local/bin',
      ].filter(Boolean)
      const current = (env.PATH || '').split(':').filter(Boolean)
      const toAdd = extra.filter(p => !current.includes(p))
      if (toAdd.length) env.PATH = [...toAdd, ...current].join(':')
    }

    let launchCmd = cmd

    // Only redirect HOME for AI agent panes — plain terminals keep the real HOME
    // so system credentials (gh, git, ssh, etc.) work without reconfiguration.
    if (accountDir && cmd) {
      mkdirSync(accountDir, { recursive: true })
      env.HOME = accountDir
      if (isWin) {
        env.USERPROFILE = accountDir
        // HOMEDRIVE and HOMEPATH are also read by git, npm, and some AI CLIs on Windows
        const driveSep = accountDir.indexOf(':')
        if (driveSep !== -1) {
          env.HOMEDRIVE = accountDir.slice(0, driveSep + 1)
          env.HOMEPATH = accountDir.slice(driveSep + 1)
        }
      }

      // Gemini needs its own config subdir
      if (cmd === 'gemini') {
        const geminiHome = join(accountDir, 'gemini')
        mkdirSync(geminiHome, { recursive: true })
        env.GEMINI_CLI_HOME = geminiHome
      }

      // macOS: AI CLIs (Claude, etc.) build keychain paths from $HOME, but the
      // real login keychain lives in the actual user home. Symlink
      // accountDir/Library/Keychains → ~/Library/Keychains so credential
      // managers find the login keychain even with HOME redirected.
      if (isMac) {
        const realKeychains = join(userHome(), 'Library', 'Keychains')
        const localKeychains = join(accountDir, 'Library', 'Keychains')
        if (fs.existsSync(realKeychains) && !fs.existsSync(localKeychains)) {
          try {
            mkdirSync(join(accountDir, 'Library'), { recursive: true })
            fs.symlinkSync(realKeychains, localKeychains)
          } catch { /* race or already exists — ignore */ }
        }
      }

    } else if (accountDir) {
      mkdirSync(accountDir, { recursive: true })
    }

    // Nest Memory: env injection at PtyManager.create() (§2.5) — the one place every
    // AI pane passes through, same reasoning as the HOME rewrite above. env is injected
    // for every AI type; provisioning itself is dispatched generically by binary name
    // through the adapter registry (memory-cli-adapters.ts, via `ensureProvisioned` on
    // this integration). Phase 1 only registers 'claude' there, so a bin with no
    // adapter comes back as `{args: [], env: {}}` and launchCmd is left untouched —
    // same observable behavior as before this file knew Codex/Gemini could exist.
    //
    // §3.2 fix: this deliberately sits OUTSIDE the `accountDir` branch above. Memory is
    // not a consequence of the HOME redirection — a headless graph node runs with the
    // real HOME and an empty accountDir, and used to be skipped in silence.
    if (cmd && this.memory) {
      // §3.1 fix: match the BINARY, not the whole command. The graph orchestrator
      // launches nodes with `claude --model <x>` (graph-tick.ts `launchCommand`), and a
      // plain `cmd === 'claude'` comparison would miss exactly those.
      const bin = cmd.split(' ')[0]
      // Only a plain binary name can name a headless dir; anything else (a path, a
      // shell fragment) would let cmd steer where we write.
      const memoryHome = accountDir || (/^[A-Za-z0-9_-]+$/.test(bin) ? headlessAccountDir(bin) : '')
      const parsed = memoryHome ? parseAccountDir(memoryHome) : null
      if (parsed) {
        env.NEST_MEMORY_SOCKET = this.memory.socketPath
        env.NEST_MEMORY_TOKEN = this.memory.authToken
        env.NEST_MEMORY_ACCOUNT = `${parsed.aiType}:${parsed.accountName}`
        env.NEST_MEMORY_AI = parsed.aiType
        env.NEST_MEMORY_PANE = paneId
        env.NEST_MEMORY_ENABLED = this.memory.isEnabled() ? '1' : '0'

        // §2.5 "the shared-config hazard": hooks load ONLY via the isolated
        // --settings file, never by writing accountDir/.claude/settings.json.
        // M11: ensureProvisioned (RE-)PROVISIONS the account, not just checks it.
        if (this.memory.isEnabled()) {
          const { args: extraArgs, env: extraEnv } = this.memory.ensureProvisioned(bin, memoryHome)
          Object.assign(env, extraEnv)
          if (extraArgs.length > 0) {
            const args = [...extraArgs]
            // With the real HOME, claude reads ITS ~/.claude.json, never the headless
            // one the provisioner just wrote — so the MCP server has to be named
            // explicitly. Not needed for an account pane, where HOME is the account dir.
            // Claude-specific — Gemini/Codex use their own isolated-home mechanism
            // (GEMINI_CLI_HOME above, etc.) and don't need this; not generalized yet.
            if (bin === 'claude' && !accountDir) args.push('--mcp-config', join(memoryHome, '.claude.json'))
            const quoted = args.map((a) => (a.startsWith('-') ? a : quoteShellArg(a, isWin)))
            // Insert the flags after the binary instead of rebuilding the command, so
            // the caller's own arguments (--model, --print, …) survive.
            const rest = cmd.slice(bin.length).trimStart()
            launchCmd = rest ? `${bin} ${quoted.join(' ')} ${rest}` : `${bin} ${quoted.join(' ')}`
          }
        }
      }
    }

    const spawnBin = shell?.bin ?? SHELL
    const spawnArgs = shell?.args ?? SHELL_ARGS

    // Resolve cwd with existence check. CreateProcess on Windows fails with
    // ERROR_DIRECTORY (code 267) if cwd is missing — common when a tab persists
    // a repoPath that was later deleted. Fall back to the real user home via
    // userHome() (which un-nests but ignores RAVEN_HOME — RAVEN_HOME is for
    // storage redirection, not for cwd). Never accountDir — that's the AI's
    // config dir, not a meaningful working directory.
    let cwd = repoPath || userHome()
    if (!(await cwdReachable(cwd))) {
      console.warn('[pty-manager] cwd not reachable, falling back to userHome', { paneId, requested: cwd })
      cwd = userHome()
    }

    try {
      const ptyProcess = pty.spawn(spawnBin, spawnArgs, {
        name: 'xterm-256color',
        cols: 120,
        rows: 30,
        env,
        cwd,
      })

      // Launch AI command after shell starts (skip if plain terminal).
      // On Windows, PowerShell takes 1-2s to initialise and writing blindly
      // before the prompt appears means the keystrokes get eaten. Poll: wait
      // for the first `data` event from the pty (which means PowerShell has
      // printed its prompt), then write the cmd. Keep a 5s safety timeout in
      // case data never arrives (e.g. silent shell). On non-Windows we keep
      // the short 500ms delay because POSIX shells warm up fast.
      if (cmd) {
        let primed = false
        const writeCmd = () => {
          if (primed) return
          primed = true
          this.startupTimers.delete(paneId)
          // Only write if the slot still owns THIS pty. A kill→create race
          // between scheduling and firing would otherwise write the cmd into
          // a fresh pty that wasn't asked to run it.
          if (this.ptys.get(paneId) === ptyProcess) {
            ptyProcess.write(`${launchCmd}\r`)
          }
        }
        if (isWin) {
          ptyProcess.onData(() => writeCmd())
          const timer = setTimeout(writeCmd, 5000)
          this.startupTimers.set(paneId, timer)
        } else {
          const timer = setTimeout(writeCmd, 500)
          this.startupTimers.set(paneId, timer)
        }
      }

      ptyProcess.onData((data) => {
        this.emit('data', paneId, data)
        const lines = this.buffers.get(paneId) ?? []
        lines.push(data)
        if (lines.length > BUFFER_MAX_LINES) lines.splice(0, lines.length - BUFFER_MAX_LINES)
        this.buffers.set(paneId, lines)
      })

      ptyProcess.onExit((e) => {
        // Identity guard: if a kill→create raced, the slot is already owned by a new
        // process. Don't wipe its state or fire 'exit' for a stale paneId.
        const current = this.ptys.get(paneId)
        if (current && current !== ptyProcess) return
        // Clear any pending startup-write timer for THIS pty before tearing
        // down — otherwise a delayed write could land in the next pane that
        // reuses the paneId.
        const pending = this.startupTimers.get(paneId)
        if (pending) {
          clearTimeout(pending)
          this.startupTimers.delete(paneId)
        }
        this.ptys.delete(paneId)
        this.buffers.delete(paneId)
        this.lastSize.delete(paneId)
        this.clearPendingResize(paneId)
        // exitCode: forwarded so callers (graph orchestration) can distinguish
        // a clean exit from a crash without polling — see main.ts's paneExitCode.
        this.emit('exit', paneId, e.exitCode)
      })

      this.ptys.set(paneId, ptyProcess)
      this.cwdByPaneId.set(paneId, cwd)
      return { ok: true }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.error('[pty-manager] spawn failed', { paneId, spawnBin, spawnArgs, error: message })
      return { ok: false, error: message }
    }
  }

  write(paneId: string, data: string): void {
    this.ptys.get(paneId)?.write(data)
  }

  resize(paneId: string, cols: number, rows: number, source?: string): void {
    if (!this.ptys.has(paneId)) return
    // Un panel colapsado a su minSize mide ~15 columnas y el reflow deja
    // formas de 4-6 filas. No son tamanos de trabajo: aplicarlos hace que la
    // TUI repinte en una tira vertical de 4 caracteres y esa basura queda en
    // el scrollback para siempre. Que el pty conserve el ultimo tamano usable
    // es preferible a corromper la sesion (mismo criterio que la guarda del
    // 2x1 en useXterm).
    if (cols < PtyManager.MIN_COLS || rows < PtyManager.MIN_ROWS) {
      console.log(`[resize-trace] SKIP pane=${paneId} ${cols}x${rows} (degenerado) from=${source ?? '?'}`)
      return
    }
    // TRAZA temporal: quien pide cada resize y cual termina llegando al proceso.
    console.log(`[resize-trace] req  pane=${paneId} ${cols}x${rows} from=${source ?? '?'}`)
    const last = this.lastSize.get(paneId)
    if (last && last.cols === cols && last.rows === rows) {
      // Volvio al tamano que el pty ya tiene: lo que estuviera agendado sobra.
      this.clearPendingResize(paneId)
      return
    }
    this.pendingSize.set(paneId, { cols, rows })
    const prev = this.resizeTimers.get(paneId)
    if (prev) clearTimeout(prev)
    this.resizeTimers.set(paneId, setTimeout(() => this.flushResize(paneId), PtyManager.RESIZE_SETTLE_MS))
  }

  private clearPendingResize(paneId: string): void {
    const t = this.resizeTimers.get(paneId)
    if (t) clearTimeout(t)
    this.resizeTimers.delete(paneId)
    this.pendingSize.delete(paneId)
  }

  private flushResize(paneId: string): void {
    this.resizeTimers.delete(paneId)
    const size = this.pendingSize.get(paneId)
    this.pendingSize.delete(paneId)
    if (!size) return
    const ptyProc = this.ptys.get(paneId)
    if (ptyProc) {
      const last = this.lastSize.get(paneId)
      if (last && last.cols === size.cols && last.rows === size.rows) return
      this.lastSize.set(paneId, size)
      console.log(`[resize-trace] APPLY pane=${paneId} ${size.cols}x${size.rows}`)
      try {
        ptyProc.resize(size.cols, size.rows)
      } catch (err) {
        // Resize on an exited PTY is the common case during teardown — keep it
        // as debug (not warn) so we don't spam main.log, but DO log it so a
        // genuinely broken resize (e.g. conpty hiccup on live pane) leaves a
        // breadcrumb instead of vanishing.
        console.debug('[pty-manager] resize failed', paneId, err instanceof Error ? err.message : err)
      }
    }
  }

  exists(paneId: string): boolean {
    return this.ptys.has(paneId)
  }

  getPid(paneId: string): number | undefined {
    return this.ptys.get(paneId)?.pid
  }

  /**
   * Snapshot of every live pane's PID. Used by the BrowserCell port dropdown
   * to enumerate all listening ports across the whole app without depending
   * on the renderer's view of which panes exist.
   */
  getAllPids(): Array<{ paneId: string; pid: number }> {
    const out: Array<{ paneId: string; pid: number }> = []
    for (const [paneId, pty] of this.ptys) {
      if (Number.isFinite(pty.pid) && pty.pid > 0) {
        out.push({ paneId, pid: pty.pid })
      }
    }
    return out
  }

  getBuffer(paneId: string): string {
    return (this.buffers.get(paneId) ?? []).join('')
  }

  kill(paneId: string): void {
    // Clear any pending startup-write timer FIRST. If the pane is killed
    // before the 3 s Windows warmup elapses, the timer would otherwise fire a
    // write into a dead (or recreated) pty.
    const pending = this.startupTimers.get(paneId)
    if (pending) {
      clearTimeout(pending)
      this.startupTimers.delete(paneId)
    }
    const ptyProc = this.ptys.get(paneId)
    if (ptyProc) {
      try { ptyProc.kill() } catch { /* already dead */ }
      this.ptys.delete(paneId)
    }
    this.buffers.delete(paneId)
    this.lastSize.delete(paneId)
    this.clearPendingResize(paneId)
    this.cwdByPaneId.delete(paneId)
  }

  killAll(): void {
    for (const id of this.ptys.keys()) this.kill(id)
  }

  /**
   * Kill every pane whose cwd lives inside `prefix`. Returns the paneIds that
   * were killed. Used by `worktree:remove` so Windows doesn't hit EBUSY when
   * deleting a worktree directory that a PowerShell pane is currently sitting
   * inside.
   */
  killByCwdPrefix(prefix: string): string[] {
    const norm = (p: string) => p.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
    const target = norm(prefix)
    const targetSlash = target + '/'
    const killed: string[] = []
    for (const [paneId, cwd] of Array.from(this.cwdByPaneId.entries())) {
      const cwdN = norm(cwd)
      if (cwdN === target || cwdN.startsWith(targetSlash)) {
        this.kill(paneId)
        killed.push(paneId)
      }
    }
    return killed
  }
}
