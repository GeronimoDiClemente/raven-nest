// La TUI de memoria, abierta desde la paleta, en un pane de Nest de verdad.
//
// Lo que prueba y ningún unit puede: que el centinela `NEST_MEMORY_TUI_CMD` llegue al pty,
// que el pane corra `dist-electron/memory-tui.js` con el Electron de Nest en modo Node y las
// variables de memoria del pane, que Ink cargue ahí, que `n` abra `$EDITOR` y lo que vuelve se
// guarde en el daemon de la app, y que `q` le devuelva el pane a su shell.
//
// El editor es el falso de los tests de la TUI (`electron/__tests__/fixtures/editor-falso.mjs`),
// corrido con el Node del runner: escribe el archivo con `EDITOR_FALSO_TEXTO` y sale.
//
// El xterm dibuja con WebGL, así que el DOM no tiene el texto: la salida del pty se lee
// envolviendo `webContents.send('pty:data', …)` en el main. El teclado sí va por el xterm.
//
// Necesita `npm run build` (corre contra `dist-electron/`) y el binding nativo de Electron.
// En macOS correr con `RAVEN_E2E_KEEP_REAL_HOME=1`: sin el HOME real aparece el modal del llavero.
import { test, expect, type ElectronApplication } from '@playwright/test'
import { existsSync } from 'fs'
import { join } from 'path'
import { launchHarness, teardown } from './helpers/harness'
import { buscarNestVivo } from '../electron/nest-vivo-del-paquete'

const REPO = join(__dirname, '..')
const TUI = join(REPO, 'dist-electron', 'memory-tui.js')
const EDITOR_FALSO = join(REPO, 'electron', '__tests__', 'fixtures', 'editor-falso.mjs')
const isWin = process.platform === 'win32'
const TITULO = 'E2E from the TUI'

const sinAnsi = (s: string) =>
  // eslint-disable-next-line no-control-regex
  s.replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '').replace(/\x1b\][^\x07\x1b]*(\x07|\x1b\\)/g, '').replace(/\x1b[()][A-Z0-9]/g, '')

/** Toda la salida de los pty, por pane, envolviendo en el main el `send` de `pty:data`. */
async function capturarSalidaPty(app: ElectronApplication) {
  await app.evaluate(({ BrowserWindow }) => {
    const g = globalThis as unknown as { __salidaPty?: Record<string, string> }
    g.__salidaPty = {}
    const wc = BrowserWindow.getAllWindows()[0].webContents
    const original = wc.send.bind(wc)
    wc.send = (canal: string, ...args: unknown[]) => {
      if (canal === 'pty:data') {
        const [id, data] = args as [string, string]
        g.__salidaPty![id] = (g.__salidaPty![id] ?? '') + data
      }
      return original(canal, ...args)
    }
  })
  const salidas = () => app.evaluate(() =>
    (globalThis as unknown as { __salidaPty: Record<string, string> }).__salidaPty)
  /** El pane donde corre la TUI: el único cuya salida dibuja el encabezado. */
  const paneDeLaTui = async () => Object.entries(await salidas()).find(([, t]) => sinAnsi(t).includes('Nest Memory'))
  const salidaDe = async (id: string) => sinAnsi((await salidas())[id] ?? '')
  return { salidas, paneDeLaTui, salidaDe }
}

test.beforeAll(() => {
  test.skip(!existsSync(TUI), 'hace falta `npm run build`')
})

test('la paleta abre la TUI en un pane, n crea una memoria con $EDITOR y q vuelve al shell', async () => {
  const editor = `"${process.execPath}" "${EDITOR_FALSO}"`
  const h = await launchHarness({
    withRepo: false,
    env: {
      // VISUAL le gana a EDITOR: si el entorno del runner trae uno, se pisa con el mismo.
      VISUAL: editor,
      EDITOR: editor,
      EDITOR_FALSO_MODO: 'valido',
      EDITOR_FALSO_TEXTO: `---\ntitle: ${TITULO}\ntype: decision\ntags: [e2e]\n---\nCreated from the memory TUI in a Nest pane.\n`,
    },
  })
  const { app, page } = h
  try {
    await expect.poll(async () => (await buscarNestVivo({}, h.homeDir, isWin)) !== null, { timeout: 20_000 }).toBe(true)

    const { salidas, paneDeLaTui, salidaDe } = await capturarSalidaPty(app)

    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+k' : 'Control+k')
    const input = page.locator('.cmd-input')
    await expect(input).toBeVisible()
    await input.fill('memory terminal')
    await page.locator('.cmd-item', { hasText: 'Open Memory in terminal' }).click()
    await expect(input).toBeHidden()

    // El pane nuevo, con el label que le pone App.tsx.
    const pane = page.locator('.terminal-pane', { hasText: 'Memory' }).last()
    await expect(pane).toBeVisible()

    await expect.poll(async () => (await paneDeLaTui()) !== undefined, { timeout: 30_000 }).toBe(true)
    const [paneId] = (await paneDeLaTui())!
    await expect.poll(async () => salidaDe(paneId), { timeout: 15_000 }).toContain('Recent')

    // El teclado entra por el xterm del pane, como lo usaría una persona.
    await pane.locator('.terminal-container').click()
    const antesDeN = (await salidaDe(paneId)).length
    await page.keyboard.press('n')
    await expect.poll(async () => (await salidaDe(paneId)).slice(antesDeN), { timeout: 20_000 }).toContain(TITULO)

    // Y está en el store de la app, leído por la API de memoria del renderer.
    await expect.poll(async () => {
      const r = await page.evaluate((q) =>
        (window as unknown as { memory: { crossProject(q: { query: string }): Promise<{ items: Array<{ title: string }> }> } })
          .memory.crossProject({ query: q }), TITULO)
      return r.items.map((i) => i.title)
    }, { timeout: 10_000 }).toContain(TITULO)

    // `q` sale de la TUI y el pane vuelve a su shell: un comando nuevo corre ahí.
    // La salida de la pantalla alternativa se mira DESPUÉS de la `q`: el ida y vuelta con el
    // editor ya la soltó una vez.
    const crudoAntesDeQ = ((await salidas())[paneId] ?? '').length
    await page.keyboard.press('q')
    await expect.poll(async () => ((await salidas())[paneId] ?? '').slice(crudoAntesDeQ), { timeout: 10_000 }).toContain('\x1b[?1049l')
    const antesDelEco = (await salidaDe(paneId)).length
    await page.keyboard.type('echo SHELL_$((40+2))')
    await page.keyboard.press('Enter')
    await expect.poll(async () => (await salidaDe(paneId)).slice(antesDelEco), { timeout: 10_000 }).toContain('SHELL_42')
  } finally {
    await teardown(h)
  }
})

// El botón del header de Memories: cierra el overlay antes de sumar el pane, que si no
// nacería tapado por él.
test('el botón de Memories cierra el overlay y abre la TUI en un pane visible', async () => {
  const h = await launchHarness({ withRepo: false })
  const { app, page } = h
  try {
    await expect.poll(async () => (await buscarNestVivo({}, h.homeDir, isWin)) !== null, { timeout: 20_000 }).toBe(true)
    const { paneDeLaTui } = await capturarSalidaPty(app)

    await page.getByTitle(/^Memories/).first().click()
    const overlay = page.locator('.memories-workspace')
    await expect(overlay).toBeVisible()
    await overlay.getByRole('button', { name: 'Open Memory in terminal' }).click()

    await expect(overlay).toBeHidden()
    await expect(page.locator('.terminal-pane', { hasText: 'Memory' }).last()).toBeVisible()
    await expect.poll(async () => (await paneDeLaTui()) !== undefined, { timeout: 30_000 }).toBe(true)
  } finally {
    await teardown(h)
  }
})
