// Cada proceso que puede abrir la base en sólo lectura tiene que registrar el motor al arrancar.
//
// Desde ada7a4c (2026-09-18) `MemoryReadonlyClient` no nombra a ningún motor: le pide uno a
// `sqlite-motor.ts`, y lo pone el arranque de cada entorno. `main.ts` y la CLI del paquete lo
// registraron; el shim del MCP, que es OTRO proceso, no. Resultado: con Nest cerrado —o con
// una Nest sin daemon— cada `memory_search` de cada agente devolvía «No read-only database
// opener was registered at startup», y ningún test lo veía porque los tests registran el motor
// en su propio `setupFiles`.
//
// Se lee el fuente en vez de importarlo: el shim corre `main()` al cargarse y se queda
// escuchando stdin.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'

const RAIZ = resolve(__dirname, '..')

/** Los archivos que arrancan un proceso propio y pueden terminar en `MemoryReadonlyClient`. */
const ENTRADAS = [
  'main.ts',
  'memory-mcp/index.ts',
  'cli-del-paquete.ts',
]

describe('las entradas registran el motor de sólo lectura', () => {
  for (const entrada of ENTRADAS) {
    it(entrada, () => {
      const fuente = readFileSync(resolve(RAIZ, entrada), 'utf8')
      expect(fuente).toMatch(/^usarAbridorDeLecturaPorDefecto\(/m)
    })
  }
})
