import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const css = readFileSync(resolve(here, '../../styles/global.css'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')

/**
 * Profundidad de anidamiento en la que arranca cada selector de nivel superior.
 *
 * Ojo: este archivo esta migrando a Tailwind v4, que soporta CSS nesting de
 * verdad (@media, @supports, @container, @keyframes con selectores adentro).
 * Un selector de clase anidado DENTRO DE UNO DE ESOS at-rules es legitimo y
 * no hay que reportarlo. El bug real (`.rb-bullet-logo { .empty-state-wrap {
 * ... } }`) es un selector de clase anidado dentro de OTRA REGLA PLANA — eso
 * es lo unico que se reporta.
 *
 * Para eso llevamos una pila con el tipo de cada bloque abierto (`atrule` vs
 * `rule`) y solo miramos el tipo del bloque inmediato que lo contiene. Las
 * llaves de cada linea se procesan caracter a caracter y en orden real (no
 * por conteo), asi una linea con cierre-y-apertura tipo `} .foo {` o un
 * one-liner `.x { color: red; }` actualizan la pila bien sin arrastrar
 * drift al resto del archivo.
 */
function selectoresAnidados(source: string): string[] {
  const malos: string[] = []
  const pila: Array<'atrule' | 'rule'> = []
  let cabecera = ''
  for (const linea of source.split('\n')) {
    const padreEsReglaPlana = pila.length > 0 && pila[pila.length - 1] === 'rule'
    if (padreEsReglaPlana && /^\.[a-zA-Z][\w-]*/.test(linea)) malos.push(linea.trim().slice(0, 60))
    for (const ch of linea) {
      if (ch === '{') {
        const esAtRule = /^@(media|supports|container|keyframes)\b/.test(cabecera.trim())
        pila.push(esAtRule ? 'atrule' : 'rule')
        cabecera = ''
      } else if (ch === '}') {
        pila.pop()
        cabecera = ''
      } else {
        cabecera += ch
      }
    }
    cabecera += '\n'
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

  // Fix round 1 (revision): sin este par de casos, el chequeo de arriba le
  // pega falso positivo al dia que alguien escriba nesting legitimo en un
  // @media/@supports/@container/@keyframes — y un guard que grita con algo
  // correcto es un guard que terminan borrando.
  describe('selectoresAnidados — distingue nesting legitimo del bug real', () => {
    it('un selector de clase dentro de un @media es legitimo — no se reporta', () => {
      const fixture = [
        '@media (max-width: 600px) {',
        '  .foo {',
        '    color: red;',
        '  }',
        '}',
      ].join('\n')
      expect(selectoresAnidados(fixture)).toEqual([])
    })

    it('un selector de clase dentro de una regla plana sin cerrar SI es el bug — se reporta', () => {
      // Misma forma que `.rb-bullet-logo { ... .empty-state-wrap { ... } }`:
      // `.a` abre y nunca cierra antes de que aparezca `.b`.
      const fixture = ['.a {', '  color: red;', '.b {', '  color: blue;', '}', '}'].join('\n')
      expect(selectoresAnidados(fixture)).toEqual(['.b {'])
    })
  })
})
