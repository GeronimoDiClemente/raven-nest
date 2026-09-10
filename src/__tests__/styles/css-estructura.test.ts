import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const css = readFileSync(resolve(here, '../../styles/global.css'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')

/** Profundidad de anidamiento en la que arranca cada selector de nivel superior. */
function selectoresAnidados(source: string): string[] {
  const malos: string[] = []
  let depth = 0
  for (const linea of source.split('\n')) {
    const abre = (linea.match(/\{/g) ?? []).length
    const cierra = (linea.match(/\}/g) ?? []).length
    // Un selector de clase que arranca en columna 0 no puede estar anidado: en este
    // archivo no se usa CSS nesting a proposito en ningun lado.
    if (depth > 0 && /^\.[a-zA-Z][\w-]*/.test(linea)) malos.push(linea.trim().slice(0, 60))
    depth += abre - cierra
  }
  return malos
}

/**
 * Bloques de declaraciones sueltas: un `}` que cierra una regla, seguido
 * directo (sin selector en el medio) por una o mas lineas `prop: valor;` y
 * despues otro `}`. Es la firma de una regla que perdio su selector en una
 * edicion (el defecto de la linea ~9291).
 */
function declaracionesHuerfanas(source: string): string[] {
  const malas: string[] = []
  const lineas = source.split('\n').map((l) => l.trim())
  for (let i = 0; i < lineas.length; i++) {
    if (lineas[i] !== '}') continue
    let j = i + 1
    while (j < lineas.length && (lineas[j] === '' || /^[a-z-]+:\s*[^;]+;$/.test(lineas[j]))) j++
    // Hubo al menos una declaracion entre el `}` y el proximo `}`/selector, y lo
    // que sigue es otro cierre de bloque -> esas declaraciones no tienen selector.
    if (j > i + 1 && lineas[j] === '}') {
      const primera = lineas.slice(i + 1, j).find((l) => l !== '') ?? lineas[i + 1]
      malas.push(primera)
    }
  }
  return malas
}

describe('global.css — estructura', () => {
  // El bug del 2026-09-09: `.rb-bullet-logo {` sin cerrar dejaba 71 selectores
  // anidados adentro, o sea muertos. Las llaves balanceaban, asi que ningun
  // contador lo veia.
  it('ningun selector de clase queda anidado dentro de otra regla', () => {
    expect(selectoresAnidados(css)).toEqual([])
  })

  it('no hay bloques de declaraciones sin selector', () => {
    expect(declaracionesHuerfanas(css)).toEqual([])
  })
})
