import { execFile } from 'child_process'
import { existsSync, statSync } from 'fs'
import { promisify } from 'util'

const execFileP = promisify(execFile)

export type DiffLineType = 'add' | 'del' | 'context' | 'meta'

export interface DiffLine {
  type: DiffLineType
  text: string
  oldNum?: number
  newNum?: number
}

export interface DiffHunk {
  header: string
  lines: DiffLine[]
}

export interface DiffFile {
  path: string
  oldPath?: string
  additions: number
  deletions: number
  binary: boolean
  hunks: DiffHunk[]
  oversized?: boolean
}

export interface DiffResult {
  base: string
  files: DiffFile[]
  notFound?: boolean
}

const MAX_LINES_PER_FILE = 10000

function parseUnifiedDiff(diff: string): DiffFile[] {
  const files: DiffFile[] = []
  const lines = diff.split('\n')
  let i = 0
  while (i < lines.length) {
    if (!lines[i].startsWith('diff --git ')) { i++; continue }
    const headerLine = lines[i]
    const m = headerLine.match(/^diff --git a\/(.+) b\/(.+)$/)
    const oldPath = m?.[1]
    const newPath = m?.[2] ?? oldPath ?? '?'
    const file: DiffFile = {
      path: newPath,
      oldPath: oldPath !== newPath ? oldPath : undefined,
      additions: 0,
      deletions: 0,
      binary: false,
      hunks: [],
    }
    i++
    let oldNum = 0, newNum = 0, currentHunk: DiffHunk | null = null
    let totalLines = 0
    while (i < lines.length && !lines[i].startsWith('diff --git ')) {
      const line = lines[i]
      if (line.startsWith('Binary files ')) { file.binary = true; i++; continue }
      const hunkMatch = line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/)
      if (hunkMatch) {
        oldNum = parseInt(hunkMatch[1]!, 10)
        newNum = parseInt(hunkMatch[2]!, 10)
        currentHunk = { header: line, lines: [] }
        file.hunks.push(currentHunk)
        i++; continue
      }
      if (!currentHunk) { i++; continue }
      if (totalLines > MAX_LINES_PER_FILE) {
        file.oversized = true
        // skip rest of hunks for this file
        while (i < lines.length && !lines[i].startsWith('diff --git ')) i++
        break
      }
      if (line.startsWith('+') && !line.startsWith('+++')) {
        currentHunk.lines.push({ type: 'add', text: line.slice(1), newNum: newNum++ })
        file.additions++
        totalLines++
      } else if (line.startsWith('-') && !line.startsWith('---')) {
        currentHunk.lines.push({ type: 'del', text: line.slice(1), oldNum: oldNum++ })
        file.deletions++
        totalLines++
      } else if (line.startsWith(' ')) {
        currentHunk.lines.push({ type: 'context', text: line.slice(1), oldNum: oldNum++, newNum: newNum++ })
        totalLines++
      }
      i++
    }
    files.push(file)
  }
  return files
}

export async function getDiff(worktreePath: string, base = 'HEAD'): Promise<DiffResult> {
  // If the worktree was deleted out from under us (or never existed), don't
  // shell out to git — execFile would otherwise reject with an opaque ENOENT
  // / "fatal: cannot change to" error. Caller handles `notFound` in its agent.
  if (!existsSync(worktreePath) || !statSync(worktreePath).isDirectory()) {
    return { base: '', files: [], notFound: true }
  }
  const { stdout } = await execFileP('git', ['-C', worktreePath, 'diff', '--no-color', '--unified=3', base], {
    timeout: 10000,
    maxBuffer: 50 * 1024 * 1024,
  })
  return { base, files: parseUnifiedDiff(stdout) }
}

export const _internals = { parseUnifiedDiff }
