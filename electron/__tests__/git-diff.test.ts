import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { execFileSync } from 'child_process'
import { parseNumstat, parseAddedLineRanges, getDiffStats, getAddedLines } from '../git-diff'

describe('parseNumstat', () => {
  it('parses added/deleted per file', () => {
    const out = '12\t4\tsrc/utils.ts\n0\t7\tREADME.md\n'
    expect(parseNumstat(out)).toEqual([
      { relPath: 'src/utils.ts', added: 12, deleted: 4 },
      { relPath: 'README.md', added: 0, deleted: 7 },
    ])
  })

  it('skips binary entries (git reports "-")', () => {
    const out = '-\t-\tlogo.png\n3\t1\ta.ts\n'
    expect(parseNumstat(out)).toEqual([{ relPath: 'a.ts', added: 3, deleted: 1 }])
  })

  it('returns empty for empty output', () => {
    expect(parseNumstat('')).toEqual([])
  })
})

describe('parseAddedLineRanges', () => {
  it('extracts +start,count ranges from -U0 hunks', () => {
    const out = [
      '@@ -1,0 +2,3 @@ contexto',
      'basura que no es hunk',
      '@@ -10,2 +14 @@',
    ].join('\n')
    // +2,3 → líneas 2..4 ; +14 (count implícito 1) → 14..14
    expect(parseAddedLineRanges(out)).toEqual([
      { start: 2, end: 4 },
      { start: 14, end: 14 },
    ])
  })

  it('omits pure deletions (+n,0)', () => {
    // borrar líneas produce +n,0 — no hay líneas nuevas que pintar
    expect(parseAddedLineRanges('@@ -5,3 +4,0 @@')).toEqual([])
  })
})

describe('integración con git real', () => {
  let repo: string

  const git = (...a: string[]) => execFileSync('git', ['-C', repo, ...a], { stdio: 'pipe' })

  beforeEach(() => {
    repo = mkdtempSync(join(tmpdir(), 'gitdiff-'))
    execFileSync('git', ['init', '-q', '-b', 'main', repo], { stdio: 'pipe' })
    mkdirSync(join(repo, 'src'), { recursive: true })
    writeFileSync(join(repo, 'src', 'a.ts'), 'uno\ndos\ntres\n')
    git('add', '-A')
    git('-c', 'user.email=t@t', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', 'commit', '-q', '-m', 'i')
  })

  afterEach(() => { rmSync(repo, { recursive: true, force: true }) })

  it('reports modified counts and untracked files vs HEAD', () => {
    writeFileSync(join(repo, 'src', 'a.ts'), 'uno\nDOS CAMBIADO\ntres\ncuatro\ncinco\n')
    writeFileSync(join(repo, 'nuevo.ts'), 'x\n')
    const res = getDiffStats(repo)
    expect(res.ok).toBe(true)
    if (res.ok) {
      expect(res.files).toEqual([{ relPath: 'src/a.ts', added: 3, deleted: 1 }])
      expect(res.untracked).toEqual(['nuevo.ts'])
    }
  })

  it('reports added line ranges for a modified file', () => {
    writeFileSync(join(repo, 'src', 'a.ts'), 'uno\nDOS CAMBIADO\ntres\ncuatro\n')
    const res = getAddedLines(repo, 'src/a.ts')
    expect(res.ok).toBe(true)
    if (res.ok) {
      // línea 2 cambiada + línea 4 nueva
      expect(res.ranges).toEqual([{ start: 2, end: 2 }, { start: 4, end: 4 }])
    }
  })

  it('rejects relPaths that traverse out of the worktree', () => {
    const res = getAddedLines(repo, '../fuera.ts')
    expect(res.ok).toBe(false)
  })

  it('fails gracefully on a repo without commits (no HEAD)', () => {
    const fresh = mkdtempSync(join(tmpdir(), 'gitdiff-fresh-'))
    execFileSync('git', ['init', '-q', fresh], { stdio: 'pipe' })
    try {
      const res = getDiffStats(fresh)
      expect(res.ok).toBe(false)
    } finally {
      rmSync(fresh, { recursive: true, force: true })
    }
  })
})
