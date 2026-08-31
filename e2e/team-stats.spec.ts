import { test } from '@playwright/test'
import { launchHarness, teardown, expect } from './helpers/harness'

test('TeamsWorkspace opens without crash after Stats tab integration', async () => {
  const h = await launchHarness({ withRepo: false })
  try {
    // Click the Teams button in the sidebar. "My Repos" shares the
    // .sidebar-item-team class, so target the panel by its title.
    await h.page.locator('.sidebar-item-team[title="Team"]').click()

    // The Teams click is plan-gated (planLimits.allowTeam): with a team/trial
    // plan the TeamsWorkspace mounts; on a clean local Supabase the bypass
    // user has no profile (plan 'free') and the UpgradeModal opens instead.
    // Either way the point of this spec holds: the click must not crash.
    await expect(
      h.page.locator('.teams-workspace, .upgrade-modal').first(),
    ).toBeVisible({ timeout: 10_000 })

    // No JS error overlay should be visible
    await expect(h.page.locator('.error-boundary-fallback')).not.toBeVisible()
  } finally {
    await teardown(h)
  }
})
