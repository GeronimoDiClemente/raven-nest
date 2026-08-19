// electron/fs-bridge.ts
import { promises as fsp } from 'fs'
import { basename, dirname, join, resolve, sep } from 'path'
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
  const rootWithSep = root.endsWith(sep) ? root : root + sep

  const assertWithinRoot = (p: string): void => {
    if (p !== root && !p.startsWith(rootWithSep)) {
      throw new ScopeViolationError(worktreePath, relPath)
    }
  }

  // Fast path: the whole candidate exists on disk. realpath() resolves every
  // symlink in it (including the leaf), so a direct string-prefix check
  // against `root` is safe here.
  try {
    const real = await fsp.realpath(candidate)
    assertWithinRoot(real)
    return real
  } catch (err) {
    if (!(err instanceof Error) || (err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
  }

  // realpath() failed because the candidate — or some ancestor of it —
  // doesn't exist yet. realpath() cannot resolve a path unless the ENTIRE
  // path exists, so we can't just trust the un-resolved candidate string:
  // an EXISTING intermediate directory earlier in the path could be a
  // symlink pointing outside `root`, and the raw candidate string would
  // still textually start with `root` even though the OS would follow that
  // symlink at write time. So: walk up from the candidate to the nearest
  // ancestor that actually exists (even as a symlink — lstat, not stat, so
  // we don't get fooled by a *broken* symlink reading as "missing"),
  // realpath just that existing ancestor to flush out any symlinks in it,
  // verify the result is inside `root`, and only then re-append the
  // remaining path segments — which are guaranteed not to exist yet, so
  // they cannot themselves be symlinks.
  const missingSegments: string[] = []
  let ancestor = candidate
  while (ancestor !== root) {
    const parent = dirname(ancestor)
    if (parent === ancestor) {
      // Walked all the way to the filesystem root without ever reaching
      // `root` — relPath resolves entirely outside the worktree.
      throw new ScopeViolationError(worktreePath, relPath)
    }
    let exists = true
    try {
      await fsp.lstat(ancestor)
    } catch (statErr) {
      if (statErr instanceof Error && (statErr as NodeJS.ErrnoException).code === 'ENOENT') {
        exists = false
      } else {
        throw statErr
      }
    }
    if (exists) break
    missingSegments.unshift(basename(ancestor))
    ancestor = parent
  }

  const realAncestor = ancestor === root ? root : await fsp.realpath(ancestor)
  assertWithinRoot(realAncestor)

  const real = missingSegments.length > 0 ? join(realAncestor, ...missingSegments) : realAncestor
  assertWithinRoot(real)
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

interface WatchEntry {
  refs: number
  watcher: FSWatcher | null
  // Resuelve cuando el chokidar quedó registrado (o la validación falló).
  ready: Promise<void>
}

// Identidad canónica del worktreePath para keyear watchers. Dos productores
// nombran el MISMO dir con formas distintas (worktree-store POSIX 'C:/repo' vs
// dialog/clone nativo 'C:\repo', o un trailing slash). Sin colapsarlas, cada
// forma abría su propio chokidar → eventos duplicados y el refcount de abajo
// quedaba bypasseado. Espeja worktreeKey del renderer, pero acá SÍ hay
// process.platform: win32 (NTFS case-insensitive) se lowercasea; en POSIX se
// respeta el case (Linux ext4 es case-SENSITIVE, lowercasear colapsaría dos
// worktrees reales).
function normalizeWatchPath(worktreePath: string): string {
  const posix = worktreePath.replace(/\\/g, '/').replace(/\/+$/, '') || '/'
  return process.platform === 'win32' ? posix.toLowerCase() : posix
}

export class FsWatchRegistry {
  // Refcount por key: el mismo archivo abierto en dos panes produce dos
  // watch() (dedupeados a UN chokidar) y dos unwatch() al cerrarse cada uno.
  // Sin el contador, el primer unwatch cerraba el watcher compartido y el
  // pane sobreviviente dejaba de ver cambios externos — su próximo Ctrl+S
  // los pisaba sin pasar por el banner de conflicto.
  //
  // La ENTRADA se registra SINCRÓNICAMENTE, antes del await de resolveScoped:
  // con el chequeo antes del await y el set después, dos watch() concurrentes
  // (session restore con el mismo archivo en dos panes) pasaban ambos el
  // chequeo y creaban DOS chokidars — uno filtrado para siempre emitiendo
  // eventos duplicados, y refs:1 para dos consumidores.
  private watchers = new Map<string, WatchEntry>()

  private key(worktreePath: string, relPath: string): string {
    return `${normalizeWatchPath(worktreePath)}::${relPath}`
  }

  async watch(worktreePath: string, relPath: string, onChange: FsChangeCallback, opts?: { depth?: number }): Promise<void> {
    const key = this.key(worktreePath, relPath)
    const existing = this.watchers.get(key)
    if (existing) {
      existing.refs++
      return existing.ready
    }
    const entry: WatchEntry = { refs: 1, watcher: null, ready: Promise.resolve() }
    entry.ready = (async () => {
      try {
        const full = await resolveScoped(worktreePath, relPath)
        const watcher = chokidar.watch(full, {
          ignoreInitial: true,
          depth: opts?.depth,
          awaitWriteFinish: { stabilityThreshold: 200, pollInterval: 50 },
        })
        const fire = () => onChange(worktreePath, relPath)
        watcher.on('change', fire).on('unlink', fire).on('add', fire).on('unlinkDir', fire).on('addDir', fire)
        entry.watcher = watcher
      } catch (err) {
        // Validación fallida: la entrada no representa ningún watcher — se
        // retira para que un watch posterior pueda reintentar limpio.
        if (this.watchers.get(key) === entry) this.watchers.delete(key)
        throw err
      }
    })()
    this.watchers.set(key, entry)
    return entry.ready
  }

  async unwatch(worktreePath: string, relPath: string): Promise<void> {
    const key = this.key(worktreePath, relPath)
    const entry = this.watchers.get(key)
    if (!entry) return
    entry.refs--
    if (entry.refs > 0) return
    this.watchers.delete(key)
    // Esperar la registración en vuelo antes de cerrar — sin esto, un
    // unwatch inmediato podía correr con watcher aún null y filtrarlo.
    await entry.ready.catch(() => {})
    if (entry.watcher) await entry.watcher.close()
  }

  async closeAll(): Promise<void> {
    const entries = Array.from(this.watchers.values())
    this.watchers.clear()
    await Promise.all(entries.map(async (e) => {
      await e.ready.catch(() => {})
      if (e.watcher) await e.watcher.close()
    }))
  }
}
