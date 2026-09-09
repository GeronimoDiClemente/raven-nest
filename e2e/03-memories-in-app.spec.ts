// La verificacion manual que el plan de la fase 1 dejo pendiente en dos lugares:
// Task 7 Step 4 (la escala de z-index) y Task 10 Step 4 (la fila, el overlay y la puerta
// desde Settings). Es el riesgo #1 de la spec §11: "el codigo del rediseño nunca corrio en
// la app real — solo en jsdom".
//
// Escrito como e2e y no como una pasada a ojo para que el dia que alguien mueva un z-index
// o saque la fila de la sidebar, esto grite en vez de descubrirse en produccion.
//
// DOS COSAS QUE ESTE ARCHIVO **NO** CUBRE, y conviene saberlo antes de creerle:
//
// 1. El perfil que levanta el harness es **Free**, y en Free la fila `Personal` abre el
//    modal de upgrade, no el workspace (`onUpgrade` en PersonalItem — que es justo lo que
//    MemoriesItem documenta NO hacer). Asi que "el overlay queda encima de Personal" no se
//    puede ejercitar aca: se verifica contra el panel de Settings, que si es alcanzable en
//    Free, mas la escala numerica del §5.4 leida del CSS real.
// 2. El punto 6 de la lista del plan (§2.2: abrir `claude` de verdad, esperar >15s y ver la
//    fila en rojo) necesita spawnear un agente con credenciales y esperar el timeout. Es un
//    smoke aparte — ver `keepRealHome` en el harness.
import { test, expect } from '@playwright/test'
import { launchHarness, teardown } from './helpers/harness'
import { mkdirSync } from 'fs'
import { join } from 'path'

const SHOTS = join(__dirname, '..', 'test-results', 'memories-in-app')
mkdirSync(SHOTS, { recursive: true })

// Un harness por test, no uno compartido: `app.close()` cuelga (ver `teardown` en el
// harness), y un worker que muere en teardown reinicia el `beforeAll` del siguiente, con lo
// que los tests dejan de ver el estado que el anterior creyo dejarles.

test('la fila Memories esta debajo de Personal y encima del usuario, con su punto', async () => {
  const h = await launchHarness({ withRepo: false })
  const { page } = h
  try {
    // La app arranca con la sidebar COLAPSADA. Sin esto, este test y el de abajo probaban
    // los dos el mismo estado y la captura "expandida" mostraba la colapsada.
    const toggle = page.locator('.sidebar-toggle')
    await expect(toggle).toBeVisible({ timeout: 15_000 })
    if ((await page.locator('.sidebar.expanded').count()) === 0) {
      await toggle.click()
      await expect(page.locator('.sidebar.expanded')).toHaveCount(1)
    }

    const memories = page.locator('.sidebar-item', { hasText: 'Memories' }).first()
    await expect(memories).toBeVisible({ timeout: 15_000 })
    // Expandida la fila muestra ademas el texto de estado al lado del nombre (§4.2).
    await expect(page.locator('.memories-status-text')).toBeVisible()

    // El orden es la mitad del pedido del §4.1 ("hermana de Personal"), asi que se mide por
    // posicion real en pantalla y no por orden en el DOM.
    const personal = page.locator('.sidebar-item', { hasText: 'Personal' }).first()
    const settings = page.locator('.sidebar-item-settings').first()
    const yDe = async (loc: ReturnType<typeof page.locator>) => (await loc.boundingBox())!.y

    expect(await yDe(memories)).toBeGreaterThan(await yDe(personal))
    expect(await yDe(memories)).toBeLessThan(await yDe(settings))

    const dot = page.getByTestId('memories-dot').first()
    await expect(dot).toBeVisible()
    await expect(dot).toHaveAttribute('data-dot', /green|amber|red|grey/)

    await page.screenshot({ path: join(SHOTS, '01-sidebar-expandida.png') })
  } finally {
    await teardown(h)
  }
})

test('colapsada, el punto se sigue viendo — es la unica señal de estado que queda', async () => {
  const h = await launchHarness({ withRepo: false })
  const { page } = h
  try {
    // `title`, no `aria-label`: el boton es `.sidebar-toggle` con title Collapse/Expand
    // (Sidebar.tsx:676). Anclarlo a la clase Y al title deja el test roto a proposito si
    // alguien le saca la etiqueta accesible en vez de pasar en falso.
    const toggle = page.locator('.sidebar-toggle')
    await expect(toggle).toBeVisible({ timeout: 15_000 })
    await expect(toggle).toHaveAttribute('title', /Collapse sidebar|Expand sidebar/)

    // Arranca colapsada, pero no se asume: se fuerza el estado que este test quiere probar.
    if ((await page.locator('.sidebar.expanded').count()) > 0) await toggle.click()
    await expect(page.locator('.sidebar.expanded')).toHaveCount(0)
    // Colapsada, el nombre y el texto de estado desaparecen — el punto es lo unico que queda.
    await expect(page.locator('.memories-status-text')).toHaveCount(0)

    await expect(page.getByTestId('memories-dot').first()).toBeVisible()
    await page.screenshot({ path: join(SHOTS, '02-sidebar-colapsada.png') })
  } finally {
    await teardown(h)
  }
})

test('la escala de z-index del §5.4 es la que dice el plan, y Memories esta en el tope', async () => {
  const h = await launchHarness({ withRepo: false })
  const { page } = h
  try {
    // Task 7 Step 1: las tres custom properties, leidas del CSS que la app CARGO — no del
    // archivo fuente. Un build que no las incluya se ve aca y en ningun otro lado.
    const vars = await page.evaluate(() => {
      const s = getComputedStyle(document.documentElement)
      return {
        base: s.getPropertyValue('--z-overlay-base').trim(),
        front: s.getPropertyValue('--z-overlay-front').trim(),
        top: s.getPropertyValue('--z-overlay-top').trim(),
      }
    })
    expect(vars).toEqual({ base: '1000', front: '1100', top: '1200' })

    await page.locator('.sidebar-item', { hasText: 'Memories' }).first().click()
    const overlay = page.locator('.memories-workspace')
    await expect(overlay).toBeVisible({ timeout: 10_000 })

    // Que use la variable del tope, no un numero suelto — la regla que la Task 7 existe
    // para imponer.
    expect(await overlay.evaluate((el) => Number(getComputedStyle(el).zIndex))).toBe(1200)
    expect(await overlay.evaluate((el) => getComputedStyle(el).position)).toBe('fixed')

    await page.screenshot({ path: join(SHOTS, '03-overlay-abierto.png') })
  } finally {
    await teardown(h)
  }
})

test('el overlay tapa de verdad lo que hay debajo, no solo por numero', async () => {
  const h = await launchHarness({ withRepo: false })
  const { page } = h
  try {
    // Settings como capa de abajo: en Free es el unico overlay alcanzable (Personal manda
    // al modal de upgrade). Su puerta a Memories es ademas lo que la Task 10 dejo.
    await page.locator('.sidebar-item-settings').first().click()
    await page.getByRole('button', { name: 'Account', exact: true }).first().click()

    const puerta = page.getByRole('button', { name: 'Open Memories' })
    await expect(puerta).toBeVisible({ timeout: 10_000 })
    await puerta.click()

    await expect(page.locator('.memories-workspace')).toBeVisible({ timeout: 10_000 })

    // El chequeo que un z-index alto no garantiza: lo que el navegador entrega en el centro
    // de la pantalla tiene que estar ADENTRO del overlay.
    const arriba = await page.evaluate(() =>
      Boolean(document.elementFromPoint(window.innerWidth / 2, window.innerHeight / 2)?.closest('.memories-workspace'))
    )
    expect(arriba).toBe(true)

    await page.screenshot({ path: join(SHOTS, '04-overlay-sobre-settings.png') })
  } finally {
    await teardown(h)
  }
})

test('el overlay se dibuja: fila de estado arriba y un cuerpo, nunca un hueco', async () => {
  const h = await launchHarness({ withRepo: false })
  const { page } = h
  try {
    await page.locator('.sidebar-item', { hasText: 'Memories' }).first().click()
    await expect(page.locator('.memories-workspace .memories-status-row')).toBeVisible({ timeout: 10_000 })

    // Sin repo abierto el overlay explica por que no hay grafo; con repo dibuja el panel del
    // hilo. Los dos son estados validos — lo que NO puede pasar es que no haya ninguno.
    const conGrafo = await page.locator('.memories-workspace .team-thread-panel').count()
    const sinRepo = await page.locator('.memories-workspace .memories-empty').count()
    expect(conGrafo + sinRepo).toBeGreaterThan(0)

    await page.screenshot({ path: join(SHOTS, '05-overlay-cuerpo.png') })

    // Y cierra: un overlay que no se puede cerrar es una trampa, no una pantalla.
    await page.locator('.memories-workspace .tw-back-btn').click()
    await expect(page.locator('.memories-workspace')).toHaveCount(0)
  } finally {
    await teardown(h)
  }
})

test('Settings ya no tiene las tarjetas de memoria — solo la puerta', async () => {
  const h = await launchHarness({ withRepo: false })
  const { page } = h
  try {
    await page.locator('.sidebar-item-settings').first().click()
    await page.getByRole('button', { name: 'Account', exact: true }).first().click()
    await expect(page.getByRole('button', { name: 'Open Memories' })).toBeVisible({ timeout: 10_000 })

    // Lo que la Task 10 SACO de Settings. Si alguna vuelve, es una regresion.
    await expect(page.locator('.memory-vault-card')).toHaveCount(0)
    await expect(page.locator('.memory-hub')).toHaveCount(0)
    await expect(page.locator('.memory-status-card')).toHaveCount(0)

    await page.screenshot({ path: join(SHOTS, '06-settings-solo-la-puerta.png') })
  } finally {
    await teardown(h)
  }
})
