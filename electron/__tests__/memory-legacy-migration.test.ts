// Task 1 (plan de memoria por cuenta multi-dispositivo), Step 3d: migrateLegacyStorePath()
// tests. Máquinas reales tienen datos capturados bajo el path PLANO legado
// ({home}/.raven-nest/memory/memory.db) — estos tests simulan exactamente esa instalación
// vieja (un HOME temporal con ese archivo preexistente) y confirman que tras la migración
// el archivo (y sus compañeros -wal/-shm cuando existen) termina bajo _local/memory.db con
// sus datos intactos, sin tocar nada cuando no hace falta migrar.
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest'
import { existsSync, mkdirSync, writeFileSync, readFileSync, renameSync, type PathLike } from 'fs'
import { join, dirname } from 'path'
import { makeTmpDir, cleanupTmp } from './setup'
import { MemoryStore, resolveStorePath, migrateLegacyStorePath } from '../memory-store'

function legacyPath(home: string): string {
  return join(home, '.raven-nest', 'memory', 'memory.db')
}

// Adversarial-review fixes (smoke/memory-bridge) on migrateLegacyStorePath: BUG 1 (a
// renameSync had no retry, so a transient Windows EBUSY/EPERM disabled the whole memory
// feature for the session) and BUG 2 (the bare .db moved BEFORE its -wal/-shm companions,
// so a process death between those two renames orphaned a not-yet-checkpointed WAL
// forever, silently). See memory-store.ts's migrateLegacyStorePath doc comment.
//
// `renameSync` is mocked here (real implementation by default, per-test override below) so
// the interrupted-migration and retry tests can force ONE specific rename call to fail
// without touching any other fs call this file — or migrateLegacyStorePath itself — relies
// on (existsSync, mkdirSync, writeFileSync, readFileSync all stay real).
vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>()
  return { ...actual, renameSync: vi.fn(actual.renameSync) }
})

describe('migrateLegacyStorePath (Task 1 Step 3d)', () => {
  let home: string
  let realRenameSync: typeof import('fs').renameSync

  beforeAll(async () => {
    ;({ renameSync: realRenameSync } = await vi.importActual<typeof import('fs')>('fs'))
  })

  beforeEach(() => {
    home = makeTmpDir('raven-legacy-migration-')
  })

  afterEach(() => {
    cleanupTmp(home)
    // Whatever a test installed as the renameSync implementation, put the real one back
    // before the next test — nothing here should leak an override across tests.
    vi.mocked(renameSync).mockImplementation(realRenameSync)
  })

  it('moves a real legacy store to the new _local path, data intact', () => {
    // Exactly what main.ts used to construct pre-migration: a MemoryStore opened directly
    // at the flat legacy path, no account subfolder.
    const legacy = legacyPath(home)
    const legacyStore = new MemoryStore(legacy)
    legacyStore.save({
      projectKey: 'proj-a',
      type: 'discovery',
      title: 'pre-migration note',
      content: 'captured before Task 1 shipped',
      source: 'mcp',
    })
    legacyStore.close()
    expect(existsSync(legacy)).toBe(true)

    migrateLegacyStorePath(home)

    const newPath = resolveStorePath(home, null)
    expect(newPath).toBe(join(home, '.raven-nest', 'memory', '_local', 'memory.db'))
    expect(existsSync(newPath)).toBe(true)
    // The legacy file is gone — moved, not copied.
    expect(existsSync(legacy)).toBe(false)

    const migratedStore = new MemoryStore(newPath)
    const items = migratedStore.search('proj-a', 'pre-migration')
    expect(items).toHaveLength(1)
    expect(items[0].title).toBe('pre-migration note')
    migratedStore.close()
  })

  it('moves -wal/-shm companions alongside the .db when present', () => {
    const legacy = legacyPath(home)
    mkdirSync(dirname(legacy), { recursive: true })
    writeFileSync(legacy, 'fake-db-bytes')
    writeFileSync(`${legacy}-wal`, 'fake-wal-bytes')
    writeFileSync(`${legacy}-shm`, 'fake-shm-bytes')

    migrateLegacyStorePath(home)

    const newPath = resolveStorePath(home, null)
    expect(existsSync(newPath)).toBe(true)
    expect(existsSync(`${newPath}-wal`)).toBe(true)
    expect(existsSync(`${newPath}-shm`)).toBe(true)
    expect(readFileSync(newPath, 'utf8')).toBe('fake-db-bytes')
    expect(readFileSync(`${newPath}-wal`, 'utf8')).toBe('fake-wal-bytes')
    expect(readFileSync(`${newPath}-shm`, 'utf8')).toBe('fake-shm-bytes')

    expect(existsSync(legacy)).toBe(false)
    expect(existsSync(`${legacy}-wal`)).toBe(false)
    expect(existsSync(`${legacy}-shm`)).toBe(false)
  })

  it('is a no-op when there is no legacy file — creates nothing', () => {
    migrateLegacyStorePath(home)

    const newPath = resolveStorePath(home, null)
    expect(existsSync(legacyPath(home))).toBe(false)
    expect(existsSync(newPath)).toBe(false)
    // Not even the directory should appear from a pure no-op run.
    expect(existsSync(dirname(newPath))).toBe(false)
  })

  it('is a no-op when the new _local store already exists — never overwrites it, legacy file left untouched', () => {
    const newPath = resolveStorePath(home, null)
    const newStore = new MemoryStore(newPath)
    newStore.save({
      projectKey: 'proj-a',
      type: 'discovery',
      title: 'already on the new layout',
      content: 'this device already migrated once',
      source: 'mcp',
    })
    newStore.close()

    // A legacy file also happens to exist (e.g. stale leftover from before a previous
    // migration run) — must be left alone, never merged or clobbered.
    const legacy = legacyPath(home)
    mkdirSync(dirname(legacy), { recursive: true })
    writeFileSync(legacy, 'stale-legacy-bytes')

    migrateLegacyStorePath(home)

    expect(existsSync(legacy)).toBe(true)
    expect(readFileSync(legacy, 'utf8')).toBe('stale-legacy-bytes')

    const reopened = new MemoryStore(newPath)
    const items = reopened.search('proj-a', 'already on the new layout')
    expect(items).toHaveLength(1)
    reopened.close()
  })

  it('recovers from a crash before the final .db rename — a second call finishes without losing the WAL (BUG 2)', () => {
    const legacy = legacyPath(home)
    mkdirSync(dirname(legacy), { recursive: true })
    writeFileSync(legacy, 'fake-db-bytes')
    writeFileSync(`${legacy}-wal`, 'fake-wal-bytes')
    writeFileSync(`${legacy}-shm`, 'fake-shm-bytes')

    // Simulate the process dying right before the LAST rename — the bare .db, moved last
    // under the fixed order — after its -wal/-shm companions already made it across.
    vi.mocked(renameSync).mockImplementation((from: PathLike, to: PathLike) => {
      if (from === legacy) {
        throw Object.assign(new Error('simulated crash before the final .db rename'), { code: 'SIMULATED_CRASH' })
      }
      return realRenameSync(from, to)
    })

    expect(() => migrateLegacyStorePath(home)).toThrow('simulated crash before the final .db rename')

    const newPath = resolveStorePath(home, null)
    // Companions made it across before the simulated crash...
    expect(existsSync(`${newPath}-wal`)).toBe(true)
    expect(existsSync(`${newPath}-shm`)).toBe(true)
    // ...but the .db itself — and therefore the guard's "migration already done" signal —
    // did not. The legacy .db is still exactly where it was; its companions are gone.
    expect(existsSync(newPath)).toBe(false)
    expect(existsSync(legacy)).toBe(true)
    expect(existsSync(`${legacy}-wal`)).toBe(false)
    expect(existsSync(`${legacy}-shm`)).toBe(false)

    // Second call (the next app start): existsSync(newPath) is still false so the guard
    // does not short-circuit, the loop runs again, and existsSync(from) silently skips the
    // two files already moved — only the .db itself is actually renamed this time.
    vi.mocked(renameSync).mockImplementation(realRenameSync)
    migrateLegacyStorePath(home)

    expect(existsSync(newPath)).toBe(true)
    expect(existsSync(legacy)).toBe(false)
    expect(readFileSync(newPath, 'utf8')).toBe('fake-db-bytes')
    expect(readFileSync(`${newPath}-wal`, 'utf8')).toBe('fake-wal-bytes')
    expect(readFileSync(`${newPath}-shm`, 'utf8')).toBe('fake-shm-bytes')
  })

  it('retries a transient EBUSY on an individual rename and recovers (BUG 1)', () => {
    const legacy = legacyPath(home)
    mkdirSync(dirname(legacy), { recursive: true })
    writeFileSync(legacy, 'fake-db-bytes')
    writeFileSync(`${legacy}-wal`, 'fake-wal-bytes')
    writeFileSync(`${legacy}-shm`, 'fake-shm-bytes')

    let callCount = 0
    vi.mocked(renameSync).mockImplementation((from: PathLike, to: PathLike) => {
      callCount += 1
      if (callCount === 1) {
        // Simulates the Windows antivirus/indexer/OneDrive transient lock the review
        // flagged — the very first rename attempt of the run hits it.
        throw Object.assign(new Error('simulated transient lock'), { code: 'EBUSY' })
      }
      return realRenameSync(from, to)
    })

    expect(() => migrateLegacyStorePath(home)).not.toThrow()

    const newPath = resolveStorePath(home, null)
    expect(existsSync(newPath)).toBe(true)
    expect(existsSync(`${newPath}-wal`)).toBe(true)
    expect(existsSync(`${newPath}-shm`)).toBe(true)
    expect(existsSync(legacy)).toBe(false)
    // 3 files to move + 1 retry for the one that hit EBUSY on its first attempt.
    expect(callCount).toBe(4)
  })

  it('does not retry a non-transient rename error — it propagates immediately', () => {
    const legacy = legacyPath(home)
    mkdirSync(dirname(legacy), { recursive: true })
    writeFileSync(legacy, 'fake-db-bytes')

    let callCount = 0
    vi.mocked(renameSync).mockImplementation(() => {
      callCount += 1
      // Not EBUSY/EPERM — a real, non-transient failure that retrying could never fix.
      throw Object.assign(new Error('permission denied, not a transient lock'), { code: 'EACCES' })
    })

    expect(() => migrateLegacyStorePath(home)).toThrow('permission denied, not a transient lock')
    expect(callCount).toBe(1)
  })
})
