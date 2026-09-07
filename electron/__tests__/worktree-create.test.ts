import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, existsSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { performWorktreeAdd, type WorktreeAddPorts } from '../worktree-create'

function ports(over: Partial<WorktreeAddPorts> = {}): WorktreeAddPorts {
  return {
    worktreeExists: () => false,
    branchExists: () => false,
    runGit: vi.fn(),
    ...over,
  }
}

const base = {
  repoPath: '/repo',
  branch: 'gero/ENG-1-fix',
  wtPath: '/repo-gero-ENG-1-fix',
  fromBranch: 'HEAD',
}

describe('performWorktreeAdd', () => {
  it('reusa un worktree existente sin correr git (idempotente)', () => {
    // El bug: reclickear "Work on this" tiraba el "already exists" crudo de git.
    const runGit = vi.fn()
    const res = performWorktreeAdd(ports({ worktreeExists: () => true, runGit }), base)
    expect(res).toEqual({ ok: true, created: false })
    expect(runGit).not.toHaveBeenCalled()
  })

  it('crea rama+worktree nuevos con -b cuando no existe nada', () => {
    const runGit = vi.fn()
    const res = performWorktreeAdd(ports({ runGit }), base)
    expect(res).toEqual({ ok: true, created: true })
    expect(runGit).toHaveBeenCalledWith(
      ['-C', '/repo', 'worktree', 'add', '-b', 'gero/ENG-1-fix', '/repo-gero-ENG-1-fix', 'HEAD'],
    )
  })

  it('adjunta una rama existente (sin -b) si la rama ya existe pero no hay worktree', () => {
    const runGit = vi.fn()
    const res = performWorktreeAdd(ports({ branchExists: () => true, runGit }), base)
    expect(res).toEqual({ ok: true, created: true })
    expect(runGit).toHaveBeenCalledWith(
      ['-C', '/repo', 'worktree', 'add', '/repo-gero-ENG-1-fix', 'gero/ENG-1-fix'],
    )
  })

  it('mapea un fallo de git a un error limpio, no la excepción cruda', () => {
    const runGit = vi.fn(() => { throw new Error("fatal: '/x' already exists") })
    const res = performWorktreeAdd(ports({ runGit }), base)
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error).toContain('git worktree add failed')
  })
})

// End-to-end contra git real: reproduce el "Work on this" clickeado dos veces
// (el bug del smoke). Puertos reales; el segundo llamado debe reusar sin que
// git tire "'<path>' already exists".
describe('performWorktreeAdd — git real (idempotencia del re-click)', () => {
  const realPorts: WorktreeAddPorts = {
    worktreeExists: (p) => existsSync(p),
    branchExists: (repoPath, branch) => {
      try {
        execFileSync('git', ['-C', repoPath, 'show-ref', '--verify', '--quiet', `refs/heads/${branch}`], { stdio: 'ignore' })
        return true
      } catch { return false }
    },
    runGit: (args) => { execFileSync('git', args, { stdio: 'pipe' }) },
  }
  let repo: string
  let wt: string

  beforeEach(() => {
    repo = mkdtempSync(join(tmpdir(), 'nest-wt-repo-'))
    const git = (...a: string[]) => execFileSync('git', ['-C', repo, ...a], { stdio: 'ignore' })
    git('init', '-q', '-b', 'main')
    git('config', 'user.email', 't@t.co')
    git('config', 'user.name', 'T')
    writeFileSync(join(repo, 'f.txt'), 'x')
    git('add', '.')
    git('commit', '-qm', 'init')
    wt = `${repo}-wt`
  })

  afterEach(() => {
    try { execFileSync('git', ['-C', repo, 'worktree', 'remove', '--force', wt], { stdio: 'ignore' }) } catch { /* noop */ }
    rmSync(repo, { recursive: true, force: true })
    rmSync(wt, { recursive: true, force: true })
  })

  it('primer llamado crea el worktree; segundo (re-click) lo reusa sin error', () => {
    const opts = { repoPath: repo, branch: 'gero/OWNER-repo-9-x', wtPath: wt, fromBranch: 'HEAD' }

    const first = performWorktreeAdd(realPorts, opts)
    expect(first).toEqual({ ok: true, created: true })
    expect(existsSync(wt)).toBe(true)

    // Sin el fix, aquí git tiraría "fatal: '<wt>' already exists".
    const second = performWorktreeAdd(realPorts, opts)
    expect(second).toEqual({ ok: true, created: false })
  })
})
