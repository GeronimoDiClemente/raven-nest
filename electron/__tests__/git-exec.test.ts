import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runGit, type GitExecError } from '../git-exec'

describe('runGit — contra un repo real', () => {
  let repo: string

  beforeEach(() => {
    repo = mkdtempSync(join(tmpdir(), 'nest-git-exec-'))
    execFileSync('git', ['-C', repo, 'init', '-q', '-b', 'trunk'], { stdio: 'ignore' })
  })

  afterEach(() => {
    rmSync(repo, { recursive: true, force: true })
  })

  it('resuelve con el stdout recortado', async () => {
    // `symbolic-ref` imprime "refs/heads/trunk\n": el salto final no tiene que llegar.
    await expect(runGit(['-C', repo, 'symbolic-ref', 'HEAD'])).resolves.toBe('refs/heads/trunk')
  })

  it('respeta cwd igual que -C', async () => {
    await expect(runGit(['symbolic-ref', '--short', 'HEAD'], { cwd: repo })).resolves.toBe('trunk')
  })

  it('rechaza cuando git falla, con stderr y el exit code', async () => {
    const err = await runGit(['-C', repo, 'remote', 'get-url', 'origin']).then(
      () => { throw new Error('debió rechazar') },
      (e: GitExecError) => e,
    )
    expect(err.message).toMatch(/^Command failed: git -C .* remote get-url origin/)
    expect(err.stderr).toMatch(/no such remote/i)
    expect(typeof err.code).toBe('number')
    expect(err.code).not.toBe(0)
  })

  it('cierra stdin: un comando que lee stdin no se cuelga', async () => {
    // Sin el stdin.end(), `hash-object --stdin` esperaría para siempre (o hasta el timeout).
    const out = await runGit(['-C', repo, 'hash-object', '--stdin'], { timeout: 5000 })
    expect(out).toBe('e69de29bb2d1d6434b8b29ae775ad8c2e48c5391') // hash del blob vacío
  })

  it('respeta el timeout y rechaza con ETIMEDOUT', async () => {
    // Un alias que duerme 10 s. `exec` + redirecciones para que ningún nieto se quede con
    // los pipes abiertos: el callback de execFile espera a que se cierren.
    const t0 = Date.now()
    const err = await runGit(
      ['-C', repo, '-c', 'alias.dormir=!exec sleep 10 >/dev/null 2>&1 </dev/null', 'dormir'],
      { timeout: 300 },
    ).then(
      () => { throw new Error('debió rechazar por timeout') },
      (e: GitExecError) => e,
    )
    expect(Date.now() - t0).toBeLessThan(5000)
    expect(err.code).toBe('ETIMEDOUT')
    expect(err.message).toBe('spawnSync git ETIMEDOUT')
  })
})
