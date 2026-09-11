// La memoria que estás mirando, entera y con su contenido.
//
// Ni el grafo ni el listado traen `content` — serían cientos de documentos completos por
// consulta. Esto es la lectura puntual del nodo seleccionado, y sale de SQLite, no del
// vault Markdown: el vault es opcional y es una proyección de esta base, no la fuente, así
// que el panel tiene que funcionar con el vault apagado.
import { useEffect, useState } from 'react'
import type { MemoryObservationDetail } from '../types'

export interface MemoryDetailState {
  detail: MemoryObservationDetail | null
  loading: boolean
  /** `true` cuando el id existe en el grafo pero la lectura devolvió null: la memoria se
   *  borró entre que se dibujó el nodo y que la tocaste. Es distinto de "todavía cargando"
   *  y el panel lo dice, en vez de quedarse en blanco para siempre. */
  missing: boolean
}

export function useMemoryDetail(syncId: string | null): MemoryDetailState {
  const [state, setState] = useState<MemoryDetailState>({ detail: null, loading: false, missing: false })

  useEffect(() => {
    if (!syncId) {
      setState({ detail: null, loading: false, missing: false })
      return
    }

    const leer = window.memory?.observation
    if (!leer) {
      setState({ detail: null, loading: false, missing: true })
      return
    }

    let alive = true
    // `detail: null` mientras carga, no el anterior: dejar el documento viejo en pantalla
    // mientras llega el nuevo hace que el panel diga una cosa y el grafo resalte otra.
    setState({ detail: null, loading: true, missing: false })

    leer(syncId)
      .then((detail) => {
        if (!alive) return
        setState({ detail, loading: false, missing: detail === null })
      })
      .catch(() => {
        if (!alive) return
        setState({ detail: null, loading: false, missing: true })
      })

    return () => { alive = false }
  }, [syncId])

  return state
}
