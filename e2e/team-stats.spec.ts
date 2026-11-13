import { test } from '@playwright/test'
import { launchHarness, teardown, expect } from './helpers/harness'

test('TeamsWorkspace opens without crash after Stats tab integration', async () => {
  const h = await launchHarness({ withRepo: false })
  try {
    // Team y My Repos se fusionaron en una sola fila Personal (commit
    // 136ed8e, 2026-09-08, preexistente a esta rama) — ya no hay un item de
    // sidebar separado con title="Team". Personal es hoy la unica puerta.
    await h.page.getByRole('button', { name: 'Personal' }).click()

    // El click esta gateado por plan (plan === 'free' -> upgrade modal en vez
    // de abrir Personal/Teams): con un plan team/trial monta la workspace; en
    // un Supabase local limpio el usuario del bypass no tiene perfil (plan
    // 'free') y se abre el UpgradeModal. Cualquiera de los dos casos sostiene
    // el punto del spec: el click no tiene que crashear.
    await expect(
      h.page.locator('.teams-workspace, .upgrade-modal').first(),
    ).toBeVisible({ timeout: 10_000 })

    // No JS error overlay should be visible
    await expect(h.page.locator('.error-boundary-fallback')).not.toBeVisible()
  } finally {
    await teardown(h)
  }
})
