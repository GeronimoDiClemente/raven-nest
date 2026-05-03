import { watch, type FSWatcher } from 'fs'
import { copyFile, unlink, mkdir, stat } from 'fs/promises'
import { join, relative, dirname, sep } from 'path'
import { EventEmitter } from 'events'

const DEFAULT_IGNORE = ['.git', 'node_modules', 'dist', '.next', 'build', '.cache', '.turbo']

interface ActiveMirror {
  worktreePath: string
  rootRepoPath: string
  watcher: FSWatcher
  ignore: Set<string>
  startedAt: number
  events: number
  errors: string[]
}

function isIgnored(rel: string, ignore: Set<string>): boolean {
  if (!rel) return true
  const parts = rel.split(/[\\/]/)
  return parts.some((seg) => ignore.has(seg))
}

async function copyWithRetry(src: string, dst: string, attempts = 3): Promise<void> {
  let lastErr: unknown = null
  for (let i = 0; i < attempts; i++) {
    try {
      await mkdir(dirname(dst), { recursive: true })
      await copyFile(src, dst)
      return
    } catch (err) {
      lastErr = err
      await new Promise((r) => setTimeout(r, 50 * (i + 1)))
    }
  }
  throw lastErr
}

export class SpotlightEngine extends EventEmitter {
  private active: ActiveMirror | null = null

  isActive(): boolean { return this.active !== null }

  status(): { active: boolean; worktreePath?: string; events?: number; errors?: number } {
    if (!this.active) return { active: false }
    return {
      active: true,
      worktreePath: this.active.worktreePath,
      events: this.active.events,
      errors: this.active.errors.length,
    }
  }

  async start(worktreePath: string, rootRepoPath: string, extraIgnore: string[] = []): Promise<void> {
    if (this.active) {
      if (this.active.worktreePath === worktreePath) return
      await this.stop()
    }
    const ignore = new Set([...DEFAULT_IGNORE, ...extraIgnore])
    let watcher: FSWatcher
    try {
      watcher = watch(worktreePath, { recursive: true })
    } catch (err) {
      throw new Error(`spotlight failed to watch (Linux requires recursive support; got: ${(err as Error).message})`)
    }
    const mirror: ActiveMirror = {
      worktreePath,
      rootRepoPath,
      watcher,
      ignore,
      startedAt: Date.now(),
      events: 0,
      errors: [],
    }
    this.active = mirror

    watcher.on('change', (_eventType, filename) => {
      if (!filename) return
      const rel = String(filename)
      if (isIgnored(rel, ignore)) return
      void this.handleChange(rel)
    })
    watcher.on('error', (err) => {
      mirror.errors.push(err.message)
      this.emit('warning', err.message)
    })
    this.emit('start', worktreePath)
  }

  private async handleChange(rel: string): Promise<void> {
    if (!this.active) return
    const src = join(this.active.worktreePath, rel)
    const dst = join(this.active.rootRepoPath, rel)
    try {
      const st = await stat(src).catch(() => null)
      if (!st) {
        await unlink(dst).catch(() => {})
      } else if (st.isFile()) {
        await copyWithRetry(src, dst)
      }
      this.active.events++
      this.emit('event', { rel, type: 'sync' })
    } catch (err) {
      this.active.errors.push((err as Error).message)
      this.emit('warning', `${rel}: ${(err as Error).message}`)
    }
  }

  async stop(): Promise<void> {
    if (!this.active) return
    try { this.active.watcher.close() } catch {}
    const wt = this.active.worktreePath
    this.active = null
    this.emit('stop', wt)
  }
}

export const _internals = { isIgnored, sep }
