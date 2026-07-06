// e2e del flujo Demo — hito "integraciones dentro de My Repos":
// abrir My Repos → sección Integrations → instalar Demo → ítem en el nav
// "Installed" → panel embebido → acciones → compose → desinstalar.
import { test } from '@playwright/test'
import { launchHarness, teardown, expect } from './helpers/harness'

const SHOTS = process.env.SMOKE_SHOTS || '/tmp/ip-smoke'

test('integrations dentro de My Repos: instalar Demo → nav → panel → acciones → compose → desinstalar', async () => {
  const h = await launchHarness({ withRepo: false })
  const { page } = h
  try {
    // 1. Abrir My Repos desde la Sidebar global (gateado a Pro; el bypass e2e
    // resuelve a plan 'pro' — ver src/hooks/useProfile.ts).
    await page.locator('.sidebar-item', { hasText: 'My Repos' }).first().click()
    await expect(page.locator('.teams-workspace')).toBeVisible()
    await page.screenshot({ path: `${SHOTS}/01-my-repos.png` })

    // 2. Nav interno → sección Integrations → marketplace embebido
    await page.locator('.tw-nav-btn', { hasText: 'Integrations' }).click()
    await expect(page.locator('section[aria-label="Available"]')).toBeVisible()
    await page.screenshot({ path: `${SHOTS}/02-marketplace.png` })

    // 3. Instalar Demo → grupo "Installed" en el nav con un ítem "Demo"
    const demoCard = page.locator('.integration-card', { hasText: 'Demo' })
    await demoCard.getByRole('button', { name: 'Install' }).click()
    await expect(demoCard.getByRole('button', { name: 'Remove' })).toBeVisible()

    const installedGroup = page.getByRole('group', { name: 'Installed' })
    await expect(installedGroup).toBeVisible()
    const demoNavItem = installedGroup.locator('.tw-nav-btn', { hasText: 'Demo' })
    await expect(demoNavItem).toBeVisible()
    await page.screenshot({ path: `${SHOTS}/03-nav-demo.png` })

    // 4. Click en el ítem Demo del nav → panel embebido
    await demoNavItem.click()
    await expect(page.locator('.ip-shell')).toBeVisible()
    await expect(page.locator('.ip-section-label', { hasText: 'My work' })).toBeVisible()
    await expect(page.locator('.ip-section-label', { hasText: 'Recent' })).toBeVisible()
    // Sin repo activo no hay branch → no auto-selección
    await expect(page.locator('.ip-empty')).toHaveText('Pick an item on the left')
    await page.screenshot({ path: `${SHOTS}/04-panel-embebido.png` })

    // 5. Seleccionar DEMO-231 y correr la acción → Done
    await page.locator('.ip-item', { hasText: 'Integrations marketplace' }).click()
    await expect(page.locator('.ip-status')).toHaveText('In Progress')
    await page.locator('.ip-action', { hasText: '→ Done' }).click()
    await expect(page.locator('.ip-status')).toHaveText('Done')
    await page.screenshot({ path: `${SHOTS}/05-accion-done.png` })

    // 6. Compose. Nota: la captura del terminal es real desde F2 (lee el
    // buffer de xterm del pane enfocado) y acá no hay panes en el entorno
    // e2e, así que "Attach" no adjunta nada — la captura está unit-testeada
    // en src/__tests__/integrations/terminalCapture.test.ts.
    await page.locator('.ip-compose-input').fill('testing compose from e2e')
    await page.locator('.ip-send').click()
    const comment = page.locator('.ip-block-comment', { hasText: 'testing compose from e2e' })
    await expect(comment).toBeVisible()
    await page.screenshot({ path: `${SHOTS}/06-compose.png` })

    // 7. Desinstalar Demo (volver a Integrations → Remove) → el ítem
    // desaparece del nav y el panel cae al marketplace (misma sección activa).
    await page.locator('.tw-nav-btn', { hasText: 'Integrations' }).click()
    await expect(page.locator('section[aria-label="Available"]')).toBeVisible()
    await page.locator('.integration-card', { hasText: 'Demo' }).getByRole('button', { name: 'Remove' }).click()
    await expect(page.getByRole('group', { name: 'Installed' })).toHaveCount(0)
    await page.screenshot({ path: `${SHOTS}/07-desinstalado.png` })
  } finally {
    await teardown(h)
  }
})
