import { describe, it, expect, afterEach } from 'vitest'
import { worktreeKey, sameWorktree, __setUnixCaseInsensitiveForTests } from '../../lib/worktree-path'

afterEach(() => __setUnixCaseInsensitiveForTests(null))

// En Windows conviven DOS formas del mismo worktree: `git worktree list`
// llega POSIX (C:/dev/repo, worktree-store normaliza) y dialog:openFolder /
// clone llegan nativos (C:\dev\repo, local-paths.json sin normalizar). Toda
// comparación de identidad de worktree tiene que colapsar ambas formas.
describe('worktreeKey', () => {
  it('collapses Windows separators to POSIX', () => {
    expect(worktreeKey('C:\\dev\\repo')).toBe(worktreeKey('C:/dev/repo'))
  })

  it('ignores trailing slashes', () => {
    expect(worktreeKey('C:/dev/repo/')).toBe(worktreeKey('C:/dev/repo'))
    expect(worktreeKey('/home/u/repo')).toBe(worktreeKey('/home/u/repo/'))
  })

  it('keeps distinct paths distinct', () => {
    expect(worktreeKey('/home/u/repo')).not.toBe(worktreeKey('/home/u/repo2'))
  })

  // NTFS es case-insensitive: el dialog del OS y git pueden devolver el MISMO
  // folder con casing distinto (C:/Dev/Repo vs c:/dev/repo) — main.ts ya
  // compara identidad de paths con toLowerCase en sus propios chequeos.
  it('is case-insensitive for Windows-shaped paths (drive letter or UNC)', () => {
    expect(worktreeKey('C:/Dev/Repo')).toBe(worktreeKey('c:/dev/repo'))
    expect(worktreeKey('\\\\server\\Share\\repo')).toBe(worktreeKey('//server/share/repo'))
  })

  // ext4 es case-SENSITIVE: /home/User y /home/user son carpetas distintas —
  // lowercasear paths unix colapsaría dos worktrees reales en uno.
  it('stays case-sensitive for unix paths on linux', () => {
    expect(worktreeKey('/home/User/repo')).not.toBe(worktreeKey('/home/user/repo'))
  })

  // APFS default es case-INSENSITIVE: en macOS dos casings del mismo folder
  // (git worktree add con casing tipeado vs el dialog del OS) son el MISMO
  // worktree — sin colapsarlos, dos modelos Monaco divergen y el último
  // Ctrl+S pisa al otro (hallazgo de la auditoría cross-platform).
  it('is case-insensitive for unix paths on macOS', () => {
    __setUnixCaseInsensitiveForTests(true)
    expect(worktreeKey('/Users/b/DEV/repo')).toBe(worktreeKey('/users/b/dev/repo'))
  })
})

describe('sameWorktree', () => {
  it('matches the two Windows forms of the same worktree', () => {
    expect(sameWorktree('C:\\Users\\x\\repo', 'C:/Users/x/repo')).toBe(true)
  })

  it('rejects different worktrees', () => {
    expect(sameWorktree('/wt-a', '/wt-b')).toBe(false)
  })

  // Un pane sin repoPath no puede leer archivos: no hay identidad que
  // matchear — dos undefined NO son "el mismo worktree".
  it('rejects missing paths, even both missing', () => {
    expect(sameWorktree(undefined, '/wt')).toBe(false)
    expect(sameWorktree('/wt', undefined)).toBe(false)
    expect(sameWorktree(undefined, undefined)).toBe(false)
    expect(sameWorktree('', '')).toBe(false)
  })
})
