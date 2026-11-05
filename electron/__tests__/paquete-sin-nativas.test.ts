// La invariante que sostiene el paquete portátil entero: desde sus módulos no se llega NUNCA
// a `better-sqlite3` ni a `electron`.
//
// Es la razón de ser de los pasos 3 y 4 del spec —«cero dependencias nativas»— y es
// exactamente la clase de cosa que se rompe sin que nadie se entere: alcanza con que alguien
// agregue un import cómodo en un archivo compartido, tres niveles abajo, para que el paquete
// publicado exija compilar un binding y falle en el `npx` de otra persona.
//
// El caminador (imports estáticos, leyendo los archivos) vive en `grafo-de-imports.ts`.
import { describe, it, expect } from 'vitest'
import { cadenasHasta } from './grafo-de-imports'

/** Lo que el paquete portátil arranca. Todo lo que cuelgue de acá tiene que ser puro Node. */
const ENTRADAS = [
  // La entrada de verdad va primera: si algo se cuela, se cuela por acá.
  'cli-del-paquete.ts',
  // La TUI entra por un `import()` dinámico, que el caminador no sigue: se camina aparte.
  'tui-del-paquete/arrancar.ts',
  'argumentos-del-paquete.ts',
  'base-para-el-paquete.ts',
  'setup-del-paquete.ts',
  'aplicar-setup.ts',
  'login-del-paquete.ts',
  'enrolamiento-del-paquete.ts',
  'llavero-del-sistema.ts',
  'panel-de-la-extension.ts',
  // La extensión se empaqueta en un `.vsix` que no instala nada: si algo nativo se cuela
  // ahí adentro, el editor no tiene con qué compilarlo.
  'extension-arranque.ts',
  'extension-vscode.ts',
  'sqlite-sin-compilar.ts',
  'memory-store.ts',
  'memory-daemon.ts',
]

const PROHIBIDOS = ['better-sqlite3', 'electron', 'node-pty', 'pidusage', 'koffi']

const cadenasProhibidas = (entrada: string) => cadenasHasta(entrada, PROHIBIDOS)

describe('el paquete portátil no llega a ninguna dependencia nativa', () => {
  for (const entrada of ENTRADAS) {
    it(`desde ${entrada}`, () => {
      expect(cadenasProhibidas(entrada)).toEqual([])
    })
  }

  it('el guard sabe encontrar una cadena cuando la hay', () => {
    // Sin esto, un error en el caminador haría que todo pase por no mirar nada.
    expect(cadenasProhibidas('sqlite-better.ts').length).toBeGreaterThan(0)
  })
})
