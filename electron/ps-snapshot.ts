/**
 * Una sola foto de la tabla de procesos, compartida por todos los que preguntan.
 *
 * El poll de puertos (cada 5 s) pedía el árbol de procesos de CADA pane por separado, y
 * en macOS/Linux `pidtree` spawnea un `ps -A` sobre la tabla ENTERA por llamada. Con los
 * 12 panes del tope son 12 `ps` cada 5 s, más otros 12 cada 10 s del poll de métricas:
 * medido el 2026-09-17, doce `ps -A` cuestan 0.12 s de CPU (casi todo `sys`), o sea ~3.6%
 * de un core quemándose para siempre en atribuir puertos y medir memoria.
 *
 * Windows ya no tenía este problema: `getWindowsSnapshot()` cachea la tabla 1.5 s porque
 * ahí la consulta es carísima. Esto es la misma idea para el resto — la tabla se lee una
 * vez por ciclo y los árboles salen de caminarla en memoria.
 */

export interface DepsSnapshot {
  /** Corre `ps -A -o ppid,pid` (o equivalente) y devuelve su stdout. */
  correrPs: () => Promise<string>
  now: () => number
  ttlMs: number
}

export interface SnapshotDeProcesos {
  /** El pid y todos sus descendientes. Si no está en la tabla, devuelve `[pid]`. */
  arbolDe(pid: number): Promise<number[]>
}

/** Convierte la salida de `ps -A -o ppid,pid` en un mapa padre → hijos. */
export function parsearTablaDeProcesos(stdout: string): Map<number, number[]> {
  const hijosPorPadre = new Map<number, number[]>()
  for (const linea of stdout.split('\n')) {
    const campos = linea.trim().split(/\s+/)
    if (campos.length < 2) continue
    const ppid = Number(campos[0])
    const pid = Number(campos[1])
    if (!Number.isInteger(ppid) || !Number.isInteger(pid)) continue   // encabezado y basura
    if (ppid === pid) continue                                        // no es hijo de sí mismo
    const hijos = hijosPorPadre.get(ppid)
    if (hijos) hijos.push(pid)
    else hijosPorPadre.set(ppid, [pid])
  }
  return hijosPorPadre
}

/** Camina el mapa. El `visto` no es de más: un ciclo de PPIDs es raro pero pasa. */
function caminar(raiz: number, hijosPorPadre: Map<number, number[]>): number[] {
  const arbol = [raiz]
  const pila = [raiz]
  const visto = new Set<number>([raiz])
  while (pila.length > 0) {
    const p = pila.pop()!
    for (const h of hijosPorPadre.get(p) ?? []) {
      if (visto.has(h)) continue
      visto.add(h)
      arbol.push(h)
      pila.push(h)
    }
  }
  return arbol
}

export function crearSnapshotDeProcesos(deps: DepsSnapshot): SnapshotDeProcesos {
  let tabla: Map<number, number[]> | null = null
  let leidaEn = -Infinity
  // Las doce consultas de un tick llegan en el mismo turno: sin esto cada una vería
  // la caché vacía y arrancaría su propio `ps`, que es exactamente lo que vinimos a evitar.
  let enVuelo: Promise<Map<number, number[]>> | null = null

  const tablaFresca = async (): Promise<Map<number, number[]>> => {
    if (tabla && deps.now() - leidaEn < deps.ttlMs) return tabla
    if (enVuelo) return enVuelo
    enVuelo = (async () => {
      try {
        const t = parsearTablaDeProcesos(await deps.correrPs())
        tabla = t
        leidaEn = deps.now()
        return t
      } catch {
        return new Map<number, number[]>()   // sin tabla, cada pid queda solo
      } finally {
        enVuelo = null
      }
    })()
    return enVuelo
  }

  return {
    async arbolDe(pid) {
      if (!Number.isInteger(pid) || pid <= 0) return []
      return caminar(pid, await tablaFresca())
    },
  }
}
