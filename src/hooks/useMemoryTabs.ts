import { useCallback, useEffect, useReducer } from 'react'
import { ESTADO_INICIAL, tabsReducer, type MemoryTab, type TabsState } from '../lib/memory-tabs'

// Vive mientras la app está abierta: cerrar y reabrir el overlay vuelve a las mismas
// pestañas; reiniciar la app vuelve a sólo Graph (spec §3).
let ultimo: TabsState = ESTADO_INICIAL

export function useMemoryTabs(conHilo: boolean) {
  const [state, dispatch] = useReducer(tabsReducer, ultimo)
  useEffect(() => { ultimo = state }, [state])
  useEffect(() => { dispatch({ type: 'setThread', on: conHilo }) }, [conHilo])
  return {
    ...state,
    open: useCallback((tab: MemoryTab, opts?: { background?: boolean }) => dispatch({ type: 'open', tab, background: opts?.background }), []),
    close: useCallback((id: string) => dispatch({ type: 'close', id }), []),
    activate: useCallback((id: string) => dispatch({ type: 'activate', id }), []),
    replace: useCallback((id: string, tab: MemoryTab) => dispatch({ type: 'replace', id, tab }), []),
  }
}

/** Sólo para tests: vuelve la caché de sesión al inicio. */
export function __reiniciarPestanas(): void { ultimo = ESTADO_INICIAL }
