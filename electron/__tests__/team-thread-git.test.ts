import { describe, it, expect } from 'vitest'
import { parseBranchStates } from '../integrations/team-thread-git'

describe('parseBranchStates', () => {
  it('git fallo: todas las ramas quedan en sin-worktree, no en cerrada (bug de la review)', () => {
    const out = parseBranchStates('', '', ['main', 'feat/x'], false)
    expect(out).toEqual({ main: 'sin-worktree', 'feat/x': 'sin-worktree' })
  })

  it('una rama con worktree abierto queda activa', () => {
    const branchOutput = 'main\nfeat/x\n'
    const worktreeOutput = [
      'worktree /repo',
      'HEAD abc123',
      'branch refs/heads/main',
      '',
      'worktree /repo-feat-x',
      'HEAD def456',
      'branch refs/heads/feat/x',
      '',
    ].join('\n')
    const out = parseBranchStates(branchOutput, worktreeOutput, ['main', 'feat/x'], true)
    expect(out).toEqual({ main: 'activa', 'feat/x': 'activa' })
  })

  it('una rama que existe pero sin worktree abierto queda sin-worktree', () => {
    const branchOutput = 'main\nfeat/x\n'
    const worktreeOutput = ['worktree /repo', 'HEAD abc123', 'branch refs/heads/main', ''].join('\n')
    const out = parseBranchStates(branchOutput, worktreeOutput, ['feat/x'], true)
    expect(out).toEqual({ 'feat/x': 'sin-worktree' })
  })

  it('una rama que ya no existe queda cerrada', () => {
    const branchOutput = 'main\n'
    const worktreeOutput = ['worktree /repo', 'HEAD abc123', 'branch refs/heads/main', ''].join('\n')
    const out = parseBranchStates(branchOutput, worktreeOutput, ['feat/borrada'], true)
    expect(out).toEqual({ 'feat/borrada': 'cerrada' })
  })

  it('una entrada detached en git worktree list no rompe el parseo ni inventa una rama', () => {
    const branchOutput = 'main\n'
    const worktreeOutput = [
      'worktree /repo',
      'HEAD abc123',
      'branch refs/heads/main',
      '',
      'worktree /repo-detached',
      'HEAD def456',
      'detached',
      '',
    ].join('\n')
    const out = parseBranchStates(branchOutput, worktreeOutput, ['main'], true)
    expect(out).toEqual({ main: 'activa' })
  })
})
