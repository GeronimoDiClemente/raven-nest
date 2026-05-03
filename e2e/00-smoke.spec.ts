import { test, _electron as electron } from '@playwright/test'
import { mkdtempSync, mkdirSync } from 'fs'
import { tmpdir } from 'os'
import { join, resolve } from 'path'

test('debug: dump DOM to see what renders', async () => {
  const REPO_ROOT = resolve(__dirname, '..')
  const MAIN_JS = join(REPO_ROOT, 'dist-electron', 'main.js')
  const homeDir = mkdtempSync(join(tmpdir(), 'raven-e2e-debug-'))
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
  await page.waitForTimeout(3000)

  const html = await page.evaluate(() => document.body.innerHTML.slice(0, 2000))
  const flags = await page.evaluate(() => ({
    hasAppFlags: typeof (window as any).appFlags !== 'undefined',
    e2eBypass: (window as any).appFlags?.e2eBypass,
  }))
  console.log('FLAGS:', JSON.stringify(flags))
  console.log('HTML[:2000]:', html)

  await app.close()
})
