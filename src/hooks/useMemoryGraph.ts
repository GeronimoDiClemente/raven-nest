// Lee el grafo de memorias del store y lo deja listo para dibujar.
//
// El puente de datos ya existía (electron/memory-graph.ts, commits 1c7b948 y 4440f0f) y
// nunca se había consumido desde la UI: lo que se veía en Memories era TeamThreadGraph, que
// es el grafo de RAMAS de git, otra cosa.
import { useCallback, useEffect, useState } from 'react'
import type { MemoryGraph } from '../types'
import { toGraphData, type GraphData } from '../lib/memory-graph-visuals'

export interface MemoryGraphState {
  data: GraphData | null
  /** Cuántos nodos dejó afuera el `limit` del store. Se muestra: un grafo recortado que no
   *  avisa que está recortado miente sobre lo que hay. */
  truncated: number
  loading: boolean
  /** Mensaje de error, o null. La pantalla NO se cae si esto falla (spec §"Manejo de
   *  errores"): el resto de Memories sigue funcionando y este cuadro dice qué pasó. */
  error: string | null
}

const VACIO: MemoryGraphState = { data: null, truncated: 0, loading: true, error: null }

/**
 * @param includeSimilar Las aristas por similitud son inferencia, no un hecho afirmado, así
 * que van apagadas por default — acá y en la capa de datos. Se piden sólo cuando el usuario
 * las prende; no se traen para después filtrarlas.
 */
export function useMemoryGraph(includeSimilar: boolean): MemoryGraphState & { refresh: () => void } {
  const [state, setState] = useState<MemoryGraphState>(VACIO)
  const [nonce, setNonce] = useState(0)
  const refresh = useCallback(() => setNonce((n) => n + 1), [])

  useEffect(() => {
    let alive = true
    setState((s) => ({ ...s, loading: true }))

    const leer = window.memory?.graph
    if (!leer) {
      // Preload viejo (dev, o un test que no lo mockea). No es un error del usuario: el
      // cuadro simplemente no se monta.
      setState({ data: null, truncated: 0, loading: false, error: null })
      return
    }

    // `includeSuperseded: true` a proposito, y al reves que la lista.
    //
    // La lista muestra lo que VALE HOY, asi que esconde las reemplazadas. El grafo muestra
    // COMO SE LLEGO hasta acá, y la arista `revision` es justamente el linaje de una idea
    // (spec §3). Con las reemplazadas afuera, el nodo del otro extremo no existe, la arista
    // se cae por el filtro de puntas huerfanas de toGraphData, y `revision` --una de las
    // cuatro relaciones que la spec pide distinguir-- no puede aparecer NUNCA. Se dibujan
    // mas chicas (ver toGraphData) para que se lean como lo que son: historia, no vigencia.
    leer({ projectKey: null, includeSuperseded: true, includeSimilar })
      .then((graph: MemoryGraph) => {
        if (!alive) return
        setState({ data: toGraphData(graph), truncated: graph.truncated, loading: false, error: null })
      })
      .catch((err: unknown) => {
        if (!alive) return
        setState({
          data: null,
          truncated: 0,
          loading: false,
          error: err instanceof Error ? err.message : 'Could not read the memory graph',
        })
      })

    return () => { alive = false }
  }, [includeSimilar, nonce])

  return { ...state, refresh }
}
