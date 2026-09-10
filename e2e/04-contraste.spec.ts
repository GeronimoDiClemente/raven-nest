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
    const toggle = page.locator('.sidebar-toggle')
    if ((await page.locator('.sidebar.expanded').count()) === 0) await toggle.click()
    await page.waitForTimeout(1200)

    const pantallas: Array<[string, () => Promise<void>]> = [
      ['workspace', async () => {}],
      ['memories', async () => {
        await page.locator('.sidebar-item', { hasText: 'Memories' }).first().click()
        await page.waitForTimeout(800)
      }],
      ['settings', async () => {
        await page.locator('.memories-workspace .tw-back-btn').click()
        await page.locator('.sidebar-item-settings').first().click()
        await page.getByRole('button', { name: 'Account', exact: true }).first().click()
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
