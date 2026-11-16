import { useState, useEffect, useCallback } from 'react'
import type { WorktreeSignalDTO } from '../types'

// Estado de señales por worktree (repoPath → señal). Se llena por IPC y se
// refresca cuando el poller de main emite 'signals:update'. Token en main.
export function useWorktreeSignals(): Record<string, WorktreeSignalDTO> {
  const [byPath, setByPath] = useState<Record<string, WorktreeSignalDTO>>({})
  const refresh = useCallback(async () => {
    // `window.signals?` es defensivo: el bridge puede no estar aún (timing de
    // preload) o faltar en entornos de test que sólo mockean otros bridges.
    const list = (await window.signals?.list().catch(() => [])) ?? []
    setByPath(Object.fromEntries(list.map((s) => [s.repoPath, s])))
  }, [])
  useEffect(() => {
    refresh()
    return window.signals?.onUpdate(refresh)
  }, [refresh])
  return byPath
}
