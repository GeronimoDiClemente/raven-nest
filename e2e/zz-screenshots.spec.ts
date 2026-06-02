import { test } from '@playwright/test'
import { launchHarness, teardown } from './helpers/harness'
import { mkdirSync } from 'fs'
import { join, resolve } from 'path'

// Preview-only spec. NOT part of CI. Generates UI screenshots for design review.
// Output is written to .preview-shots/ (gitignored). Run: npx playwright test zz-screenshots

const OUT = resolve(__dirname, '..', '.preview-shots')

const RUN = process.env.PREVIEW_SHOTS === '1'

test('capture restyled UI', async () => {
  test.skip(!RUN, 'preview-only: set PREVIEW_SHOTS=1 to generate screenshots')
  mkdirSync(OUT, { recursive: true })
  const h = await launchHarness({ withRepo: true })
  const { page } = h

  await page.setViewportSize({ width: 1280, height: 800 })
  await page.waitForTimeout(800)

  const shot = (name: string) => page.screenshot({ path: join(OUT, name) })

  // 1. Initial view (worktrees panel open by default)
  await shot('01-initial.png')

  // close the default side panel for a clean baseline
  if (await page.locator('.side-panel').count()) {
    await page.locator('.nav-item[title="Worktrees"]').first().click()
    await page.waitForTimeout(300)
  }

  // 2. The "Choose AI" picker (multi-AI identity, branded tiles)
  await page.keyboard.press('Control+t')
  await page.waitForTimeout(600)
  await shot('02-choose-ai.png')
  await page.keyboard.press('Escape') // close dialog before interacting with nav
  await page.waitForTimeout(300)

  // 3. Side panels docked to the right
  const panels: Array<[string, string]> = [
    ['Worktrees', '04-worktrees.png'],
    ['Snippets', '05-snippets.png'],
    ['MCP', '06-mcp.png'],
    ['Workspaces', '07-workspaces.png'],
  ]
  for (const [title, file] of panels) {
    await page.locator(`.nav-item[title="${title}"]`).first().click()
    await page.waitForTimeout(500)
    await shot(file)
    await page.locator(`.nav-item[title="${title}"]`).first().click() // toggle closed
    await page.waitForTimeout(200)
  }

  // 4. Teams — now populated via the e2e fixtures (lands on Activity feed)
  await page.locator('.nav-item[title="Team"]').first().click()
  await page.waitForTimeout(1000)
  await shot('08-teams-activity.png')

  // Teams sub-views via the left nav inside Teams
  const teamViews: Array<[string, string]> = [
    ['Chat', '10-teams-chat.png'],
    ['Repos', '11-teams-repos.png'],
    ['Members', '12-teams-members.png'],
    ['Snippets', '13-teams-snippets.png'],
  ]
  for (const [label, file] of teamViews) {
    const btn = page.locator('.teams-workspace-nav button', { hasText: label }).first()
    if (await btn.count()) {
      await btn.click()
      await page.waitForTimeout(600)
      await shot(file)
    }
  }

  // back to terminal
  const back = page.locator('text=Back').first()
  if (await back.count()) { await back.click(); await page.waitForTimeout(400) }

  // 5. Spotlight (Ctrl+K)
  await page.keyboard.press('Control+k')
  await page.waitForTimeout(500)
  await shot('09-spotlight.png')
  await page.keyboard.press('Escape')

  await teardown(h)
})

test('capture Teams welcome/join (no team)', async () => {
  test.skip(!RUN, 'preview-only: set PREVIEW_SHOTS=1 to generate screenshots')
  mkdirSync(OUT, { recursive: true })
  const h = await launchHarness({ withRepo: true, env: { RAVEN_PREVIEW_EMPTY: '1' } })
  const { page } = h
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.waitForTimeout(800)
  await page.locator('.nav-item[title="Team"]').first().click()
  await page.waitForTimeout(1000)
  await page.screenshot({ path: join(OUT, '03-teams-welcome.png') })
  await teardown(h)
})
