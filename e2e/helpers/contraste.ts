import type { Page } from '@playwright/test'

export const UMBRAL = 3

export interface Ofensor {
  texto: string
  selector: string
  color: string
  fondo: string
  ratio: number
}

/**
 * Recorre todo lo visible con texto propio y devuelve lo que no llega al umbral.
 *
 * Con `raiz` (selector CSS) mide sólo ese subárbol; el fondo se sigue resolviendo hacia arriba.
 * El fondo se resuelve subiendo por los ancestros hasta encontrar uno opaco,
 * que es lo que hace el navegador al componer: un elemento con
 * `background: transparent` se ve sobre el fondo de su padre, no sobre el suyo.
 */
export async function medirContraste(page: Page, raiz?: string): Promise<Ofensor[]> {
  return page.evaluate(({ umbral, raiz }) => {
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
    const origen = raiz ? document.querySelector(raiz) : null
    if (raiz && !origen) throw new Error(`medirContraste: no existe la raiz ${raiz}`)
    const todos = origen ? [origen, ...Array.from(origen.querySelectorAll('*'))] : Array.from(document.querySelectorAll('*'))
    for (const el of todos) {
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
  }, { umbral: UMBRAL, raiz })
}

