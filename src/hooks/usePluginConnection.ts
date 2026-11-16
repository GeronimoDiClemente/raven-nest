import { useState, useEffect, useCallback } from 'react'

// Evento propio (no reusa nest:plugins-changed, que es install/uninstall):
// dispara cada vez que se guarda o borra una credencial de un plugin, para
// que cualquier instancia de usePluginConnection() en pantalla se refresque.
const PLUGIN_CONNECTION_CHANGED_EVENT = 'nest:plugin-connection-changed'

export function notifyPluginConnectionChanged(pluginId: string): void {
  window.dispatchEvent(new CustomEvent(PLUGIN_CONNECTION_CHANGED_EVENT, { detail: { pluginId } }))
}

export function usePluginConnection(pluginId: string) {
  const [connected, setConnected] = useState(false)
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    const has = await window.pluginCreds.has(pluginId)
    setConnected(has)
    setLoading(false)
  }, [pluginId])

  useEffect(() => { void refresh() }, [refresh])

  useEffect(() => {
    const onChanged = (e: Event) => {
      const detail = (e as CustomEvent<{ pluginId: string }>).detail
      if (!detail || detail.pluginId === pluginId) void refresh()
    }
    window.addEventListener(PLUGIN_CONNECTION_CHANGED_EVENT, onChanged)
    return () => window.removeEventListener(PLUGIN_CONNECTION_CHANGED_EVENT, onChanged)
  }, [pluginId, refresh])

  return { connected, loading, refresh }
}
