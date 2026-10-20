// ¿El repo activo tiene el hilo del equipo prendido? Es la MISMA lectura con la que
// `TeamThreadPanel` decide si dibujarse (`useTeamThreadSettings`: projectKey del worktree y
// después sus settings), reducida a un booleano para quien sólo necesita saber si mostrar la
// pestaña «Team thread» de Memories. Mientras carga, o si la lectura falló, es `false`: una
// pestaña fija que aparece y desaparece al primer render sería peor que esperar.
import { useTeamThreadSettings } from './useTeamThreadSettings'

export function useTeamThreadEnabled(activeRepoPath: string | null): boolean {
  const { ready, enabled, error } = useTeamThreadSettings(activeRepoPath)
  return Boolean(activeRepoPath) && ready && enabled && error === null
}
