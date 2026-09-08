// I3 de la review final de rama: los settings del hilo son POR PROYECTO pero la escritura
// y el `rmSync` eran POR WORKTREE. Con 8 worktrees del mismo repo (el caso real de esta
// maquina), apagar el toggle desde uno dejaba los otros 7 con `.nest/team/` viejo y la
// linea en su AGENTS.md; prenderlo desde uno no escribia el hilo en los demas, en contra de
// la decision 7 de la spec §3 ("se escribe uno por worktree, completo").
import { describe, it, expect } from 'vitest'
import { groupWorktreesByRepo, normalizeWorktreeKey, worktreesOfSameRepo } from '../integrations/team-thread-worktrees'

const NEST_ROOT = 'C:/dev/raven-nest'
const OTRO_ROOT = 'C:/dev/pagina-nest'

const STORE = [
  { repoPath: NEST_ROOT, rootRepoPath: NEST_ROOT },
  { repoPath: 'C:/dev/raven-nest/.claude/worktrees/memory-smoke', rootRepoPath: NEST_ROOT },
  { repoPath: 'C:/dev/raven-nest/.claude/worktrees/sidebar-tabs', rootRepoPath: NEST_ROOT },
  { repoPath: OTRO_ROOT, rootRepoPath: OTRO_ROOT },
]

describe('worktreesOfSameRepo', () => {
  it('desde UN worktree devuelve TODOS los del mismo repo, no solo ese', () => {
    const res = worktreesOfSameRepo(STORE, 'C:/dev/raven-nest/.claude/worktrees/memory-smoke')

    expect(res).toHaveLength(3)
    expect(res).toContain(NEST_ROOT)
    expect(res).toContain('C:/dev/raven-nest/.claude/worktrees/sidebar-tabs')
  })

  it('no arrastra worktrees de OTRO repo', () => {
    expect(worktreesOfSameRepo(STORE, NEST_ROOT)).not.toContain(OTRO_ROOT)
  })

  it('un worktree que el store no conoce igual se procesa a si mismo', () => {
    expect(worktreesOfSameRepo(STORE, 'C:/dev/repo-nuevo')).toEqual(['C:/dev/repo-nuevo'])
  })

  it('barras de Windows y de POSIX son el mismo worktree, y no se procesa dos veces', () => {
    const res = worktreesOfSameRepo(STORE, 'C:\\dev\\raven-nest\\.claude\\worktrees\\memory-smoke')

    expect(res).toHaveLength(3)
    // El path que vino del caller gana, verbatim: es el que ya se valido como absoluto.
    expect(res[0]).toBe('C:\\dev\\raven-nest\\.claude\\worktrees\\memory-smoke')
  })

  it('una barra final no duplica el worktree', () => {
    expect(worktreesOfSameRepo(STORE, 'C:/dev/raven-nest/')).toHaveLength(3)
  })

  it('el worktree que dispara siempre viene primero', () => {
    const res = worktreesOfSameRepo(STORE, 'C:/dev/raven-nest/.claude/worktrees/sidebar-tabs')
    expect(res[0]).toBe('C:/dev/raven-nest/.claude/worktrees/sidebar-tabs')
  })
})

describe('groupWorktreesByRepo', () => {
  it('un grupo por repo raiz, con todos sus worktrees', () => {
    const grupos = groupWorktreesByRepo(STORE)

    expect(grupos).toHaveLength(2)
    expect(grupos.find((g) => g.rootRepoPath === NEST_ROOT)?.worktrees).toHaveLength(3)
    expect(grupos.find((g) => g.rootRepoPath === OTRO_ROOT)?.worktrees).toEqual([OTRO_ROOT])
  })

  it('lista vacia -> ningun grupo (el poll no tiene nada que recorrer)', () => {
    expect(groupWorktreesByRepo([])).toEqual([])
  })
})

describe('normalizeWorktreeKey', () => {
  it('las tres formas del mismo path colapsan a la misma clave', () => {
    const a = normalizeWorktreeKey('C:\\dev\\raven-nest')
    expect(normalizeWorktreeKey('C:/dev/raven-nest')).toBe(a)
    expect(normalizeWorktreeKey('C:/dev/raven-nest/')).toBe(a)
  })
})
