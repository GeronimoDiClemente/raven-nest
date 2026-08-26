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
import { MemoryStore, deriveImportSyncId, computeContentIdentity } from '../memory-store'
import { importMarkdownFile, importAllMarkdownSources } from '../memory-importers/markdown'
import { importEngramDatabase } from '../memory-importers/engram'
import { GLOBAL_PROJECT_KEY } from '../memory-project-key'

// Fixture-1's resolved identity everywhere below: 'raven-nest' has no entry in the
// (empty, in these tests) knownProjects map, so resolveProjectKeyForEngramProject falls
// back to GLOBAL_PROJECT_KEY; scope is always forced to 'personal' for engram imports.
// Computed once here so every test that needs fixture-1's deterministic sync_id derives
// it exactly the way the importer does, instead of duplicating the hash by hand.
const FIXTURE_1_SYNC_ID = deriveImportSyncId(
  GLOBAL_PROJECT_KEY,
  'personal',
  'decision',
  computeContentIdentity('Use pnpm', 'Decided to use pnpm workspaces.').hash
)

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
// Timestamps below use engram's REAL representation — SQLite TEXT datetimes in
// 'YYYY-MM-DD HH:MM:SS' format, always UTC (SQLite's CURRENT_TIMESTAMP default) — verified
// against a production engram.db. NOT epoch integers, despite this project's original
// assumption; see memory-importers/engram.ts's parseEngramTimestamp for why the raw string
// can't be passed through to MemoryStore as-is. A fixture using the wrong representation
// (e.g. Date.now()) would let bug-1-regression tests pass while the real importer breaks.
const FIXTURE_1_CREATED_AT = '2020-06-15 12:00:00'
const FIXTURE_2_CREATED_AT = '2021-03-10 08:30:00'
const FIXTURE_2_UPDATED_AT = '2021-03-10 09:00:00'

function buildFixtureEngramDb(path: string): void {
  const db = new Database(path)
  db.exec(`
    CREATE TABLE observations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sync_id TEXT, session_id TEXT, type TEXT, title TEXT, content TEXT, tool_name TEXT,
      project TEXT, scope TEXT, topic_key TEXT, normalized_hash TEXT, revision_count INTEGER,
      duplicate_count INTEGER, last_seen_at TEXT, pinned INTEGER, created_at TEXT,
      updated_at TEXT, deleted_at TEXT
    );
  `)
  const insert = db.prepare(
    `INSERT INTO observations (sync_id, type, title, content, project, scope, topic_key, revision_count,
     duplicate_count, last_seen_at, created_at, updated_at, deleted_at)
     VALUES (@sync_id, @type, @title, @content, @project, @scope, @topic_key, 0, 0, @last_seen_at, @created_at, @updated_at, @deleted_at)`
  )
  insert.run({ sync_id: 'obs-fixture-1', type: 'decision', title: 'Use pnpm', content: 'Decided to use pnpm workspaces.', project: 'raven-nest', scope: 'personal', topic_key: null, created_at: FIXTURE_1_CREATED_AT, updated_at: FIXTURE_1_CREATED_AT, last_seen_at: FIXTURE_1_CREATED_AT, deleted_at: null })
  insert.run({ sync_id: 'obs-fixture-2', type: 'bugfix', title: 'Fixed race condition', content: 'Root cause was a missing await.', project: 'raven-nest', scope: 'project', topic_key: null, created_at: FIXTURE_2_CREATED_AT, updated_at: FIXTURE_2_UPDATED_AT, last_seen_at: FIXTURE_2_UPDATED_AT, deleted_at: null })
  insert.run({ sync_id: 'obs-fixture-3', type: 'discovery', title: 'Deleted row', content: 'Should be skipped on import.', project: 'raven-nest', scope: 'personal', topic_key: null, created_at: '2021-01-01 00:00:00', updated_at: '2021-01-01 00:00:00', last_seen_at: '2021-01-01 00:00:00', deleted_at: '2021-01-02 00:00:00' })
  db.close()
}

interface FixtureRowSpec {
  syncId: string
  type?: string
  title?: string
  content?: string
  project?: string
}

/**
 * Builds a fixture engram.db with caller-specified rows — used by the cross-device and
 * same-run collision tests below, which need control over engram's own sync_id per row
 * while keeping title/content/type/project identical (the exact shape of the field
 * failure: same content, different engram-assigned sync_ids).
 */
function buildFixtureEngramDbWithRows(path: string, rows: FixtureRowSpec[]): void {
  const db = new Database(path)
  db.exec(`
    CREATE TABLE observations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sync_id TEXT, session_id TEXT, type TEXT, title TEXT, content TEXT, tool_name TEXT,
      project TEXT, scope TEXT, topic_key TEXT, normalized_hash TEXT, revision_count INTEGER,
      duplicate_count INTEGER, last_seen_at TEXT, pinned INTEGER, created_at TEXT,
      updated_at TEXT, deleted_at TEXT
    );
  `)
  const insert = db.prepare(
    `INSERT INTO observations (sync_id, type, title, content, project, scope, topic_key, revision_count,
     duplicate_count, last_seen_at, created_at, updated_at, deleted_at)
     VALUES (@sync_id, @type, @title, @content, @project, @scope, @topic_key, 0, 0, @last_seen_at, @created_at, @updated_at, @deleted_at)`
  )
  for (const row of rows) {
    insert.run({
      sync_id: row.syncId,
      type: row.type ?? 'decision',
      title: row.title ?? 'Cross-device shared fact',
      content: row.content ?? 'This fact was captured identically on two machines.',
      project: row.project ?? 'raven-nest',
      scope: 'personal',
      topic_key: null,
      created_at: FIXTURE_1_CREATED_AT,
      updated_at: FIXTURE_1_CREATED_AT,
      last_seen_at: FIXTURE_1_CREATED_AT,
      deleted_at: null,
    })
  }
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

  // Bug 1 regression (production: 1992 imported rows landing within the same second
  // because created_at/updated_at were never passed to store.save() and MemoryStore
  // stamped `now` instead).
  it('preserves engram original created_at/updated_at instead of collapsing to the import moment', () => {
    const beforeImport = Date.now()
    importEngramDatabase(store, engramDbPath)
    const row1 = store.getBySourceRef('import', 'engram:obs-fixture-1')
    expect(row1?.created_at).toBe(Date.parse('2020-06-15T12:00:00Z'))
    expect(row1?.updated_at).toBe(Date.parse('2020-06-15T12:00:00Z'))
    expect(row1!.created_at).toBeLessThan(beforeImport)

    // updated_at differs from created_at in the fixture — asserting on both catches a
    // sloppy fix that maps both to the same source column.
    const row2 = store.getBySourceRef('import', 'engram:obs-fixture-2')
    expect(row2?.created_at).toBe(Date.parse('2021-03-10T08:30:00Z'))
    expect(row2?.updated_at).toBe(Date.parse('2021-03-10T09:00:00Z'))
  })

  // Bug 2 regression (production: 294 duplicate groups / 849 rows after a local wipe +
  // reconnect re-inserted content under fresh random sync_ids).
  it('derives the same sync_id for the same engram row across two independent fresh stores', () => {
    const dir2 = makeTmpDir('raven-engram-import-2-')
    const store2 = new MemoryStore(join(dir2, 'memory.db'))
    try {
      importEngramDatabase(store, engramDbPath)
      importEngramDatabase(store2, engramDbPath)

      const row1 = store.getBySourceRef('import', 'engram:obs-fixture-1')
      const row2 = store2.getBySourceRef('import', 'engram:obs-fixture-1')
      expect(row1?.sync_id).toBe(row2?.sync_id)
      expect(row1?.sync_id).toBe(FIXTURE_1_SYNC_ID)
    } finally {
      store2.close()
      cleanupTmp(dir2)
    }
  })

  it('wipe/reconnect: a row already pulled from the server under its deterministic sync_id is updated, not duplicated, on re-import', () => {
    const expectedSyncId = FIXTURE_1_SYNC_ID

    // Simulates the daemon's pull-apply path (§4.4) restoring this row after a local
    // wipe. The server has no source_ref column, so the restored row carries the
    // deterministic sync_id but NO source_ref — Step 0's (source, source_ref) identity
    // lookup in save() can never find it again; only the sync_id-match step can.
    store.applyIncomingObservation({
      syncId: expectedSyncId,
      projectKey: '__global__', // unmapped 'raven-nest' project -> GLOBAL_PROJECT_KEY, per resolveProjectKeyForEngramProject
      scope: 'personal',
      topicKey: null,
      type: 'decision',
      title: 'Use pnpm',
      content: 'Decided to use pnpm workspaces.',
      updatedAt: Date.now() - 1000,
      lamport: 1,
      deleted: false,
    })
    expect(store.count()).toBe(1)
    expect(store.get(expectedSyncId)?.source_ref).toBeNull()

    const result = importEngramDatabase(store, engramDbPath)

    expect(result.imported).toBe(2) // fixture-1 (matched by sync_id) + fixture-2 (genuinely new)
    expect(store.count()).toBe(2) // NOT 3 — fixture-1 updated the pulled row in place
    const row = store.get(expectedSyncId)
    expect(row?.revision_count).toBe(1) // went through the sync_id-match UPDATE path, not a fresh insert
    // Exactly one mutation for the pulled row's sync_id — the legitimate update. No
    // second ('insert') mutation was appended for it.
    const pendingForPulledRow = store.pendingMutations().filter((m) => m.sync_id === expectedSyncId)
    expect(pendingForPulledRow).toHaveLength(1)
  })
})

// Cross-device dedupe fix regression: live multi-device testing proved the OLD
// (source, sourceRef)-based derivation insufficient — the SAME observation content
// exists in two machines' engram.db files under DIFFERENT engram sync_ids (engram never
// guarantees a stable id across separate installs), so each machine derived a different
// Nest sync_id for identical content and the server (upsert by sync_id, PK sync_id, no
// content dedupe) stored duplicates: 261 duplicate content groups reproduced live. See
// deriveImportSyncId's doc comment in memory-store.ts for the full explanation.
describe('engram importer — cross-device content-derived identity (field failure fix)', () => {
  it('two machines whose engram.db assigns DIFFERENT engram sync_ids to the SAME content converge on the identical Nest sync_id', () => {
    const dirA = makeTmpDir('raven-engram-crossdevice-a-')
    const dirB = makeTmpDir('raven-engram-crossdevice-b-')
    const storeA = new MemoryStore(join(dirA, 'memory.db'))
    const storeB = new MemoryStore(join(dirB, 'memory.db'))
    const dbA = join(dirA, 'engram.db')
    const dbB = join(dirB, 'engram.db')
    try {
      // Same title/content/type/project on both — the only thing that differs is the
      // engram-assigned sync_id, exactly the shape of the reproduced field failure.
      buildFixtureEngramDbWithRows(dbA, [{ syncId: 'device-a-own-engram-sync-id' }])
      buildFixtureEngramDbWithRows(dbB, [{ syncId: 'device-b-totally-different-engram-sync-id' }])

      const resultA = importEngramDatabase(storeA, dbA)
      const resultB = importEngramDatabase(storeB, dbB)
      expect(resultA.imported).toBe(1)
      expect(resultB.imported).toBe(1)

      const rowsA = storeA.context(GLOBAL_PROJECT_KEY, 10)
      const rowsB = storeB.context(GLOBAL_PROJECT_KEY, 10)
      expect(rowsA).toHaveLength(1)
      expect(rowsB).toHaveLength(1)
      // THE regression: under the old (source, sourceRef) derivation these would differ
      // because each engram install's OWN sync_id fed the hash. Content-derived identity
      // makes them converge, so the server's upsert-by-sync_id dedupes cross-device.
      expect(rowsA[0].syncId).toBe(rowsB[0].syncId)
    } finally {
      storeA.close()
      storeB.close()
      cleanupTmp(dirA)
      cleanupTmp(dirB)
    }
  })

  it('same import run: two engram rows with identical content but different engram sync_ids collapse into one observation, revision bumped, without violating idx_obs_source_ref', () => {
    const dirDup = makeTmpDir('raven-engram-samerun-')
    const storeDup = new MemoryStore(join(dirDup, 'memory.db'))
    const dbDup = join(dirDup, 'engram-dup.db')
    try {
      buildFixtureEngramDbWithRows(dbDup, [
        { syncId: 'dup-row-a', type: 'discovery', title: 'Duplicated fact', content: 'Same fact recorded twice with two different engram ids.' },
        { syncId: 'dup-row-b', type: 'discovery', title: 'Duplicated fact', content: 'Same fact recorded twice with two different engram ids.' },
      ])

      let result: ReturnType<typeof importEngramDatabase> | undefined
      expect(() => {
        result = importEngramDatabase(storeDup, dbDup)
      }).not.toThrow() // must not be a PRIMARY KEY or idx_obs_source_ref UNIQUE violation

      expect(result?.imported).toBe(2) // both source rows were processed
      expect(storeDup.count()).toBe(1) // but collapsed into ONE observation via Step 0.5

      const summary = storeDup.context(GLOBAL_PROJECT_KEY, 10)[0]
      const row = storeDup.get(summary.syncId)
      expect(row?.revision_count).toBe(1) // second row updated the first in place
      // The row's source_ref now reflects whichever engram id was processed last — not
      // both at once, which is exactly why idx_obs_source_ref (UNIQUE(source, source_ref))
      // is never violated: only one row ever holds a given source_ref at a time.
      expect(['engram:dup-row-a', 'engram:dup-row-b']).toContain(row?.source_ref)
    } finally {
      storeDup.close()
      cleanupTmp(dirDup)
    }
  })
})
