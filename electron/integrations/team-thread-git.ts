// Parseo puro de la salida de git para el estado de cada rama del hilo de equipo. Sin fs,
// sin child_process — separado de main.ts para que se pueda testear sin invocar git de
// verdad y sin arrastrar `main.ts` entero. Ver team-thread-run.test.ts / Task 7.
import type { EstadoRama } from './team-thread-note'

/**
 * `activa` si hay un worktree abierto en esa rama, `sin-worktree` si la rama existe pero
 * nadie la tiene abierta, `cerrada` si ya no existe.
 *
 * Si `gitDisponible` es `false` (el caller no pudo correr git: no esta instalado, cwd
 * ilegible, etc.) TODAS las ramas quedan en `sin-worktree` — el default menos afirmativo.
 * `cerrada` es una afirmacion mas fuerte ("la rama fue borrada o mergeada") y devolverla
 * cuando en realidad no sabemos nada seria falso, ademas de que el grafo de la Task 10
 * dibuja los nodos `cerrada` apagados: un git roto no puede hacer parecer que todo el
 * trabajo del equipo esta cerrado.
 */
export function parseBranchStates(
  branchOutput: string,
  worktreeOutput: string,
  branches: string[],
  gitDisponible: boolean,
): Record<string, EstadoRama> {
  const out: Record<string, EstadoRama> = {}

  if (!gitDisponible) {
    for (const b of branches) out[b] = 'sin-worktree'
    return out
  }

  const existentes = new Set(
    branchOutput.split('\n').map((l) => l.trim()).filter(Boolean),
  )
  // Una entrada `git worktree list --porcelain` sin linea `branch ` es un worktree en
  // detached HEAD — no tiene rama, y filtrarla por el prefijo ya la deja afuera sin que
  // haga falta un caso especial: no rompe el parseo ni inventa una rama.
  const conWorktree = new Set(
    worktreeOutput.split('\n').filter((l) => l.startsWith('branch '))
      .map((l) => l.slice('branch refs/heads/'.length).trim()).filter(Boolean),
  )

  for (const b of branches) {
    out[b] = conWorktree.has(b) ? 'activa' : existentes.has(b) ? 'sin-worktree' : 'cerrada'
  }
  return out
}
