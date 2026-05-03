import { join } from 'path'
import { mkdirSync } from 'fs'
import type { WorktreeMeta } from '../src/types'

export class WorktreeStore {
  private storeDir: string
  private storeFile: string

  constructor(storeDir: string) {
    this.storeDir = storeDir
    this.storeFile = join(storeDir, 'worktrees.json')
    mkdirSync(storeDir, { recursive: true })
  }

  get(repoPath: string): WorktreeMeta | null {
    return null  // placeholder, Task 3 lo implementa correctamente
  }
}
