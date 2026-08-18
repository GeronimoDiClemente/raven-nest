import { execFileSync } from 'child_process'

// Diff stats por worktree para el editor: badges +N −M en el Explorer y
// líneas agregadas en verde en el editor. Diff contra HEAD (todo lo no
// commiteado, staged o no): la pregunta del flujo Nest es "qué cambié desde
// el último commit", no el split staged/unstaged de VS Code.

export interface FileDiffStat {
  relPath: string
  added: number
  deleted: number
}

export type DiffStatsResult =
  | { ok: true; files: FileDiffStat[]; untracked: string[] }
  | { ok: false; error: string }

export type AddedLinesResult =
  | { ok: true; ranges: Array<{ start: number; end: number }> }
  | { ok: false; error: string }

// `git diff --numstat`: una línea por archivo, `added\tdeleted\tpath`.
// Binarios reportan `-\t-\tpath` — no hay conteo de líneas que mostrar.
export function parseNumstat(stdout: string): FileDiffStat[] {
  const files: FileDiffStat[] = []
  for (const line of stdout.split('\n')) {
    if (!line.trim()) continue
    const [a, d, ...rest] = line.split('\t')
    const relPath = rest.join('\t')
    if (!relPath || a === '-' || d === '-') continue
    const added = Number(a)
    const deleted = Number(d)
    if (Number.isNaN(added) || Number.isNaN(deleted)) continue
    files.push({ relPath: relPath.replace(/\\/g, '/'), added, deleted })
  }
  return files
}

// Hunks de `git diff -U0`: `@@ -a[,b] +c[,d] @@`. Las líneas agregadas del
// hunk son c..c+d-1 (d implícito = 1; d=0 = borrado puro, nada que pintar).
export function parseAddedLineRanges(stdout: string): Array<{ start: number; end: number }> {
  const ranges: Array<{ start: number; end: number }> = []
  const re = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/
  for (const line of stdout.split('\n')) {
    const m = re.exec(line)
    if (!m) continue
    const start = Number(m[1])
    const count = m[2] === undefined ? 1 : Number(m[2])
    if (count <= 0) continue
    ranges.push({ start, end: start + count - 1 })
  }
  return ranges
}

function runGit(worktreePath: string, args: string[]): string {
  // execFileSync sin shell — mismo patrón que worktree-store.ts.
  return execFileSync('git', ['-C', worktreePath, ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 10 * 1024 * 1024,
  })
}

export function getDiffStats(worktreePath: string): DiffStatsResult {
  try {
    const numstat = runGit(worktreePath, ['diff', 'HEAD', '--numstat', '--no-renames'])
    const untrackedRaw = runGit(worktreePath, ['ls-files', '--others', '--exclude-standard'])
    const untracked = untrackedRaw.split('\n').map((l) => l.trim().replace(/\\/g, '/')).filter(Boolean)
    return { ok: true, files: parseNumstat(numstat), untracked }
  } catch (err) {
    // Típico: repo sin commits todavía (HEAD no existe) o path que no es repo.
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

export function getAddedLines(worktreePath: string, relPath: string): AddedLinesResult {
  // git falla solo con "outside repository" para pathspecs con ..; el guard
  // corta antes y con un error claro.
  if (relPath.split(/[\\/]/).includes('..')) {
    return { ok: false, error: 'relPath escapes the worktree' }
  }
  try {
    const out = runGit(worktreePath, ['diff', 'HEAD', '-U0', '--no-renames', '--', relPath])
    return { ok: true, ranges: parseAddedLineRanges(out) }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}
