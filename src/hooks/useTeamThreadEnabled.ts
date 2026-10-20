// ¿El repo activo tiene el hilo del equipo prendido? Es la MISMA lectura con la que
// `TeamThreadPanel` decide si dibujarse (`useTeamThreadSettings`: projectKey del worktree y
// después sus settings), reducida a lo que necesita la pestaña «Team thread» de Memories.
//
// `null` = todavía no se sabe (leyendo). No es lo mismo que `false`: al reabrir el overlay la
// pestaña viene de la caché de sesión, y tratar "leyendo" como "apagado" la sacaba (y movía
// la activa a Graph) antes de que llegara la respuesta. Si la lectura falló, `false`.
import { useTeamThreadSettings } from './useTeamThreadSettings'

export function useTeamThreadEnabled(activeRepoPath: string | null, nonce = 0): boolean | null {
  const { ready, enabled, error } = useTeamThreadSettings(activeRepoPath, nonce)
  if (!activeRepoPath) return false
  if (!ready) return null
  return enabled && error === null
}
