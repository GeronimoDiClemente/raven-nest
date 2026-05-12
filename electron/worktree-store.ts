import { join } from 'path'
import { mkdirSync, readFileSync, writeFileSync, existsSync, renameSync } from 'fs'
import { execFileSync } from 'child_process'
import { randomBytes } from 'crypto'
import type { WorktreeMeta } from '../src/types'

// Keys in the store are always POSIX-style (forward slashes). Windows can
// produce both `C:\dev\repo` and `C:/dev/repo` for the same physical path; if
// we mix them, the same worktree shows up twice after a reload.
function posixKey(p: string): string {
  return p.replace(/\\/g, '/')
}

export class WorktreeStore {
  private storeFile: string
  private metas: Map<string, WorktreeMeta> = new Map()

  constructor(storeDir: string) {
    mkdirSync(storeDir, { recursive: true })
    this.storeFile = join(storeDir, 'worktrees.json')
    this.load()
  }

  private load(): void {
    if (!existsSync(this.storeFile)) return
    try {
      const raw = readFileSync(this.storeFile, 'utf8')
      const arr = JSON.parse(raw) as WorktreeMeta[]
      this.metas = new Map(arr.map((m) => {
        const key = posixKey(m.repoPath)
        return [key, { ...m, repoPath: key }]
      }))
    } catch {
      this.metas = new Map()
    }
  }

  private persist(): void {
    // Per-call tmp filename so two concurrent IPC handlers (e.g. setupState
    // event + sibling worktree:create) don't clobber each other's tmp file
    // and break the atomic rename. Without this, on Windows the second
    // renameSync would EEXIST and the new state would be lost.
    const tmpFile = `${this.storeFile}.${randomBytes(6).toString('hex')}.tmp`
    writeFileSync(tmpFile, JSON.stringify(Array.from(this.metas.values()), null, 2))
    renameSync(tmpFile, this.storeFile)
  }

  get(repoPath: string): WorktreeMeta | null {
    return this.metas.get(posixKey(repoPath)) ?? null
  }

  setMeta(meta: WorktreeMeta): void {
    const key = posixKey(meta.repoPath)
    this.metas.set(key, { ...meta, repoPath: key, updatedAt: Date.now() })
    this.persist()
  }

  remove(repoPath: string): void {
    this.metas.delete(posixKey(repoPath))
    this.persist()
  }

  list(): WorktreeMeta[] {
    return Array.from(this.metas.values())
  }

  reconcile(activeWorktreePaths: string[]): void {
    const activeSet = new Set(activeWorktreePaths.map(posixKey))
    let mutated = false
    for (const [path, meta] of this.metas) {
      if (!activeSet.has(path) && meta.setupState !== 'orphaned') {
        this.metas.set(path, { ...meta, setupState: 'orphaned', updatedAt: Date.now() })
        mutated = true
      }
    }
    if (mutated) this.persist()
  }

  hydrateFromGit(repoPath: string): WorktreeMeta[] {
    const normalizedInput = repoPath.replace(/\\/g, '/')
    let raw: string
    try {
      // execFileSync (no shell) — `repoPath` is validated `isAbsolute` upstream
      // but execSync with interpolation would still leak `"`, `` ` ``, `$`,
      // `\n`, etc.
      raw = execFileSync('git', ['-C', normalizedInput, 'worktree', 'list', '--porcelain'], {
        encoding: 'utf8',
        timeout: 5000,
        stdio: ['pipe', 'pipe', 'pipe'],
      })
    } catch {
      return []
    }
    // Parse porcelain: each entry is "worktree <path>\nHEAD <sha>\nbranch <ref>\n\n"
    // The FIRST block is always the actual root repo, regardless of which
    // worktree the caller passed via `-C`. Critical: we use that first block's
    // `wtPath` as `rootRepoPath`, NOT the input — otherwise different tabs
    // pointing at different worktrees of the same repo would each get a
    // different rootRepoPath and the worktree:list filter would split them.
    const blocks = raw.trim().split(/\n\n+/)
    const result: WorktreeMeta[] = []
    let rootRepoPath = ''
    for (const block of blocks) {
      const lines = block.split('\n')
      if (lines.some((l) => l.trim() === 'bare')) continue  // skip bare repos
      const wtPathRaw = lines.find((l) => l.startsWith('worktree '))?.slice(9).trim() ?? ''
      const wtPath = wtPathRaw.replace(/\\/g, '/')
      const branchLine = lines.find((l) => l.startsWith('branch '))?.slice(7).trim() ?? ''
      const branch = branchLine.replace(/^refs\/heads\//, '') || '(detached)'
      if (!wtPath) continue
      if (!rootRepoPath) rootRepoPath = wtPath  // first porcelain entry IS the root
      const existing = this.get(wtPath)
      const now = Date.now()
      const base: WorktreeMeta = existing ?? {
        repoPath: wtPath,
        rootRepoPath,
        branch,
        setupState: 'idle',
        declaredPorts: [],
        detectedPorts: [],
        createdAt: now,
        updatedAt: now,
      }
      const meta: WorktreeMeta = {
        ...base,
        branch,
        rootRepoPath,
        updatedAt: now,
      }
      this.metas.set(wtPath, meta)
      result.push(meta)
    }
    this.persist()
    return result
  }
}
