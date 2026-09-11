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

/** Alto del cuadro declarado en MemoryGraphPanel.tsx. Lo que la spec pide es que NO se coma
 *  la pantalla; acotar el alto alcanza, y el ancho se lo lleva el grafo (pedido del usuario
 *  el 2026-09-11: "que ocupe un poco mas de espacio horizontal"). */
const ALTO = 380

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
    // El ALTO es lo acotado: es lo que impide que el grafo se coma la pantalla.
    expect(Math.round(caja.height)).toBe(ALTO)
    const viewport = page.viewportSize() ?? { width: 1280, height: 800 }
    expect(caja.height).toBeLessThan(viewport.height / 2)
    // Y el ancho es de verdad ancho: el grafo se lleva lo que sobra despues del panel del
    // documento, no un cuadradito.
    expect(caja.width).toBeGreaterThan(ALTO)

    await page.screenshot({ path: join(SHOTS, '02-grafo-con-memorias.png') })

    // 2. La leyenda nombra las relaciones que ESTE grafo tiene, y los proyectos son grupos
    //    con su color (el modelo de Obsidian).
    await expect(page.getByText('Revision', { exact: true })).toBeVisible()
    await expect(page.getByText('Same branch', { exact: true })).toBeVisible()
    // La arista que cruza repos: el mismo topic en dos proyectos. Es lo unico que un grafo
    // de varios proyectos puede mostrar y uno de un solo proyecto no.
    await expect(page.getByText('Same topic, other repo', { exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: /^raven-nest/ })).toBeVisible()

    // El color lo elige el usuario, como los Groups de Obsidian (que son color por
    // consulta). Arranca en Project: medido con datos reales, las memorias de una cuenta
    // son casi todas del MISMO tipo (120 de 120 eran `pattern`), asi que colorear por tipo
    // pinta todo del mismo color. Los proyectos, en cambio, son varios de entrada.
    const porProyecto = page.getByRole('button', { name: 'Project', exact: true })
    const porTipo = page.getByRole('button', { name: 'Type', exact: true })
    await expect(porProyecto).toHaveAttribute('aria-pressed', 'true')
    await porTipo.click()
    await expect(porProyecto).toHaveAttribute('aria-pressed', 'false')
    await porProyecto.click()
    await expect(porProyecto).toHaveAttribute('aria-pressed', 'true')

    // 2b. El filtro de huerfanas (el "Orphans" de Obsidian) arranca PRENDIDO y dice cuantas
    //     esconde. Con las memorias sembradas todas tienen alguna relacion, asi que esconde
    //     cero — pero el boton igual esta y lo dice.
    const filtroHuerfanas = page.getByRole('button', { name: /unconnected/ })
    await expect(filtroHuerfanas).toBeVisible()
    await expect(filtroHuerfanas).toHaveAttribute('aria-pressed', 'true')

    // 3. Seleccionar en la lista resalta en el grafo Y trae el documento al panel: es la
    //    MISMA seleccion. Se verifica por el estado accesible de la fila, que es lo que el
    //    grafo tambien lee.
    const filaSeleccionable = page.getByRole('button', {
      name: /Auth pasa a cookies de sesión/,
    }).first()
    await expect(filaSeleccionable).toHaveAttribute('aria-pressed', 'false')
    await filaSeleccionable.click()
    await expect(filaSeleccionable).toHaveAttribute('aria-pressed', 'true')

    // Y el documento aparece al costado: el contenido entero, no solo el titulo. Es lo que
    // convierte al grafo en algo que se usa en vez de mirarse.
    await expect(page.getByText(/Contenido de Auth pasa a cookies/)).toBeVisible({ timeout: 10_000 })
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

    // 5. Los tags son la tercera dimension, y la mas fiel al Group de Obsidian: alla un
    //    grupo es una consulta, no un campo.
    await expect(page.getByRole('button', { name: 'Tag', exact: true })).toBeEnabled()
    await expect(page.getByRole('button', { name: /^#auth/ })).toBeVisible()

    // 6. Entrar a UN proyecto deja solo sus memorias, y se puede volver. Es el "y despues
    //    si abro UN proyecto tengo todas las de dentro" del pedido.
    await page.getByRole('button', { name: /^otro-proyecto/ }).click()
    const volver = page.getByRole('button', { name: 'Everything' })
    await expect(volver).toBeVisible()
    await page.screenshot({ path: join(SHOTS, '05-dentro-de-un-proyecto.png') })
    await volver.click()

    // 7. Y entrar a un TAG cruza proyectos, al reves que entrar a un proyecto — que es
    //    justamente para lo que sirve tenerlo como agrupador aparte.
    await page.getByRole('button', { name: /^#auth/ }).click()
    await expect(page.getByRole('button', { name: 'Everything' })).toBeVisible()
    await expect(page.getByText('#auth', { exact: true })).toBeVisible()
    await page.screenshot({ path: join(SHOTS, '06-dentro-de-un-tag.png') })
    await page.getByRole('button', { name: 'Everything' }).click()
    await expect(page.getByRole('button', { name: /^raven-nest/ })).toBeVisible()

    // Y el control del color vuelve a estar: adentro de UN proyecto no se ofrece, porque
    // colorear por proyecto cuando son todos el mismo no distingue nada.
    await expect(porProyecto).toBeVisible()
    await expect(porProyecto).toHaveAttribute('aria-pressed', 'true')
  } finally {
    await teardown(h)
  }
})

// Escribir una memoria a mano. Hasta el 2026-09-11 esta pantalla era de SOLO LECTURA:
// unicamente los agentes escribian, y algo que el usuario queria dejar asentado no tenia
// puerta. Se verifica de punta a punta --formulario, IPC, store-- porque el valor esta en que
// lo escrito APAREZCA, no en que el formulario se dibuje.
test('se puede escribir una memoria y aparece en la lista', async () => {
  const h = await launchHarness({ withRepo: false })
  const { page } = h
  try {
    await abrirMemories(page)
    await expect(page.getByText('No memories yet')).toBeVisible({ timeout: 15_000 })

    await page.getByRole('button', { name: 'New memory' }).click()

    const titulo = page.getByLabel('Memory title')
    await expect(titulo).toBeVisible()
    await titulo.fill('El deploy de los viernes se hace a la mañana')
    await page.getByLabel('Memory content').fill('Un rollback a las 19h no lo mira nadie.')
    await page.getByLabel('Memory tags').fill('deploy, proceso')

    // El tipo se elige con su color, el mismo punto que despues se ve en la lista.
    await page.getByRole('button', { name: /^Preference/ }).click()
    await page.getByRole('button', { name: 'Save memory' }).click()

    // Lo que importa: aparece en la lista, sin recargar nada.
    await expect(page.getByText('El deploy de los viernes se hace a la mañana')).toBeVisible({ timeout: 10_000 })
    // Y el formulario se cierra solo — dejarlo abierto invita a guardar lo mismo dos veces.
    await expect(page.getByLabel('Memory title')).toHaveCount(0)

    // El contador de arriba tiene su propio ciclo de lectura: sin refrescarlo decia
    // "0 items" al lado de la memoria recien escrita, que es el tipo de numero que hace
    // desconfiar de toda la pantalla.
    await expect(page.getByText(/^0 items/)).toHaveCount(0)
    await page.screenshot({ path: join(SHOTS, '07-escrita-a-mano.png') })
  } finally {
    await teardown(h)
  }
})

test('sin titulo no se puede guardar: una memoria sin titulo no se encuentra despues', async () => {
  const h = await launchHarness({ withRepo: false })
  const { page } = h
  try {
    await abrirMemories(page)
    await page.getByRole('button', { name: 'New memory' }).click()
    await expect(page.getByRole('button', { name: 'Save memory' })).toBeDisabled()
    await page.getByLabel('Memory title').fill('ya tiene titulo')
    await expect(page.getByRole('button', { name: 'Save memory' })).toBeEnabled()
  } finally {
    await teardown(h)
  }
})
