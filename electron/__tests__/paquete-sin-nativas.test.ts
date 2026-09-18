// La invariante que sostiene el paquete portátil entero: desde sus módulos no se llega NUNCA
// a `better-sqlite3` ni a `electron`.
//
// Es la razón de ser de los pasos 3 y 4 del spec —«cero dependencias nativas»— y es
// exactamente la clase de cosa que se rompe sin que nadie se entere: alcanza con que alguien
// agregue un import cómodo en un archivo compartido, tres niveles abajo, para que el paquete
// publicado exija compilar un binding y falle en el `npx` de otra persona.
//
// Se camina el grafo de imports leyendo los archivos, no importándolos: un `import()` real
// tendría que resolver el módulo nativo para descubrir que está, que es justo lo que no se
// puede hacer acá.
import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'fs'
import { join, dirname, resolve } from 'path'

const RAIZ = resolve(__dirname, '..')

/** Lo que el paquete portátil arranca. Todo lo que cuelgue de acá tiene que ser puro Node. */
const ENTRADAS = [
  // La entrada de verdad va primera: si algo se cuela, se cuela por acá.
  'cli-del-paquete.ts',
  'argumentos-del-paquete.ts',
  'base-para-el-paquete.ts',
  'setup-del-paquete.ts',
  'aplicar-setup.ts',
  'login-del-paquete.ts',
  'sync-del-paquete.ts',
  'enrolamiento-del-paquete.ts',
  'llavero-del-sistema.ts',
  'panel-de-la-extension.ts',
  'sqlite-sin-compilar.ts',
  'memory-store.ts',
  'memory-daemon.ts',
]

const PROHIBIDOS = ['better-sqlite3', 'electron', 'node-pty', 'pidusage', 'koffi']

/** Los `from '...'` de un archivo, sin distinguir `import` de `import type`. */
function importsDe(texto: string): string[] {
  const salida: string[] = []
  const re = /(?:^|\n)\s*(?:import|export)[\s\S]*?from\s+['"]([^'"]+)['"]/g
  let m: RegExpExecArray | null
  while ((m = re.exec(texto)) !== null) salida.push(m[1]!)
  return salida
}

function resolverRelativo(desde: string, especificador: string): string | null {
  if (!especificador.startsWith('.')) return null
  const base = join(dirname(desde), especificador)
  for (const cand of [`${base}.ts`, join(base, 'index.ts')]) {
    if (existsSync(cand)) return cand
  }
  return null
}

/** Camina el grafo y devuelve, por cada prohibido encontrado, la cadena que lleva hasta él. */
function cadenasProhibidas(entrada: string): string[] {
  const hallazgos: string[] = []
  const vistos = new Set<string>()

  const caminar = (archivo: string, cadena: string[]) => {
    if (vistos.has(archivo)) return
    vistos.add(archivo)
    const texto = readFileSync(archivo, 'utf8')
    for (const esp of importsDe(texto)) {
      // `import type` de un paquete prohibido se borra al compilar y no arrastra nada, pero
      // distinguirlo bien exige un parser. Se mira el import COMPLETO: si es sólo de tipos,
      // el archivo lo declara con `import type` y se deja pasar.
      const soloTipo = new RegExp(`import\\s+type[\\s\\S]*?from\\s+['"]${esp.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}['"]`).test(texto)
      if (PROHIBIDOS.includes(esp) && !soloTipo) {
        hallazgos.push([...cadena, archivo, esp].map((p) => p.replace(`${RAIZ}/`, '')).join(' → '))
        continue
      }
      const sig = resolverRelativo(archivo, esp)
      if (sig) caminar(sig, [...cadena, archivo])
    }
  }

  caminar(join(RAIZ, entrada), [])
  return hallazgos
}

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
