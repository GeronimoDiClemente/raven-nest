// Memories en la app real, estilo Obsidian (spec 2026-10-20): explorer a la izquierda,
// pestañas en el centro (Graph fija, una por nota, New memory) y a la derecha los filtros del
// grafo o el panel de la nota.
//
// Verifica lo que un test de jsdom no puede ver porque depende de layout, de canvas o del
// proceso main de verdad:
//
// 1. Con cero memorias no se monta ningún canvas.
// 2. El grafo 2D ocupa el centro, no un cuadradito.
// 3. Abrir, editar y guardar una nota pasa por el IPC y el store reales.
// 4. Los `[[links]]` del live preview navegan, y el hueco ofrece crear la memoria.
// 5. Conectar a mano escribe la relación y el grafo la dibuja con su propio nombre.
// 6. Ctrl/Cmd+W cierra la pestaña y NO la ventana (Review Focus 1): el menú por defecto de
//    Electron tiene `close` en CmdOrCtrl+W, y sólo la app real dice quién gana.
//
// Y deja las capturas en .superpowers/sdd/shots/memory-graph/ (no se commitean).
import { test, expect, type Page, type Locator } from '@playwright/test'
import { launchHarness, teardown, type Harness } from './helpers/harness'
import { seedMemories, MEMORIAS_DE_MUESTRA, type SeedMemory } from './helpers/seed-memories'
import { mkdirSync } from 'fs'
import { join } from 'path'

const SHOTS = join(__dirname, '..', '.superpowers', 'sdd', 'shots', 'memory-graph')
mkdirSync(SHOTS, { recursive: true })

async function abrirMemories(page: Page) {
  const toggle = page.getByRole('button', { name: /Collapse sidebar|Expand sidebar/ })
  await expect(toggle).toBeVisible({ timeout: 15_000 })
  if ((await toggle.getAttribute('aria-expanded')) !== 'true') {
    await toggle.click()
    await expect(toggle).toHaveAttribute('aria-expanded', 'true')
  }
  await page.getByTitle(/^Memories/).first().click()
  await expect(page.locator('.memories-workspace')).toBeVisible({ timeout: 15_000 })
}

const explorer = (page: Page) => page.locator('[data-tour-id="memories-explorer"]')
const panelDerecho = (page: Page) => page.getByRole('complementary', { name: 'Side panel' })
const pestana = (page: Page, nombre: string | RegExp) => page.getByRole('tab', { name: nombre })
/** El cuerpo (el `.cm-content` de CodeMirror, que lleva role textbox y este nombre) de la
 *  pestaña activa: las notas no activas quedan montadas pero `hidden`. */
const notaActiva = (page: Page) =>
  page.locator('.memories-workspace').getByRole('textbox', { name: 'Memory content' }).filter({ visible: true })

/**
 * La app arranca y crea el store con su esquema; recién ahí se siembra (los triggers de FTS5
 * tienen que estar puestos), y se recarga el renderer para que el grafo lea lo sembrado.
 */
async function conMemorias(h: Harness, memorias: SeedMemory[]) {
  await abrirMemories(h.page)
  await expect(explorer(h.page).getByText('No memories yet')).toBeVisible({ timeout: 15_000 })
  seedMemories(h.homeDir, memorias)
  await h.page.reload()
  await expect(h.page.locator('.app')).toBeVisible({ timeout: 15_000 })
  await abrirMemories(h.page)
}

/** Abre una memoria desde el explorer por su título exacto. */
async function abrirDesdeElExplorer(page: Page, titulo: string) {
  const fila = explorer(page).getByRole('button', { name: titulo, exact: true })
  await expect(fila).toBeVisible({ timeout: 15_000 })
  await fila.click()
  await expect(pestana(page, titulo)).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByRole('textbox', { name: 'Memory title' }).filter({ visible: true })).toHaveValue(titulo, { timeout: 10_000 })
}

/** Medir después de que el zoomIn de la cáscara asiente: durante la animación boundingBox
 *  devuelve el tamaño ya escalado (misma trampa que en 07-repo-row-escala). */
async function cajaEstable(page: Page, loc: Locator) {
  let previo = -1
  for (let i = 0; i < 40; i++) {
    const b = (await loc.boundingBox())!
    if (b.width === previo) return b
    previo = b.width
    await page.waitForTimeout(50)
  }
  return (await loc.boundingBox())!
}

const AUTH = 'Auth pasa a cookies de sesión, no tokens en localStorage'

test('sin memorias no se monta ningun canvas', async () => {
  const h = await launchHarness({ withRepo: false })
  try {
    await abrirMemories(h.page)
    const ws = h.page.locator('.memories-workspace')
    // "No memories yet" sale dos veces (centro y explorer): se mira en cada lugar.
    await expect(explorer(h.page).getByText('No memories yet')).toBeVisible({ timeout: 15_000 })
    await expect(ws.locator('[data-tour-id="memories-graph"]').getByText('No memories yet')).toBeVisible()
    await expect(ws.locator('canvas')).toHaveCount(0)
    await h.page.screenshot({ path: join(SHOTS, '01-sin-memorias.png') })
  } finally {
    await teardown(h)
  }
})

test('con memorias: el grafo ocupa el centro, una nota se abre en su pestana y se guarda sola', async () => {
  test.setTimeout(120_000)
  const h = await launchHarness({ withRepo: false })
  const { page } = h
  try {
    await conMemorias(h, MEMORIAS_DE_MUESTRA)

    // 2. La pestaña Graph es la activa y el canvas se lleva el centro.
    await expect(pestana(page, /Graph/)).toHaveAttribute('aria-selected', 'true')
    const canvas = page.locator('.memories-workspace [data-tour-id="memories-graph"] canvas').first()
    await expect(canvas).toBeVisible({ timeout: 20_000 })
    const caja = await cajaEstable(page, canvas)
    const anchoDeVentana = await page.evaluate(() => window.innerWidth)
    expect(caja.width).toBeGreaterThan(anchoDeVentana * 0.5)
    // La simulación tarda en aquietarse y recién ahí encuadra: sin esperarla la captura
    // muestra el grafo a medio acomodar.
    await page.waitForTimeout(3000)
    await page.screenshot({ path: join(SHOTS, '02-grafo-con-memorias.png') })

    // 3. Abrir desde el explorer: pestaña nueva seleccionada, título en el input, y el panel
    //    derecho pasa a ser el de la nota.
    await abrirDesdeElExplorer(page, AUTH)
    await expect(panelDerecho(page).getByText('Mentioned in', { exact: true })).toBeVisible()
    await expect(panelDerecho(page).getByText('Links to', { exact: true })).toBeVisible()
    await page.screenshot({ path: join(SHOTS, '03-nota-abierta.png') })

    // 4. Editar al final del cuerpo: se guarda solo (debounce de 1,5 s), y al cerrar y
    //    reabrir la pestaña lo escrito sigue ahí — o sea que llegó al store.
    await notaActiva(page).click()
    await page.keyboard.press('Control+End')
    await page.keyboard.type(' editado')
    await expect(page.locator('.memories-workspace').getByText('Saved', { exact: true })).toBeVisible({ timeout: 5_000 })
    await pestana(page, AUTH).getByRole('button', { name: 'Close tab' }).click()
    await expect(pestana(page, AUTH)).toHaveCount(0)
    await abrirDesdeElExplorer(page, AUTH)
    await expect(notaActiva(page)).toContainText(' editado')
  } finally {
    await teardown(h)
  }
})

test('un [[link]] lleva a la otra memoria, y el hueco ofrece escribirla', async () => {
  const h = await launchHarness({ withRepo: false })
  const { page } = h
  try {
    await conMemorias(h, [
      {
        syncId: 'm-release',
        projectKey: 'raven-nest',
        title: 'Cómo se hace una release',
        type: 'pattern',
        content: '## Pasos\n- Subir la versión en `package.json`\n- Pushear a main: lo dispara **[[release-yml]]**\n\nFalta escribir [[el checklist de QA]].',
      },
      {
        syncId: 'm-release-yml',
        projectKey: 'raven-nest',
        title: 'release.yml hace todo solo',
        type: 'decision',
        topicKey: 'claude-memory/release-yml',
      },
    ])

    await abrirDesdeElExplorer(page, 'Cómo se hace una release')
    // El cursor en otra línea (el título): con la línea del link activa, el click edita en
    // vez de navegar, como en Obsidian.
    await page.getByRole('textbox', { name: 'Memory title' }).filter({ visible: true }).click()
    await page.locator('[data-wikilink="release-yml"]').click()

    // Se resuelve por el último tramo del topic, y ésa sabe quién la menciona.
    await expect(pestana(page, 'release.yml hace todo solo')).toHaveAttribute('aria-selected', 'true', { timeout: 10_000 })
    await expect(panelDerecho(page).getByRole('button', { name: 'Cómo se hace una release' })).toBeVisible({ timeout: 10_000 })

    // El hueco: un link a algo que no existe ofrece crearlo.
    await pestana(page, 'Cómo se hace una release').click()
    await page.getByRole('textbox', { name: 'Memory title' }).filter({ visible: true }).click()
    await page.locator('[data-wikilink="el checklist de QA"]').click()
    const crear = page.getByRole('button', { name: 'Create this memory' })
    await expect(crear).toBeVisible()
    await page.screenshot({ path: join(SHOTS, '04-links.png') })
    await crear.click()
    await expect(pestana(page, 'New memory')).toHaveAttribute('aria-selected', 'true')
    await expect(page.getByRole('textbox', { name: 'Memory title' }).filter({ visible: true })).toHaveValue('el checklist de QA')
  } finally {
    await teardown(h)
  }
})

// La única relación que una PERSONA afirma — las otras las infiere el sistema de algún campo
// compartido. El valor está en que la línea APAREZCA, así que se mira la leyenda del grafo.
test('se pueden conectar dos memorias a mano', async () => {
  const h = await launchHarness({ withRepo: false })
  const { page } = h
  try {
    await conMemorias(h, MEMORIAS_DE_MUESTRA)
    // Antes no hay ninguna conexión a mano.
    await expect(panelDerecho(page).getByText('Same branch', { exact: true })).toBeVisible({ timeout: 15_000 })
    await expect(panelDerecho(page).getByText('Connected by hand', { exact: true })).toHaveCount(0)

    // Dos que NO comparten nada: distinto proyecto, distinto tema, distinta rama.
    await abrirDesdeElExplorer(page, 'SQLite en WAL: los -wal y -shm se mueven ANTES que el .db')
    await page.getByRole('button', { name: 'More actions' }).filter({ visible: true }).click()
    await page.getByRole('menuitem', { name: 'Connect to another memory…' }).click()
    await expect(page.getByText(/^Pick the memory this one goes with/)).toBeVisible()

    await explorer(page).getByRole('button', { name: 'Un 429 devuelve Retry-After en segundos', exact: true }).click()
    await expect(page.getByText(/^Pick the memory this one goes with/)).toHaveCount(0)

    // La relación aparece en la leyenda del grafo con su propio nombre.
    await pestana(page, /Graph/).click()
    await expect(panelDerecho(page).getByText('Connected by hand', { exact: true })).toBeVisible({ timeout: 10_000 })
    await page.screenshot({ path: join(SHOTS, '05-conectadas-a-mano.png') })
  } finally {
    await teardown(h)
  }
})

// Escribir una memoria a mano: formulario, IPC, store. Lo que importa es que lo escrito
// APAREZCA y que la pestaña pase a ser la de la memoria nueva.
test('New memory: se escribe y la pestana pasa a ser la memoria nueva', async () => {
  const h = await launchHarness({ withRepo: false })
  const { page } = h
  try {
    await abrirMemories(page)
    await expect(explorer(page).getByText('No memories yet')).toBeVisible({ timeout: 15_000 })

    await explorer(page).getByRole('button', { name: 'New memory' }).click()
    await expect(pestana(page, 'New memory')).toHaveAttribute('aria-selected', 'true')

    // Sin título no se puede guardar: una memoria sin título no se encuentra después.
    const guardar = page.getByRole('button', { name: 'Save memory' })
    await expect(guardar).toBeDisabled()

    const titulo = 'El deploy de los viernes se hace a la mañana'
    await page.getByRole('textbox', { name: 'Memory title' }).fill(titulo)
    await page.getByRole('textbox', { name: 'Memory content' }).fill('Un rollback a las 19h no lo mira nadie.')
    await page.getByRole('button', { name: /^Preference/ }).click()
    await expect(guardar).toBeEnabled()
    await guardar.click()

    await expect(pestana(page, 'New memory')).toHaveCount(0, { timeout: 10_000 })
    await expect(pestana(page, titulo)).toHaveAttribute('aria-selected', 'true')
    await expect(page.getByRole('textbox', { name: 'Memory title' }).filter({ visible: true })).toHaveValue(titulo)
    await expect(explorer(page).getByRole('button', { name: titulo, exact: true })).toBeVisible({ timeout: 10_000 })
    await page.screenshot({ path: join(SHOTS, '06-escrita-a-mano.png') })
  } finally {
    await teardown(h)
  }
})

// Review Focus 1. `electron/main.ts` no define menú, así que rige el de Electron por defecto,
// que trae `close` (CmdOrCtrl+W) en Window; y `win.on('close')` esconde la ventana a la
// bandeja. Se escucha el evento `close` de la ventana en main: es lo único que dice si el
// acelerador ganó.
//
// Medido el 2026-10-20 (Windows): el acelerador del menú sólo corre con la ventana VISIBLE y
// CON FOCO, y sólo para teclas que entran por `webContents.sendInputEvent` — el
// `keyboard.press` de Playwright (CDP) nunca llega al menú, ni con foco. Por eso este test
// muestra la ventana (le roba el foco a quien use la máquina unos segundos) y teclea por
// `sendInputEvent`. El control del final prueba que con este método el acelerador SÍ llega:
// sin él, el `false` del medio no probaría nada.
test('Ctrl+W cierra la pestana activa y no la ventana', async () => {
  const h = await launchHarness({ withRepo: false })
  const { page, app } = h
  try {
    await conMemorias(h, MEMORIAS_DE_MUESTRA)
    await app.evaluate(({ BrowserWindow }) => {
      const g = globalThis as unknown as { __cerroLaVentana?: boolean }
      g.__cerroLaVentana = false
      const w = BrowserWindow.getAllWindows()[0]
      w.on('close', () => { g.__cerroLaVentana = true })
      w.show()
      w.focus()
    })
    const cerroLaVentana = () => app.evaluate(() => (globalThis as unknown as { __cerroLaVentana?: boolean }).__cerroLaVentana)
    // macOS usa Cmd; el resto, Ctrl. Es la misma tecla que el `CmdOrCtrl` del menú.
    const modificador = process.platform === 'darwin' ? 'meta' : 'control'
    const ctrlW = () => app.evaluate(({ BrowserWindow }, mod) => {
      const wc = BrowserWindow.getAllWindows()[0].webContents
      wc.sendInputEvent({ type: 'keyDown', keyCode: 'W', modifiers: [mod] })
      wc.sendInputEvent({ type: 'keyUp', keyCode: 'W', modifiers: [mod] })
    }, modificador as 'meta' | 'control')
    await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isFocused())).toBe(true)

    // Con el foco en el título y en el cuerpo de la nota: cierra la pestaña, nunca la ventana.
    await abrirDesdeElExplorer(page, AUTH)
    await page.getByRole('textbox', { name: 'Memory title' }).filter({ visible: true }).click()
    await ctrlW()
    await expect(pestana(page, AUTH)).toHaveCount(0)
    await expect(pestana(page, /Graph/)).toHaveAttribute('aria-selected', 'true')

    await abrirDesdeElExplorer(page, AUTH)
    await notaActiva(page).click()
    await ctrlW()
    await expect(pestana(page, AUTH)).toHaveCount(0)

    // Con Graph (fija) activa, el atajo se consume igual: no cierra nada.
    await pestana(page, /Graph/).click()
    await ctrlW()
    await expect(page.locator('.memories-workspace')).toBeVisible()
    // Margen para que un acelerador del menú (corre en main, después del renderer) llegue.
    await page.waitForTimeout(800)
    expect(await cerroLaVentana()).toBe(false)

    // Control: el mismo atajo con el foco FUERA del overlay sí llega al menú.
    await page.evaluate(() => { (document.activeElement as HTMLElement | null)?.blur() })
    await ctrlW()
    await expect.poll(cerroLaVentana, {
      timeout: 5_000,
      message: 'el control no cerró la ventana: las teclas no llegan al acelerador y el test no prueba nada',
    }).toBe(true)
  } finally {
    await teardown(h)
  }
})
