// El caminador de imports ESTÁTICOS de los tests de invariantes del paquete portátil
// (`paquete-sin-nativas`, `paquete-carga-diferida`). No es un test: vitest sólo levanta
// `*.test.ts`.
//
// Se camina el grafo leyendo los archivos, no importándolos: un `import()` real tendría que
// resolver el módulo para descubrir que está, que es justo lo que no se puede hacer acá. Un
// `import('...')` dinámico NO cuenta como arista: es la forma de cargar algo tarde.
import { readFileSync, existsSync } from 'fs'
import { join, dirname, resolve } from 'path'

export const RAIZ = resolve(__dirname, '..')

/** Los `from '...'` de un archivo y los `import '...'` de efecto, sin distinguir `import type`. */
export function importsDe(texto: string): string[] {
  const salida: string[] = []
  const re = /(?:^|\n)\s*(?:import|export)[\s\S]*?from\s+['"]([^'"]+)['"]/g
  let m: RegExpExecArray | null
  while ((m = re.exec(texto)) !== null) salida.push(m[1]!)
  // `import './x'`: sin `from`, el regex de arriba no lo ve (o peor, se come el siguiente).
  const efecto = /(?:^|\n)\s*import\s+['"]([^'"]+)['"]/g
  while ((m = efecto.exec(texto)) !== null) salida.push(m[1]!)
  return salida
}

export function resolverRelativo(desde: string, especificador: string): string | null {
  if (!especificador.startsWith('.')) return null
  const base = join(dirname(desde), especificador)
  for (const cand of [`${base}.ts`, `${base}.tsx`, join(base, 'index.ts')]) {
    if (existsSync(cand)) return cand
  }
  return null
}

const coincide = (esp: string, prohibido: string) => esp === prohibido || esp.startsWith(`${prohibido}/`)

/**
 * Camina el grafo desde `entrada` (relativa a `electron/`) y devuelve, por cada paquete
 * prohibido alcanzado, la cadena que lleva hasta él. `visitados` junta los archivos propios
 * que se recorrieron.
 */
export function cadenasHasta(entrada: string, prohibidos: string[], visitados = new Set<string>()): string[] {
  const hallazgos: string[] = []

  const caminar = (archivo: string, cadena: string[]) => {
    if (visitados.has(archivo)) return
    visitados.add(archivo)
    const texto = readFileSync(archivo, 'utf8')
    for (const esp of importsDe(texto)) {
      // `import type` de un paquete prohibido se borra al compilar y no arrastra nada, pero
      // distinguirlo bien exige un parser. Se mira el import COMPLETO: si es sólo de tipos,
      // el archivo lo declara con `import type` y se deja pasar.
      const soloTipo = new RegExp(`import\\s+type[\\s\\S]*?from\\s+['"]${esp.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}['"]`).test(texto)
      if (prohibidos.some((p) => coincide(esp, p)) && !soloTipo) {
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
