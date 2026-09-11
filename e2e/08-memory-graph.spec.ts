// El grafo de MEMORIAS en la app real: acotado, 3D, y una vista de la lista.
//
// Spec 2026-09-11 §3. Verifica en pantalla las tres cosas que la spec pide y que un test de
// jsdom no puede ver, porque dependen de layout y de WebGL:
//
// 1. El cuadro NO se come la pantalla: es un cuadrado de lado fijo.
// 2. Con cero memorias no se monta ningún cuadro vacío.
// 3. Seleccionar en la lista y seleccionar en el grafo son la misma selección.
//
// Y deja las capturas, que es la única forma de revisar que un grafo 3D se ve bien.
import { test, expect } from '@playwright/test'
import { launchHarness, teardown } from './helpers/harness'
import { seedMemories, MEMORIAS_DE_MUESTRA } from './helpers/seed-memories'
import { mkdirSync } from 'fs'
import { join } from 'path'

const SHOTS = join(__dirname, '..', '.superpowers', 'sdd', 'shots', 'memory-graph')
mkdirSync(SHOTS, { recursive: true })

/** Lado del cuadro declarado en MemoryGraphPanel.tsx. Si alguien lo cambia, este test se lo
 *  hace notar — el punto de la spec es que sea FIJO, no que valga 320. */
const LADO = 320

async function abrirMemories(page: import('@playwright/test').Page) {
  const toggle = page.getByRole('button', { name: /Collapse sidebar|Expand sidebar/ })
  await expect(toggle).toBeVisible({ timeout: 15_000 })
  if ((await toggle.getAttribute('aria-expanded')) !== 'true') {
    await toggle.click()
    await expect(toggle).toHaveAttribute('aria-expanded', 'true')
  }
  await page.getByTitle(/^Memories/).first().click()
  await expect(page.locator('.memories-workspace')).toBeVisible({ timeout: 15_000 })
}

test('sin memorias no se monta ningun cuadro de grafo vacio', async () => {
  const h = await launchHarness({ withRepo: false })
  try {
    await abrirMemories(h.page)
    // El estado vacío de la lista sí aparece; el grafo no.
    await expect(h.page.getByText('No memories yet')).toBeVisible({ timeout: 15_000 })
    await expect(h.page.getByText('How these memories connect')).toHaveCount(0)
    await h.page.screenshot({ path: join(SHOTS, '01-sin-memorias.png') })
  } finally {
    await teardown(h)
  }
})

test('con memorias: el cuadro es acotado, y la seleccion es una sola entre lista y grafo', async () => {
  const h = await launchHarness({ withRepo: false })
  const { page } = h
  try {
    // Primer pase: la app arranca y crea el store con su esquema.
    await abrirMemories(page)
    await expect(page.getByText('No memories yet')).toBeVisible({ timeout: 15_000 })

    seedMemories(h.homeDir, MEMORIAS_DE_MUESTRA)

    // Recargar el renderer y volver a entrar: la lista y el grafo leen al montarse, asi
    // que esto es lo que garantiza que vean lo recien sembrado. (Cerrar y reabrir el
    // overlay tambien deberia alcanzar, pero deja la verificacion atada a que el
    // desmontaje diferido de la animacion de salida haya terminado.)
    await page.reload()
    await expect(page.locator('.app')).toBeVisible({ timeout: 15_000 })
    await abrirMemories(page)

    const fila = page.getByText('Auth pasa a cookies de sesión, no tokens en localStorage')
    await expect(fila).toBeVisible({ timeout: 15_000 })

    // 1. El cuadro existe y es ACOTADO. Esto es lo que el usuario pidió: "un cuadrado
    //    tamaño normal que no expanda todo".
    await expect(page.getByText('How these memories connect')).toBeVisible({ timeout: 15_000 })
    const canvas = page.locator('.memories-workspace canvas').first()
    await expect(canvas).toBeVisible({ timeout: 20_000 })

    // Medir DESPUES de que el zoomIn de la cáscara asiente: durante la animación el
    // overlay está escalado y boundingBox devuelve el tamaño ya transformado, no el de
    // layout (acá daba 319 en vez de 320). Misma trampa que en 07-repo-row-escala.
    const cajaEstable = async (loc: import('@playwright/test').Locator) => {
      let previo = -1
      for (let i = 0; i < 40; i++) {
        const b = (await loc.boundingBox())!
        if (b.width === previo) return b
        previo = b.width
        await page.waitForTimeout(50)
      }
      return (await loc.boundingBox())!
    }

    // La simulación tarda en aquietarse (cooldownTime en MemoryGraph3D) y recién ahí la
    // cámara encuadra. Sin esperarla, la captura muestra el grafo a medio acomodar y sin
    // encuadrar — que es justo lo que hay que poder revisar acá.
    await page.waitForTimeout(5000)

    const caja = await cajaEstable(canvas)
    expect(Math.round(caja.width)).toBe(LADO)
    expect(Math.round(caja.height)).toBe(LADO)
    // Y sobre todo: no se comió la pantalla. Esto es lo que el usuario pidió — "un cuadrado
    // tamaño normal que no expanda todo" — y es la afirmación que de verdad importa acá.
    const viewport = page.viewportSize() ?? { width: 1280, height: 800 }
    expect(caja.width).toBeLessThan(viewport.width / 2)
    expect(caja.height).toBeLessThan(viewport.height / 2)

    await page.screenshot({ path: join(SHOTS, '02-grafo-con-memorias.png') })

    // 2. La leyenda nombra las relaciones que ESTE grafo tiene. Las memorias sembradas
    //    ejercitan revision (una reemplaza a otra), topic y branch.
    // `exact` porque la leyenda repite la palabra en la explicación de al lado ("Written
    // while working on the same branch") y sin esto el locator resuelve a dos elementos.
    await expect(page.getByText('Revision', { exact: true })).toBeVisible()
    await expect(page.getByText('Same branch', { exact: true })).toBeVisible()

    // 3. Seleccionar en la lista resalta en el grafo: es la MISMA selección. Se verifica
    //    por el estado accesible de la fila, que es lo que el grafo también lee.
    const filaSeleccionable = page.getByRole('button', {
      name: /Auth pasa a cookies de sesión/,
    }).first()
    await expect(filaSeleccionable).toHaveAttribute('aria-pressed', 'false')
    await filaSeleccionable.click()
    await expect(filaSeleccionable).toHaveAttribute('aria-pressed', 'true')
    await page.screenshot({ path: join(SHOTS, '03-seleccion-desde-la-lista.png') })

    // Volver a hacer click deselecciona — si no, no hay forma de ver el grafo entero otra vez.
    await filaSeleccionable.click()
    await expect(filaSeleccionable).toHaveAttribute('aria-pressed', 'false')

    // 4. Las aristas por similitud son inferencia, así que arrancan APAGADAS y se prenden
    //    a pedido (spec §3 y capa de datos).
    const toggleSimilar = page.getByRole('button', { name: 'Show guessed links' })
    await expect(toggleSimilar).toBeVisible()
    await expect(toggleSimilar).toHaveAttribute('aria-pressed', 'false')
    await toggleSimilar.click()
    await expect(page.getByRole('button', { name: 'Hide guessed links' })).toHaveAttribute('aria-pressed', 'true')
    await page.screenshot({ path: join(SHOTS, '04-con-aristas-inferidas.png') })
  } finally {
    await teardown(h)
  }
})
