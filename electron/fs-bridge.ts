// electron/fs-bridge.ts
import { promises as fsp } from 'fs'
import { resolve, sep } from 'path'
import chokidar, { FSWatcher } from 'chokidar'

export interface DirEntry {
  name: string
  path: string        // relative to worktreePath, POSIX-style separators
  isDirectory: boolean
}

export class ScopeViolationError extends Error {
  constructor(worktreePath: string, relPath: string) {
    super(`Path escapes worktree: ${relPath} (worktree: ${worktreePath})`)
    this.name = 'ScopeViolationError'
  }
}

export class UnsupportedFileError extends Error {
  constructor(reason: 'binary' | 'too-large', relPath: string) {
    super(reason === 'binary' ? `Binary file, cannot edit: ${relPath}` : `File too large to edit (>5MB): ${relPath}`)
    this.name = 'UnsupportedFileError'
  }
}

const MAX_READABLE_BYTES = 5 * 1024 * 1024
const BINARY_SNIFF_BYTES = 8000

async function assertReadableAsText(full: string, relPath: string): Promise<void> {
  const stat = await fsp.stat(full)
  if (stat.size > MAX_READABLE_BYTES) throw new UnsupportedFileError('too-large', relPath)
  const handle = await fsp.open(full, 'r')
  try {
    const buffer = Buffer.alloc(Math.min(BINARY_SNIFF_BYTES, stat.size))
    await handle.read(buffer, 0, buffer.length, 0)
    if (buffer.includes(0)) throw new UnsupportedFileError('binary', relPath)
  } finally {
    await handle.close()
  }
}

async function resolveScoped(worktreePath: string, relPath: string): Promise<string> {
  const root = await fsp.realpath(worktreePath)
  const candidate = resolve(root, relPath)
  let real: string
  try {
    real = await fsp.realpath(candidate)
  } catch {
    // Target may not exist yet (e.g. about to be written) — the resolved
    // (non-realpath'd) candidate is still checked against `root` below.
    real = candidate
  }
  const rootWithSep = root.endsWith(sep) ? root : root + sep
  if (real !== root && !real.startsWith(rootWithSep)) {
    throw new ScopeViolationError(worktreePath, relPath)
  }
  return real
}

export async function readFile(worktreePath: string, relPath: string): Promise<string> {
  const full = await resolveScoped(worktreePath, relPath)
  await assertReadableAsText(full, relPath)
  return fsp.readFile(full, 'utf8')
}

export async function writeFile(worktreePath: string, relPath: string, content: string): Promise<void> {
  const full = await resolveScoped(worktreePath, relPath)
  await fsp.writeFile(full, content, 'utf8')
}

export async function listDir(worktreePath: string, relPath: string): Promise<DirEntry[]> {
  const full = await resolveScoped(worktreePath, relPath)
  const entries = await fsp.readdir(full, { withFileTypes: true })
  return entries
    .filter((e) => e.name !== '.git')
    .map((e) => ({
      name: e.name,
      path: relPath ? `${relPath}/${e.name}` : e.name,
      isDirectory: e.isDirectory(),
    }))
    .sort((a, b) => {
      if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1
      return a.name.localeCompare(b.name)
    })
}

export type FsChangeCallback = (worktreePath: string, relPath: string) => void

export class FsWatchRegistry {
  private watchers = new Map<string, FSWatcher>()

  private key(worktreePath: string, relPath: string): string {
    return `${worktreePath}::${relPath}`
  }

  async watch(worktreePath: string, relPath: string, onChange: FsChangeCallback, opts?: { depth?: number }): Promise<void> {
    const key = this.key(worktreePath, relPath)
    if (this.watchers.has(key)) return
    const full = await resolveScoped(worktreePath, relPath)
    const watcher = chokidar.watch(full, {
      ignoreInitial: true,
      depth: opts?.depth,
      awaitWriteFinish: { stabilityThreshold: 200, pollInterval: 50 },
    })
    const fire = () => onChange(worktreePath, relPath)
    watcher.on('change', fire).on('unlink', fire).on('add', fire).on('unlinkDir', fire).on('addDir', fire)
    this.watchers.set(key, watcher)
  }

  async unwatch(worktreePath: string, relPath: string): Promise<void> {
    const key = this.key(worktreePath, relPath)
    const watcher = this.watchers.get(key)
    if (!watcher) return
    await watcher.close()
    this.watchers.delete(key)
  }

  async closeAll(): Promise<void> {
    await Promise.all(Array.from(this.watchers.values()).map((w) => w.close()))
    this.watchers.clear()
  }
}
