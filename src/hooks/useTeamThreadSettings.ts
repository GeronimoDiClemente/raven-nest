// Task 2 (mirar vs. configurar): el estado del hilo de equipo (projectKey + enabled),
// compartido entre TeamThreadPanel (que ademas lee ramas para el grafo) y TeamThreadToggle
// (que vive solo). Antes esto estaba repetido dentro de TeamThreadPanel.load/handleToggle;
// se mueve tal cual, mismos textos de error, para que el toggle no tenga que reimplementarlo.
import { useCallback, useEffect, useState } from 'react'

const LOAD_ERROR = "Couldn't load the team thread. Try again in a moment."
const TOGGLE_ERROR = "Couldn't update the team thread setting. Try again in a moment."

interface UseTeamThreadSettings {
  ready: boolean
  projectKey: string | null
  enabled: boolean
  error: string | null
  setEnabled: (next: boolean) => Promise<void>
}

/**
 * @param nonce Cambiarlo vuelve a leer los settings del mismo repo: lo usa Memories al volver
 * de Memory settings, donde el toggle tiene su PROPIA instancia de este hook y prender o
 * apagar el hilo ahí no le llega a la vista principal.
 */
export function useTeamThreadSettings(activeRepoPath: string | null, nonce = 0): UseTeamThreadSettings {
  const [projectKey, setProjectKey] = useState<string | null>(null)
  const [enabled, setEnabledState] = useState(false)
  const [ready, setReady] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    setReady(false)
    setError(null)

    if (!activeRepoPath) {
      setProjectKey(null)
      setEnabledState(false)
      setReady(true)
      return
    }

    void (async () => {
      try {
        const keyRes = await window.memory?.teamThreadProjectKeyForWorktree?.(activeRepoPath)
        if (!alive) return
        if (!keyRes?.ok || !keyRes.projectKey) { setError(LOAD_ERROR); setReady(true); return }
        const key = keyRes.projectKey
        setProjectKey(key)

        const settingsRes = await window.memory?.teamThreadGetSettings?.(key)
        if (!alive) return
        if (!settingsRes?.ok) { setError(LOAD_ERROR); setReady(true); return }
        setEnabledState(settingsRes.settings?.enabled ?? false)
        setError(null)
        setReady(true)
      } catch {
        if (!alive) return
        setError(LOAD_ERROR)
        setReady(true)
      }
    })()

    return () => { alive = false }
  }, [activeRepoPath, nonce])

  const setEnabled = useCallback(async (next: boolean) => {
    if (!activeRepoPath || !projectKey) return
    try {
      const res = await window.memory?.teamThreadSetSettings?.(projectKey, activeRepoPath, { enabled: next })
      // `message` viene cuando main tiene algo accionable que decir — hoy, que el plan de
      // la cuenta no admite compartir con el equipo (I1). Un codigo de error crudo no se
      // muestra nunca: para eso esta el texto generico.
      if (!res?.ok) { setError(res?.message ?? TOGGLE_ERROR); return }
      setError(null)
      setEnabledState(next)
    } catch {
      setError(TOGGLE_ERROR)
    }
  }, [activeRepoPath, projectKey])

  return { ready, projectKey, enabled, error, setEnabled }
}
