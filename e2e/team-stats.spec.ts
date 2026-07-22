import { test } from '@playwright/test'
import { launchHarness, teardown, expect } from './helpers/harness'

test('TeamsWorkspace opens without crash after Stats tab integration', async () => {
  const h = await launchHarness({ withRepo: false })

  // Click the Teams button in the sidebar
  await h.page.locator('.sidebar-item-team').click()

  // TeamsWorkspace mounts — either the empty state (no team) or the full workspace
  await expect(h.page.locator('.teams-workspace')).toBeVisible({ timeout: 10_000 })

  // No JS error overlay should be visible
  await expect(h.page.locator('.error-boundary-fallback')).not.toBeVisible()

  await teardown(h)
})
