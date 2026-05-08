import { test } from '@playwright/test'
import { launchHarness, teardown, expect } from './helpers/harness'

test('app launches with auth bypassed and main UI is visible', async () => {
  const h = await launchHarness({ withRepo: false })
  await expect(h.page.locator('.sidebar')).toBeVisible()
  await teardown(h)
})
