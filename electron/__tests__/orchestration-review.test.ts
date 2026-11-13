// Revisión de ramas de workers (spec 2026-11-12-orquestacion-panes §6.7): el store persistido y
// las acciones de git. Las acciones corren contra repos git REALES en un tmpdir: lo que importa
// (merge a medias, worktree borrado, rama borrada) sólo se ve en un repo de verdad.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, existsSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { ReviewStore, type ReviewEntry } from '../orchestration/review-store'
import { createReviewActions, parseGithubRepo, type ReviewActionDeps } from '../orchestration/review-actions'

const tmps: string[] = []
const tmp = (prefix: string): string => {
  const d = realpathSync(mkdtempSync(join(tmpdir(), prefix)))
  tmps.push(d)
  return d
}
afterEach(() => {
  for (const d of tmps.splice(0)) rmSync(d, { recursive: true, force: true })
})

const entry = (over: Partial<ReviewEntry> = {}): ReviewEntry => ({
  workerId: 'w1',
  label: 'api',
  colorIndex: 0,
  branch: 'nest/api-w1',
  worktreePath: '/wt/api',
  baseBranch: 'main',
  status: 'done',
  finishedAt: 1000,
  repoPath: '/repo',
  ...over
})

describe('ReviewStore', () => {
  it('review store sobrevive reinicio', () => {
    const dir = tmp('nest-review-store-')
    const path = join(dir, '.raven-nest', 'orchestration-review.json')
    const a = new ReviewStore(path)
    a.upsert(entry())
    a.upsert(entry({ workerId: 'w2', label: 'ui' }))
    const b = new ReviewStore(path)
    expect(b.list().map((e) => e.workerId)).toEqual(['w1', 'w2'])
    expect(b.list()[0]).toEqual(entry())
  })

  it('upsert reemplaza por workerId y remove borra', () => {
    const path = join(tmp('nest-review-store-'), 'r.json')
    const s = new ReviewStore(path)
    s.upsert(entry())
    s.upsert(entry({ status: 'stopped' }))
    expect(s.list()).toHaveLength(1)
    expect(s.list()[0].status).toBe('stopped')
    s.remove('w1')
    expect(new ReviewStore(path).list()).toEqual([])
  })

  it('un archivo roto o con basura arranca vacío y descarta lo inválido', () => {
    const dir = tmp('nest-review-store-')
    const roto = join(dir, 'roto.json')
    writeFileSync(roto, '{nope')
    expect(new ReviewStore(roto).list()).toEqual([])
    const mezcla = join(dir, 'mezcla.json')
    writeFileSync(mezcla, JSON.stringify({ entries: [entry(), { workerId: 3 }, null] }))
    expect(new ReviewStore(mezcla).list().map((e) => e.workerId)).toEqual(['w1'])
  })
})

describe('parseGithubRepo', () => {
  it('lee https y ssh, con y sin .git, y rechaza lo que no es GitHub', () => {
    expect(parseGithubRepo('git@github.com:Gero/raven-nest.git')).toEqual({ owner: 'Gero', repo: 'raven-nest' })
    expect(parseGithubRepo('https://github.com/Gero/raven-nest.git')).toEqual({ owner: 'Gero', repo: 'raven-nest' })
    expect(parseGithubRepo('https://github.com/Gero/my.repo')).toEqual({ owner: 'Gero', repo: 'my.repo' })
    expect(parseGithubRepo('ssh://git@github.com/Gero/raven-nest.git')).toEqual({ owner: 'Gero', repo: 'raven-nest' })
    expect(parseGithubRepo('https://gitlab.com/Gero/raven-nest.git')).toBeNull()
    expect(parseGithubRepo('')).toBeNull()
  })
})

// ---- repos reales ----

const git = (cwd: string, ...args: string[]): string =>
  execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()

const commit = (cwd: string, file: string, content: string, msg: string): void => {
  writeFileSync(join(cwd, file), content)
  git(cwd, 'add', file)
  git(cwd, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', msg)
}

interface Fixture {
  repo: string
  wt: string
  e: ReviewEntry
  deps: ReviewActionDeps & { runGit: ReturnType<typeof vi.fn>; openExternal: ReturnType<typeof vi.fn>; pushBranch: ReturnType<typeof vi.fn> }
  store: ReviewStore
}

/** Repo con `main` checked out en la raíz y el worker en su worktree con un commit propio. */
function fixture(): Fixture {
  const base = tmp('nest-review-git-')
  const repo = join(base, 'repo')
  execFileSync('git', ['init', '-q', '-b', 'main', repo])
  // La identidad va en el config del repo (compartido por sus worktrees): el commit de merge
  // la necesita y un runner de CI no tiene una global.
  git(repo, 'config', 'user.name', 't')
  git(repo, 'config', 'user.email', 't@t')
  commit(repo, 'a.txt', 'uno\n', 'init')
  const wt = join(base, 'repo-nest-api')
  git(repo, 'worktree', 'add', '-q', '-b', 'nest/api-w1', wt)
  commit(wt, 'b.txt', 'del worker\n', 'worker')
  const store = new ReviewStore(join(base, 'review.json'))
  const e = entry({ worktreePath: wt, repoPath: repo })
  store.upsert(e)
  const runGit = vi.fn(async (args: string[], opts: { timeout: number }) => {
    void opts
    return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
  })
  const deps = {
    runGit,
    store,
    removeWorktree: async (x: ReviewEntry) => {
      await runGit(['-C', x.repoPath, 'worktree', 'remove', '--force', x.worktreePath], { timeout: 10_000 })
      return { ok: true as const }
    },
    pushBranch: vi.fn(async () => ({ ok: true as const })),
    openExternal: vi.fn(async () => {})
  }
  return { repo, wt, e, deps, store }
}

const pushes = (f: Fixture): unknown[] =>
  f.deps.runGit.mock.calls.filter(([args]) => (args as string[]).includes('push'))

describe('review actions (git real)', () => {
  let f: Fixture
  beforeEach(() => { f = fixture() })

  it('merge bloqueado con base sucia', async () => {
    writeFileSync(join(f.repo, 'a.txt'), 'sin commitear\n')
    const r = await createReviewActions(f.deps).merge(f.e)
    expect(r).toEqual({ ok: false, error: 'coordinator_dirty' })
    expect(git(f.repo, 'log', '--oneline').split('\n')).toHaveLength(1)
    expect(existsSync(f.wt)).toBe(true)
    expect(f.store.list()).toHaveLength(1)
  })

  it('merge con conflicto aborta y no deja merge a medias', async () => {
    commit(f.wt, 'a.txt', 'del worker\n', 'worker toca a')
    commit(f.repo, 'a.txt', 'de main\n', 'main toca a')
    const antes = git(f.repo, 'rev-parse', 'HEAD')
    const r = await createReviewActions(f.deps).merge(f.e)
    expect(r).toEqual({ ok: false, error: 'merge_conflict' })
    expect(git(f.repo, 'rev-parse', 'HEAD')).toBe(antes)
    expect(git(f.repo, 'status', '--porcelain')).toBe('')
    expect(() => git(f.repo, 'rev-parse', '-q', '--verify', 'MERGE_HEAD')).toThrow()
    expect(existsSync(f.wt)).toBe(true)
    expect(f.store.list()).toHaveLength(1)
  })

  it('merge ok borra el worktree del worker', async () => {
    const r = await createReviewActions(f.deps).merge(f.e)
    expect(r).toEqual({ ok: true })
    // --no-ff: un commit de merge con dos padres, en la rama base.
    expect(git(f.repo, 'rev-list', '--parents', '-n', '1', 'HEAD').split(' ')).toHaveLength(3)
    expect(git(f.repo, 'show', 'HEAD:b.txt')).toBe('del worker')
    expect(existsSync(f.wt)).toBe(false)
    expect(f.store.list()).toEqual([])
    // La rama queda: sólo Discard borra ramas.
    expect(git(f.repo, 'branch', '--list', 'nest/api-w1')).toContain('nest/api-w1')
    expect(pushes(f)).toEqual([])
    expect(f.deps.pushBranch).not.toHaveBeenCalled()
  })

  it('merge corre en el worktree donde está checked out la base, no en el repo del coordinador', async () => {
    const coordWt = join(f.repo, '..', 'repo-coord')
    git(f.repo, 'worktree', 'add', '-q', '-b', 'feat/coord', coordWt)
    const e = { ...f.e, baseBranch: 'feat/coord' }
    f.store.upsert(e)
    const r = await createReviewActions(f.deps).merge(e)
    expect(r).toEqual({ ok: true })
    expect(git(coordWt, 'show', 'HEAD:b.txt')).toBe('del worker')
    // main no se tocó.
    expect(git(f.repo, 'log', '--oneline').split('\n')).toHaveLength(1)
  })

  it('merge sin la base checked out en ningún worktree da base_not_checked_out', async () => {
    git(f.repo, 'branch', 'develop')
    const r = await createReviewActions(f.deps).merge({ ...f.e, baseBranch: 'develop' })
    expect(r).toEqual({ ok: false, error: 'base_not_checked_out' })
    expect(existsSync(f.wt)).toBe(true)
  })

  it('merge con base desconocida (detached HEAD) no corre', async () => {
    const r = await createReviewActions(f.deps).merge({ ...f.e, baseBranch: 'HEAD' })
    expect(r).toEqual({ ok: false, error: 'detached_head' })
    expect(f.deps.runGit).not.toHaveBeenCalled()
  })

  it('merge con cambios sin commitear en el worktree del worker no lo borra', async () => {
    writeFileSync(join(f.wt, 'b.txt'), 'a medio hacer\n')
    const r = await createReviewActions(f.deps).merge(f.e)
    expect(r).toEqual({ ok: false, error: 'worker_dirty' })
    expect(existsSync(f.wt)).toBe(true)
    expect(git(f.repo, 'log', '--oneline').split('\n')).toHaveLength(1)
  })

  it('discard borra rama y worktree', async () => {
    const r = await createReviewActions(f.deps).discard(f.e)
    expect(r).toEqual({ ok: true })
    expect(existsSync(f.wt)).toBe(false)
    expect(git(f.repo, 'branch', '--list', 'nest/api-w1')).toBe('')
    expect(f.store.list()).toEqual([])
    expect(pushes(f)).toEqual([])
  })

  it('openPr arma la URL compare', async () => {
    git(f.repo, 'remote', 'add', 'origin', 'git@github.com:Gero/raven-nest.git')
    const r = await createReviewActions(f.deps).openPr({ ...f.e, baseBranch: 'feat/base' })
    expect(r).toEqual({ ok: true })
    expect(f.deps.pushBranch).toHaveBeenCalledWith(f.wt)
    expect(f.deps.openExternal).toHaveBeenCalledWith(
      'https://github.com/Gero/raven-nest/compare/feat/base...nest/api-w1?expand=1'
    )
    // No borra nada.
    expect(existsSync(f.wt)).toBe(true)
    expect(f.store.list()).toHaveLength(1)
  })

  it('openPr sin origin de GitHub no empuja nada', async () => {
    git(f.repo, 'remote', 'add', 'origin', 'https://gitlab.com/Gero/raven-nest.git')
    const r = await createReviewActions(f.deps).openPr(f.e)
    expect(r).toEqual({ ok: false, error: 'no_github_remote' })
    expect(f.deps.pushBranch).not.toHaveBeenCalled()
    expect(f.deps.openExternal).not.toHaveBeenCalled()
  })

  it('openPr sólo empuja la rama del worker', async () => {
    git(f.repo, 'remote', 'add', 'origin', 'https://github.com/Gero/raven-nest')
    git(f.wt, 'checkout', '-q', '-b', 'otra')
    const r = await createReviewActions(f.deps).openPr(f.e)
    expect(r).toEqual({ ok: false, error: 'invalid_entry' })
    expect(f.deps.pushBranch).not.toHaveBeenCalled()
  })

  // ---- fix round 1: la entrada del JSON no se cree ----

  it('una entrada que apunta al worktree principal se rechaza y no mata ni borra nada', async () => {
    git(f.repo, 'remote', 'add', 'origin', 'https://github.com/Gero/raven-nest')
    const remove = vi.fn(f.deps.removeWorktree)
    const a = createReviewActions({ ...f.deps, removeWorktree: remove })
    const mala = { ...f.e, worktreePath: f.repo }
    expect(await a.merge(mala)).toEqual({ ok: false, error: 'invalid_entry' })
    expect(await a.openPr(mala)).toEqual({ ok: false, error: 'invalid_entry' })
    expect(await a.discard(mala)).toEqual({ ok: false, error: 'invalid_entry' })
    expect(remove).not.toHaveBeenCalled()
    expect(f.deps.pushBranch).not.toHaveBeenCalled()
    expect(existsSync(join(f.repo, 'a.txt'))).toBe(true)
    expect(git(f.repo, 'branch', '--list', 'nest/api-w1')).toContain('nest/api-w1')
    expect(f.store.list()).toHaveLength(1)
  })

  it('una entrada con branch main se rechaza en openPr y no empuja', async () => {
    git(f.repo, 'remote', 'add', 'origin', 'https://github.com/Gero/raven-nest')
    const a = createReviewActions(f.deps)
    expect(await a.openPr({ ...f.e, branch: 'main' })).toEqual({ ok: false, error: 'invalid_entry' })
    expect(await a.openPr({ ...f.e, branch: 'main', worktreePath: f.repo })).toEqual({ ok: false, error: 'invalid_entry' })
    expect(await a.openPr({ ...f.e, branch: 'nest/api-w1', baseBranch: 'nest/api-w1' })).toEqual({ ok: false, error: 'invalid_entry' })
    expect(f.deps.pushBranch).not.toHaveBeenCalled()
  })

  it('una rama que empieza con - se rechaza sin llamar a git', async () => {
    const a = createReviewActions(f.deps)
    f.deps.runGit.mockClear()
    expect(await a.discard({ ...f.e, branch: '-D' })).toEqual({ ok: false, error: 'invalid_entry' })
    expect(await a.merge({ ...f.e, branch: '--help' })).toEqual({ ok: false, error: 'invalid_entry' })
    expect(f.deps.runGit).not.toHaveBeenCalled()
  })

  it('una carpeta que no es un worktree registrado no se borra', async () => {
    const remove = vi.fn(f.deps.removeWorktree)
    const suelta = join(f.repo, '..', 'suelta')
    execFileSync('mkdir', ['-p', suelta])
    const r = await createReviewActions({ ...f.deps, removeWorktree: remove }).discard({ ...f.e, worktreePath: suelta })
    expect(r).toEqual({ ok: false, error: 'invalid_entry' })
    expect(remove).not.toHaveBeenCalled()
    expect(existsSync(suelta)).toBe(true)
  })

  it('entrada vieja cuyo worktree ya no está: discard borra sólo la rama', async () => {
    rmSync(f.wt, { recursive: true, force: true })
    const remove = vi.fn(f.deps.removeWorktree)
    const r = await createReviewActions({ ...f.deps, removeWorktree: remove }).discard(f.e)
    expect(r).toEqual({ ok: true })
    expect(remove).not.toHaveBeenCalled()
    expect(git(f.repo, 'branch', '--list', 'nest/api-w1')).toBe('')
    expect(existsSync(join(f.repo, 'a.txt'))).toBe(true)
    expect(f.store.list()).toEqual([])
  })

  // Revisión final: una entrada vieja (o editada a mano) con el worktree ausente no puede
  // borrar cualquier rama que nombre el JSON: sólo las de los workers (`nest/`).
  it('una entrada ausente con una rama que no es nest/ se rechaza y la rama queda', async () => {
    git(f.repo, 'branch', 'feature/x')
    const remove = vi.fn(f.deps.removeWorktree)
    const a = createReviewActions({ ...f.deps, removeWorktree: remove })
    const ajena = { ...f.e, branch: 'feature/x', worktreePath: join(f.repo, '..', 'no-existe') }
    expect(await a.discard(ajena)).toEqual({ ok: false, error: 'invalid_entry' })
    expect(await a.merge(ajena)).toEqual({ ok: false, error: 'invalid_entry' })
    expect(await a.openPr(ajena)).toEqual({ ok: false, error: 'invalid_entry' })
    expect(git(f.repo, 'branch', '--list', 'feature/x')).toContain('feature/x')
    expect(remove).not.toHaveBeenCalled()
    expect(f.store.list()).toHaveLength(1)
  })

  it('removeWorktree recibe el path que registra git, no el del JSON', async () => {
    const link = join(f.repo, '..', 'link-al-worktree')
    execFileSync('ln', ['-s', f.wt, link])
    const vistos: string[] = []
    const remove = vi.fn(async (x: ReviewEntry) => { vistos.push(x.worktreePath); return f.deps.removeWorktree(x) })
    const r = await createReviewActions({ ...f.deps, removeWorktree: remove }).discard({ ...f.e, worktreePath: link })
    expect(r).toEqual({ ok: true })
    expect(vistos).toEqual([f.wt])
    expect(existsSync(f.wt)).toBe(false)
  })

  it('un merge que Gero dejó a medias en la base no se aborta', async () => {
    git(f.repo, 'branch', 'gero')
    git(f.repo, 'checkout', '-q', 'gero')
    git(f.repo, 'commit', '-q', '--allow-empty', '-m', 'vacío')
    git(f.repo, 'checkout', '-q', 'main')
    git(f.repo, 'merge', '--no-ff', '--no-commit', 'gero')
    const r = await createReviewActions(f.deps).merge(f.e)
    expect(r).toEqual({ ok: false, error: 'coordinator_dirty' })
    expect(git(f.repo, 'rev-parse', '-q', '--verify', 'MERGE_HEAD')).not.toBe('')
    expect(existsSync(f.wt)).toBe(true)
  })

  it('dos merges en la misma base corren de a uno', async () => {
    const wt2 = join(f.repo, '..', 'repo-nest-ui')
    git(f.repo, 'worktree', 'add', '-q', '-b', 'nest/ui-w2', wt2)
    commit(wt2, 'c.txt', 'ui\n', 'ui')
    const e2 = { ...f.e, workerId: 'w2', branch: 'nest/ui-w2', worktreePath: wt2 }
    f.store.upsert(e2)
    let enVuelo = 0
    let maximo = 0
    const lento = vi.fn(async (args: string[], opts: { timeout: number }) => {
      const esMerge = args.includes('merge') && !args.includes('--abort')
      if (esMerge) { enVuelo++; maximo = Math.max(maximo, enVuelo); await new Promise((r) => setTimeout(r, 80)) }
      try { return await f.deps.runGit(args, opts) } finally { if (esMerge) enVuelo-- }
    })
    const a = createReviewActions({ ...f.deps, runGit: lento })
    const [r1, r2] = await Promise.all([a.merge(f.e), a.merge(e2)])
    expect(maximo).toBe(1)
    expect(r1).toEqual({ ok: true })
    expect(r2).toEqual({ ok: true })
    expect(git(f.repo, 'show', 'HEAD:c.txt')).toBe('ui')
    expect(git(f.repo, 'show', 'HEAD:b.txt')).toBe('del worker')
  })

  it('openPr con push fallido no abre el navegador', async () => {
    git(f.repo, 'remote', 'add', 'origin', 'https://github.com/Gero/raven-nest')
    f.deps.pushBranch.mockResolvedValueOnce({ ok: false, error: 'rejected' } as never)
    const r = await createReviewActions(f.deps).openPr(f.e)
    expect(r).toEqual({ ok: false, error: 'push_failed', detail: 'rejected' })
    expect(f.deps.openExternal).not.toHaveBeenCalled()
  })
})
