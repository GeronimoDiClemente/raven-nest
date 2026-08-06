import { test, type Page } from '@playwright/test'
import { launchHarness, teardown, expect } from './helpers/harness'

// Opens a plain Terminal pane through the New-Pane dialog:
// Choose AI → Terminal, then the Windows shell sub-step ("Default") when shown.
async function addTerminalPane(page: Page, expected: number): Promise<void> {
  await page.locator('.sidebar-new-terminal').click()
  await page.locator('.ai-card').filter({ hasText: 'Terminal' }).first().click()
  // Windows shows a shell picker when shells are detected — pick the default one.
  // Other platforms create the pane immediately, so this step is optional.
  try {
    await page.locator('.ai-card').filter({ hasText: 'Default' }).first().click({ timeout: 5_000 })
  } catch { /* no shell sub-step on this platform */ }
  await expect(page.locator('.terminal-pane')).toHaveCount(expected, { timeout: 15_000 })
}

// Regression guard for the tmux-import "close pane" binding. It was moved off
// Meta+W (= Ctrl+W on Win/Linux, which readline needs for delete-word) onto
// Meta+Shift+X, so a focused shell keeps Ctrl+W while the app closes panes with
// Ctrl/Cmd+Shift+X. Verifies both halves end-to-end in the real Electron app.
test('close-pane binding: Ctrl+Shift+X closes the focused pane, Ctrl+W does not', async () => {
  const h = await launchHarness({ withRepo: false })
  const { page } = h
  try {
    const panes = page.locator('.terminal-pane')
    await addTerminalPane(page, 1)
    await addTerminalPane(page, 2)

    // Ctrl+W must NOT close a pane anymore — it belongs to the shell now.
    await panes.first().click()
    await page.keyboard.press('Control+w')
    await page.waitForTimeout(500)
    await expect(panes).toHaveCount(2)

    // The new binding closes the focused pane.
    await page.keyboard.press('Control+Shift+X')
    await expect(panes).toHaveCount(1, { timeout: 10_000 })
  } finally {
    await teardown(h)
  }
})
