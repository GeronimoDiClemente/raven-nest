import { app, BrowserWindow, ipcMain, shell, nativeImage, dialog, session, safeStorage, clipboard } from 'electron'
import { autoUpdater } from 'electron-updater'
import { resolve as pathResolve } from 'path'

// Swallow stdout EPIPE — happens when the parent terminal closes while the
// app keeps running. A single console.log that writes to a closed stdout
// would otherwise propagate as uncaughtException and kill the main process.
process.stdout.on('error', (err) => { if ((err as NodeJS.ErrnoException).code !== 'EPIPE') throw err })
process.stderr.on('error', (err) => { if ((err as NodeJS.ErrnoException).code !== 'EPIPE') throw err })
process.on('uncaughtException', (err) => {
  if ((err as NodeJS.ErrnoException).code === 'EPIPE') return
  throw err
})

// Single instance lock — ensures deep links route to existing window
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) { app.quit() }

// Buffer deep link URL received before renderer is ready
let pendingDeepLink: string | null = null

// Register custom protocol for OAuth deep links (nest://auth/callback)
// In dev, process.argv[1] is the entry script path — resolve to absolute so
// Windows can locate it when launching the app from a deep link (otherwise
// cwd defaults to C:\WINDOWS\system32 and the relative path breaks).
if (process.defaultApp) {
  if (process.argv.length >= 2) {
    app.setAsDefaultProtocolClient('nest', process.execPath, [pathResolve(process.argv[1])])
  }
} else {
  app.setAsDefaultProtocolClient('nest')
}
import { join as pathJoin, join, isAbsolute, basename, dirname } from 'path'
import { readFileSync, writeFileSync, mkdirSync, statSync, copyFileSync, unlinkSync, rmSync, existsSync } from 'fs'
import { tmpdir, homedir } from 'os'
import { ravenHome, userHome } from './raven-home'
import { execSync, execFile, execFileSync } from 'child_process'
import { randomBytes } from 'crypto'
import { PtyManager } from './pty-manager'
import { detectShells, getShellById } from './shell-detect'
import { AccountStore, detachClaudeConfig } from './account-store'
import { CustomCLIStore } from './custom-cli-store'
import { SnippetStore } from './snippet-store'
import { ConversationStore } from './conversation-store'
import { WorkspaceStore } from './workspace-store'
import { WorktreeStore } from './worktree-store'
import { PresetStore } from './preset-store'
import { SetupRunner } from './setup-runner'
import { scanPid } from './port-monitor'
// pidtree resolves a pid's full descendant tree. Used so port scans cover the
// actual server (a child of the PowerShell shell), not just the shell itself.
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import pidtree from 'pidtree'
import { BrowserPaneManager } from './browser-pane-manager'
import { SpotlightEngine } from './spotlight-engine'
import { BenchmarkRecorder } from './benchmark-recorder'
import { getDiff } from './diff-engine'
import { detectIDEs, openInIDE, clearCache as clearIDECache } from './ide-launcher'
import { MCPStore } from './mcp-store'
import { SettingsStore } from './settings-store'
import { MetricsCollector, PaneInput } from './metrics-collector'
import { transcribeAudio, checkWhisperAvailable, initWhisper, shutdownWhisper, setWhisperStatusCallback } from './whisper'
import { getWindowOptions, getIconsDir, ICON_FILENAME, isMac } from './platform'
import { createTray } from './tray'

const ptyManager = new PtyManager()
const accountStore = new AccountStore()
// Ensure every existing Claude account has the shared config (CLAUDE.md,
// settings.json, skills, etc.) linked from ~/.claude. Idempotent — only
// fills in missing links, never replaces a user's real file or dir.
accountStore.migrateClaudeAccounts()
const customCLIStore = new CustomCLIStore()
const snippetStore = new SnippetStore()
const conversationStore = new ConversationStore()
const workspaceStore = new WorkspaceStore()
const worktreeStore = new WorktreeStore(pathJoin(ravenHome(), '.raven-nest'))
const presetStore = new PresetStore()
const setupRunner = new SetupRunner()
const browserPanes = new BrowserPaneManager(() => BrowserWindow.getAllWindows()[0] ?? null)
const spotlight = new SpotlightEngine()
const benchmark = new BenchmarkRecorder()
const metricsCollector = new MetricsCollector()

spotlight.on('start', (wt: string) => broadcast('spotlight:status', { active: true, worktreePath: wt }))
spotlight.on('stop', () => broadcast('spotlight:status', { active: false }))
spotlight.on('warning', (msg: string) => broadcast('spotlight:warning', msg))
const mcpStore = new MCPStore()
const settingsStore = new SettingsStore()

function broadcast(channel: string, ...args: unknown[]): void {
  const win = BrowserWindow.getAllWindows()[0]
  if (win) win.webContents.send(channel, ...args)
}

setupRunner.on('progress', (worktreePath: string, line: string) => {
  broadcast('preset:setupProgress', worktreePath, line)
  const meta = worktreeStore.get(worktreePath)
  if (meta) {
    const log = meta.setupLog ? `${meta.setupLog}\n${line}` : line
    const lines = log.split('\n')
    const trimmed = lines.length > 200 ? lines.slice(lines.length - 200).join('\n') : log
    worktreeStore.setMeta({ ...meta, setupLog: trimmed })
  }
})

setupRunner.on('state', (worktreePath: string, state: 'running' | 'done' | 'failed' | 'cancelled') => {
  broadcast('preset:setupState', worktreePath, state)
  const meta = worktreeStore.get(worktreePath)
  if (meta) worktreeStore.setMeta({ ...meta, setupState: state })
})

function createWindow(): void {
  const iconPath = pathJoin(getIconsDir(), ICON_FILENAME)
  const icon = nativeImage.createFromPath(iconPath)

  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 800,
    minHeight: 600,
    backgroundColor: '#0d0d0d',
    ...getWindowOptions(),
    title: 'Nest',
    icon: icon.isEmpty() ? undefined : icon,
    webPreferences: {
      preload: join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  // Defense in depth: any window.open() from the renderer routes to the
  // system browser instead of creating a child BrowserWindow that would
  // cover the terminals. Localhost clicks in xterm go through the
  // nest:pty-url event channel (see useXterm), not window.open, so they
  // stay internal.
  win.webContents.setWindowOpenHandler(({ url }) => {
    try {
      shell.openExternal(url)
    } catch (err) {
      console.warn('[window-open-handler] openExternal rejected', url, err instanceof Error ? err.message : err)
    }
    return { action: 'deny' }
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(join(__dirname, '../dist/index.html'))
  }

  win.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return

    // Ctrl+Tab / Ctrl+Shift+Tab: Windows reserves these as accelerators and
    // they never reach the renderer keydown listener. Intercept here and
    // forward via IPC so the renderer can run its tab-cycle handler.
    if (input.control && input.key === 'Tab') {
      event.preventDefault()
      win.webContents.send('keybind:tab-cycle', { shift: input.shift })
      return
    }

    // DevTools en dev y prod (F12 y Cmd+Option+I / Ctrl+Alt+I). Útil para
    // diagnosticar problemas visuales sin tener que recompilar.
    if (input.key === 'F12') { win.webContents.openDevTools(); return }
    const trigger = isMac
      ? (input.meta && input.alt && input.key === 'i')
      : (input.control && input.alt && input.key === 'i')
    if (trigger) win.webContents.openDevTools()
  })

  // Hide to tray instead of quitting when user closes the window
  win.on('close', (e) => {
    e.preventDefault()
    win.hide()
    if (isMac) app.dock.hide()
  })
}

// Window control handlers (used by custom titlebar on Windows)
ipcMain.on('window:minimize', () => { BrowserWindow.getFocusedWindow()?.minimize() })
ipcMain.on('window:maximize', () => {
  const w = BrowserWindow.getFocusedWindow()
  if (w) w.isMaximized() ? w.unmaximize() : w.maximize()
})
ipcMain.on('window:close', () => { BrowserWindow.getFocusedWindow()?.close() })

// Conversation IPC handlers
ipcMain.handle('conversations:list', () => conversationStore.list())
ipcMain.handle('conversations:save', (_event, aiType: string, accountName: string, content: string) =>
  conversationStore.save(aiType, accountName, content))
ipcMain.handle('conversations:get', (_event, id: string) => conversationStore.get(id))
ipcMain.handle('conversations:delete', (_event, id: string) => conversationStore.delete(id))
ipcMain.handle('conversations:rename', (_event, id: string, displayName: string) =>
  conversationStore.rename(id, displayName))
ipcMain.handle('conversations:updateIcon', (_event, id: string, iconEmoji: string | null) =>
  conversationStore.updateIcon(id, iconEmoji))

ipcMain.handle('conversations:export', async (_event, id: string) => {
  const content = conversationStore.get(id)
  if (!content) return false
  const meta = conversationStore.list().find(c => c.id === id)
  const defaultName = meta ? `${meta.aiType}${meta.accountName ? `-${meta.accountName}` : ''}-${new Date(meta.timestamp).toISOString().slice(0, 10)}.md` : `${id}.md`
  const { filePath, canceled } = await dialog.showSaveDialog({
    defaultPath: defaultName,
    filters: [{ name: 'Markdown', extensions: ['md'] }],
  })
  if (canceled || !filePath) return false
  writeFileSync(filePath, content)
  return true
})

// Git IPC handlers
ipcMain.handle('git:info', (_event, repoPath: string) => {
  const empty = { branch: null, remoteUrl: null, githubUrl: null, isDirty: false }
  if (!repoPath || typeof repoPath !== 'string' || !isAbsolute(repoPath)) return empty
  try { if (!statSync(repoPath).isDirectory()) return empty } catch { return empty }

  const run = (cmd: string) => {
    try { return execSync(cmd, { cwd: repoPath, encoding: 'utf8', timeout: 3000 }).trim() }
    catch { return null }
  }
  const branch = run('git rev-parse --abbrev-ref HEAD')
  const remoteUrl = run('git remote get-url origin')
  const dirty = run('git status --porcelain')

  let githubUrl: string | null = null
  if (remoteUrl) {
    const ssh = remoteUrl.match(/git@github\.com:(.+?)(?:\.git)?$/)
    const https = remoteUrl.match(/https?:\/\/github\.com\/(.+?)(?:\.git)?$/)
    const path = (ssh || https)?.[1]
    if (path) githubUrl = `https://github.com/${path}`
  }

  return { branch, remoteUrl, githubUrl, isDirty: !!dirty && dirty.length > 0 }
})

ipcMain.handle('git:status', (_event, repoPath: string) => {
  const empty = { files: [], ahead: 0, behind: 0 }
  if (!repoPath || typeof repoPath !== 'string' || !isAbsolute(repoPath)) return empty
  try { if (!statSync(repoPath).isDirectory()) return empty } catch { return empty }

  const run = (cmd: string) => {
    try { return execSync(cmd, { cwd: repoPath, encoding: 'utf8', timeout: 3000 }).trim() }
    catch { return null }
  }

  const porcelain = run('git status --porcelain') ?? ''
  const files = porcelain
    .split('\n')
    .filter(Boolean)
    .map(line => ({ status: line.slice(0, 2).trim(), path: line.slice(3).trim() }))

  const aheadRaw = run('git rev-list --count @{upstream}..HEAD')
  const behindRaw = run('git rev-list --count HEAD..@{upstream}')
  const ahead = aheadRaw ? parseInt(aheadRaw, 10) : 0
  const behind = behindRaw ? parseInt(behindRaw, 10) : 0

  return { files, ahead: isNaN(ahead) ? 0 : ahead, behind: isNaN(behind) ? 0 : behind }
})

// List local branches in a repo + detect the default branch. Used by the
// NewWorktreeModal so the user can pick a base branch other than HEAD.
ipcMain.handle('git:listBranches', async (_evt, repoPath: string) => {
  if (!isAbsolute(repoPath)) throw new Error('repoPath must be absolute')
  if (repoPath.includes('"')) throw new Error('repoPath contains invalid characters')

  let branches: string[] = []
  try {
    // execFileSync (no shell) — same defense as `git:pushBranch` and
    // `parseRemoteOrigin`. The "no double-quotes" guard above doesn't cover
    // backticks/$()/newlines that would break execSync's quoting.
    const out = execFileSync('git', ['-C', repoPath, 'for-each-ref', '--format=%(refname:short)', 'refs/heads/'], {
      encoding: 'utf8',
      timeout: 3000,
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    branches = out.split('\n').map((s) => s.trim()).filter(Boolean)
  } catch {
    return { branches: [], defaultBranch: null }
  }

  let defaultBranch: string | null = null
  try {
    const head = execFileSync('git', ['-C', repoPath, 'symbolic-ref', 'refs/remotes/origin/HEAD'], {
      encoding: 'utf8',
      timeout: 3000,
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim()
    defaultBranch = head.replace(/^refs\/remotes\/origin\//, '')
  } catch {
    // No origin/HEAD set — fall back to the usual suspects.
    if (branches.includes('main')) defaultBranch = 'main'
    else if (branches.includes('master')) defaultBranch = 'master'
    else if (branches.includes('develop')) defaultBranch = 'develop'
    else defaultBranch = branches[0] ?? null
  }

  return { branches, defaultBranch }
})

// Push the worktree's current branch to origin (with -u). Returns a compare
// URL for GitHub so the renderer can offer "Open PR" after a successful push.
ipcMain.handle('git:pushBranch', async (_event, worktreePath: string) => {
  if (!isAbsolute(worktreePath)) throw new Error('worktreePath must be absolute')
  if (worktreePath.includes('"')) throw new Error('worktreePath contains invalid characters')

  if (!existsSync(worktreePath)) {
    return { ok: false as const, error: `Worktree path no longer exists on disk: ${worktreePath}` }
  }

  // Read current branch. Use execFileSync (no shell) — execSync with string
  // interpolation would let a worktreePath/branch with `&` `|` `` ` `` etc.
  // execute arbitrary commands. Branch values come from git itself but we
  // still don't want to trust them blindly: git allows many chars in branch
  // names that are dangerous in a shell context.
  let branch: string
  try {
    branch = execFileSync('git', ['-C', worktreePath, 'rev-parse', '--abbrev-ref', 'HEAD'], {
      encoding: 'utf8',
      timeout: 3000,
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim()
  } catch (err) {
    const raw = err instanceof Error ? err.message : String(err)
    const fatalLine = raw.split('\n').find((l) => l.includes('fatal:'))?.trim()
    const detail = fatalLine ?? raw.split('\n').slice(-2, -1)[0]?.trim() ?? 'unknown git error'
    return { ok: false as const, error: `Failed to read current branch — ${detail}` }
  }
  if (!branch || branch === 'HEAD') {
    return { ok: false as const, error: 'Detached HEAD — no branch to push' }
  }

  try {
    execFileSync('git', ['-C', worktreePath, 'push', '-u', 'origin', branch], {
      encoding: 'utf8',
      timeout: 60000,
      stdio: ['pipe', 'pipe', 'pipe'],
    })
  } catch (err) {
    const raw = err instanceof Error ? err.message : String(err)
    const fatalLine = raw.split('\n').find((l) => l.includes('fatal:') || l.includes('error:'))?.trim()
    return { ok: false as const, error: fatalLine ?? raw }
  }

  let compareUrl: string | undefined
  try {
    const remote = execSync(`git -C "${worktreePath}" remote get-url origin`, {
      encoding: 'utf8',
      timeout: 3000,
    }).trim()
    const gh = remote.match(/github\.com[:/]([^/]+\/[^/.]+)/i)
    const gl = remote.match(/gitlab\.com[:/]([^/]+\/[^/.]+)/i)
    if (gh) compareUrl = `https://github.com/${gh[1]}/pull/new/${encodeURIComponent(branch)}`
    else if (gl) compareUrl = `https://gitlab.com/${gl[1]}/-/merge_requests/new?merge_request[source_branch]=${encodeURIComponent(branch)}`
  } catch {}

  return { ok: true as const, branch, compareUrl }
})

// Clone a GitHub or GitLab repo into ~/RavenProjects/<name> (or a chosen parent dir)
ipcMain.handle('git:clone', async (
  _event,
  cloneUrl: string,
  repoName: string,
  parentDir?: string,
  auth?: { provider: 'github' | 'gitlab'; token: string | null },
) => {
  // Validate URL host. Even with strict validation we use execFile (no shell)
  // below — defense in depth against quoting bypasses on Windows cmd.exe.
  const validHost = typeof cloneUrl === 'string' && (
    cloneUrl.startsWith('https://github.com/') ||
    cloneUrl.startsWith('https://gitlab.com/')
  )
  if (!validHost) {
    return { ok: false, error: 'Invalid URL' }
  }
  // Reject shell metacharacters in the URL itself so a malicious renderer
  // can't smuggle args via a crafted URL even if execFile escaping were bypassed.
  if (/[\s"'`$;&|<>\\]/.test(cloneUrl)) {
    return { ok: false, error: 'Invalid URL' }
  }
  // Validate repoName: must be path segments separated by '/' with no traversal,
  // empty parts, or backslashes. Supports GitLab subgroups like "group/sub/repo".
  if (typeof repoName !== 'string') {
    return { ok: false, error: 'Invalid repoName' }
  }
  const parts = repoName.split('/')
  if (parts.length < 2 || parts.some(p => !p || p === '.' || p === '..' || p.includes('\\'))) {
    return { ok: false, error: 'Invalid repoName' }
  }
  const folderName = parts[parts.length - 1]
  // Use userHome() (real home), not ravenHome() (storage root). When the user
  // runs Nest with RAVEN_HOME pointed at an accountDir to share storage with a
  // parent Nest, ravenHome() returns that accountDir — and clones would land
  // inside .raven-nest/accounts/.../RavenProjects/. Clones are user DATA, not
  // Nest's internal storage, so they belong in the real user home regardless
  // of RAVEN_HOME.
  const baseDir = parentDir && isAbsolute(parentDir)
    ? parentDir
    : pathJoin(userHome(), 'RavenProjects')
  try { mkdirSync(baseDir, { recursive: true }) } catch {}
  const dest = pathJoin(baseDir, folderName)
  // If a directory at `dest` already exists, only adopt it when its `origin`
  // remote matches the URL we're trying to clone. Two different repos with
  // the same last-segment (e.g. `groupA/utils` vs `groupB/utils`) would
  // otherwise collide silently, and the renderer would link the new repo
  // record to the wrong folder — same class of bug as the link-existing
  // mismatch case in `pickRepoFolder`.
  try {
    if (statSync(dest).isDirectory()) {
      let existingRemote: string | null = null
      try {
        existingRemote = execFileSync('git', ['-C', dest, 'remote', 'get-url', 'origin'], {
          encoding: 'utf8', timeout: 3000, stdio: ['pipe', 'pipe', 'pipe'],
        }).trim() || null
      } catch {
        // Not a git repo (or no origin). Treat as collision — don't adopt.
      }
      const norm = (u: string) => u
        .replace(/\.git$/, '')
        .replace(/\/+$/, '')
        .replace(/^https?:\/\/[^@/]+@/, 'https://')
        .toLowerCase()
      if (existingRemote && norm(existingRemote) === norm(cloneUrl)) {
        return { ok: true, path: dest, alreadyExisted: true }
      }
      return {
        ok: false,
        error: `Folder already exists at "${dest}" but its remote ${existingRemote ? `is "${existingRemote}"` : 'is missing'}, not "${cloneUrl}". Choose a different parent dir or remove the existing folder.`,
      }
    }
  } catch {
    // Path doesn't exist — proceed with clone normally.
  }

  // For private repos, inject the OAuth token into the URL just for the clone.
  // After cloning we rewrite the remote to the clean URL so the token never
  // lands in .git/config. Token is rejected if it contains anything other than
  // the GitHub/GitLab token charset (no '@', '/', etc.) to keep the URL safe.
  const tokenSafe = typeof auth?.token === 'string' && /^[A-Za-z0-9_\-.]+$/.test(auth.token)
    ? auth.token
    : null
  let authedUrl = cloneUrl
  if (tokenSafe && auth) {
    const userPart = auth.provider === 'gitlab' ? 'oauth2' : 'x-access-token'
    authedUrl = cloneUrl.replace(/^https:\/\//, `https://${userPart}:${tokenSafe}@`)
  }

  try {
    execFileSync('git', ['clone', authedUrl, dest], {
      encoding: 'utf8',
      timeout: 120000,
      stdio: 'pipe',
    })
    if (tokenSafe) {
      try {
        execFileSync('git', ['-C', dest, 'remote', 'set-url', 'origin', cloneUrl], { stdio: 'pipe' })
      } catch (scrubErr: unknown) {
        // CRITICAL: token is now persisted in .git/config. Try to remove the clone
        // so the user doesn't unknowingly leak credentials. If even that fails,
        // surface a hard error so they can scrub manually.
        const scrubMsg = scrubErr instanceof Error ? scrubErr.message : String(scrubErr)
        console.error('[git:clone] token scrub failed', { dest, error: scrubMsg })
        try { rmSync(dest, { recursive: true, force: true }) } catch {}
        return {
          ok: false,
          error: 'Cloned but failed to remove token from .git/config. The clone was deleted to avoid leaking credentials. Please retry, or run manually: git remote set-url origin <url>',
        }
      }
    }
    return { ok: true, path: dest, alreadyExisted: false }
  } catch (err: unknown) {
    let message = err instanceof Error ? err.message : 'Clone failed'
    // Strip any leaked token from error messages before returning to renderer.
    if (tokenSafe) message = message.replaceAll(tokenSafe, '***')
    return { ok: false, error: message }
  }
})

// Pick a folder for linking an existing local repo. Validates:
//   1. Selected folder is a git repo (.git/ exists). Without this, users can
//      accidentally link a non-repo folder and then "Open terminal" lands in
//      the wrong place forever.
//   2. (optional) Selected folder's `origin` remote matches `expectedRemote`.
//      Without this, the user can pick the WRONG repo's folder and the link
//      sticks silently — exactly how sti-travel-console ended up pointing at
//      the algoritmos folder.
// On validation failure we show a native dialog explaining why and return
// null. Callers don't need to handle each rejection case manually.
ipcMain.handle('dialog:pickRepoFolder', async (_evt, expectedRemote?: string) => {
  const win = BrowserWindow.getFocusedWindow()
  const opts = { properties: ['openDirectory'] as const, title: 'Link local repo folder' }
  const { filePaths, canceled } = win
    ? await dialog.showOpenDialog(win, opts)
    : await dialog.showOpenDialog(opts)
  if (canceled || filePaths.length === 0) return null
  const folder = filePaths[0]!

  // .git can be a directory (regular repo) or a file (linked worktrees point
  // at the common gitdir via a `gitdir:` text file). Either is valid.
  let isGitRepo = false
  try { statSync(pathJoin(folder, '.git')); isGitRepo = true } catch { /* not a repo */ }
  if (!isGitRepo) {
    const recipient = win ?? undefined
    const msgOpts = {
      type: 'error' as const,
      title: 'Not a git repository',
      message: 'The selected folder is not a git repository.',
      detail: `${folder}\n\nIt has no .git entry. Pick the repository's root folder.`,
    }
    if (recipient) await dialog.showMessageBox(recipient, msgOpts)
    else await dialog.showMessageBox(msgOpts)
    return null
  }

  if (expectedRemote && typeof expectedRemote === 'string') {
    let actualRemote: string | null = null
    try {
      actualRemote = execFileSync('git', ['-C', folder, 'remote', 'get-url', 'origin'], {
        encoding: 'utf8', timeout: 3000, stdio: ['pipe', 'pipe', 'pipe'],
      }).trim() || null
    } catch {
      // No `origin` remote — uncommon but legal (local-only repo). Skip the
      // match check and let the user proceed; we already verified .git exists.
    }
    if (actualRemote) {
      const norm = (u: string) => u
        .replace(/\.git$/, '')
        .replace(/\/+$/, '')
        .replace(/^https?:\/\/[^@/]+@/, 'https://')  // strip embedded credentials
        .toLowerCase()
      if (norm(actualRemote) !== norm(expectedRemote)) {
        const recipient = win ?? undefined
        const msgOpts = {
          type: 'warning' as const,
          title: 'Remote URL mismatch',
          message: 'The selected folder is linked to a different repository.',
          detail: `Expected:\n  ${expectedRemote}\n\nFound:\n  ${actualRemote}\n\nLink anyway?`,
          buttons: ['Link anyway', 'Cancel'],
          defaultId: 1,
          cancelId: 1,
        }
        const choice = recipient
          ? await dialog.showMessageBox(recipient, msgOpts)
          : await dialog.showMessageBox(msgOpts)
        if (choice.response !== 0) return null
      }
    }
  }

  return folder
})

// Read the `origin` remote URL of a local repo. Returns null when the path
// isn't a git repo, has no origin remote, or git is missing. Used by the
// Teams "Open terminal" flow to verify a team-shared local_path actually
// matches THIS repo before auto-adopting it as the user's path — otherwise
// the wrong-folder bug (sti-travel-console linked to algoritmos) keeps
// silently re-applying after every Unlink.
ipcMain.handle('git:getRemoteUrl', (_event, folder: string) => {
  if (!folder || typeof folder !== 'string' || !isAbsolute(folder)) return null
  try { if (!statSync(folder).isDirectory()) return null } catch { return null }
  try { statSync(pathJoin(folder, '.git')) } catch { return null }
  try {
    const out = execFileSync('git', ['-C', folder, 'remote', 'get-url', 'origin'], {
      encoding: 'utf8', timeout: 3000, stdio: ['pipe', 'pipe', 'pipe'],
    }).trim()
    return out || null
  } catch {
    return null
  }
})

// Check if a path exists and is a directory on this machine
ipcMain.handle('path:exists', (_event, p: string) => {
  if (!p || typeof p !== 'string' || !isAbsolute(p)) return false
  try { return statSync(p).isDirectory() } catch { return false }
})

// Settings IPC handlers
ipcMain.handle('settings:get', () => settingsStore.get())
ipcMain.handle('settings:set', (_e, data) => { settingsStore.set(data) })

// Speech / Whisper IPC handlers
ipcMain.handle('speech:check', () => checkWhisperAvailable())
ipcMain.handle('speech:transcribe', (_e, audio: Uint8Array, language?: string) => transcribeAudio(Buffer.from(audio), language ?? 'es'))

// MCP IPC handlers
ipcMain.handle('mcp:read', (_event, filePath: string) => mcpStore.read(filePath))
ipcMain.handle('mcp:write', (_event, filePath: string, servers: unknown) =>
  mcpStore.write(filePath, servers as Record<string, unknown>))
ipcMain.handle('mcp:globalPath', () => pathJoin(ravenHome(), '.claude', 'settings.json'))

// Snippet IPC handlers
ipcMain.handle('snippets:list', () => snippetStore.list())
ipcMain.handle('snippets:save', (_event, snippet) => snippetStore.save(snippet))
ipcMain.handle('snippets:delete', (_event, id: string) => snippetStore.delete(id))

// CLI detection
// Electron launched from a desktop launcher (.app on macOS Finder,
// .desktop on Linux) inherits a PATH without the directories where
// users typically install per-user CLIs (Homebrew on Apple Silicon,
// npm global with custom prefix, snap, ~/.local/bin). Augment PATH
// with those locations before resolving binaries so we don't show
// the "install X" prompt for CLIs that are actually present.
const cliLookupPath = (): string => {
  const home = homedir()
  const extra: string[] = []
  if (process.platform === 'darwin') {
    extra.push(
      '/opt/homebrew/bin',
      '/usr/local/bin',
      `${home}/.npm-global/bin`,
      `${home}/.volta/bin`,
      `${home}/.local/bin`,
      `${home}/.cargo/bin`,
    )
  } else if (process.platform === 'linux') {
    extra.push(
      `${home}/.local/bin`,
      `${home}/.npm-global/bin`,
      '/snap/bin',
      '/usr/local/bin',
      `${home}/.cargo/bin`,
    )
  }
  const sep = process.platform === 'win32' ? ';' : ':'
  return [process.env.PATH ?? '', ...extra].filter(Boolean).join(sep)
}

ipcMain.handle('cli:check', (_event, cmd: string) => {
  const bin = cmd.trim().split(' ')[0] // 'gh copilot' → 'gh'
  if (!/^[a-zA-Z0-9._-]+$/.test(bin)) return { found: false, path: '' }
  try {
    const which = process.platform === 'win32' ? `where ${bin}` : `which ${bin}`
    const path = execSync(which, {
      encoding: 'utf8',
      timeout: 3000,
      env: { ...process.env, PATH: cliLookupPath() },
    }).trim().split('\n')[0]
    return { found: true, path }
  } catch {
    return { found: false, path: '' }
  }
})

// Custom CLI IPC handlers
ipcMain.handle('customcli:list', () => customCLIStore.list())
ipcMain.handle('customcli:save', (_event, cli) => customCLIStore.save(cli))
ipcMain.handle('customcli:delete', (_event, id: string) => customCLIStore.delete(id))

// PTY IPC handlers
ipcMain.handle('pty:create', (_event, paneId: string, cmd: string, accountDir: string, repoPath?: string, shellId?: string) => {
  const shell = shellId ? getShellById(shellId) : undefined
  return ptyManager.create(paneId, cmd, accountDir, repoPath, shell)
})

// Shell detection (Windows-only meaningful result; non-Windows returns [])
ipcMain.handle('shells:detect', () => {
  return detectShells().map((s) => ({ id: s.id, label: s.label }))
})

ipcMain.handle('dialog:openFolder', async () => {
  const win = BrowserWindow.getFocusedWindow()
  const { filePaths, canceled } = win
    ? await dialog.showOpenDialog(win, { properties: ['openDirectory'], title: 'Seleccionar directorio del repo' })
    : await dialog.showOpenDialog({ properties: ['openDirectory'], title: 'Seleccionar directorio del repo' })
  return canceled || filePaths.length === 0 ? null : filePaths[0]
})

ipcMain.on('pty:write', (_event, paneId: string, data: string) => {
  ptyManager.write(paneId, data)
})

ipcMain.on('pty:resize', (_event, paneId: string, cols: number, rows: number) => {
  ptyManager.resize(paneId, cols, rows)
})

ipcMain.handle('pty:kill', (_event, paneId: string) => {
  ptyManager.kill(paneId)
})

ipcMain.handle('pty:exists', (_event, paneId: string) => {
  return ptyManager.exists(paneId)
})

ipcMain.handle('pty:getBuffer', (_event, paneId: string) => {
  return ptyManager.getBuffer(paneId)
})

ipcMain.handle('pty:pid', (_event, paneId: string) => {
  return ptyManager.getPid(paneId)
})

// Forward PTY output to renderer
ptyManager.on('data', (paneId: string, data: string) => {
  const win = BrowserWindow.getAllWindows()[0]
  if (win) win.webContents.send('pty:data', paneId, data)
})

ptyManager.on('exit', (paneId: string) => {
  const win = BrowserWindow.getAllWindows()[0]
  if (win) win.webContents.send('pty:exit', paneId)
})

// Account IPC handlers
ipcMain.handle('accounts:list', (_event, aiType: string) => {
  return accountStore.list(aiType)
})

ipcMain.handle('accounts:save', (_event, aiType: string, name: string) => {
  return accountStore.save(aiType, name)
})

ipcMain.handle('accounts:delete', (_event, aiType: string, name: string) => {
  return accountStore.delete(aiType, name)
})

ipcMain.handle('accounts:getDir', (_event, aiType: string, name: string) => {
  return accountStore.getDir(aiType, name)
})

ipcMain.handle('accounts:detachConfig', (_event, aiType: string, name: string) => {
  const dir = accountStore.getDir(aiType, name)
  detachClaudeConfig(dir)
})

// Workspace IPC handlers
ipcMain.handle('workspace:list', () => workspaceStore.list())
ipcMain.handle('workspace:save', (_event, ws: unknown) => workspaceStore.save(ws as ReturnType<WorkspaceStore['list']>[number]))
ipcMain.handle('workspace:delete', (_event, id: string) => workspaceStore.delete(id))

ipcMain.handle('workspace:export', async (_event, ws: unknown) => {
  const { filePath } = await dialog.showSaveDialog({
    defaultPath: `${(ws as { name: string }).name}.json`,
    filters: [{ name: 'Nest Workspace', extensions: ['json'] }],
  })
  if (!filePath) return
  writeFileSync(filePath, JSON.stringify(ws, null, 2))
})

ipcMain.handle('workspace:import', async () => {
  const { filePaths } = await dialog.showOpenDialog({
    filters: [{ name: 'Nest Workspace', extensions: ['json'] }],
    properties: ['openFile'],
  })
  if (!filePaths[0]) return null
  try {
    return JSON.parse(readFileSync(filePaths[0], 'utf8'))
  } catch {
    return null
  }
})

// === Worktree handlers (Plan 1 — v1.0) ===

ipcMain.handle('worktree:list', async (_evt, repoPath: string) => {
  if (!isAbsolute(repoPath)) throw new Error('repoPath must be absolute')
  const live = worktreeStore.hydrateFromGit(repoPath)
  // Mark store entries that git no longer reports as `orphaned`. Without
  // this, a worktree the user removed externally (`rm -rf <wt>` or
  // `git worktree remove`) stays in the store as `done` forever, and every
  // other consumer (metrics, ports, spotlight) treats it as live.
  worktreeStore.reconcile(live.map((m) => m.repoPath))
  // Filter by rootRepoPath in posix form on both sides so backslash variants
  // from session restore don't cause an empty list (the store always stores
  // POSIX-keyed rootRepoPath after the hydrate fix, but the IPC `repoPath`
  // can still arrive with backslashes).
  const rootPosix = repoPath.replace(/\\/g, '/').replace(/\/+$/, '')
  return worktreeStore.list().filter((m) => {
    const mRoot = m.rootRepoPath.replace(/\\/g, '/').replace(/\/+$/, '')
    return mRoot === rootPosix
  })
})

ipcMain.handle('worktree:get', async (_evt, worktreePath: string) => {
  if (!isAbsolute(worktreePath)) throw new Error('worktreePath must be absolute')
  return worktreeStore.get(worktreePath)
})

ipcMain.handle('worktree:setPreset', async (_evt, worktreePath: string, presetId: string | null) => {
  if (!isAbsolute(worktreePath)) throw new Error('worktreePath must be absolute')
  const meta = worktreeStore.get(worktreePath)
  if (!meta) throw new Error('Worktree not found')
  worktreeStore.setMeta({ ...meta, presetId: presetId ?? undefined })
})

ipcMain.handle('worktree:create', async (_evt, opts: {
  repoPath: string
  branch: string
  fromBranch?: string
  path?: string
  presetId?: string
}) => {
  if (!isAbsolute(opts.repoPath)) throw new Error('repoPath must be absolute')
  // Reject quotes — paths get interpolated into shell strings below, so a path
  // containing `"` could escape the quoting and inject arbitrary commands.
  if (opts.repoPath.includes('"')) throw new Error('repoPath contains invalid characters')
  if (!opts.branch || !/^[a-zA-Z0-9._/\-]+$/.test(opts.branch)) {
    throw new Error(`Invalid branch name: ${opts.branch}`)
  }
  if (opts.path !== undefined) {
    if (!isAbsolute(opts.path) || opts.path.includes('..') || opts.path.includes('"')) {
      throw new Error('path must be absolute and not contain ".." or quotes')
    }
  }

  const slug = opts.branch.replace(/[\/]/g, '-').replace(/[^a-zA-Z0-9._\-]/g, '')
  // Default to a sibling directory next to the repo. Never place the working
  // tree inside .git/worktrees — that's git's internal metadata folder and
  // any worktree created there ends up corrupt (git worktree remove fails
  // with "is not a working tree").
  const wtPath = opts.path ?? pathJoin(dirname(opts.repoPath), `${basename(opts.repoPath)}-${slug}`)

  // Validate fromBranch with the same regex as `opts.branch` — it gets passed
  // directly to git when creating a new branch. The renderer always provides
  // a value from `git:listBranches` (trusted) but server-side validation is
  // defense in depth in case the IPC is called from elsewhere.
  if (opts.fromBranch !== undefined && opts.fromBranch !== 'HEAD'
      && !/^[a-zA-Z0-9._/\-]+$/.test(opts.fromBranch)) {
    throw new Error(`Invalid fromBranch name: ${opts.fromBranch}`)
  }

  // Check if branch exists — execFileSync (no shell)
  let branchExists = false
  try {
    execFileSync('git', ['-C', opts.repoPath, 'show-ref', '--verify', '--quiet', `refs/heads/${opts.branch}`], {
      timeout: 3000,
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    branchExists = true
  } catch { branchExists = false }

  // git worktree add — array args, no shell interpolation.
  const from = opts.fromBranch ?? 'HEAD'
  const addArgs = branchExists
    ? ['-C', opts.repoPath, 'worktree', 'add', wtPath, opts.branch]
    : ['-C', opts.repoPath, 'worktree', 'add', '-b', opts.branch, wtPath, from]
  try {
    execFileSync('git', addArgs, { encoding: 'utf8', timeout: 10000, stdio: ['pipe', 'pipe', 'pipe'] })
  } catch (err) {
    throw new Error(`git worktree add failed: ${err instanceof Error ? err.message : String(err)}`)
  }

  // Persist meta
  const now = Date.now()
  let preset: import('../src/types').RavenPreset | null = null
  if (opts.presetId) {
    preset = presetStore.get(opts.repoPath, opts.presetId)
  }
  const meta = {
    repoPath: wtPath,
    rootRepoPath: opts.repoPath,
    branch: opts.branch,
    presetId: opts.presetId,
    setupState: 'idle' as const,
    declaredPorts: preset?.ports ?? [],
    detectedPorts: [],
    devCmd: preset?.dev,
    createdAt: now,
    updatedAt: now,
  }
  worktreeStore.setMeta(meta)

  // Auto-run setup in background (non-blocking)
  if (preset) {
    const commands = [...(preset.postCreate ?? []), ...(preset.setup ?? [])]
    if (commands.length > 0) {
      setupRunner
        .run({ worktreePath: wtPath, presetId: preset.id, commands, env: preset.env ?? {} })
        .catch((err) => console.error('[setup-runner]', err))
    }
  }

  return meta
})

ipcMain.handle('worktree:remove', async (_evt, worktreePath: string) => {
  if (!isAbsolute(worktreePath)) throw new Error('worktreePath must be absolute')
  const meta = worktreeStore.get(worktreePath)
  if (!meta) throw new Error('Worktree not found in store')

  if (setupRunner.isRunning(worktreePath)) setupRunner.cancel(worktreePath)

  // Kill every pane whose cwd lives inside the worktree BEFORE attempting
  // any filesystem op. On Windows a PowerShell pane inside the worktree
  // holds a directory handle, so `git worktree remove --force` and `rmSync`
  // both fail with EBUSY-style errors that don't match our legacy-cleanup
  // regex below — they used to bubble up as a confusing message OR worse,
  // get silently swallowed in the manual-cleanup branch and leave a ghost
  // directory that resurrected on every refresh.
  const killedPanes = ptyManager.killByCwdPrefix(worktreePath)
  if (killedPanes.length > 0) {
    console.warn('[worktree:remove] killed live panes inside worktree', { worktreePath, killedPanes })
    // Give Windows a moment to release the directory handles before we try
    // to delete. Not strictly necessary on POSIX but cheap.
    await new Promise((r) => setTimeout(r, 250))
  }

  let needsManualCleanup = false
  try {
    execFileSync('git', ['-C', meta.rootRepoPath, 'worktree', 'remove', worktreePath, '--force'], {
      encoding: 'utf8',
      timeout: 10000,
      stdio: ['pipe', 'pipe', 'pipe'],
    })
  } catch (err) {
    // Legacy worktrees created before v1.0 sometimes ended up pointing inside
    // .git/worktrees (git's metadata folder). Those aren't valid working trees
    // so `git worktree remove` fails. Fall back to manual cleanup so the user
    // can still get rid of them from the UI.
    const msg = err instanceof Error ? err.message : String(err)
    if (!/is not a working tree|is not a worktree|not a valid/i.test(msg)) {
      throw new Error(`git worktree remove failed: ${msg}`)
    }
    needsManualCleanup = true
  }

  // Track partial failures. If EITHER step fails we keep the meta in place
  // so the UI doesn't lie about success — otherwise on next hydrateFromGit
  // the worktree resurrects and the user can't get rid of it.
  let cleanupFailures: string[] = []
  if (needsManualCleanup) {
    // Order matters: delete the directory FIRST, then prune. With the dir
    // gone, `git worktree prune` sees the metadata as dangling and drops the
    // entry under .git/worktrees/<slug>/ too. If we pruned first, the metadata
    // might still reference the very path we're about to delete.
    try {
      if (existsSync(worktreePath)) rmSync(worktreePath, { recursive: true, force: true })
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      console.warn('[worktree:remove] manual rmSync failed', msg)
      cleanupFailures.push(`rmSync: ${msg}`)
    }
    try {
      execFileSync('git', ['-C', meta.rootRepoPath, 'worktree', 'prune'], {
        encoding: 'utf8', timeout: 5000, stdio: ['pipe', 'pipe', 'pipe'],
      })
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      console.warn('[worktree:remove] prune failed', msg)
      cleanupFailures.push(`prune: ${msg}`)
    }
  }

  if (cleanupFailures.length > 0) {
    // Leave the meta in place so user can retry; surface a real error.
    throw new Error(`Worktree partially removed — ${cleanupFailures.join('; ')}. Retry, or clean up the directory manually.`)
  }
  worktreeStore.remove(worktreePath)
})

// === Preset handlers (Plan 2 — v1.0) ===

ipcMain.handle('preset:list', async (_evt, repoPath: string) => {
  if (!isAbsolute(repoPath)) throw new Error('repoPath must be absolute')
  return presetStore.list(repoPath)
})

ipcMain.handle('preset:save', async (_evt, repoPath: string, preset: import('../src/types').RavenPreset) => {
  if (!isAbsolute(repoPath)) throw new Error('repoPath must be absolute')
  return presetStore.save(repoPath, preset)
})

ipcMain.handle('preset:delete', async (_evt, repoPath: string, presetId: string) => {
  if (!isAbsolute(repoPath)) throw new Error('repoPath must be absolute')
  presetStore.delete(repoPath, presetId)
})

ipcMain.handle('preset:apply', async (_evt, worktreePath: string, presetId: string) => {
  if (!isAbsolute(worktreePath)) throw new Error('worktreePath must be absolute')
  const meta = worktreeStore.get(worktreePath)
  if (!meta) throw new Error('Worktree not found')
  const preset = presetStore.get(meta.rootRepoPath, presetId)
  if (!preset) throw new Error(`Preset not found: ${presetId}`)
  worktreeStore.setMeta({
    ...meta,
    presetId: preset.id,
    declaredPorts: preset.ports ?? [],
    devCmd: preset.dev,
    setupLog: undefined,
  })
  const commands = [...(preset.postCreate ?? []), ...(preset.setup ?? [])]
  if (commands.length === 0) return
  setupRunner
    .run({ worktreePath, presetId: preset.id, commands, env: preset.env ?? {} })
    .catch((err) => console.error('[setup-runner]', err))
})

ipcMain.handle('preset:cancel', async (_evt, worktreePath: string) => {
  if (!isAbsolute(worktreePath)) throw new Error('worktreePath must be absolute')
  setupRunner.cancel(worktreePath)
})

// === Port monitor handler (Plan 3 — v1.0) ===

// Shared tree resolver: routes Windows tree walks through MetricsCollector's
// CIM snapshot cache (wmic was removed in Win11 22H2). On POSIX it still
// uses pidtree under the hood. Pass this to every scanPid() call.
const resolvePidTree = (pid: number) => metricsCollector.getTreeForPid(pid)

ipcMain.handle('port:scan', async (_evt, pid: number) => {
  if (!Number.isFinite(pid) || pid <= 0) return []
  return scanPid(pid, resolvePidTree)
})

// === Browser pane handlers (Plan 4 — v1.0) ===

const SAFE_PARTITION_RE = /^persist:[a-zA-Z0-9_-]+$/

function safeBrowserUrl(url: string): boolean {
  // Allow http(s) for real navigation, plus a strictly self-contained
  // `data:text/html` URL used by BrowserCell as the dark blank-state page.
  // We don't allow arbitrary data: URLs (e.g. data:application/javascript)
  // to keep this narrow — only inert HTML payloads.
  return /^https?:\/\//i.test(url) || /^data:text\/html[;,]/i.test(url)
}

ipcMain.handle('browser:create', async (_evt, paneId: string, url: string, partition: string) => {
  if (!paneId || typeof paneId !== 'string') throw new Error('paneId required')
  if (!safeBrowserUrl(url)) throw new Error('url must be http(s)')
  if (!SAFE_PARTITION_RE.test(partition)) throw new Error('invalid partition')
  browserPanes.create(paneId, url, partition)
})

ipcMain.handle('browser:reposition', async (_evt, paneId: string, bounds: unknown) => {
  if (!bounds || typeof bounds !== 'object') return
  const b = bounds as { x: number; y: number; width: number; height: number }
  if ([b.x, b.y, b.width, b.height].some((v) => !Number.isFinite(v))) return
  browserPanes.reposition(paneId, b)
})

ipcMain.handle('browser:navigate', async (_evt, paneId: string, url: string) => {
  if (!safeBrowserUrl(url)) throw new Error('url must be http(s)')
  browserPanes.navigate(paneId, url)
})

ipcMain.handle('browser:back', async (_evt, paneId: string) => browserPanes.back(paneId))
ipcMain.handle('browser:forward', async (_evt, paneId: string) => browserPanes.forward(paneId))
ipcMain.handle('browser:reload', async (_evt, paneId: string) => browserPanes.reload(paneId))
ipcMain.handle('browser:destroy', async (_evt, paneId: string) => browserPanes.destroy(paneId))

// === Spotlight handlers (Plan 5 — v1.0) ===

ipcMain.handle('spotlight:start', async (_evt, worktreePath: string) => {
  if (!isAbsolute(worktreePath)) throw new Error('worktreePath must be absolute')
  const meta = worktreeStore.get(worktreePath)
  if (!meta) throw new Error('Worktree not in store')
  if (meta.repoPath === meta.rootRepoPath) throw new Error('Cannot spotlight the root worktree')
  const preset = meta.presetId ? presetStore.get(meta.rootRepoPath, meta.presetId) : null
  await spotlight.start(worktreePath, meta.rootRepoPath, preset?.spotlightIgnore ?? [])
})

ipcMain.handle('spotlight:stop', async () => spotlight.stop())

ipcMain.handle('spotlight:status', async () => spotlight.status())

// === Benchmark handlers (Plan 5 — v1.0) ===

ipcMain.handle('benchmark:start', async (_evt, cellId: string, pid: number, mode: 'setup' | 'spotlight' | 'idle') => {
  if (!Number.isFinite(pid) || pid <= 0) throw new Error('Invalid pid')
  benchmark.start(cellId, pid, mode)
})

ipcMain.handle('benchmark:stop', async (_evt, cellId: string) => {
  benchmark.stop(cellId)
})

ipcMain.handle('benchmark:get', async (_evt, cellId: string) => {
  return benchmark.get(cellId)
})

ipcMain.handle('benchmark:list', async () => benchmark.list())

ipcMain.handle('benchmark:setMode', async (_evt, cellId: string, mode: 'setup' | 'spotlight' | 'idle') => {
  benchmark.setMode(cellId, mode)
})

// === Resource Usage metrics ===

ipcMain.handle('metrics:snapshot', async (
  _evt,
  panes: Array<{ paneId: string; repoPath: string | undefined; label: string; note?: string; workspaceName?: string; aiColor?: string; aiType?: string }>,
) => {
  // Resolve PIDs in main — renderer never sees raw OS PIDs in any other API
  // surface, so we keep that boundary here too. ptyManager.getPid() returns
  // undefined for panes that don't have a live PTY (browser cells, panes
  // whose PTY hasn't spawned yet, panes that already exited).
  const safePanes = Array.isArray(panes) ? panes : []
  const inputs: PaneInput[] = safePanes.map((p) => ({
    paneId: p.paneId,
    pid: ptyManager.getPid(p.paneId) ?? 0,
    label: p.label,
    repoPath: p.repoPath,
    note: p.note,
    workspaceName: p.workspaceName,
    aiColor: p.aiColor,
    aiType: p.aiType,
  }))
  return metricsCollector.collect(inputs)
})

ipcMain.handle('metrics:refreshDisk', async (_evt, worktreePaths: string[]) => {
  const valid = Array.isArray(worktreePaths)
    ? worktreePaths.filter((p) => typeof p === 'string' && isAbsolute(p))
    : []
  return metricsCollector.refreshDisk(valid)
})

// Kill a process by PID. On Windows we use `taskkill /F /T` to kill the whole
// tree — a PowerShell pane has its dev server as a descendant and `process.kill`
// would only signal the shell itself, leaving the actual server orphaned.
// Falls back to `process.kill(pid)` if taskkill isn't available.
function killProcessTree(pid: number): { ok: true } | { ok: false; error: string } {
  if (process.platform === 'win32') {
    try {
      execFileSync('taskkill', ['/F', '/T', '/PID', String(pid)], {
        timeout: 5000,
        stdio: 'pipe',
      })
      return { ok: true }
    } catch {
      // taskkill missing or refused — fall through to process.kill
    }
  }
  try {
    process.kill(pid)
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

ipcMain.handle('metrics:killPid', async (_evt, pid: number) => {
  if (!Number.isFinite(pid) || pid <= 0) {
    return { ok: false as const, error: 'Invalid pid' }
  }
  return killProcessTree(pid)
})

// Bulk port-scan for many pids in one IPC call. Used by the resource popover
// so we can render port chips per worktree without N round-trips. Each pid is
// expanded to its full process tree FIRST so we catch ports opened by child
// processes (e.g. `node` under `npm run dev` under the PowerShell shell) —
// the shell itself almost never listens on a port. The map key remains the
// ORIGINAL input pid so the renderer can still look up ports by pane pid.
// Listening ports filtered to the workspace the BrowserCell lives in.
// Combines panes of the current tab (via paneIds) with "external" processes
// whose ExecutablePath/CommandLine lives inside the workspace's repoPath
// — that's how a `npm run dev` launched in a side terminal (or another
// Nest instance) still surfaces here. Tree-scans each PID so children
// (the actual `node` listening on :5173) are covered.
ipcMain.handle('ports:listForWorkspace', async (
  _evt,
  opts: { repoPath?: string; repoPaths?: string[]; paneIds?: string[] },
) => {
  const safe = opts && typeof opts === 'object' ? opts : {}
  const seedPids = new Set<number>()

  for (const id of safe.paneIds ?? []) {
    const p = ptyManager.getPid(id)
    if (p && Number.isFinite(p) && p > 0) seedPids.add(p)
  }
  // Accept BOTH legacy `repoPath` (single, kept for renderer compat) and the
  // newer `repoPaths` array. The array is critical when a workspace tab is
  // pinned to a repo root but its panes (and the dev server they reference)
  // live in *worktrees* — siblings of the root that don't share its path
  // prefix. Without scanning each pane's actual path, the dev server is
  // invisible to findProcessesUnderPath.
  const pathsToScan = new Set<string>()
  if (safe.repoPath) pathsToScan.add(safe.repoPath)
  for (const p of safe.repoPaths ?? []) {
    if (typeof p === 'string' && p) pathsToScan.add(p)
  }
  for (const path of pathsToScan) {
    const external = await metricsCollector.findProcessesUnderPath(path)
    for (const p of external) seedPids.add(p)
  }
  if (seedPids.size === 0) return [] as number[]

  const trees = await Promise.all(Array.from(seedPids).map((p) => metricsCollector.getTreeForPid(p)))
  const flat = new Set<number>()
  for (const t of trees) for (const p of t) flat.add(p)
  if (flat.size === 0) return [] as number[]

  const portArrays = await Promise.allSettled(Array.from(flat).map((pid) => scanPid(pid, resolvePidTree)))
  const merged = new Set<number>()
  for (const r of portArrays) {
    if (r.status === 'fulfilled' && Array.isArray(r.value)) {
      for (const port of r.value) merged.add(port)
    }
  }
  return Array.from(merged).sort((a, b) => a - b)
})

// All listening localhost-bindable ports on the system. Used by the
// BrowserCell URL dropdown when no workspace context is available.
ipcMain.handle('ports:listAll', async () => {
  if (process.platform === 'win32') {
    return await new Promise<number[]>((res) => {
      execFile('netstat', ['-ano'], { timeout: 5000, windowsHide: true, maxBuffer: 8 * 1024 * 1024 }, (err, stdout) => {
        if (err || !stdout) {
          if (err) console.warn('[ports:listAll] netstat failed', (err as NodeJS.ErrnoException).code ?? err.message)
          return res([])
        }
        const ports = new Set<number>()
        for (const line of stdout.split(/\r?\n/)) {
          // `  TCP    0.0.0.0:5173    0.0.0.0:0    LISTENING    12708`
          // `  TCP    [::]:5173       [::]:0       LISTENING    12708`
          const m = line.match(/^\s*TCP\s+\S+:(\d+)\s+\S+\s+LISTENING\b/)
          if (!m) continue
          const port = parseInt(m[1]!, 10)
          if (Number.isFinite(port)) ports.add(port)
        }
        res(Array.from(ports).sort((a, b) => a - b))
      })
    })
  }
  // macOS / Linux: `lsof -nP -iTCP -sTCP:LISTEN` is the cleanest one-shot.
  return await new Promise<number[]>((res) => {
    execFile('lsof', ['-nP', '-iTCP', '-sTCP:LISTEN'], { timeout: 5000 }, (err, stdout) => {
      if (err || !stdout) {
        if (err) console.warn('[ports:listAll] lsof failed', (err as NodeJS.ErrnoException).code ?? err.message)
        return res([])
      }
      const ports = new Set<number>()
      for (const line of stdout.split(/\r?\n/)) {
        const m = line.match(/:(\d+)\s+\(LISTEN\)\s*$/)
        if (m) {
          const port = parseInt(m[1]!, 10)
          if (Number.isFinite(port)) ports.add(port)
        }
      }
      res(Array.from(ports).sort((a, b) => a - b))
    })
  })
})

ipcMain.handle('metrics:portsByPids', async (_evt, pids: number[]) => {
  if (!Array.isArray(pids)) return {} as Record<number, number[]>
  const valid = pids.filter((p) => Number.isFinite(p) && p > 0)
  const out: Record<number, number[]> = {}
  // 1. Resolve each pid's tree (pid + descendants). Routed through the
  //    MetricsCollector so the Windows CIM snapshot is cached and shared
  //    with collect()'s own tree resolution. On Windows `pidtree` shells
  //    out to `wmic` (removed in Win11 22H2), so we never use it directly.
  const trees = await Promise.all(valid.map((p) => metricsCollector.getTreeForPid(p)))
  // 2. For each input pid, scan every pid in its tree and union the results.
  await Promise.all(valid.map(async (p, idx) => {
    const tree = trees[idx]!
    const results = await Promise.allSettled(tree.map((tp) => scanPid(tp, resolvePidTree)))
    const merged = new Set<number>()
    for (const r of results) {
      if (r.status === 'fulfilled' && Array.isArray(r.value)) {
        for (const port of r.value) merged.add(port)
      }
    }
    if (merged.size > 0) {
      out[p] = Array.from(merged).sort((a, b) => a - b)
    }
  }))
  return out
})

// === Diff handlers (Plan 6 — v1.0) ===

ipcMain.handle('diff:get', async (_evt, worktreePath: string, base?: string) => {
  if (!isAbsolute(worktreePath)) throw new Error('worktreePath must be absolute')
  return getDiff(worktreePath, base ?? 'HEAD')
})

// Lightweight shortstat for the worktree sidebar chip. `git diff --shortstat`
// returns one line — we parse it into totals. Defensive everywhere: any failure
// returns zeros so the chip simply doesn't render (silent failure preferred).
ipcMain.handle('git:shortstat', async (_evt, worktreePath: string, base?: string) => {
  const empty = { additions: 0, deletions: 0, filesChanged: 0 }
  if (!worktreePath || typeof worktreePath !== 'string' || !isAbsolute(worktreePath)) return empty
  try { if (!statSync(worktreePath).isDirectory()) return empty } catch { return empty }

  // Resolve a base ref. Caller may pass undefined — fall back to origin/HEAD,
  // then main/master/develop. We compare base..HEAD (two-dot) so the chip shows
  // the diff "ahead of base" rather than including base's own changes.
  let baseRef = base
  if (!baseRef) {
    try {
      const head = execFileSync('git', ['-C', worktreePath, 'symbolic-ref', 'refs/remotes/origin/HEAD'], {
        encoding: 'utf8', timeout: 3000, stdio: ['pipe', 'pipe', 'pipe'],
      }).trim()
      baseRef = head.replace(/^refs\/remotes\//, '')
    } catch {
      for (const candidate of ['origin/main', 'origin/master', 'origin/develop', 'main', 'master']) {
        try {
          execFileSync('git', ['-C', worktreePath, 'rev-parse', '--verify', candidate], {
            timeout: 2000, stdio: 'pipe',
          })
          baseRef = candidate
          break
        } catch { /* try next */ }
      }
    }
  }
  // Even with execFile, validate baseRef shape — it's a git ref name, not a path.
  if (!baseRef || !/^[a-zA-Z0-9._/\-]+$/.test(baseRef)) return empty

  let out = ''
  try {
    out = execFileSync('git', ['-C', worktreePath, 'diff', '--shortstat', `${baseRef}...HEAD`], {
      encoding: 'utf8', timeout: 5000, stdio: ['pipe', 'pipe', 'pipe'],
    })
  } catch {
    return empty
  }

  // Sample line: " 3 files changed, 27 insertions(+), 4 deletions(-)"
  // Either insertions or deletions can be missing (pure-add or pure-delete).
  const filesM = out.match(/(\d+)\s+files?\s+changed/)
  const addM = out.match(/(\d+)\s+insertions?\(\+\)/)
  const delM = out.match(/(\d+)\s+deletions?\(-\)/)
  return {
    filesChanged: filesM ? parseInt(filesM[1]!, 10) : 0,
    additions: addM ? parseInt(addM[1]!, 10) : 0,
    deletions: delM ? parseInt(delM[1]!, 10) : 0,
  }
})

// List untracked files matching .env* (root-level or nested). Used by
// NewWorktreeModal to warn the user before creating a worktree, since
// `git worktree add` does NOT copy untracked files like .env / .env.local.
ipcMain.handle('git:listUntrackedEnvFiles', async (_evt, repoPath: string) => {
  if (!repoPath || typeof repoPath !== 'string' || !isAbsolute(repoPath)) return []
  try { if (!statSync(repoPath).isDirectory()) return [] } catch { return [] }
  let out: string
  try {
    out = execSync(`git -C "${repoPath}" ls-files --others --exclude-standard`, {
      encoding: 'utf8', timeout: 5000, stdio: ['pipe', 'pipe', 'pipe'],
    })
  } catch {
    return []
  }
  return out
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean)
    .filter((p) => {
      const base = p.split('/').pop() ?? ''
      // Matches `.env`, `.env.local`, `.env.production`, ... at any depth.
      return /^\.env(\.|$)/.test(base)
    })
})

// PR lookup cache (per branch, 5 min TTL, max 200 entries). Lives in main so
// it survives renderer remounts and isn't duplicated across windows.
type PRChip = { number: number; url: string } | null
const prCache = new Map<string, { value: PRChip; expiresAt: number }>()
const PR_CACHE_TTL_MS = 5 * 60 * 1000
const PR_CACHE_MAX = 200

function prCacheGet(key: string): PRChip | undefined {
  const hit = prCache.get(key)
  if (!hit) return undefined
  if (hit.expiresAt < Date.now()) { prCache.delete(key); return undefined }
  return hit.value
}
function prCacheSet(key: string, value: PRChip): void {
  // Drop oldest insertion when over capacity (Map iteration order is insertion order).
  if (prCache.size >= PR_CACHE_MAX) {
    const firstKey = prCache.keys().next().value
    if (firstKey !== undefined) prCache.delete(firstKey)
  }
  prCache.set(key, { value, expiresAt: Date.now() + PR_CACHE_TTL_MS })
}

function parseRemoteOrigin(repoPath: string): {
  provider: 'github' | 'gitlab'
  ownerRepo: string
} | null {
  try {
    // Use execFileSync (no shell) — `repoPath` flows from the renderer's
    // session/tab state with only `isAbsolute` validation upstream. With
    // execSync + string interpolation, a path containing `"`, `` ` ``, `$`,
    // `\n`, etc. could inject arbitrary commands in main.
    const remote = execFileSync('git', ['-C', repoPath, 'remote', 'get-url', 'origin'], {
      encoding: 'utf8', timeout: 3000, stdio: ['pipe', 'pipe', 'pipe'],
    }).trim()
    const gh = remote.match(/github\.com[:/]([^/]+\/[^/]+?)(?:\.git)?$/i)
    if (gh) return { provider: 'github', ownerRepo: gh[1]! }
    const gl = remote.match(/gitlab\.com[:/]([^/]+(?:\/[^/]+)+?)(?:\.git)?$/i)
    if (gl) return { provider: 'gitlab', ownerRepo: gl[1]! }
  } catch (err) {
    // Log so the PR chip not appearing is debuggable (vs an empty `origin`
    // remote which is legitimate for local-only repos).
    console.warn('[parseRemoteOrigin]', repoPath, err instanceof Error ? err.message.split('\n')[0] : err)
  }
  return null
}

ipcMain.handle('git:findPRForBranch', async (
  _evt,
  repoPath: string,
  branch: string,
  tokens?: { github?: string | null; gitlab?: string | null },
): Promise<PRChip> => {
  if (!repoPath || !isAbsolute(repoPath)) return null
  if (!branch || typeof branch !== 'string' || branch === 'HEAD') return null

  const cacheKey = `${repoPath}::${branch}`
  const cached = prCacheGet(cacheKey)
  if (cached !== undefined) return cached

  const remote = parseRemoteOrigin(repoPath)
  if (!remote) { prCacheSet(cacheKey, null); return null }

  // Only cache null on a confirmed "no PR exists" (200 + empty array, or 404).
  // For 401/403/429/5xx and network/fetch errors we return null WITHOUT caching
  // so the next refresh retries — otherwise the user loses the PR chip for the
  // full TTL on a transient blip.
  try {
    if (remote.provider === 'github') {
      const [owner, repo] = remote.ownerRepo.split('/') as [string, string]
      const url = `https://api.github.com/repos/${owner}/${repo}/pulls?head=${encodeURIComponent(`${owner}:${branch}`)}&state=open`
      const headers: Record<string, string> = {
        'Accept': 'application/vnd.github+json',
        'User-Agent': 'raven-nest',
      }
      const tok = tokens?.github
      if (typeof tok === 'string' && tok) headers['Authorization'] = `Bearer ${tok}`
      const res = await fetch(url, { headers })
      if (!res.ok) {
        if (res.status === 404) { prCacheSet(cacheKey, null); return null }
        console.warn('[git:findPRForBranch]', res.status, branch, 'github transient — not caching')
        return null
      }
      const arr = (await res.json()) as Array<{ number: number; html_url: string }>
      if (!Array.isArray(arr) || arr.length === 0) { prCacheSet(cacheKey, null); return null }
      const pr = { number: arr[0]!.number, url: arr[0]!.html_url }
      prCacheSet(cacheKey, pr)
      return pr
    }
    // gitlab
    const encoded = encodeURIComponent(remote.ownerRepo)
    const url = `https://gitlab.com/api/v4/projects/${encoded}/merge_requests?source_branch=${encodeURIComponent(branch)}&state=opened`
    const headers: Record<string, string> = { 'User-Agent': 'raven-nest' }
    const tok = tokens?.gitlab
    if (typeof tok === 'string' && tok) headers['PRIVATE-TOKEN'] = tok
    const res = await fetch(url, { headers })
    if (!res.ok) {
      if (res.status === 404) { prCacheSet(cacheKey, null); return null }
      console.warn('[git:findPRForBranch]', res.status, branch, 'gitlab transient — not caching')
      return null
    }
    const arr = (await res.json()) as Array<{ iid: number; web_url: string }>
    if (!Array.isArray(arr) || arr.length === 0) { prCacheSet(cacheKey, null); return null }
    const pr = { number: arr[0]!.iid, url: arr[0]!.web_url }
    prCacheSet(cacheKey, pr)
    return pr
  } catch (err) {
    console.warn('[git:findPRForBranch]', 'network', branch, err instanceof Error ? err.message : String(err))
    return null
  }
})

// Copy a list of (untracked) files from the source repo to a new worktree path.
// Used by the .env carry-over checkbox in NewWorktreeModal. Defensive: never
// overwrites existing files at the destination, never escapes the destination
// dir via traversal in `files` entries.
ipcMain.handle('worktree:copyFiles', async (
  _evt,
  srcRepoPath: string,
  dstWorktreePath: string,
  files: string[],
) => {
  if (!isAbsolute(srcRepoPath) || !isAbsolute(dstWorktreePath)) {
    return { copied: 0, skipped: 0, errors: [] as string[] }
  }
  if (!Array.isArray(files)) return { copied: 0, skipped: 0, errors: [] as string[] }

  let copied = 0
  let skipped = 0
  const errors: string[] = []
  for (const rel of files) {
    if (typeof rel !== 'string' || !rel) continue
    if (rel.includes('..') || isAbsolute(rel) || rel.includes('\0')) {
      errors.push(`skip ${rel} (unsafe path)`)
      continue
    }
    const src = pathJoin(srcRepoPath, rel)
    const dst = pathJoin(dstWorktreePath, rel)
    try {
      if (existsSync(dst)) {
        console.warn(`[worktree:copyFiles] destination exists, skipping: ${dst}`)
        skipped++
        continue
      }
      // Precheck: copyFileSync fails with EISDIR on directories/symlink-to-dirs.
      // Skip them with a clear warning instead of letting the cryptic errno bubble.
      try {
        if (!statSync(src).isFile()) {
          console.warn(`[worktree:copyFiles] skipping directory ${rel}`)
          skipped++
          continue
        }
      } catch (statErr) {
        console.warn('[worktree:copyFiles]', rel, statErr)
        errors.push(`${rel}: ${statErr instanceof Error ? statErr.message : String(statErr)}`)
        continue
      }
      mkdirSync(dirname(dst), { recursive: true })
      copyFileSync(src, dst)
      copied++
    } catch (err) {
      console.warn('[worktree:copyFiles]', rel, err)
      errors.push(`${rel}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }
  return { copied, skipped, errors }
})

// === IDE launcher handlers (Plan 6 — v1.0) ===

ipcMain.handle('ide:detect', async (_evt, force?: boolean) => detectIDEs(Boolean(force)))

ipcMain.handle('ide:open', async (_evt, binPath: string, worktreePath: string) => {
  if (!isAbsolute(worktreePath)) throw new Error('worktreePath must be absolute')
  if (typeof binPath !== 'string' || !binPath) throw new Error('binPath required')
  // Defense in depth: the renderer should only call this with paths from
  // `detectIDEs()`, but the IPC contract has to enforce it server-side too.
  // Without this whitelist, a compromised renderer could pass any string
  // as binPath (e.g. `"calc.exe & evil.exe"`) and `spawn(..., { shell: true })`
  // would execute it via cmd.exe.
  const detected = await detectIDEs(false)
  const allowedBinPaths = new Set(detected.map((d) => d.binPath))
  if (!allowedBinPaths.has(binPath)) {
    console.error('[ide:open] refused to launch — binPath not in detected IDE cache', { binPath })
    throw new Error('binPath not recognised as a detected IDE')
  }
  openInIDE(binPath, worktreePath)
})

ipcMain.handle('ide:clearCache', async () => { clearIDECache() })

// Session persistence
const SESSION_PATH = join(ravenHome(), '.raven-nest', 'session.json')

ipcMain.handle('session:load', () => {
  try {
    return JSON.parse(readFileSync(SESSION_PATH, 'utf8'))
  } catch {
    return null
  }
})

ipcMain.handle('session:save', (_event, data: unknown) => {
  try {
    mkdirSync(join(ravenHome(), '.raven-nest'), { recursive: true })
    writeFileSync(SESSION_PATH, JSON.stringify(data))
  } catch {}
})

type UpdaterState = 'idle' | 'downloading' | 'ready'
let updaterState: UpdaterState = 'idle'
let updaterInterval: NodeJS.Timeout | null = null

function safeCheckForUpdates(): void {
  if (updaterState !== 'idle') return
  autoUpdater.checkForUpdates().catch(() => {})
}

function setupAutoUpdater(): void {
  // Only run in packaged app, not in dev
  if (process.env['ELECTRON_RENDERER_URL']) return

  // Clear any previously attached listeners so repeated calls (e.g. HMR/reload)
  // don't accumulate handlers and leak memory.
  autoUpdater.removeAllListeners('update-available')
  autoUpdater.removeAllListeners('update-downloaded')
  autoUpdater.removeAllListeners('error')

  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true

  autoUpdater.on('update-available', () => {
    if (updaterState !== 'idle') return
    updaterState = 'downloading'
    const win = BrowserWindow.getAllWindows()[0]
    if (win) win.webContents.send('updater:status', 'downloading')
  })

  autoUpdater.on('update-downloaded', () => {
    updaterState = 'ready'
    // Remove macOS quarantine so the updated app opens without Gatekeeper block
    if (isMac) {
      execFile('xattr', ['-cr', app.getPath('exe').split('.app')[0] + '.app'], () => {})
    }
    const win = BrowserWindow.getAllWindows()[0]
    if (win) win.webContents.send('updater:status', 'ready')
  })

  autoUpdater.on('error', (err) => {
    console.error('Auto-updater error:', err.message)
    updaterState = 'idle'
    const win = BrowserWindow.getAllWindows()[0]
    const shortMsg = err.message?.split('\n')[0].slice(0, 120)
    if (win) win.webContents.send('updater:status', 'error', shortMsg)
  })

  // Check on launch, then every 4 hours. Capture the handle so we can clear
  // it on before-quit (otherwise the interval keeps the event loop alive past
  // app exit and leaks across HMR reloads in dev).
  safeCheckForUpdates()
  if (updaterInterval) clearInterval(updaterInterval)
  updaterInterval = setInterval(safeCheckForUpdates, 4 * 60 * 60 * 1000)
}

ipcMain.on('updater:install', () => {
  autoUpdater.quitAndInstall()
})

ipcMain.handle('updater:checkForUpdates', async () => {
  if (process.env['ELECTRON_RENDERER_URL']) return 'up-to-date'
  // If already downloading or downloaded, don't call checkForUpdates() again
  // (electron-updater throws if called while a download is in progress)
  if (updaterState === 'downloading' || updaterState === 'ready') return 'update-found'
  const result = await autoUpdater.checkForUpdates().catch(() => null)
  if (!result) return 'error'
  const current = app.getVersion()
  return result.updateInfo.version !== current ? 'update-found' : 'up-to-date'
})

ipcMain.handle('safeStorage:encrypt', (_event, plaintext: string) => {
  if (!safeStorage.isEncryptionAvailable()) return null
  return safeStorage.encryptString(plaintext).toString('base64')
})

ipcMain.handle('safeStorage:decrypt', (_event, encrypted: string) => {
  if (!safeStorage.isEncryptionAvailable()) return null
  return safeStorage.decryptString(Buffer.from(encrypted, 'base64'))
})

ipcMain.handle('clipboard:writeImage', (_event, filePath: string) => {
  const img = nativeImage.createFromPath(filePath)
  if (!img.isEmpty()) clipboard.writeImage(img)
})

const ALLOWED_IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'tiff', 'tif', 'svg'])

ipcMain.handle('tempImages:copyToTemp', (_event, srcPath: string, index: number) => {
  if (!isAbsolute(srcPath)) throw new Error('srcPath must be absolute')
  statSync(srcPath) // throws if file doesn't exist
  const ext = (srcPath.split('.').pop() ?? '').toLowerCase()
  if (!ALLOWED_IMAGE_EXTS.has(ext)) throw new Error(`Unsupported image extension: ${ext}`)
  const destPath = pathJoin(tmpdir(), `nest-img-${index}-${Date.now()}.${ext}`)
  copyFileSync(srcPath, destPath)
  return destPath
})

ipcMain.handle('tempImages:save', (_event, base64: string) => {
  const filePath = pathJoin(tmpdir(), `nest-${Date.now()}.png`)
  writeFileSync(filePath, Buffer.from(base64, 'base64'))
  return filePath
})

ipcMain.handle('tempImages:cleanup', (_event, paths: string[]) => {
  const tmp = tmpdir()
  for (const p of paths) {
    if (isAbsolute(p) && p.startsWith(tmp)) {
      try { unlinkSync(p) } catch { /* already gone */ }
    }
  }
})

ipcMain.on('shell:openExternal', (_event, url: string) => {
  if (typeof url === 'string' && (url.startsWith('https://') || url.startsWith('http://'))) {
    shell.openExternal(url)
  }
})

// CSRF/state nonces for the Connect-from-Settings OAuth flows. We generate one
// when the user clicks Connect and only honor a deep-link if its `state` matches
// the most recent expected nonce — this prevents an attacker from tricking the
// running app into exchanging an attacker-controlled `code` (account hijack).
const expectedOAuthState: { github: string | null; gitlab: string | null } = {
  github: null,
  gitlab: null,
}
function newOAuthState(): string {
  return randomBytes(16).toString('hex')
}

// Handle OAuth deep link: nest://auth/callback#access_token=...
function handleDeepLink(url: string) {
  if (url.startsWith('nest://oauth/github')) {
    const urlObj = new URL(url)
    const code = urlObj.searchParams.get('code')
    const state = urlObj.searchParams.get('state')
    if (code && state && state === expectedOAuthState.github) {
      expectedOAuthState.github = null
      const win = BrowserWindow.getAllWindows()[0]
      if (win) win.webContents.send('github-oauth-code', code)
    }
    return
  }
  if (url.startsWith('nest://oauth/gitlab')) {
    const urlObj = new URL(url)
    const code = urlObj.searchParams.get('code')
    const state = urlObj.searchParams.get('state')
    if (code && state && state === expectedOAuthState.gitlab) {
      expectedOAuthState.gitlab = null
      const win = BrowserWindow.getAllWindows()[0]
      if (win) win.webContents.send('gitlab-oauth-code', code)
    }
    return
  }
  // Buffer URL — renderer will pull it via deeplink:consume once ready
  pendingDeepLink = url
  // Also push if renderer is already loaded (runtime deep links)
  const win = BrowserWindow.getAllWindows()[0]
  if (win && !win.webContents.isLoading()) {
    win.webContents.send('auth:deeplink', url)
    pendingDeepLink = null
  }
}

// Renderer pulls buffered deep link URL once it's ready
ipcMain.handle('deeplink:consume', () => {
  const url = pendingDeepLink
  pendingDeepLink = null
  return url
})

ipcMain.handle('github:open-oauth', async () => {
  const clientId = import.meta.env.MAIN_VITE_GITHUB_CLIENT_ID ?? ''
  if (!clientId) {
    dialog.showMessageBox({
      type: 'error',
      title: 'GitHub OAuth not configured',
      message: 'Missing MAIN_VITE_GITHUB_CLIENT_ID in .env.local',
      detail: 'Register an OAuth App at github.com/settings/developers with callback nest://oauth/github, copy the Client ID to .env.local and restart the app.',
    })
    return
  }
  const redirectUri = 'nest://oauth/github'
  const scopes = 'repo read:org read:user'
  const state = newOAuthState()
  expectedOAuthState.github = state
  const authUrl = `https://github.com/login/oauth/authorize?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${encodeURIComponent(scopes)}&state=${state}`
  shell.openExternal(authUrl)
})

ipcMain.handle('gitlab:open-oauth', async () => {
  const clientId = import.meta.env.MAIN_VITE_GITLAB_CLIENT_ID ?? ''
  if (!clientId) {
    return dialog.showMessageBox({
      type: 'error',
      title: 'GitLab not configured',
      message: 'GitLab OAuth Client ID not set.',
      detail: 'Register an OAuth App at gitlab.com/-/user_settings/applications with redirect nest://oauth/gitlab and scopes "read_api read_repository", set MAIN_VITE_GITLAB_CLIENT_ID in .env.local and restart.',
    })
  }
  const redirectUri = 'nest://oauth/gitlab'
  const scope = 'read_api read_repository read_user'
  const state = newOAuthState()
  expectedOAuthState.gitlab = state
  const url = `https://gitlab.com/oauth/authorize?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=${encodeURIComponent(scope)}&state=${state}`
  await shell.openExternal(url)
})

// macOS: open-url event
app.on('open-url', (_event, url) => handleDeepLink(url))

// Windows/Linux: second-instance with argv
app.on('second-instance', (_event, argv) => {
  const url = argv.find(a => a.startsWith('nest://'))
  if (url) handleDeepLink(url)
  const win = BrowserWindow.getAllWindows()[0]
  if (win) { win.show(); if (isMac) app.dock.show() }
})

// Clear renderer cache when app version changes (prevents stale UI after update)
function clearCacheOnVersionChange(): void {
  const versionFile = join(app.getPath('userData'), '.last-version')
  const currentVersion = app.getVersion()
  let lastVersion = ''
  try { lastVersion = readFileSync(versionFile, 'utf8').trim() } catch {}
  if (lastVersion !== currentVersion) {
    const cacheNames = ['Cache', 'Code Cache', 'GPUCache', 'DawnCache', 'DawnWebGPUCache', 'Service Worker', 'blob_storage']
    for (const name of cacheNames) {
      const p = join(app.getPath('userData'), name)
      try { rmSync(p, { recursive: true }) } catch {}
    }
    try { writeFileSync(versionFile, currentVersion) } catch {}
  }
}

app.whenReady().then(() => {
  clearCacheOnVersionChange()

  // Windows: capture deep link URL passed as argv at cold launch
  if (!isMac) {
    const startUrl = process.argv.find(a => a.startsWith('nest://'))
    if (startUrl) pendingDeepLink = startUrl
  }

  // Microphone permission for Web Speech API (works in dev and prod)
  session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
    const allowed = ['microphone', 'media', 'notifications']
    callback(allowed.includes(permission))
  })

  if (isMac) {
    const dockIcon = nativeImage.createFromPath(pathJoin(getIconsDir(), 'icon.icns'))
    if (!dockIcon.isEmpty()) app.dock.setIcon(dockIcon)
  }
  createWindow()
  setupAutoUpdater()
  setWhisperStatusCallback((status) => {
    const win = BrowserWindow.getAllWindows()[0]
    if (win) win.webContents.send('speech:status', status)
  })
  initWhisper()

  createTray(
    () => {
      const w = BrowserWindow.getAllWindows()[0]
      if (w) {
        w.show()
        if (isMac) app.dock.show()
      }
    },
    () => {
      ptyManager.killAll()
      app.exit(0)
    },
    () => {
      if (updaterState === 'downloading') {
        dialog.showMessageBox({ type: 'info', title: 'Nest', message: 'Update is already downloading in the background…' })
        return
      }
      if (updaterState === 'ready') {
        dialog.showMessageBox({ type: 'info', title: 'Nest', message: 'Update already downloaded. Restart Nest to install it.' })
        return
      }
      autoUpdater.checkForUpdates()
        .then(result => {
          if (!result || !result.updateInfo) return
          const current = app.getVersion()
          const latest = result.updateInfo.version
          if (current === latest) {
            dialog.showMessageBox({ type: 'info', title: 'Nest', message: `You're up to date (v${current})` })
          } else {
            dialog.showMessageBox({ type: 'info', title: 'Nest', message: `Update available: v${latest}\nDownloading in the background…` })
          }
        })
        .catch(() => {
          dialog.showMessageBox({ type: 'error', title: 'Nest', message: 'Could not check for updates.' })
        })
    }
  )

  app.on('activate', () => {
    const w = BrowserWindow.getAllWindows()[0]
    if (w) {
      w.show()
      if (isMac) app.dock.show()
    } else {
      createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  // Don't quit — window is hidden to tray, PTYs keep running
  // App only exits via tray menu "Salir"
})

app.on('before-quit', () => {
  shutdownWhisper()
  if (updaterInterval) {
    clearInterval(updaterInterval)
    updaterInterval = null
  }
  // Tear down every long-lived resource on quit. Without these, dev-mode HMR
  // reloads (and any future "soft restart" path) would accumulate intervals,
  // file watchers, PTYs and detached child processes across reloads —
  // user-visible as a slow leak on app idle.
  benchmark.stopAll()
  // Cancel any in-flight `npm install` / preset setup. The spawned children
  // are NOT detached, so they'd die with the parent anyway — but explicit
  // taskkill on Windows tears down the whole tree (preset commands like
  // `npm install` spawn many sub-processes) cleanly instead of orphaning
  // them for a moment.
  setupRunner.cancelAll()
  // Stop the spotlight fs.watch handle. The watcher keeps the event loop
  // alive on macOS/Linux and would block app exit otherwise.
  void spotlight.stop()
  // Destroy every WebContentsView. Each one owns a Chromium render process
  // tree; leaving them dangling for the Electron app teardown is slow.
  browserPanes.destroyAll()
  // Kill every node-pty process. Each PTY is its own OS-level process with a
  // pseudoterminal device — without this, the user sees PowerShell/bash
  // processes survive Nest's tray-Quit on Windows (they'd only die when
  // the conpty session closes, which doesn't happen cleanly without kill()).
  ptyManager.killAll()
  ptyManager.removeAllListeners()
  setupRunner.removeAllListeners()
  spotlight.removeAllListeners()
  metricsCollector.dispose()
  autoUpdater.removeAllListeners()
})
