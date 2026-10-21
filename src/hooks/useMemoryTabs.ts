import { useCallback, useEffect, useReducer } from 'react'
import { ESTADO_INICIAL, tabsReducer, type MemoryTab, type SeccionDeSettings, type TabsState } from '../lib/memory-tabs'

// Vive mientras la app está abierta: cerrar y reabrir el overlay vuelve a las mismas
// pestañas; reiniciar la app vuelve a sólo Graph (spec §3).
let ultimo: TabsState = ESTADO_INICIAL
// El último pedido de Settings atendido (decisión D5): App cuenta los pedidos de Account →
// "Memory settings"; cada uno abre Settings UNA vez, aunque el overlay se cierre y se reabra.
let pedidoAtendido = 0

/**
 * @param conHilo `null` = todavía no se sabe: no se toca la pestaña Team thread.
 * @param pedidoDeSettings sube cada vez que algo de afuera pide abrir Memory settings.
 */
export function useMemoryTabs(conHilo: boolean | null, pedidoDeSettings = 0) {
  const [state, dispatch] = useReducer(tabsReducer, ultimo)
  useEffect(() => { ultimo = state }, [state])
  useEffect(() => { if (conHilo !== null) dispatch({ type: 'setThread', on: conHilo }) }, [conHilo])
  useEffect(() => {
    if (pedidoDeSettings <= pedidoAtendido) return
    pedidoAtendido = pedidoDeSettings
    dispatch({ type: 'openSettings' })
  }, [pedidoDeSettings])
  return {
    ...state,
    open: useCallback((tab: MemoryTab, opts?: { background?: boolean }) => dispatch({ type: 'open', tab, background: opts?.background }), []),
    close: useCallback((id: string) => dispatch({ type: 'close', id }), []),
    activate: useCallback((id: string) => dispatch({ type: 'activate', id }), []),
    replace: useCallback((id: string, tab: MemoryTab) => dispatch({ type: 'replace', id, tab }), []),
    openSettings: useCallback((section?: SeccionDeSettings) => dispatch({ type: 'openSettings', section }), []),
  }
}

/** Sólo para tests: vuelve la caché de sesión al inicio. */
export function __reiniciarPestanas(): void { ultimo = ESTADO_INICIAL; pedidoAtendido = 0 }
