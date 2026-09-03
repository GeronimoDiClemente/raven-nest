import { describe, it, expect, afterEach } from 'vitest'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { writeHandoff, readHandoff } from '../integrations/handoff'

const dirs: string[] = []
function tmpWorktree(): string { const d = mkdtempSync(join(tmpdir(), 'handoff-')); dirs.push(d); return d }
afterEach(() => { while (dirs.length) { try { rmSync(dirs.pop()!, { recursive: true, force: true }) } catch { /* ignore */ } } })

describe('handoff file', () => {
  it('read returns null when no handoff exists', () => {
    expect(readHandoff(tmpWorktree())).toBeNull()
  })
  it('write then read round-trips, creating .nest/', () => {
    const wt = tmpWorktree()
    writeHandoff(wt, 'Explored auth.ts; the bug is a missing await on line 42.')
    expect(readHandoff(wt)).toBe('Explored auth.ts; the bug is a missing await on line 42.')
  })
  it('second write overwrites the first', () => {
    const wt = tmpWorktree()
    writeHandoff(wt, 'first summary')
    writeHandoff(wt, 'second summary')
    expect(readHandoff(wt)).toBe('second summary')
  })
})

// El handoff se escribe DENTRO del repo del usuario, y nada lo excluía: aparecía en su
// `git status` como basura nuestra. El arreglo no puede ser el `.gitignore` de este repo
// —el archivo cae en repos ajenos— ni el del usuario, que es un archivo suyo y versionado.
// `.git/info/exclude` es el lugar: por clon, no se commitea, no le tocamos nada tracked.
describe('handoff — no ensucia el repo del usuario', () => {
  it('excluye .nest/ via .git/info/exclude en un repo normal', () => {
    const wt = tmpWorktree()
    mkdirSync(join(wt, '.git', 'info'), { recursive: true })

    writeHandoff(wt, 'un resumen cualquiera')

    expect(readFileSync(join(wt, '.git', 'info', 'exclude'), 'utf8')).toContain('.nest/')
  })

  it('crea info/exclude si el repo no lo tiene', () => {
    const wt = tmpWorktree()
    mkdirSync(join(wt, '.git'), { recursive: true })

    writeHandoff(wt, 'un resumen cualquiera')

    expect(readFileSync(join(wt, '.git', 'info', 'exclude'), 'utf8')).toContain('.nest/')
  })

  // En un worktree de git, `.git` es un ARCHIVO que apunta al gitdir real. Escribir
  // `.git/info/exclude` ahí falla — y los worktrees son el caso normal de este producto.
  it('en un worktree resuelve el gitdir real, que .git es un archivo', () => {
    const wt = tmpWorktree()
    const gitdir = tmpWorktree()
    mkdirSync(join(gitdir, 'info'), { recursive: true })
    writeFileSync(join(wt, '.git'), `gitdir: ${gitdir}\n`)

    writeHandoff(wt, 'un resumen cualquiera')

    expect(readFileSync(join(gitdir, 'info', 'exclude'), 'utf8')).toContain('.nest/')
  })

  it('no duplica la linea si ya esta', () => {
    const wt = tmpWorktree()
    mkdirSync(join(wt, '.git', 'info'), { recursive: true })

    writeHandoff(wt, 'uno')
    writeHandoff(wt, 'dos')

    const exclude = readFileSync(join(wt, '.git', 'info', 'exclude'), 'utf8')
    expect(exclude.split('\n').filter((l) => l.trim() === '.nest/').length).toBe(1)
  })

  it('sin .git escribe el handoff igual, no explota', () => {
    const wt = tmpWorktree()

    writeHandoff(wt, 'un resumen sin repo')

    expect(readHandoff(wt)).toBe('un resumen sin repo')
  })
})
