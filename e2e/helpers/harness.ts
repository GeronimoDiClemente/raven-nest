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

export async function launchHarness(opts?: { withRepo?: boolean }): Promise<Harness> {
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
  env.HOME = homeDir
  env.USERPROFILE = homeDir

  const app = await electron.launch({
    args: [MAIN_JS, `--user-data-dir=${userDataDir}`],
    env,
    timeout: 30_000,
  })

  const page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')

  // Wait for the main UI to render (not the AuthScreen)
  await expect(page.locator('.app, .empty-state, .titlebar, [data-app-ready], .sidebar'))
    .toBeVisible({ timeout: 15_000 })

  return { app, page, homeDir, repoDir }
}

export async function teardown(h: Harness): Promise<void> {
  try { await h.app.close() } catch {}
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
