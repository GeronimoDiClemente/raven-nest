import { join } from 'path'
import { mkdirSync, readFileSync, writeFileSync, existsSync, renameSync } from 'fs'
import { execSync } from 'child_process'
import type { WorktreeMeta } from '../src/types'

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
      this.metas = new Map(arr.map((m) => [m.repoPath, m]))
    } catch {
      this.metas = new Map()
    }
  }

  private persist(): void {
    const tmpFile = `${this.storeFile}.tmp`
    writeFileSync(tmpFile, JSON.stringify(Array.from(this.metas.values()), null, 2))
    renameSync(tmpFile, this.storeFile)
  }

  get(repoPath: string): WorktreeMeta | null {
    return this.metas.get(repoPath) ?? null
  }

  setMeta(meta: WorktreeMeta): void {
    this.metas.set(meta.repoPath, { ...meta, updatedAt: Date.now() })
    this.persist()
  }

  remove(repoPath: string): void {
    this.metas.delete(repoPath)
    this.persist()
  }

  list(): WorktreeMeta[] {
    return Array.from(this.metas.values())
  }

  reconcile(activeWorktreePaths: string[]): void {
    const activeSet = new Set(activeWorktreePaths)
    for (const [path, meta] of this.metas) {
      if (!activeSet.has(path) && meta.setupState !== 'orphaned') {
        this.metas.set(path, { ...meta, setupState: 'orphaned', updatedAt: Date.now() })
      }
    }
    this.persist()
  }

  hydrateFromGit(repoPath: string): WorktreeMeta[] {
    const normalizedInput = repoPath.replace(/\\/g, '/')
    let raw: string
    try {
      raw = execSync(`git -C "${normalizedInput}" worktree list --porcelain`, {
        encoding: 'utf8',
        timeout: 5000,
      })
    } catch {
      return []
    }
    // Parse porcelain: each entry is "worktree <path>\nHEAD <sha>\nbranch <ref>\n\n"
    const blocks = raw.trim().split(/\n\n+/)
    const result: WorktreeMeta[] = []
    let rootRepoPath = ''
    for (const block of blocks) {
      const lines = block.split('\n')
      const wtPath = (lines.find((l) => l.startsWith('worktree '))?.slice(9) ?? '').replace(/\\/g, '/')
      const branchLine = lines.find((l) => l.startsWith('branch '))?.slice(7) ?? ''
      const branch = branchLine.replace(/^refs\/heads\//, '') || '(detached)'
      if (!wtPath) continue
      if (!rootRepoPath) rootRepoPath = repoPath  // first entry is the root; use original input path
      const existing = this.get(wtPath)
      const now = Date.now()
      const meta: WorktreeMeta = existing ?? {
        repoPath: wtPath,
        rootRepoPath,
        branch,
        setupState: 'idle',
        declaredPorts: [],
        detectedPorts: [],
        createdAt: now,
        updatedAt: now,
      }
      meta.branch = branch
      meta.rootRepoPath = rootRepoPath
      this.metas.set(wtPath, meta)
      result.push(meta)
    }
    this.persist()
    return result
  }
}
