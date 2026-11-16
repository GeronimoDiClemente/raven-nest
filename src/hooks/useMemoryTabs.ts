import { useCallback, useEffect, useReducer, useState } from 'react'
import { ESTADO_INICIAL, tabsReducer, type MemoryTab, type SeccionDeSettings, type TabsState } from '../lib/memory-tabs'

// Vive mientras la app está abierta: cerrar y reabrir el overlay vuelve a las mismas
// pestañas; reiniciar la app vuelve a sólo Graph.
let ultimo: TabsState = ESTADO_INICIAL
// El último pedido de Settings atendido: App cuenta los pedidos de Account →
// "Memory settings"; cada uno abre Settings UNA vez, aunque el overlay se cierre y se reabra.
let pedidoAtendido = 0
// Lo mismo para el pedido del grafo: App lo sube al arrancar el tour de Memories.
let grafoAtendido = 0

/**
 * @param conHilo `null` = todavía no se sabe: no se toca la pestaña Team thread.
 * @param pedidoDeSettings sube cada vez que algo de afuera pide abrir Memory settings.
 * @param seccionPedida la sección que trae el pedido; sin ella Settings conserva la que tenía.
 * @param pedidoDelGrafo sube cada vez que arranca el tour de Memories: sus anclas (explorer,
 *   grafo, New) están ocultas con Settings activa, y el tour las mediría como una caja 0×0.
 */
export function useMemoryTabs(conHilo: boolean | null, pedidoDeSettings = 0, pedidoDelGrafo = 0, seccionPedida?: SeccionDeSettings) {
  const [state, dispatch] = useReducer(tabsReducer, ultimo)
  useEffect(() => { ultimo = state }, [state])
  useEffect(() => { if (conHilo !== null) dispatch({ type: 'setThread', on: conHilo }) }, [conHilo])
  useEffect(() => {
    if (pedidoDeSettings <= pedidoAtendido) return
    pedidoAtendido = pedidoDeSettings
    dispatch({ type: 'openSettings', section: seccionPedida })
    // seccionPedida se lee sólo cuando el pedido sube: no es dependencia a propósito.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pedidoDeSettings])
  // Durante el render y no en un efecto: el tour se monta en el MISMO commit que sube el pedido
  // y mide su ancla en un efecto pasivo. Con un efecto acá (aun de layout, porque React vacía
  // los pasivos antes del re-render) el tour mediría el explorer todavía oculto. Es el patrón
  // de React de ajustar estado cuando cambia un prop: el re-render pasa antes del commit.
  const [grafoVisto, setGrafoVisto] = useState(grafoAtendido)
  if (pedidoDelGrafo > grafoVisto) {
    setGrafoVisto(pedidoDelGrafo)
    if (state.activeId !== 'graph') dispatch({ type: 'activate', id: 'graph' })
  }
  useEffect(() => { grafoAtendido = Math.max(grafoAtendido, grafoVisto) }, [grafoVisto])
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
export function __reiniciarPestanas(): void { ultimo = ESTADO_INICIAL; pedidoAtendido = 0; grafoAtendido = 0 }
