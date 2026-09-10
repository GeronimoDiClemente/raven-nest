import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const raiz = resolve(here, '../../..')
const tw = readFileSync(resolve(raiz, 'src/styles/tailwind.css'), 'utf8')

// Guard de la Task 13 (item 1). La regla real de preflight que shadcn da por
// hecho es `button, input, optgroup, select, textarea { font: inherit; ... }`.
// Este selector quedó angosto a sólo `button` DOS veces en este branch (5b/7b
// y otra vez al cerrar C1) porque se armó persiguiendo bugs observados en vez
// de copiar la regla completa — con el selector angosto, 91 <input>/<select>/
// <textarea> del renderer caen a la fuente del sistema en vez de heredar
// Geist. Este test existe para que la tercera vez sea un test rojo, no un
// hallazgo de captura.
describe('preflight de form controls (tailwind.css)', () => {
  it('el bloque @layer base nombra los cinco elementos de la regla real de preflight', () => {
    const m = tw.match(/@layer\s+base\s*\{([\s\S]*?)\{/)
    expect(m).not.toBeNull()

    const selector = m![1]
    const elementos = selector
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)

    expect(elementos.sort()).toEqual(['button', 'input', 'optgroup', 'select', 'textarea'].sort())
  })
})
