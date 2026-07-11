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

  it('watch() on a directory with depth 0 fires (with the DIR relPath) when a direct child is created', async () => {
    mkdirSync(join(root, 'dir'))
    const registry = new FsWatchRegistry()
    const changes: string[] = []
    await registry.watch(root, 'dir', (_wt, relPath) => changes.push(relPath), { depth: 0 })
    await new Promise((r) => setTimeout(r, 300))
    writeFileSync(join(root, 'dir', 'new.txt'), 'x')
    await new Promise((r) => setTimeout(r, 500))
    expect(changes).toContain('dir')
    await registry.closeAll()
  })
})
