import { join } from 'path'
import { mkdirSync, readFileSync, writeFileSync, existsSync, renameSync } from 'fs'
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
}
