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

// Extrae la regla que CONTIENE `font: inherit` dentro de `@layer base`, en
// vez de asumir que es la primera regla del layer (la review — Important 3 /
// Minor 10 — probó que esa asunción da falso rojo si se agrega un comentario,
// una regla `:root` antes, o se envuelve todo en `@media`: los tres casos
// hacían que el match anterior capturara el selector equivocado). Recorremos
// el contenido de `@layer base { ... }` regla por regla (balanceando llaves,
// no con un regex no-greedy que para en el primer `{`) y nos quedamos con la
// que declara `font: inherit`.
function extraerReglaConFontInherit(css: string): { selector: string; cuerpo: string } {
  const inicioLayer = css.match(/@layer\s+base\s*\{/)
  expect(inicioLayer).not.toBeNull()
  const desde = inicioLayer!.index! + inicioLayer![0].length

  // Encontrar el cierre del @layer base balanceando llaves.
  let profundidad = 1
  let i = desde
  while (i < css.length && profundidad > 0) {
    if (css[i] === '{') profundidad++
    else if (css[i] === '}') profundidad--
    i++
  }
  const contenidoLayer = css.slice(desde, i - 1)

  // Dentro del layer, partir en reglas individuales (selector { cuerpo }).
  const reglaRegex = /([^{}]+)\{([^{}]*)\}/g
  let m: RegExpExecArray | null
  while ((m = reglaRegex.exec(contenidoLayer)) !== null) {
    const [, selectorCrudo, cuerpo] = m
    if (/font\s*:\s*inherit\s*;/.test(cuerpo)) {
      return { selector: selectorCrudo.trim(), cuerpo }
    }
  }
  throw new Error('Ninguna regla de @layer base declara font: inherit')
}

describe('preflight de form controls (tailwind.css)', () => {
  it('el bloque @layer base nombra los cinco elementos de la regla real de preflight', () => {
    const { selector } = extraerReglaConFontInherit(tw)
    const elementos = selector
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)

    expect(elementos.sort()).toEqual(['button', 'input', 'optgroup', 'select', 'textarea'].sort())
  })

  // Important 3 de la review: el guard anterior sólo miraba el selector.
  // Probado contra variantes sintéticas, las tres pasaban en verde siendo
  // exactamente la regresión que el test existe para prevenir: borrar las
  // tres declaraciones dejando el selector intacto, y cambiar `font: inherit`
  // por `font-family: inherit` (pierde size/weight/line-height, pero deja
  // "inherit" en el texto). Estas tres aserciones cubren esas dos variantes —
  // afirman las declaraciones LITERALES, no sólo que algo contenga la palabra
  // "inherit".
  it('la regla declara las tres propiedades literales, no una versión angosta', () => {
    const { cuerpo } = extraerReglaConFontInherit(tw)

    expect(cuerpo).toMatch(/font\s*:\s*inherit\s*;/)
    expect(cuerpo).toMatch(/background-color\s*:\s*transparent\s*;/)
    expect(cuerpo).toMatch(/color\s*:\s*inherit\s*;/)
  })

  // La tercera variante de la review (una regla agregada DESPUÉS, en el mismo
  // layer, que pise `font-family` para los mismos elementos) es la que el
  // brief marca como difícil de expresar barato. Esta es la forma barata que
  // encontré: dentro de `@layer base`, ninguna otra regla puede nombrar a los
  // cinco elementos de preflight (button/input/optgroup/select/textarea, como
  // tag o como parte de un selector compuesto) y declarar `font`/`font-family`
  // con un valor que no sea `inherit`.
  it('ninguna otra regla de @layer base pisa la fuente heredada de los cinco elementos', () => {
    const inicioLayer = tw.match(/@layer\s+base\s*\{/)
    expect(inicioLayer).not.toBeNull()
    const desde = inicioLayer!.index! + inicioLayer![0].length
    let profundidad = 1
    let i = desde
    while (i < tw.length && profundidad > 0) {
      if (tw[i] === '{') profundidad++
      else if (tw[i] === '}') profundidad--
      i++
    }
    const contenidoLayer = tw.slice(desde, i - 1)

    const elementos = ['button', 'input', 'optgroup', 'select', 'textarea']
    const reglaRegex = /([^{}]+)\{([^{}]*)\}/g
    let m: RegExpExecArray | null
    let reglasQuePisan = 0
    while ((m = reglaRegex.exec(contenidoLayer)) !== null) {
      const [, selectorCrudo, cuerpo] = m
      // Saltar la regla misma de preflight (la que ya afirmamos arriba).
      if (/font\s*:\s*inherit\s*;/.test(cuerpo)) continue

      const nombraElemento = selectorCrudo
        .split(',')
        .map((s) => s.trim())
        .some((sel) => elementos.some((el) => sel === el || sel.startsWith(`${el}.`) || sel.startsWith(`${el}:`) || sel.startsWith(`${el} `)))

      if (!nombraElemento) continue

      const pisaFont = /font(-family)?\s*:\s*(?!inherit\b)[^;]+;/.test(cuerpo)
      if (pisaFont) reglasQuePisan++
    }

    expect(reglasQuePisan).toBe(0)
  })
})
