// Las tres decisiones de Gero sobre la rama de un worker (spec §6.7): merge en la rama del
// coordinador, abrir un PR, o descartar. Todo el IO entra por `deps` (git en array, sin shell).
//
// Nada de esto corre solo: cada acción sale de un click en el panel de revisión. Y ninguna
// empuja la rama base: `merge` es local (nunca `git push`), y `openPr` empuja SÓLO la rama del
// worker (anti-meta §4: nada llega a main sin una decisión de Gero).

import { existsSync } from 'node:fs'
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

/** Parsea `git worktree list --porcelain`: path → rama (sin `refs/heads/`). */
function worktreesPorRama(porcelain: string): Map<string, string> {
  const out = new Map<string, string>()
  for (const bloque of porcelain.split(/\n\s*\n/)) {
    const path = bloque.match(/^worktree (.+)$/m)?.[1]
    const rama = bloque.match(/^branch refs\/heads\/(.+)$/m)?.[1]
    if (path && rama) out.set(rama.trim(), path.trim())
  }
  return out
}

export function createReviewActions(deps: ReviewActionDeps) {
  const git = (args: string[], timeout = T_CORTO) => deps.runGit(args, { timeout })

  const entradaValida = (e: ReviewEntry): boolean =>
    REF_VALIDO.test(e.branch) && (e.baseBranch === 'HEAD' || REF_VALIDO.test(e.baseBranch))

  return {
    async merge(e: ReviewEntry): Promise<ReviewResult> {
      if (e.baseBranch === 'HEAD') return falla('detached_head')
      if (!entradaValida(e)) return falla('invalid_entry')

      // Borrar el worktree con `--force` se lleva lo no commiteado: si el worker dejó algo
      // (incluidos archivos nuevos), no se mergea ni se borra nada.
      if (existsSync(e.worktreePath)) {
        try {
          if ((await git(['-C', e.worktreePath, 'status', '--porcelain'])) !== '') return falla('worker_dirty')
        } catch (err) {
          return falla('git_failed', mensaje(err))
        }
      }

      let baseWt: string | undefined
      try {
        baseWt = worktreesPorRama(await git(['-C', e.repoPath, 'worktree', 'list', '--porcelain'])).get(e.baseBranch)
      } catch (err) {
        return falla('git_failed', mensaje(err))
      }
      if (!baseWt) return falla('base_not_checked_out')

      // Sólo lo trackeado: un archivo suelto que no choca no bloquea, y si chocara git
      // rechaza el merge antes de empezar (merge_failed, sin nada a medias).
      try {
        const sucio = await git(['-C', baseWt, 'status', '--porcelain', '--untracked-files=no'])
        if (sucio !== '') return falla('coordinator_dirty')
      } catch (err) {
        return falla('git_failed', mensaje(err))
      }

      try {
        await git(['-C', baseWt, 'merge', '--no-ff', '--no-edit', e.branch], T_MERGE)
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

      if (existsSync(e.worktreePath)) {
        const r = await deps.removeWorktree(e)
        // Ya está mergeado: la entrada queda para reintentar (un merge repetido no hace nada).
        if (!r.ok) return falla('remove_failed', r.error)
      }
      deps.store.remove(e.workerId)
      return { ok: true }
    },

    async openPr(e: ReviewEntry): Promise<ReviewResult> {
      if (!entradaValida(e)) return falla('invalid_entry')
      let origin = ''
      try {
        const cwd = existsSync(e.worktreePath) ? e.worktreePath : e.repoPath
        origin = await git(['-C', cwd, 'remote', 'get-url', 'origin'])
      } catch {
        origin = ''
      }
      const gh = parseGithubRepo(origin)
      if (!gh) return falla('no_github_remote')

      // pushBranch empuja lo que el worktree tenga checked out: se confirma antes que es la rama
      // del worker (y no, p. ej., algo que alguien hizo checkout a mano ahí).
      try {
        const actual = await git(['-C', e.worktreePath, 'rev-parse', '--abbrev-ref', 'HEAD'])
        if (actual !== e.branch) return falla('push_failed', `worktree is on ${actual}, not ${e.branch}`)
      } catch (err) {
        return falla('push_failed', mensaje(err))
      }

      const push = await deps.pushBranch(e.worktreePath)
      if (!push.ok) return falla('push_failed', push.error)

      // Con la base desconocida (detached HEAD) GitHub elige la rama por defecto.
      const comparar = e.baseBranch === 'HEAD' ? e.branch : `${e.baseBranch}...${e.branch}`
      await deps.openExternal(`https://github.com/${gh.owner}/${gh.repo}/compare/${comparar}?expand=1`)
      return { ok: true }
    },

    async discard(e: ReviewEntry): Promise<ReviewResult> {
      if (!entradaValida(e)) return falla('invalid_entry')
      if (existsSync(e.worktreePath)) {
        const r = await deps.removeWorktree(e)
        if (!r.ok) return falla('remove_failed', r.error)
      }
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
