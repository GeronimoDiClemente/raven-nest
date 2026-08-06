import { test } from '@playwright/test'
import { launchHarness, teardown, expect } from './helpers/harness'

// Regression guard for the tmux-import close-tab binding. Its default was fixed
// from 'Meta+Shift+w' (lowercase — never matched with Shift held, since e.key is
// 'W') to 'Meta+Shift+W', so kill-window actually closes a tab now.
test('close-tab binding: Ctrl+Shift+W closes the active workspace tab', async () => {
  const h = await launchHarness({ withRepo: false })
  const { page } = h
  try {
    const tabs = page.locator('.tab')
    await expect(tabs).toHaveCount(1)

    // Open a second (empty) workspace — no confirm dialog on close.
    await page.locator('.tab-new').click()
    await expect(tabs).toHaveCount(2)

    // Close the active tab with the fixed binding.
    await page.keyboard.press('Control+Shift+W')
    await expect(tabs).toHaveCount(1)
  } finally {
    await teardown(h)
  }
})
