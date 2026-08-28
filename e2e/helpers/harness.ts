import { _electron as electron, type ElectronApplication, type Page, expect } from '@playwright/test'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, cpSync } from 'fs'
import { tmpdir } from 'os'
import { join, resolve } from 'path'
import { execSync } from 'child_process'

const REPO_ROOT = resolve(__dirname, '..', '..')
const MAIN_JS = join(REPO_ROOT, 'dist-electron', 'main.js')

if (!existsSync(MAIN_JS)) {
  throw new Error(`Electron main not built: ${MAIN_JS}\nRun: npm run build`)
}

export interface Harness {
  app: ElectronApplication
  page: Page
  homeDir: string
  repoDir: string
}

function uniqueTmp(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix))
}

export async function launchHarness(opts?: { withRepo?: boolean; keepRealHome?: boolean }): Promise<Harness> {
  const homeDir = uniqueTmp('raven-e2e-home-')
  let repoDir = ''
  if (opts?.withRepo !== false) {
    repoDir = uniqueTmp('raven-e2e-repo-')
    initRepo(repoDir)
  }

  // userDataDir scopes the Electron single-instance lock per-test so the
  // user's running Nest.exe does not steal the lock from the test process.
  const userDataDir = join(homeDir, 'electron-user-data')
  mkdirSync(userDataDir, { recursive: true })

  const env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE
  env.RAVEN_E2E = '1'
  // RAVEN_HOME is what the main process consults for persistent storage paths.
  // HOME / USERPROFILE alone are not sufficient on Windows, where os.homedir()
  // can read the user token rather than env vars.
  env.RAVEN_HOME = homeDir
  // `keepRealHome` deja el HOME real intacto: RAVEN_HOME ya aisla TODO el
  // storage de Nest (ravenHome() lo consulta primero), pero las CLIs que Nest
  // spawnea en una pty heredan HOME y buscan ahí sus credenciales. Un HOME
  // descartable las deja sin login y el smoke se cuelga en una pantalla de
  // auth. Solo lo usan los smokes que corren agentes de verdad.
  if (!opts?.keepRealHome) {
    env.HOME = homeDir
    env.USERPROFILE = homeDir
  }

  const app = await electron.launch({
    args: [MAIN_JS, `--user-data-dir=${userDataDir}`],
    env,
    timeout: 30_000,
  })

  try {
    const page = await app.firstWindow()
    await page.waitForLoadState('domcontentloaded')

    // .app is the root container rendered only when bypass succeeds (not on AuthScreen).
    await expect(page.locator('.app')).toBeVisible({ timeout: 15_000 })

    return { app, page, homeDir, repoDir }
  } catch (e) {
    // Setup failed — kill Electron so the worker doesn't hang for 60s.
    try { app.process()?.kill() } catch {}
    try { rmSync(homeDir, { recursive: true, force: true }) } catch {}
    if (repoDir) try { rmSync(repoDir, { recursive: true, force: true }) } catch {}
    throw e
  }
}

export async function teardown(h: Harness): Promise<void> {
  // app.close() hangs when background intervals (port polling, spotlight watchers)
  // keep the event loop alive. Race against a hard kill so the worker exits.
  const pid = h.app.process()?.pid
  try {
    await Promise.race([
      h.app.close(),
      new Promise<void>((resolve) => setTimeout(resolve, 3000)),
    ])
  } catch {}
  // Force-kill the entire process tree — Node's default kill() on Windows
  // does not propagate to children (Electron renderer, GPU process, etc.).
  if (pid) {
    try {
      if (process.platform === 'win32') {
        execSync(`taskkill /T /F /PID ${pid}`, { stdio: 'ignore' })
      } else {
        process.kill(pid, 'SIGKILL')
      }
    } catch {}
  }
  for (const d of [h.homeDir, h.repoDir]) {
    if (!d) continue
    try { rmSync(d, { recursive: true, force: true }) } catch {}
  }
}

export function initRepo(repoDir: string, files: Record<string, string> = { 'README.md': '# test\n' }): void {
  mkdirSync(repoDir, { recursive: true })
  for (const [rel, content] of Object.entries(files)) {
    const full = join(repoDir, rel)
    mkdirSync(join(full, '..'), { recursive: true })
    writeFileSync(full, content)
  }
  execSync('git init -q -b main', { cwd: repoDir })
  execSync('git config user.email "e2e@test.local"', { cwd: repoDir })
  execSync('git config user.name "e2e"', { cwd: repoDir })
  execSync('git config commit.gpgsign false', { cwd: repoDir })
  execSync('git add -A', { cwd: repoDir })
  execSync('git commit -q -m "initial"', { cwd: repoDir })
}

export function writeFile(repoDir: string, rel: string, content: string): void {
  const full = join(repoDir, rel)
  mkdirSync(join(full, '..'), { recursive: true })
  writeFileSync(full, content)
}

export function commitAll(repoDir: string, msg: string): void {
  execSync('git add -A', { cwd: repoDir })
  execSync(`git commit -q -m "${msg}"`, { cwd: repoDir })
}

export { expect }
