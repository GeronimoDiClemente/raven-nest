// Guarda de contraste sobre la app REAL.
//
// Existe por un bug que me comí de verdad: al pasar `--primary` de azul a casi
// blanco (dirección Nest Terminal), diecinueve reglas que pintaban
// `background: var(--primary)` seguían con `color: #fff` escrito a mano — texto
// blanco sobre fondo blanco. El botón "New Terminal" quedó ilegible y sólo se
// vio mirando una captura.
//
// Ese es exactamente el tipo de error que una migración de paleta produce en
// serie y que ningún test de unidad ve, porque el color sale de la CASCADA, no
// del markup. Acá se mide lo que el navegador realmente pinta.
//
// Umbral: 3:1. No es WCAG AA para texto normal (4.5:1) a propósito — buena
// parte de la UI de Nest es metadata secundaria deliberadamente atenuada, y
// exigir 4.5 daría cientos de falsos positivos que nadie va a mirar. 3:1 caza
// lo que este test existe para cazar: texto que directamente no se lee.
import { test, expect } from '@playwright/test'
import { launchHarness, teardown } from './helpers/harness'
import { fingirCloudSobreElTope, fingirMaquinas } from './helpers/fingir-cuenta'

const UMBRAL = 3

interface Ofensor {
  texto: string
  selector: string
  color: string
  fondo: string
  ratio: number
}

/**
 * Recorre todo lo visible con texto propio y devuelve lo que no llega al umbral.
 *
 * El fondo se resuelve subiendo por los ancestros hasta encontrar uno opaco,
 * que es lo que hace el navegador al componer: un elemento con
 * `background: transparent` se ve sobre el fondo de su padre, no sobre el suyo.
 */
async function medirContraste(page: import('@playwright/test').Page): Promise<Ofensor[]> {
  return page.evaluate((umbral) => {
    const canal = (c: number) => {
      const s = c / 255
      return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
    }
    const lum = ([r, g, b]: number[]) => 0.2126 * canal(r) + 0.7152 * canal(g) + 0.0722 * canal(b)
    /** Devuelve [r,g,b,a]; null si el color no se puede leer. */
    const parse = (css: string): number[] | null => {
      const m = css.match(/rgba?\(([^)]+)\)/)
      if (!m) return null
      const p = m[1].split(/[,/]/).map((x) => parseFloat(x.trim()))
      return [p[0], p[1], p[2], p.length >= 4 ? p[3] : 1]
    }
    /**
     * El fondo EFECTIVO, componiendo el alpha contra lo que hay detrás.
     *
     * La primera versión de esto devolvía el primer color con alpha > 0 como si
     * fuera opaco, y reportaba el banner de advertencia —ámbar al 8% sobre un
     * panel oscuro— como "ámbar sobre ámbar", 1:1. Dos falsos positivos de tres.
     * Un fondo translúcido HAY que componerlo: es justamente lo que hace el
     * navegador, y ahora que los bordes y superficies del tema son translúcidos
     * (regla 3 de la dirección) el caso dejó de ser raro y pasó a ser el normal.
     */
    const fondoDe = (el: Element): number[] => {
      const capas: number[][] = []
      let cur: Element | null = el
      while (cur) {
        const c = parse(getComputedStyle(cur).backgroundColor)
        if (c && c[3] > 0) {
          capas.push(c)
          if (c[3] >= 1) break // opaco: lo de atrás ya no se ve
        }
        cur = cur.parentElement
      }
      // De atrás hacia adelante, `over` de Porter-Duff.
      let out = [0, 0, 0]
      for (let i = capas.length - 1; i >= 0; i--) {
        const [r, g, b, a] = capas[i]
        out = [0, 1, 2].map((k) => [r, g, b][k] * a + out[k] * (1 - a))
      }
      return out
    }
    const ratio = (a: number[], b: number[]) => {
      const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p)
      return (x + 0.05) / (y + 0.05)
    }
    const nombre = (el: Element) =>
      el.tagName.toLowerCase() + (el.className && typeof el.className === 'string'
        ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.') : '')

    const malos: Ofensor[] = []
    for (const el of Array.from(document.querySelectorAll('*'))) {
      // Sólo elementos con texto PROPIO: si no, se reporta el contenedor y todos
      // sus hijos por el mismo texto.
      const propio = Array.from(el.childNodes)
        .filter((n) => n.nodeType === Node.TEXT_NODE)
        .map((n) => n.textContent ?? '')
        .join('')
        .trim()
      if (!propio) continue

      const st = getComputedStyle(el)
      if (st.visibility === 'hidden' || st.display === 'none' || parseFloat(st.opacity) < 0.15) continue
      const r = el.getBoundingClientRect()
      if (r.width < 2 || r.height < 2) continue

      const fgRaw = parse(st.color)
      if (!fgRaw || fgRaw[3] === 0) continue
      const bg = fondoDe(el)
      // Texto con alpha: se compone sobre su propio fondo antes de medir.
      const fg = fgRaw[3] >= 1
        ? [fgRaw[0], fgRaw[1], fgRaw[2]]
        : [0, 1, 2].map((k) => fgRaw[k] * fgRaw[3] + bg[k] * (1 - fgRaw[3]))
      const cr = ratio(fg, bg)
      if (cr < umbral) {
        malos.push({
          texto: propio.slice(0, 40), selector: nombre(el),
          color: st.color, fondo: `rgb(${bg.map((n) => Math.round(n)).join(', ')})`, ratio: Math.round(cr * 100) / 100,
        })
      }
    }
    return malos
  }, UMBRAL)
}

test('ningún texto de la app queda por debajo de 3:1 de contraste', async () => {
  const h = await launchHarness({ withRepo: true })
  const { page } = h
  try {
    // Locator por rol + nombre accesible (title, unico nombre disponible) en vez de
    // la clase — ver la misma nota en 03-memories-in-app.spec.ts.
    const toggle = page.getByRole('button', { name: /Collapse sidebar|Expand sidebar/ })
    if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click()
    await page.waitForTimeout(1200)

    const pantallas: Array<[string, () => Promise<void>]> = [
      ['workspace', async () => {}],
      ['tools', async () => {
        // La lista de Tools (Task 7): las filas ghost sin variant activa no
        // declaran color de reposo — es la superficie donde el bug de este
        // archivo (texto negro nativo del navegador, sin preflight) se
        // manifestaria si a alguna le faltara la clase de color explicita.
        await page.getByRole('tab', { name: 'Tools' }).click()
        await page.waitForTimeout(500)
      }],
      ['memories', async () => {
        await page.getByTitle(/^Memories/).first().click()
        await page.waitForTimeout(800)
      }],
      // Fix round 1 (review de rama): el repo rule es "todo cambio de UI pasa
      // e2e/04-contraste" y este plan sumó pantallas enteras (Memory settings, la
      // bienvenida) que este archivo nunca medía.
      // Spec 2026-10-21: Memory settings es una pestaña con seis secciones; se mide cada una.
      ['memory-settings-sync', async () => {
        // Sync es la sección con que abre la pestaña.
        await page.locator('.memories-workspace').getByRole('button', { name: 'Memory settings' }).click()
        await page.waitForTimeout(600)
      }],
      ...(['Encryption', 'Editor & graph', 'This project', 'Notes on disk', 'Advanced'] as const).map((s): [string, () => Promise<void>] => [
        `memory-settings-${s}`,
        async () => {
          await page.locator('.memories-workspace').getByRole('navigation', { name: 'Settings sections' })
            .getByRole('button', { name: s, exact: true }).click()
          // This project encadena tres IPC (projectKeyForWorktree → getSettings → status).
          await page.waitForTimeout(800)
        },
      ]),
      ['memories-welcome', async () => {
        // "How it works" está siempre en el header. Bajo RAVEN_E2E=1 la bienvenida no se
        // auto-muestra; el botón la fuerza.
        await page.getByRole('button', { name: 'How it works' }).click()
        await page.waitForTimeout(800)
      }],
      ['settings', async () => {
        // Cierra la bienvenida que dejó el paso anterior: el overlay del Dialog de Radix
        // intercepta los clicks de abajo si no se cierra primero.
        const skip = page.getByRole('button', { name: /Skip/ })
        if (await skip.count()) await skip.click()
        await page.locator('.memories-workspace .tw-back-btn').click()
        await page.locator('.sidebar-item-settings').first().click()
        // Ya no hay pestaña "Account": Settings es una sola pagina con secciones (modelo de
    // Orca). La seccion esta montada desde que se abre el panel, asi que no hay nada que
    // clickear para llegar.
        await page.waitForTimeout(700)
      }],
    ]

    const todos: Array<Ofensor & { pantalla: string }> = []
    for (const [nombre, ir] of pantallas) {
      await ir()
      for (const o of await medirContraste(page)) todos.push({ ...o, pantalla: nombre })
    }

    if (todos.length) {
      console.log('\nTEXTO ILEGIBLE:')
      for (const o of todos) {
        console.log(`  [${o.pantalla}] ${o.ratio}:1  ${o.selector}  "${o.texto}"  ${o.color} sobre ${o.fondo}`)
      }
    }
    expect(todos, `${todos.length} elementos por debajo de ${UMBRAL}:1`).toEqual([])
  } finally {
    await teardown(h)
  }
})

// Review I4: el test de arriba corre con `withRepo: true`, asi que la pantalla
// `memories` siempre dibuja TeamThreadPanel — la Card/CardTitle/CardDescription/Button
// del estado vacio (Task 8) nunca se renderizaban durante el gate. La constraint del
// plan ("todo componente migrado pasa el guard de contraste") no se cumplia como GUARD
// aunque los valores dieran bien medidos a mano; esto la cierra.
test('el estado vacio de Memories (sin repo) tambien pasa el guard de 3:1', async () => {
  const h = await launchHarness({ withRepo: false })
  const { page } = h
  try {
    // 2026-10-19: el estado vacio ("vincular un repo") se mudó de la vista principal a
    // Memory settings → This project (Task 5).
    await page.getByTitle(/^Memories/).first().click()
    await page.getByRole('button', { name: 'Memory settings' }).click()
    await page.getByRole('navigation', { name: 'Settings sections' }).getByRole('button', { name: 'This project', exact: true }).click()
    await page.getByRole('button', { name: /link a repo/i }).waitFor({ timeout: 10_000 })

    const malos = await medirContraste(page)
    if (malos.length) {
      console.log('\nTEXTO ILEGIBLE (estado vacio de Memories):')
      for (const o of malos) {
        console.log(`  ${o.ratio}:1  ${o.selector}  "${o.texto}"  ${o.color} sobre ${o.fondo}`)
      }
    }
    expect(malos, `${malos.length} elementos por debajo de ${UMBRAL}:1`).toEqual([])
  } finally {
    await teardown(h)
  }
})

// Spec 2b-3: Account con Cloud, el toast y la sección Sync sobre el tope. Test aparte y no
// pantallas del de arriba: ese abre Memories antes que Settings, y al desmontarse el
// `useMemory` de CloudMemoryCard su `removeStatusListener` saca TODOS los listeners de
// `memory:status` —también el de SettingsPanel—, así que el status fingido nunca le llegaba
// a Account. Acá Settings se abre sin haber pasado por Memories.
test('Account, el toast de Cloud y Keep syncing también pasan el guard de 3:1', async () => {
  // Arranca en Free para producir el paso free -> cloud con el evento; la facturación sólo
  // se dibuja con un plan pago, o sea desde ahí.
  const h = await launchHarness({
    withRepo: false,
    env: {
      RAVEN_E2E_PLAN: 'free',
      RAVEN_E2E_BILLING: JSON.stringify({ billingInterval: 'monthly', currentPeriodEnd: '2026-11-29T00:00:00Z', cancelAtPeriodEnd: false }),
    },
  })
  const { page } = h
  try {
    const pantallas: Array<[string, () => Promise<void>]> = [
      // El toast vive 8 s: se mide acá y puede seguir visible en la siguiente.
      ['toast-cloud', async () => {
        await page.evaluate(() => window.dispatchEvent(new CustomEvent('nest:e2e-plan', { detail: { plan: 'cloud' } })))
        await page.getByText('Cloud is active — syncing all your projects.').waitFor({ timeout: 10_000 })
      }],
      ['account-cloud', async () => {
        await fingirMaquinas(h)
        await fingirCloudSobreElTope(h)
        await page.locator('.sidebar-item-settings').first().click()
        await page.getByText('3 connected', { exact: true }).waitFor({ timeout: 10_000 })
        await page.getByRole('button', { name: 'Disconnect MacBook', exact: true }).click()
        await page.getByText('Disconnect MacBook?', { exact: true }).waitFor()
        // La animación de entrada del panel.
        await page.waitForTimeout(700)
      }],
      ['memory-settings-keep-syncing', async () => {
        await page.getByRole('button', { name: /local only — Keep syncing in Memory settings ›$/ }).click()
        await page.locator('.memories-workspace').getByRole('combobox', { name: 'Keep syncing' }).waitFor({ timeout: 10_000 })
        // Medir a mitad del fundido mezcla las dos pantallas.
        await page.waitForTimeout(800)
      }],
    ]

    const todos: Array<Ofensor & { pantalla: string }> = []
    for (const [nombre, ir] of pantallas) {
      await ir()
      for (const o of await medirContraste(page)) todos.push({ ...o, pantalla: nombre })
    }
    if (todos.length) {
      console.log('\nTEXTO ILEGIBLE (cuenta):')
      for (const o of todos) {
        console.log(`  [${o.pantalla}] ${o.ratio}:1  ${o.selector}  "${o.texto}"  ${o.color} sobre ${o.fondo}`)
      }
    }
    expect(todos, `${todos.length} elementos por debajo de ${UMBRAL}:1`).toEqual([])
  } finally {
    await teardown(h)
  }
})
