// Spec 2026-09-11 §1 (pantalla de Memories legible) — el data-fetching detrás de la
// lista cross-project. window.memory.crossProject() ya existe (electron/memory-store.ts's
// crossProjectMemories(), commit 4fadd02): ordena por updated_at DESC, pagina por
// cursor, excluye borradas y reemplazadas por default. Este hook es el único que sabe
// de paginado incremental y debounce de búsqueda; MemoriesList.tsx solo renderiza.
import { useCallback, useEffect, useRef, useState } from 'react'
import type { CrossProjectObservation } from '../types'

export type CrossProjectMemoriesStatus = 'loading' | 'ready' | 'error' | 'unavailable'

export interface CrossProjectMemoriesState {
  status: CrossProjectMemoriesStatus
  items: CrossProjectObservation[]
  error: string | null
  hasMore: boolean
  loadingMore: boolean
  loadMore: () => void
  query: string
  setQuery: (query: string) => void
}

/** Tamaño de página. La lista puede tener miles de filas (spec: "no se traen todas") —
 *  100 balancea pocos viajes de IPC contra no traer de más en la primera pintura. */
const PAGE_SIZE = 100

/** Espera antes de re-consultar tras cada tecla, para no mandar un IPC por caracter. */
const DEBOUNCE_MS = 250

export function useCrossProjectMemories(debounceMs = DEBOUNCE_MS): CrossProjectMemoriesState {
  const [query, setQuery] = useState('')
  const [items, setItems] = useState<CrossProjectObservation[]>([])
  const [cursor, setCursor] = useState<string | null>(null)
  const [hasMore, setHasMore] = useState(false)
  const [status, setStatus] = useState<CrossProjectMemoriesStatus>('loading')
  const [error, setError] = useState<string | null>(null)
  const [loadingMore, setLoadingMore] = useState(false)

  // Evita setState despues de desmontar (el overlay se cierra con un pedido en vuelo) y
  // descarta la respuesta de una busqueda vieja que llega tarde, si el usuario ya tipeo
  // una query distinta antes de que la anterior resolviera.
  const alive = useRef(true)
  const requestSeq = useRef(0)
  useEffect(() => {
    alive.current = true
    return () => { alive.current = false }
  }, [])

  const fetchPage = useCallback(async (q: string, cur: string | null, append: boolean) => {
    const api = typeof window === 'undefined' ? undefined : window.memory
    if (!api?.crossProject) {
      if (alive.current) {
        setStatus('unavailable')
        setItems([])
        setHasMore(false)
      }
      return
    }

    const seq = ++requestSeq.current
    if (append) setLoadingMore(true)
    else setStatus('loading')

    try {
      const page = await api.crossProject({ query: q || undefined, limit: PAGE_SIZE, cursor: cur })
      if (!alive.current || seq !== requestSeq.current) return
      setItems((prev) => (append ? [...prev, ...page.items] : page.items))
      setCursor(page.nextCursor)
      setHasMore(page.nextCursor !== null)
      setStatus('ready')
      setError(null)
    } catch (err) {
      if (!alive.current || seq !== requestSeq.current) return
      setError(err instanceof Error ? err.message : String(err))
      setStatus('error')
      if (!append) {
        setItems([])
        setHasMore(false)
      }
    } finally {
      if (alive.current && seq === requestSeq.current) setLoadingMore(false)
    }
  }, [])

  // Primera carga inmediata; cada cambio de query despues reinicia la paginacion, con
  // debounce para no mandar un IPC por tecla.
  const firstRun = useRef(true)
  useEffect(() => {
    if (firstRun.current) {
      firstRun.current = false
      void fetchPage(query, null, false)
      return
    }
    const id = setTimeout(() => { void fetchPage(query, null, false) }, debounceMs)
    return () => clearTimeout(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, debounceMs])

  const loadMore = useCallback(() => {
    if (!hasMore || loadingMore || status !== 'ready') return
    void fetchPage(query, cursor, true)
  }, [hasMore, loadingMore, status, query, cursor, fetchPage])

  return { status, items, error, hasMore, loadingMore, loadMore, query, setQuery }
}
