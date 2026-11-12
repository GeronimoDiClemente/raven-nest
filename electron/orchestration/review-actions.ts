// Las tres decisiones de Gero sobre la rama de un worker (spec §6.7): merge en la rama del
// coordinador, abrir un PR, o descartar. Todo el IO entra por `deps` (git en array, sin shell).
//
// Nada de esto corre solo: cada acción sale de un click en el panel de revisión. Y ninguna
// empuja la rama base: `merge` es local (nunca `git push`), y `openPr` empuja SÓLO la rama del
// worker (anti-meta §4: nada llega a main sin una decisión de Gero).

import { existsSync, realpathSync } from 'node:fs'
import { isAbsolute, resolve } from 'node:path'
import type { ReviewEntry, ReviewStore } from './review-store'

export type ReviewError =
  | 'unknown_worker'
  | 'invalid_entry'
  | 'detached_head'
  | 'worker_dirty'
  | 'base_not_checked_out'
  | 'coordinator_dirty'
  | 'merge_conflict'
  | 'merge_failed'
  | 'remove_failed'
  | 'git_failed'
  | 'no_github_remote'
  | 'push_failed'

export type ReviewResult = { ok: true } | { ok: false; error: ReviewError; detail?: string }

export interface ReviewActionDeps {
  runGit(args: string[], opts: { timeout: number }): Promise<string>
  store: Pick<ReviewStore, 'remove'>
  /** Borra el worktree del worker (en main: la lógica de `worktree:remove`, que además mata
   *  los panes que viven adentro). */
  removeWorktree(e: ReviewEntry): Promise<{ ok: true } | { ok: false; error: string }>
  /** Empuja la rama del worktree a origin (en main: la lógica de `git:pushBranch`). */
  pushBranch(worktreePath: string): Promise<{ ok: true } | { ok: false; error: string }>
  openExternal(url: string): Promise<void> | void
}

const REF_VALIDO = /^[a-zA-Z0-9._/-]+$/
const T_CORTO = 5_000
const T_MERGE = 60_000

const falla = (error: ReviewError, detail?: string): ReviewResult =>
  detail ? { ok: false, error, detail } : { ok: false, error }

const mensaje = (err: unknown): string => {
  const raw = err instanceof Error ? err.message : String(err)
  return raw.split('\n').find((l) => /fatal:|error:/.test(l))?.trim() ?? raw.split('\n')[0]
}

/** owner/repo de una URL de `origin` de GitHub (https, ssh o scp-like). null si no es GitHub. */
export function parseGithubRepo(url: string): { owner: string; repo: string } | null {
  const m = url
    .trim()
    .match(/^(?:https?:\/\/|ssh:\/\/)?(?:[^@/\s]+@)?github\.com[:/]([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/i)
  return m ? { owner: m[1], repo: m[2] } : null
}

interface WorktreeListado { path: string; branch: string | null; principal: boolean }

/** Parsea `git worktree list --porcelain`. El primer bloque es siempre el worktree principal. */
function parsearWorktrees(porcelain: string): WorktreeListado[] {
  const out: WorktreeListado[] = []
  for (const bloque of porcelain.split(/\n\s*\n/)) {
    const path = bloque.match(/^worktree (.+)$/m)?.[1]
    if (!path) continue
    const rama = bloque.match(/^branch refs\/heads\/(.+)$/m)?.[1]
    out.push({ path: path.trim(), branch: rama ? rama.trim() : null, principal: out.length === 0 })
  }
  return out
}

/** Para comparar carpetas: la real si existe (en macOS /var es /private/var), si no la resuelta. */
function carpeta(p: string): string {
  try {
    return realpathSync(p)
  } catch {
    return resolve(p)
  }
}

/** Nombre de rama que se puede pasar a git sin que se lea como opción. */
const ramaSegura = (b: string): boolean => REF_VALIDO.test(b) && !b.startsWith('-') && b !== 'HEAD'

/** Cola por clave: dos merges en el mismo worktree base corren de a uno. */
function crearCandado() {
  const colas = new Map<string, Promise<unknown>>()
  return async <T>(clave: string, fn: () => Promise<T>): Promise<T> => {
    const previa = colas.get(clave) ?? Promise.resolve()
    const actual = previa.then(fn, fn)
    const fin = actual.then(() => undefined, () => undefined)
    colas.set(clave, fin)
    try {
      return await actual
    } finally {
      if (colas.get(clave) === fin) colas.delete(clave)
    }
  }
}

export function createReviewActions(deps: ReviewActionDeps) {
  const git = (args: string[], timeout = T_CORTO) => deps.runGit(args, { timeout })
  const conCandado = crearCandado()

  /**
   * La entrada sale de un JSON en disco: no se le cree. Antes de tocar nada se cruza con
   * `git worktree list` del repo: el worktree tiene que ser uno registrado que NO sea el
   * principal y tener checked out justo la rama del worker. `ausente` = la carpeta ya no está
   * (sólo Discard la acepta, para borrar la rama). Todo lo demás es `invalid_entry`, y ningún
   * camino que mata panes o borra carpetas corre con un path que no pasó por acá.
   */
  const verificar = async (
    e: ReviewEntry
  ): Promise<{ ok: true; estado: 'registrado' | 'ausente'; worktrees: WorktreeListado[] } | { ok: false; r: ReviewResult }> => {
    const invalida = { ok: false as const, r: falla('invalid_entry') }
    if (!ramaSegura(e.branch)) return invalida
    if (e.baseBranch !== 'HEAD' && (!REF_VALIDO.test(e.baseBranch) || e.baseBranch.startsWith('-'))) return invalida
    if (e.branch === e.baseBranch) return invalida
    if (!isAbsolute(e.repoPath) || !isAbsolute(e.worktreePath)) return invalida
    let worktrees: WorktreeListado[]
    try {
      worktrees = parsearWorktrees(await git(['-C', e.repoPath, 'worktree', 'list', '--porcelain']))
    } catch (err) {
      return { ok: false, r: falla('git_failed', mensaje(err)) }
    }
    const objetivo = carpeta(e.worktreePath)
    const registrado = worktrees.find((w) => carpeta(w.path) === objetivo)
    if (registrado?.principal) return invalida
    if (!existsSync(e.worktreePath)) {
      // Una carpeta que ya no existe no se borra ni se mata nada adentro; a lo sumo la rama.
      return { ok: true, estado: 'ausente', worktrees }
    }
    if (!registrado || registrado.branch !== e.branch) return invalida
    return { ok: true, estado: 'registrado', worktrees }
  }

  return {
    async merge(e: ReviewEntry): Promise<ReviewResult> {
      if (e.baseBranch === 'HEAD') return falla('detached_head')
      const v = await verificar(e)
      if (!v.ok) return v.r
      if (v.estado !== 'registrado') return falla('invalid_entry')

      // Borrar el worktree con `--force` se lleva lo no commiteado: si el worker dejó algo
      // (incluidos archivos nuevos), no se mergea ni se borra nada.
      try {
        if ((await git(['-C', e.worktreePath, 'status', '--porcelain'])) !== '') return falla('worker_dirty')
      } catch (err) {
        return falla('git_failed', mensaje(err))
      }

      const baseWt = v.worktrees.find((w) => w.branch === e.baseBranch)?.path
      if (!baseWt) return falla('base_not_checked_out')

      return conCandado(carpeta(baseWt), async () => {
        // Un merge que Gero dejó a medias en la base es suyo: no se toca (ni se aborta).
        try {
          await git(['-C', baseWt, 'rev-parse', '-q', '--verify', 'MERGE_HEAD'])
          return falla('coordinator_dirty')
        } catch {
          /* sin MERGE_HEAD: se sigue */
        }
        // Sólo lo trackeado: un archivo suelto que no choca no bloquea, y si chocara git
        // rechaza el merge antes de empezar (merge_failed, sin nada a medias).
        try {
          const sucio = await git(['-C', baseWt, 'status', '--porcelain', '--untracked-files=no'])
          if (sucio !== '') return falla('coordinator_dirty')
        } catch (err) {
          return falla('git_failed', mensaje(err))
        }

        try {
          // La ref completa: nunca se puede leer como opción ni como otra cosa que esta rama.
          await git(['-C', baseWt, 'merge', '--no-ff', '--no-edit', `refs/heads/${e.branch}`], T_MERGE)
        } catch (err) {
          let aMedias = false
          try {
            await git(['-C', baseWt, 'rev-parse', '-q', '--verify', 'MERGE_HEAD'])
            aMedias = true
          } catch {
            aMedias = false
          }
          if (aMedias) {
            try {
              await git(['-C', baseWt, 'merge', '--abort'])
            } catch (abortErr) {
              return falla('merge_failed', `merge --abort failed: ${mensaje(abortErr)}`)
            }
            return falla('merge_conflict')
          }
          return falla('merge_failed', mensaje(err))
        }

        const r = await deps.removeWorktree(e)
        // Ya está mergeado: la entrada queda para reintentar (un merge repetido no hace nada).
        if (!r.ok) return falla('remove_failed', r.error)
        deps.store.remove(e.workerId)
        return { ok: true } as ReviewResult
      })
    },

    async openPr(e: ReviewEntry): Promise<ReviewResult> {
      const v = await verificar(e)
      if (!v.ok) return v.r
      // pushBranch empuja lo que el worktree tenga checked out: verificar ya confirmó que es la
      // rama del worker (y nunca la base ni el worktree principal).
      if (v.estado !== 'registrado') return falla('invalid_entry')
      let origin = ''
      try {
        origin = await git(['-C', e.worktreePath, 'remote', 'get-url', 'origin'])
      } catch {
        origin = ''
      }
      const gh = parseGithubRepo(origin)
      if (!gh) return falla('no_github_remote')

      const push = await deps.pushBranch(e.worktreePath)
      if (!push.ok) return falla('push_failed', push.error)

      // Con la base desconocida (detached HEAD) GitHub elige la rama por defecto.
      const comparar = e.baseBranch === 'HEAD' ? e.branch : `${e.baseBranch}...${e.branch}`
      await deps.openExternal(`https://github.com/${gh.owner}/${gh.repo}/compare/${comparar}?expand=1`)
      return { ok: true }
    },

    async discard(e: ReviewEntry): Promise<ReviewResult> {
      const v = await verificar(e)
      if (!v.ok) return v.r
      if (v.estado === 'registrado') {
        const r = await deps.removeWorktree(e)
        if (!r.ok) return falla('remove_failed', r.error)
      } else {
        // La carpeta ya no está: se olvida su registro (si quedó) para que git suelte la rama.
        try { await git(['-C', e.repoPath, 'worktree', 'prune']) } catch { /* sigue igual */ }
      }
      // Rama a la que se llega sólo validada (sin `-` adelante, nunca HEAD ni la base).
      try {
        await git(['-C', e.repoPath, 'branch', '-D', e.branch])
      } catch (err) {
        // Si la rama ya no existe, el descarte igual está hecho.
        let existe = true
        try {
          await git(['-C', e.repoPath, 'rev-parse', '-q', '--verify', `refs/heads/${e.branch}`])
        } catch {
          existe = false
        }
        if (existe) return falla('git_failed', mensaje(err))
      }
      deps.store.remove(e.workerId)
      return { ok: true }
    }
  }
}

export type ReviewActions = ReturnType<typeof createReviewActions>
