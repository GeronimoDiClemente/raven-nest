import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { globSync } from 'fs'

/**
 * La app es en ingles y tiene que seguir siendolo.
 *
 * Los COMENTARIOS del codigo estan en espanol y asi se quedan: es el idioma en el que se
 * piensa este repo y cambiarlos no le sirve a ningun usuario. Lo que no puede estar en
 * espanol es lo que SALE de la app: lo que lee una persona en pantalla, lo que se manda a
 * Slack, y lo que entra al contexto de un agente.
 *
 * Este guard existe porque el español se fue filtrando de a uno, en lugares que nadie mira
 * dos veces: un mensaje de error de un caso raro, el texto que el shim MCP le imprime a un
 * agente cuando Nest esta cerrado, el titulo de una memoria que escribe el puente. Ninguno
 * se ve en la pantalla principal, y por eso ninguno se corrigio solo.
 */

/** Acentos, enye y signos invertidos: inequivocamente espanol. */
const MARCA = /[áéíóúñ¿¡]/i

/**
 * Lo que NO cuenta, y por que cada uno:
 *
 * - `src/tutorial/` — los tours son bilingues a proposito (`{ en, es }`) y
 *   `resolveTutorialLocale()` devuelve `'en'` fijo, asi que el espanol es una tabla de
 *   traduccion que no se renderiza nunca.
 * - `memory-mcp/tools.ts` — las descripciones de las herramientas incluyen frases de EJEMPLO
 *   en otros idiomas ("cómo resolvimos") para que el modelo reconozca a un usuario que
 *   pregunta por su trabajo pasado sin hablar ingles. Sacarlas empeoraria la herramienta.
 * - `mockAdapter.ts` — nombres de personas de mentira para los mocks.
 */
const EXCEPCIONES = [
  'src/tutorial/',
  'electron/memory-mcp/tools.ts',
  'src/integrations/mockAdapter.ts',
]

function archivosDeFuente(): string[] {
  const raiz = process.cwd()
  const patrones = ['src/**/*.ts', 'src/**/*.tsx', 'electron/**/*.ts']
  const todos = patrones.flatMap((p) => globSync(p, { cwd: raiz }))
  return todos.filter((f) => !f.includes('__tests__') && !EXCEPCIONES.some((e) => f.includes(e)))
}

/** Saca comentarios de bloque, de linea y de JSX, para mirar solo los literales. */
function sinComentarios(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
}

describe('lo que sale de la app esta en ingles', () => {
  it('ningun literal visible al usuario tiene acentos ni enye', () => {
    const culpables: string[] = []
    for (const archivo of archivosDeFuente()) {
      const limpio = sinComentarios(readFileSync(join(process.cwd(), archivo), 'utf8'))
      const literales = limpio.matchAll(/'([^'\\\n]{4,200})'|"([^"\\\n]{4,200})"|`([^`\\\n]{4,200})`/g)
      for (const m of literales) {
        const s = m[1] ?? m[2] ?? m[3]
        if (MARCA.test(s)) culpables.push(`${archivo}\n    ${s.slice(0, 100)}`)
      }
    }
    expect(culpables.join('\n'), 'texto en espanol que la app puede mostrar').toEqual('')
  })
})
