import { useState, useEffect, useCallback } from 'react'
import type { InstalledPlugin } from '../types'

export function useInstalledPlugins() {
  const [installed, setInstalled] = useState<InstalledPlugin[]>([])

  const refresh = useCallback(async () => {
    setInstalled(await window.plugins.list())
  }, [])

  useEffect(() => { void refresh() }, [refresh])

  const install = useCallback(async (pluginId: string, config: Record<string, unknown> = {}) => {
    await window.plugins.save({ pluginId, scope: 'personal', enabled: true, config })
    await refresh()
  }, [refresh])

  const uninstall = useCallback(async (pluginId: string) => {
    await window.plugins.delete(pluginId)
    await refresh()
  }, [refresh])

  const isInstalled = useCallback(
    (id: string) => installed.some((p) => p.pluginId === id),
    [installed],
  )

  return { installed, install, uninstall, isInstalled, refresh }
}
