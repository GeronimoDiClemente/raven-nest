// electron/__tests__/fs-bridge.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, writeFileSync, symlinkSync } from 'fs'
import { join } from 'path'
import { makeTmpDir, cleanupTmp } from './setup'
import { readFile, writeFile, listDir, ScopeViolationError, UnsupportedFileError, FsWatchRegistry } from '../fs-bridge'

describe('fs-bridge', () => {
  let root: string

  beforeEach(() => {
    root = makeTmpDir('fs-bridge-')
  })

  afterEach(() => {
    cleanupTmp(root)
  })

  it('reads a file scoped to the worktree', async () => {
    writeFileSync(join(root, 'a.txt'), 'hello')
    await expect(readFile(root, 'a.txt')).resolves.toBe('hello')
  })

  it('writes a file scoped to the worktree', async () => {
    await writeFile(root, 'b.txt', 'world')
    await expect(readFile(root, 'b.txt')).resolves.toBe('world')
  })

  it('lists directory entries, hiding .git', async () => {
    mkdirSync(join(root, '.git'))
    mkdirSync(join(root, 'src'))
    writeFileSync(join(root, 'src', 'index.ts'), '')
    writeFileSync(join(root, 'README.md'), '')
    const entries = await listDir(root, '')
    const names = entries.map((e) => e.name)
    expect(names).toContain('src')
    expect(names).toContain('README.md')
    expect(names).not.toContain('.git')
  })

  it('lists nested directory entries by relPath', async () => {
    mkdirSync(join(root, 'src'))
    writeFileSync(join(root, 'src', 'index.ts'), '')
    const entries = await listDir(root, 'src')
    expect(entries).toEqual([{ name: 'index.ts', path: 'src/index.ts', isDirectory: false }])
  })

  it('rejects a relative path that escapes the worktree via ..', async () => {
    await expect(readFile(root, '../outside.txt')).rejects.toThrow(ScopeViolationError)
  })

  it('rejects a binary file', async () => {
    writeFileSync(join(root, 'bin.dat'), Buffer.from([0, 1, 2, 3]))
    await expect(readFile(root, 'bin.dat')).rejects.toThrow(UnsupportedFileError)
  })

  it('rejects a file larger than the readable size limit', async () => {
    writeFileSync(join(root, 'big.txt'), Buffer.alloc(6 * 1024 * 1024, 'a'))
    await expect(readFile(root, 'big.txt')).rejects.toThrow(UnsupportedFileError)
  })

  it('rejects a symlink that points outside the worktree', async ({ skip }) => {
    const outside = makeTmpDir('fs-bridge-outside-')
    writeFileSync(join(outside, 'secret.txt'), 'nope')
    try {
      symlinkSync(join(outside, 'secret.txt'), join(root, 'link.txt'))
    } catch {
      // Creating filesystem symlinks needs elevated privileges on some Windows
      // configurations (no Developer Mode, non-admin). Skip rather than fail
      // CI on a platform limitation unrelated to the scoping logic itself.
      cleanupTmp(outside)
      skip()
      return
    }
    await expect(readFile(root, 'link.txt')).rejects.toThrow(ScopeViolationError)
    cleanupTmp(outside)
  })

  it('rejects a write through a symlinked intermediate directory that points outside the worktree, even when the leaf file does not exist yet', async ({ skip }) => {
    const outside = makeTmpDir('fs-bridge-outside-')
    try {
      symlinkSync(outside, join(root, 'symlinkedDir'), 'junction')
    } catch {
      // Creating filesystem symlinks needs elevated privileges on some Windows
      // configurations (no Developer Mode, non-admin). Skip rather than fail
      // CI on a platform limitation unrelated to the scoping logic itself.
      cleanupTmp(outside)
      skip()
      return
    }
    await expect(writeFile(root, 'symlinkedDir/newfile.txt', 'pwned')).rejects.toThrow(ScopeViolationError)
    cleanupTmp(outside)
  })

  it('watch() fires onChange when the watched file is modified', async () => {
    writeFileSync(join(root, 'watched.txt'), 'v1')
    const registry = new FsWatchRegistry()
    const changes: string[] = []
    await registry.watch(root, 'watched.txt', (_wt, relPath) => changes.push(relPath))
    // chokidar necesita un tick para terminar su scan inicial antes de reportar cambios.
    await new Promise((r) => setTimeout(r, 300))
    writeFileSync(join(root, 'watched.txt'), 'v2')
    await new Promise((r) => setTimeout(r, 500))
    expect(changes).toContain('watched.txt')
    await registry.closeAll()
  })

  it('unwatch() stops firing onChange', async () => {
    writeFileSync(join(root, 'watched2.txt'), 'v1')
    const registry = new FsWatchRegistry()
    const changes: string[] = []
    await registry.watch(root, 'watched2.txt', (_wt, relPath) => changes.push(relPath))
    await new Promise((r) => setTimeout(r, 300))
    await registry.unwatch(root, 'watched2.txt')
    writeFileSync(join(root, 'watched2.txt'), 'v2')
    await new Promise((r) => setTimeout(r, 500))
    expect(changes).toEqual([])
    await registry.closeAll()
  })

  it('dedupes CONCURRENT watch() calls into one watcher with refs for both', async () => {
    // TOCTOU del refcount: el chequeo del mapa era antes del await de
    // resolveScoped y el set después — dos watch() concurrentes (session
    // restore con el mismo archivo en dos panes) pasaban ambos el chequeo,
    // creaban DOS chokidars (uno filtrado para siempre, eventos duplicados)
    // y dejaban refs:1 para dos consumidores.
    writeFileSync(join(root, 'conc.txt'), 'v1')
    const registry = new FsWatchRegistry()
    const changes: string[] = []
    await Promise.all([
      registry.watch(root, 'conc.txt', () => changes.push('a')),
      registry.watch(root, 'conc.txt', () => changes.push('b')),
    ])
    await new Promise((r) => setTimeout(r, 300))
    writeFileSync(join(root, 'conc.txt'), 'v2')
    await new Promise((r) => setTimeout(r, 600))
    // UN solo watcher → exactamente un evento por cambio (no duplicados)
    expect(changes.length).toBe(1)
    changes.length = 0
    await registry.unwatch(root, 'conc.txt') // consumidor 1 se va
    writeFileSync(join(root, 'conc.txt'), 'v3')
    await new Promise((r) => setTimeout(r, 600))
    expect(changes.length).toBe(1) // el consumidor 2 sigue cubierto
    await registry.closeAll()
  })

  it('refcounts watchers: closing one of two panes keeps the survivor watching', async () => {
    // Mismo archivo abierto en DOS panes: cada uno hace watch() (dedupe por
    // key) y al cerrar uno hace unwatch(). Sin refcount, ese único unwatch
    // cerraba el chokidar compartido y el pane sobreviviente dejaba de ver
    // cambios externos — su próximo Ctrl+S los pisaba sin conflicto.
    writeFileSync(join(root, 'shared.txt'), 'v1')
    const registry = new FsWatchRegistry()
    const changes: string[] = []
    await registry.watch(root, 'shared.txt', (_wt, relPath) => changes.push(relPath)) // pane A
    await registry.watch(root, 'shared.txt', (_wt, relPath) => changes.push(relPath)) // pane B (dedupe)
    await new Promise((r) => setTimeout(r, 300))
    await registry.unwatch(root, 'shared.txt') // pane A se cierra
    writeFileSync(join(root, 'shared.txt'), 'v2')
    await new Promise((r) => setTimeout(r, 500))
    expect(changes).toContain('shared.txt') // el pane B sigue enterándose
    changes.length = 0
    await registry.unwatch(root, 'shared.txt') // pane B se cierra: refs a 0
    writeFileSync(join(root, 'shared.txt'), 'v3')
    await new Promise((r) => setTimeout(r, 500))
    expect(changes).toEqual([]) // ahora sí, nadie escucha
    await registry.closeAll()
  })

  it('watch() on a directory with depth 0 fires (with the DIR relPath) when a direct child is created, but not for a grandchild two levels down', async () => {
    mkdirSync(join(root, 'dir'))
    const registry = new FsWatchRegistry()
    const changes: string[] = []
    await registry.watch(root, 'dir', (_wt, relPath) => changes.push(relPath), { depth: 0 })
    await new Promise((r) => setTimeout(r, 300))
    writeFileSync(join(root, 'dir', 'new.txt'), 'x')
    await new Promise((r) => setTimeout(r, 500))
    expect(changes).toContain('dir')

    // depth: 0 must NOT recurse — a change two levels below the watched dir
    // should never surface, proving depth actually limits recursion rather
    // than the assertion above merely being satisfied by an unlimited-depth
    // watcher too. Creating `nested` itself is a direct child, so let it
    // settle first — the assertion below only covers the grandchild.
    mkdirSync(join(root, 'dir', 'nested'))
    await new Promise((r) => setTimeout(r, 500))
    const changesBeforeGrandchild = changes.length
    writeFileSync(join(root, 'dir', 'nested', 'grandchild.txt'), 'y')
    await new Promise((r) => setTimeout(r, 500))
    expect(changes.length).toBe(changesBeforeGrandchild)

    await registry.closeAll()
  })
})
