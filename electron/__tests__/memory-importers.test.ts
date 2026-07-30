// NOTE ON EXECUTION: see the header of memory-store.test.ts — these tests need the
// better-sqlite3 native binding (both for MemoryStore and, for the engram tests, to
// build a synthetic fixture engram.db on the fly). Unexecuted in the sandbox this branch
// was developed in; written to run unmodified on a machine with a working
// better-sqlite3 build. This is also the doc-mandated idempotency check from
// docs/nest-memory-architecture.md §9 Phase 1 "Local test plan": "run the engram
// importer twice, assert identical counts."
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import Database from 'better-sqlite3'
import { join } from 'path'
import { writeFileSync, mkdirSync } from 'fs'
import { makeTmpDir, cleanupTmp } from './setup'
import { MemoryStore } from '../memory-store'
import { importMarkdownFile, importAllMarkdownSources } from '../memory-importers/markdown'
import { importEngramDatabase } from '../memory-importers/engram'

describe('markdown importer — idempotency (§5.3 guard 1: UNIQUE(source, source_ref))', () => {
  let dir: string
  let store: MemoryStore

  beforeEach(() => {
    dir = makeTmpDir('raven-md-import-')
    store = new MemoryStore(join(dir, 'memory.db'))
  })

  afterEach(() => {
    store.close()
    cleanupTmp(dir)
  })

  it('importing the same file twice updates in place instead of duplicating', () => {
    const mdPath = join(dir, 'CLAUDE.md')
    writeFileSync(
      mdPath,
      '## Release process\nThis section explains the release process in enough detail to pass the length minimum.\n'
    )

    const first = importMarkdownFile(store, mdPath, 'proj-a', 'claude-md')
    const second = importMarkdownFile(store, mdPath, 'proj-a', 'claude-md')

    expect(first).toBe(1)
    expect(second).toBe(1)
    expect(store.count()).toBe(1) // NOT 2
  })

  it('a symlinked/duplicated file (same content, different path is not tested — hash dedupe is) imports once via importAllMarkdownSources', () => {
    const globalMd = join(dir, '.claude', 'CLAUDE.md')
    mkdirSync(join(dir, '.claude'), { recursive: true })
    writeFileSync(
      globalMd,
      '## Shared convention\nThis convention applies everywhere and is long enough to clear the minimum length.\n'
    )
    const accountDir = join(dir, 'accounts', 'claude', 'Bautista')
    mkdirSync(join(accountDir, '.claude'), { recursive: true })
    // Simulates account-store's symlink: same bytes, different path.
    writeFileSync(
      join(accountDir, '.claude', 'CLAUDE.md'),
      '## Shared convention\nThis convention applies everywhere and is long enough to clear the minimum length.\n'
    )

    const result = importAllMarkdownSources(store, {
      ravenHomeDir: dir,
      claudeAccountDirs: [accountDir],
      projectRoots: [],
      globalProjectKey: '__global__',
    })

    expect(result.filesSkippedDuplicate).toBe(1) // the second (byte-identical) file
    expect(store.count()).toBe(1)
  })
})

// Builds a tiny synthetic engram.db fixture matching the schema documented in
// docs/nest-memory-architecture.md §5.2.A, so this test has no dependency on any real
// user's engram data (the doc explicitly requires a synthetic fixture, not a copy of a
// real one).
function buildFixtureEngramDb(path: string): void {
  const db = new Database(path)
  db.exec(`
    CREATE TABLE observations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sync_id TEXT, session_id TEXT, type TEXT, title TEXT, content TEXT, tool_name TEXT,
      project TEXT, scope TEXT, topic_key TEXT, normalized_hash TEXT, revision_count INTEGER,
      duplicate_count INTEGER, last_seen_at INTEGER, pinned INTEGER, created_at INTEGER,
      updated_at INTEGER, deleted_at INTEGER
    );
  `)
  const insert = db.prepare(
    `INSERT INTO observations (sync_id, type, title, content, project, scope, topic_key, revision_count,
     duplicate_count, last_seen_at, created_at, updated_at, deleted_at)
     VALUES (@sync_id, @type, @title, @content, @project, @scope, @topic_key, 0, 0, @created_at, @created_at, @created_at, @deleted_at)`
  )
  insert.run({ sync_id: 'obs-fixture-1', type: 'decision', title: 'Use pnpm', content: 'Decided to use pnpm workspaces.', project: 'raven-nest', scope: 'personal', topic_key: null, created_at: Date.now(), deleted_at: null })
  insert.run({ sync_id: 'obs-fixture-2', type: 'bugfix', title: 'Fixed race condition', content: 'Root cause was a missing await.', project: 'raven-nest', scope: 'project', topic_key: null, created_at: Date.now(), deleted_at: null })
  insert.run({ sync_id: 'obs-fixture-3', type: 'discovery', title: 'Deleted row', content: 'Should be skipped on import.', project: 'raven-nest', scope: 'personal', topic_key: null, created_at: Date.now(), deleted_at: Date.now() })
  db.close()
}

describe('engram importer — idempotency and scope handling (§5.2.A, §5.3)', () => {
  let dir: string
  let store: MemoryStore
  let engramDbPath: string

  beforeEach(() => {
    dir = makeTmpDir('raven-engram-import-')
    store = new MemoryStore(join(dir, 'memory.db'))
    engramDbPath = join(dir, 'engram.db')
    buildFixtureEngramDb(engramDbPath)
  })

  afterEach(() => {
    store.close()
    cleanupTmp(dir)
  })

  it('running the importer twice produces identical counts (no duplicates)', () => {
    const first = importEngramDatabase(store, engramDbPath)
    const second = importEngramDatabase(store, engramDbPath)

    expect(first.imported).toBe(2) // 2 non-deleted rows
    expect(second.imported).toBe(2) // re-run reprocesses the same 2, but as updates
    expect(store.count()).toBe(2) // NOT 4 — source_ref identity collapses the re-import
  })

  it('skips deleted_at rows instead of importing them as tombstones', () => {
    const result = importEngramDatabase(store, engramDbPath)
    expect(result.skipped).toBe(1)
    expect(store.count()).toBe(2)
  })

  it('forces every imported row to scope=personal, even engram project-scoped rows', () => {
    importEngramDatabase(store, engramDbPath)
    const rows = store.context('__global__', 10)
    // engram's "project" scope row (obs-fixture-2) must NOT carry over as project/team —
    // the user re-decides sharing from zero (§5.2.A).
    const bugfixRow = store.getBySourceRef('import', 'engram:obs-fixture-2')
    expect(bugfixRow?.scope).toBe('personal')
    void rows
  })

  it('tags imported rows with source_ref = engram:{sync_id} for idempotency', () => {
    importEngramDatabase(store, engramDbPath)
    const row = store.getBySourceRef('import', 'engram:obs-fixture-1')
    expect(row).not.toBeNull()
    expect(row?.title).toBe('Use pnpm')
  })

  it('records an import_runs row', () => {
    const result = importEngramDatabase(store, engramDbPath)
    expect(result.error).toBeUndefined()
    const run = store.getImportRun('engram', engramDbPath)
    expect(run?.state).toBe('done')
    expect(run?.imported).toBe(2)
  })
})
