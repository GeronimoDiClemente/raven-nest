// Las pestañas de workspace de la barra de arriba (2026-10-16, captura de Gero con nueve
// workspaces: «moneytr…», «app-scri…»).
//
// Medido en una ventana de 1400px: desde la octava pestaña TODAS truncaban. De una pestaña de
// 107px, el nombre se quedaba con 43 — el padding, el punto de color y la cruz de cerrar se
// llevaban el resto, y la cruz de las inactivas era invisible (opacity 0) pero igual
// reservaba su caja. Además el área de arrastre de la ventana se quedaba con 80px fijos también
// en pantalla completa, donde no hay ventana que arrastrar.
import { test, expect, type Page } from '@playwright/test'
import { launchHarness, teardown } from './helpers/harness'

const CAPTURAS = process.env.NEST_E2E_CAPTURA_PESTANAS ?? 'test-results/pestanas'

async function sumarWorkspaces(page: Page, n: number): Promise<void> {
  for (let i = 0; i < n; i++) {
    await page.getByRole('button', { name: 'New workspace' }).click()
    await page.waitForTimeout(150)
  }
}

const truncadas = (page: Page) => page.evaluate(() =>
  [...document.querySelectorAll('.tabbar-tabs .tab .tab-name')]
    .filter((n) => (n as HTMLElement).scrollWidth > (n as HTMLElement).clientWidth).length)

test('con nueve workspaces en 1400px ningún nombre se corta', async () => {
  const h = await launchHarness({ withRepo: true })
  const { page } = h
  try {
    await expect(page.getByRole('button', { name: 'New workspace' })).toBeVisible({ timeout: 15_000 })
    await page.waitForTimeout(1500)
    await sumarWorkspaces(page, 8)
    await expect(page.locator('.tabbar-tabs .tab')).toHaveCount(9)
    await page.locator('.tabbar').screenshot({ path: `${CAPTURAS}-ventana.png` })
    expect(await truncadas(page)).toBe(0)
  } finally {
    await teardown(h)
  }
})

test('en una pestaña inactiva la cruz aparece al pasar el mouse y cierra', async () => {
  const h = await launchHarness({ withRepo: true })
  const { page } = h
  try {
    await expect(page.getByRole('button', { name: 'New workspace' })).toBeVisible({ timeout: 15_000 })
    await page.waitForTimeout(1500)
    await sumarWorkspaces(page, 2)
    const pestanas = page.locator('.tabbar-tabs .tab')
    await expect(pestanas).toHaveCount(3)
    const inactiva = pestanas.first()
    await expect(inactiva).not.toHaveClass(/\bactive\b/)
    const cruz = inactiva.getByRole('button', { name: 'Close workspace' })
    await expect(cruz).toHaveCSS('opacity', '0')
    await inactiva.hover()
    await expect(cruz).toHaveCSS('opacity', '1')
    // El punto de color sigue siendo tocable con la cruz a la vista (Gero, 2026-10-16: con la
    // cruz ENCIMA del punto no había forma de cambiarle el color a una pestaña inactiva).
    const punto = inactiva.getByRole('button', { name: 'Change tab color' })
    const [rCruz, rPunto] = [(await cruz.boundingBox())!, (await punto.boundingBox())!]
    expect(rCruz.x + rCruz.width <= rPunto.x || rPunto.x + rPunto.width <= rCruz.x, 'la cruz no tapa el punto').toBe(true)
    const enElPunto = await page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.closest('button')?.getAttribute('title') ?? null,
      [rPunto.x + rPunto.width / 2, rPunto.y + rPunto.height / 2])
    expect(enElPunto).toBe('Change tab color')
    await page.locator('.tabbar').screenshot({ path: `${CAPTURAS}-hover.png` })
    await cruz.click()
    await expect(pestanas).toHaveCount(2)
  } finally {
    await teardown(h)
  }
})

test('en pantalla completa el área de arrastre no le saca lugar a las pestañas', async () => {
  const h = await launchHarness({ withRepo: true })
  const { app, page } = h
  try {
    await expect(page.getByRole('button', { name: 'New workspace' })).toBeVisible({ timeout: 15_000 })
    await page.waitForTimeout(1500)
    // Lo mismo que manda main.ts al entrar en pantalla completa (`avisarPantallaCompleta`).
    await app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0].webContents.send('window:fullscreen', true)
    })
    await expect(page.locator('.app.pantalla-completa')).toHaveCount(1)
    await page.waitForTimeout(300)
    const ancho = await page.locator('.tabbar-drag').evaluate((el) => el.getBoundingClientRect().width)
    expect(ancho).toBe(0)
  } finally {
    await teardown(h)
  }
})
