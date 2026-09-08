// Todo lo que decide COMO se guarda un handoff como observacion, sacado del handler
// `handoff:write` de main.ts para que se pueda testear.
//
// Por que existe este modulo (C1 de la review final de rama): `handoff:write` es el UNICO
// productor de filas `scope: 'team'` — `decision` nace personal fijo en memory-bridge y en
// el camino MCP, y eso es una garantia de seguridad, no un descuido. Ese handler llamaba a
// `store.save({...})` SIN `gitBranch`, y `memory-store.ts` no deriva nada: guarda
// `input.gitBranch ?? null`. Consecuencia: toda entrada de todo companero caia en
// `general.md`, `ramas/` nunca se escribia, `ramaCanonica()` daba null (estado siempre
// `sin-worktree`), el foco del panel no matcheaba nunca y el grafo quedaba en un punto.
//
// Ninguna review por task lo vio porque TODOS los fixtures del hilo pasan `gitBranch` a
// mano. Por eso el input del save se construye ACA y no inline en main.ts: un test puede
// mirar el objeto exacto que se va a guardar.
import type { ObservationType } from '../memory-protocol'
import type { TeamThreadSettings } from './team-thread-config'
import { scopeForCapture } from './team-thread-promotion'

/** Subconjunto de `MemorySaveInput` que arma este modulo. No se importa el tipo del store
 *  a proposito: eso arrastraria better-sqlite3 a un modulo puro. */
export interface HandoffSaveInput {
  projectKey: string
  scope: 'personal' | 'team'
  type: ObservationType
  title: string
  content: string
  source: 'ui'
  gitBranch: string | null
}

export interface BuildHandoffSaveParams {
  worktreePath: string
  projectKey: string
  title: string
  content: string
  settings: TeamThreadSettings
}

export interface BuildHandoffSaveDeps {
  /** `resolveGitInfoForCwd` de main.ts — la MISMA via que ya usan `handoff:read`,
   *  `projectKeyForWorktree` y el servidor IPC de memoria. No se abre una nueva. */
  resolveGitInfo: (cwd: string) => { branch: string; remoteUrl: string | null } | null
}

/**
 * La rama del worktree, o null. Null es un resultado aceptable, no un error: la fila cae
 * en `general.md` (el comportamiento de hoy) y el handoff se guarda igual. Lo que no puede
 * pasar es que resolver la rama tire o bloquee el guardado, por eso el try/catch.
 *
 * `HEAD` (detached) y el string vacio NO son ramas: guardarlos crearia una nota
 * `ramas/head.md` compartida entre worktrees sin relacion.
 */
export function resolveHandoffBranch(worktreePath: string, deps: BuildHandoffSaveDeps): string | null {
  try {
    const branch = deps.resolveGitInfo(worktreePath)?.branch?.trim()
    if (!branch || branch === 'HEAD') return null
    return branch
  } catch {
    return null
  }
}

/** El input exacto que `handoff:write` le pasa a `store.save()`, mas el `heldBack` del
 *  gate de redaccion (spec §6.3) que el handler loguea. */
export function buildHandoffSave(
  params: BuildHandoffSaveParams,
  deps: BuildHandoffSaveDeps,
): { input: HandoffSaveInput; heldBack: boolean } {
  const { scope, heldBack } = scopeForCapture(params.settings, 'handoff', params.title, params.content)
  return {
    input: {
      projectKey: params.projectKey,
      scope,
      type: 'handoff',
      title: params.title,
      content: params.content,
      source: 'ui',
      gitBranch: resolveHandoffBranch(params.worktreePath, deps),
    },
    heldBack,
  }
}
