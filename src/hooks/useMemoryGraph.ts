// Lee el grafo de memorias del store.
//
// Devuelve el grafo CRUDO, no el ya traducido a formato de render: los filtros de la UI
// (esconder huérfanas, enfocar un proyecto, colorear por proyecto o por tipo) son
// transformaciones puras sobre estos mismos datos, y hacerlas acá obligaría a volver a
// consultar la base cada vez que alguien toca un toggle. La única opción que SÍ viaja a la
// consulta es `includeSimilar`, porque esas aristas se calculan en SQL.
//
// El puente de datos ya existía (electron/memory-graph.ts, commits 1c7b948 y 4440f0f) y
// nunca se había consumido desde la UI: lo que se veía en Memories era TeamThreadGraph, que
// es el grafo de RAMAS de git, otra cosa.
import { useCallback, useEffect, useState } from 'react'
import type { MemoryGraph } from '../types'

export interface MemoryGraphState {
  graph: MemoryGraph | null
  /** Cuántos nodos dejó afuera el `limit` del store. Se muestra: un grafo recortado que no
   *  avisa que está recortado miente sobre lo que hay. */
  truncated: number
  loading: boolean
  /** Mensaje de error, o null. La pantalla NO se cae si esto falla: el resto de Memories
   *  sigue funcionando y este cuadro dice qué pasó. */
  error: string | null
}

const VACIO: MemoryGraphState = { graph: null, truncated: 0, loading: true, error: null }

/**
 * @param includeSimilar Las aristas por similitud son inferencia, no un hecho afirmado, así
 * que van apagadas por default. Se piden sólo cuando el usuario las prende; no se traen
 * para después filtrarlas.
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
      setState({ graph: null, truncated: 0, loading: false, error: null })
      return
    }

    // `includeSuperseded: true` a proposito, y al reves que la lista.
    //
    // La lista muestra lo que VALE HOY, asi que esconde las reemplazadas. El grafo muestra
    // COMO SE LLEGO hasta acá, y la arista `revision` es justamente el linaje de una idea.
    // Con las reemplazadas afuera, el nodo del otro extremo no existe, la arista se cae por
    // el filtro de puntas huerfanas de toGraphData, y `revision` --una de las cuatro
    // relaciones que la spec pide distinguir-- no puede aparecer NUNCA. Se dibujan mas
    // chicas (ver valorPorGrado) para que se lean como lo que son: historia, no vigencia.
    //
    // `limit` alto: el filtro de huerfanas se aplica DESPUES, en el renderer, asi que con
    // el limite bajo se corria el riesgo de que las 300 que llegan sean justo las sueltas y
    // el grafo se viera vacio aunque haya estructura mas atras.
    leer({ projectKey: null, includeSuperseded: true, includeSimilar, limit: 1500 })
      .then((graph: MemoryGraph) => {
        if (!alive) return
        setState({ graph, truncated: graph.truncated, loading: false, error: null })
      })
      .catch((err: unknown) => {
        if (!alive) return
        setState({
          graph: null,
          truncated: 0,
          loading: false,
          error: err instanceof Error ? err.message : 'Could not read the memory graph',
        })
      })

    return () => { alive = false }
  }, [includeSimilar, nonce])

  return { ...state, refresh }
}
