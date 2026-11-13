// Una animación infinita viva hace que Chromium produzca frames a la tasa del monitor mientras
// dure, aunque anime un punto de 6px. Medido el 2026-11-06: el punto de trial (box-shadow en
// loop, siempre a la vista) costaba ~22% de CPU en reposo, y el de actividad de la pestaña ~11
// con un agente trabajando. Una infinita sólo se acepta en algo pasajero —un skeleton, un
// spinner, un estado de CI corriendo— y entra a esta lista a conciencia.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const raiz = resolve(here, '../../..')
const global = readFileSync(resolve(raiz, 'src/styles/global.css'), 'utf8')

const PASAJERAS = [
  '.pr-skeleton-item',
  '.feed-skeleton-icon',
  '.feed-skeleton-line',
  '.ci-badge--running .ci-badge-dot',
  '.actions-status--running',
  '.actions-skeleton',
  '.rb-refresh--spinning',
  '.jcf-submit-spinner',
  '.gb-mn.working .gb-dot',
  '.gb-mn.needs .gb-dot',
  '.gb-node.working .gb-s',
  '.gb-node.needs .gb-s',
  '.ts-status-dot.online',
  '.ts-skeleton',
]

/** El selector de cada regla cuyo cuerpo tiene una animación `infinite`. */
function selectoresConInfinita(css: string): string[] {
  const sinComentarios = css.replace(/\/\*[\s\S]*?\*\//g, '')
  const out: string[] = []
  for (const m of sinComentarios.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (/animation[^;]*\binfinite\b/.test(m[2]!)) out.push(m[1]!.trim())
  }
  return out
}

describe('animaciones infinitas', () => {
  it('sólo las pasajeras de la lista', () => {
    expect(selectoresConInfinita(global).sort()).toEqual([...PASAJERAS].sort())
  })

  it('los puntos que están siempre a la vista no animan', () => {
    const sinComentarios = global.replace(/\/\*[\s\S]*?\*\//g, '')
    for (const sel of ['.tab-activity-dot', '.user-menu-dot', '.user-menu-dot--trial']) {
      const reglas = [...sinComentarios.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter((m) => m[1]!.trim() === sel)
      expect(reglas.length, sel).toBeGreaterThan(0)
      for (const r of reglas) expect(r[2], sel).not.toMatch(/animation/)
    }
  })
})
