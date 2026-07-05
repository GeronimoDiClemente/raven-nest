// Smoke del hito 1 — recorrido completo del panel de integraciones Demo:
// instalar desde el marketplace, ítem en Sidebar, panel, acciones, compose, desinstalar.
import { test } from '@playwright/test'
import { launchHarness, teardown, expect } from './helpers/harness'

const SHOTS = process.env.SMOKE_SHOTS || '/tmp/ip-smoke'

test('hito 1: instalar Demo → ítem en Sidebar → panel → acciones → compose → desinstalar', async () => {
  const h = await launchHarness({ withRepo: false })
  const { page } = h
  try {
    // 1. Abrir el marketplace desde la Sidebar
    await page.locator('.sidebar-item', { hasText: 'Integrations' }).first().click()
    await expect(page.locator('.integrations-modal')).toBeVisible()
    await page.screenshot({ path: `${SHOTS}/01-marketplace.png` })

    // 2. Instalar Demo (tab Personal)
    const demoCard = page.locator('.integration-card', { hasText: 'Demo' })
    await demoCard.getByRole('button', { name: 'Install' }).click()
    await expect(demoCard.getByRole('button', { name: 'Remove' })).toBeVisible()

    // 3. Cerrar el modal → ítem Demo en la Sidebar (sync cross-instancia)
    await page.locator('.integrations-close').click()
    const demoItem = page.locator('.sidebar-item-panel', { hasText: 'Demo' })
    await expect(demoItem).toBeVisible()
    await page.screenshot({ path: `${SHOTS}/02-sidebar-demo.png` })

    // 4. Abrir el panel Demo
    await demoItem.click()
    await expect(page.locator('.ip-window')).toBeVisible()
    await expect(page.locator('.ip-section-label', { hasText: 'My work' })).toBeVisible()
    await expect(page.locator('.ip-section-label', { hasText: 'Recent' })).toBeVisible()
    // Sin repo activo no hay branch → no auto-selección
    await expect(page.locator('.ip-empty')).toHaveText('Pick an item on the left')
    await page.screenshot({ path: `${SHOTS}/03-panel-abierto.png` })

    // 5. Seleccionar DEMO-231 y correr la acción → Done
    await page.locator('.ip-item', { hasText: 'Integrations marketplace' }).click()
    await expect(page.locator('.ip-status')).toHaveText('In Progress')
    await page.locator('.ip-action', { hasText: '→ Done' }).click()
    await expect(page.locator('.ip-status')).toHaveText('Done')
    await page.screenshot({ path: `${SHOTS}/04-accion-done.png` })

    // 6. Compose con output adjuntado
    await page.locator('.ip-compose-input').fill('probando compose desde e2e')
    await page.locator('.ip-attach').click()
    await expect(page.locator('.ip-compose-attachment')).toBeVisible()
    await page.locator('.ip-send').click()
    const comment = page.locator('.ip-block-comment', { hasText: 'probando compose desde e2e' })
    await expect(comment).toBeVisible()
    await page.screenshot({ path: `${SHOTS}/05-compose.png` })

    // 7. Cerrar y reabrir → estado mock se resetea (esperado)
    await page.locator('.ip-window-close').click()
    await expect(page.locator('.ip-window')).toHaveCount(0)
    await demoItem.click()
    await expect(page.locator('.ip-window')).toBeVisible()
    await expect(page.locator('.ip-section-label', { hasText: 'My work' })).toBeVisible()
    await page.locator('.ip-window-close').click()

    // 8. Desinstalar Demo → el ítem desaparece de la Sidebar
    await page.locator('.sidebar-item', { hasText: 'Integrations' }).first().click()
    await page.locator('.integration-card', { hasText: 'Demo' }).getByRole('button', { name: 'Remove' }).click()
    await page.locator('.integrations-close').click()
    await expect(page.locator('.sidebar-item-panel', { hasText: 'Demo' })).toHaveCount(0)
    await page.screenshot({ path: `${SHOTS}/06-desinstalado.png` })
  } finally {
    await teardown(h)
  }
})
