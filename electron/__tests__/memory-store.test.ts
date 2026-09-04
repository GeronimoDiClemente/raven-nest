// NOTE ON EXECUTION: these tests require the better-sqlite3 native binding, which could
// not be built or fetched as a prebuilt binary in the sandbox this branch was developed
// in (no Visual Studio Build Tools, and no published better-sqlite3 prebuild for the
// sandbox's Node version — see the implementation report for details; this is exactly
// risk R-5 in docs/nest-memory-architecture.md §10). They are believed correct against
// the store's implementation and are written to run unmodified on any machine with a
// working `npm run postinstall` (electron-rebuild) or a compatible better-sqlite3
// prebuild. Run `npx vitest run electron/__tests__/memory-store.test.ts` to verify.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { join } from 'path'
import { makeTmpDir, cleanupTmp } from './setup'
import { MemoryStore, SCHEMA_VERSION, deriveImportSyncId, computeContentIdentity, resolveStorePath } from '../memory-store'
import { swapMemoryStore, type SwapContext } from '../memory-account-switch'

describe('MemoryStore — write path resolution (§3.1)', () => {
  let dir: string
  let store: MemoryStore

  beforeEach(() => {
    dir = makeTmpDir('raven-memory-store-')
    store = new MemoryStore(join(dir, 'memory.db'))
  })

  afterEach(() => {
    store.close()
    cleanupTmp(dir)
  })

  it('inserts a new observation and appends one mutation_log row', () => {
    const result = store.save({
      projectKey: 'proj-a',
      type: 'decision',
      title: 'Use TanStack Query',
      content: 'Decided to use TanStack Query for all server state.',
      source: 'mcp',
    })
    expect(result.outcome).toBe('inserted')
    expect(store.count()).toBe(1)
    expect(store.pendingMutations()).toHaveLength(1)
    expect(store.pendingMutations()[0].op).toBe('upsert')
  })

  it('topic_key upsert rewrites the row in place, keeping the same sync_id', () => {
    const first = store.save({
      projectKey: 'proj-a',
      topicKey: 'architecture/auth-model',
      type: 'architecture',
      title: 'Auth model v1',
      content: 'JWT-based auth with refresh tokens.',
      source: 'mcp',
    })
    const second = store.save({
      projectKey: 'proj-a',
      topicKey: 'architecture/auth-model',
      type: 'architecture',
      title: 'Auth model v2',
      content: 'Switched to session cookies.',
      source: 'mcp',
    })
    expect(second.syncId).toBe(first.syncId)
    expect(second.outcome).toBe('topic_updated')
    expect(store.count()).toBe(1) // still one active row, not two
    const row = store.get(first.syncId)
    expect(row?.title).toBe('Auth model v2')
    expect(row?.revision_count).toBe(1)
  })

  it('content dedupe window absorbs an identical save instead of inserting a duplicate', () => {
    const first = store.save({
      projectKey: 'proj-a',
      type: 'bugfix',
      title: 'Fixed N+1 query',
      content: 'Root cause: missing eager load in UserList.',
      source: 'mcp',
    })
    const second = store.save({
      projectKey: 'proj-a',
      type: 'bugfix',
      title: 'Fixed N+1 query',
      content: 'Root cause: missing eager load in UserList.',
      source: 'mcp',
    })
    expect(second.syncId).toBe(first.syncId)
    expect(second.outcome).toBe('duplicate')
    expect(store.count()).toBe(1)
    const row = store.get(first.syncId)
    expect(row?.duplicate_count).toBe(1)
  })

  it('a different topic_key or different content produces separate rows', () => {
    store.save({ projectKey: 'proj-a', topicKey: 'a', type: 'pattern', title: 'A', content: 'Content A here.', source: 'mcp' })
    store.save({ projectKey: 'proj-a', topicKey: 'b', type: 'pattern', title: 'B', content: 'Content B here.', source: 'mcp' })
    expect(store.count()).toBe(2)
  })

  it('scope isolation: a save with scope=personal never contaminates another project_key', () => {
    store.save({ projectKey: 'proj-a', type: 'decision', title: 'A decision', content: 'Content for project A.', source: 'mcp' })
    const results = store.context('proj-b')
    expect(results).toHaveLength(0)
  })

  it('redacts secrets before persisting', () => {
    const result = store.save({
      projectKey: 'proj-a',
      type: 'config',
      title: 'API setup',
      content: 'Set api_key=sk-abcdefghijklmnop123 in the .env file.',
      source: 'mcp',
    })
    expect(result.redacted).toBe(true)
    const row = store.get(result.syncId)
    expect(row?.content).not.toContain('sk-abcdefghijklmnop123')
  })
})

describe('MemoryStore — search & context', () => {
  let dir: string
  let store: MemoryStore

  beforeEach(() => {
    dir = makeTmpDir('raven-memory-store-')
    store = new MemoryStore(join(dir, 'memory.db'))
  })

  afterEach(() => {
    store.close()
    cleanupTmp(dir)
  })

  it('search finds a saved observation by content via FTS5', () => {
    store.save({ projectKey: 'proj-a', type: 'discovery', title: 'Weird bug', content: 'The websocket reconnect loop was the culprit.', source: 'mcp' })
    const results = store.search('proj-a', 'websocket')
    expect(results).toHaveLength(1)
    expect(results[0].title).toBe('Weird bug')
  })

  it('context returns recent observations ordered by updated_at desc', () => {
    store.save({ projectKey: 'proj-a', type: 'decision', title: 'First', content: 'First decision made here.', source: 'mcp' })
    store.save({ projectKey: 'proj-a', type: 'decision', title: 'Second', content: 'Second decision made here.', source: 'mcp' })
    const results = store.context('proj-a', 5)
    expect(results[0].title).toBe('Second')
    expect(results[1].title).toBe('First')
  })

  it('context includes __global__ project-less memories alongside project-scoped ones', () => {
    store.save({ projectKey: '__global__', type: 'preference', title: 'Global pref', content: 'User prefers dark mode everywhere.', source: 'mcp' })
    store.save({ projectKey: 'proj-a', type: 'decision', title: 'Local decision', content: 'Only relevant to proj-a.', source: 'mcp' })
    const results = store.context('proj-a', 10)
    expect(results.map((r) => r.title).sort()).toEqual(['Global pref', 'Local decision'])
  })
})

describe('MemoryStore — mutation log / offline queue (§4.5)', () => {
  let dir: string
  let store: MemoryStore

  beforeEach(() => {
    dir = makeTmpDir('raven-memory-store-')
    store = new MemoryStore(join(dir, 'memory.db'))
  })

  afterEach(() => {
    store.close()
    cleanupTmp(dir)
  })

  it('markPushed clears pending mutations', () => {
    store.save({ projectKey: 'proj-a', type: 'decision', title: 'X', content: 'Content X here for testing.', source: 'mcp' })
    const pending = store.pendingMutations()
    expect(pending).toHaveLength(1)
    store.markPushed(pending.map((p) => p.seq))
    expect(store.pendingMutations()).toHaveLength(0)
  })

  it('a topic_key update after the original save appends a SECOND mutation for the SAME sync_id', () => {
    const first = store.save({ projectKey: 'proj-a', topicKey: 't', type: 'decision', title: 'v1', content: 'Version one content here.', source: 'mcp' })
    store.save({ projectKey: 'proj-a', topicKey: 't', type: 'decision', title: 'v2', content: 'Version two content here.', source: 'mcp' })
    const pending = store.pendingMutations()
    expect(pending).toHaveLength(2)
    expect(pending.every((p) => p.sync_id === first.syncId)).toBe(true)
  })

  // Task 8 (smoke/memory-bridge): a REVERSIBLE server rejection (project_limit_reached,
  // quota_exceeded) must not be discarded the way markPushed() discards a terminal one —
  // the user can lift these by paying or freeing space, so the mutation has to survive
  // somewhere the daemon can find it again, without also being retried every single cycle.
  describe('blockMutations / blockedMutations / unblockMutations', () => {
    it('a blocked mutation disappears from pendingMutations but not from the log', () => {
      store.save({ projectKey: 'proj-a', type: 'decision', title: 'X', content: 'x', source: 'mcp' })
      const [row] = store.pendingMutations()

      store.blockMutations([{ seq: row.seq, reason: 'project_limit_reached' }])

      expect(store.pendingMutations().map((m) => m.seq)).not.toContain(row.seq)
      expect(store.blockedMutations().map((m) => m.seq)).toContain(row.seq)
    })

    it('a blocked mutation is not counted as pending either', () => {
      store.save({ projectKey: 'proj-a', type: 'decision', title: 'X', content: 'x', source: 'mcp' })
      const [row] = store.pendingMutations()
      store.blockMutations([{ seq: row.seq, reason: 'quota_exceeded' }])

      expect(store.pendingMutationCount()).toBe(0)
    })

    it('blockMutations records the reason as last_error too, for visibility', () => {
      store.save({ projectKey: 'proj-a', type: 'decision', title: 'X', content: 'x', source: 'mcp' })
      const [row] = store.pendingMutations()
      store.blockMutations([{ seq: row.seq, reason: 'project_limit_reached' }])

      expect(store.blockedMutations()[0].last_error).toBe('project_limit_reached')
    })

    it('unblockMutations only lifts the reasons named, not every blocked row', () => {
      store.save({ projectKey: 'proj-a', type: 'decision', title: 'A', content: 'a', source: 'mcp' })
      store.save({ projectKey: 'proj-a', type: 'decision', title: 'B', content: 'b', source: 'mcp' })
      const [rowA, rowB] = store.pendingMutations()
      store.blockMutations([
        { seq: rowA.seq, reason: 'project_limit_reached' },
        { seq: rowB.seq, reason: 'quota_exceeded' },
      ])

      store.unblockMutations(['quota_exceeded'])

      const pendingSeqs = store.pendingMutations().map((m) => m.seq)
      expect(pendingSeqs).toContain(rowB.seq) // freed
      expect(pendingSeqs).not.toContain(rowA.seq) // still blocked
      expect(store.blockedMutations().map((m) => m.seq)).toEqual([rowA.seq])
    })

    it('an empty reasons list is a no-op, not "unblock everything"', () => {
      store.save({ projectKey: 'proj-a', type: 'decision', title: 'X', content: 'x', source: 'mcp' })
      const [row] = store.pendingMutations()
      store.blockMutations([{ seq: row.seq, reason: 'project_limit_reached' }])

      store.unblockMutations([])

      expect(store.blockedMutations().map((m) => m.seq)).toContain(row.seq)
    })
  })
})

describe('MemoryStore — applyIncomingObservation (daemon pull-apply path, §4.4)', () => {
  let dir: string
  let store: MemoryStore

  beforeEach(() => {
    dir = makeTmpDir('raven-memory-store-')
    store = new MemoryStore(join(dir, 'memory.db'))
  })

  afterEach(() => {
    store.close()
    cleanupTmp(dir)
  })

  it('inserts a row that does not exist locally yet, without going through save()s dedupe path', () => {
    store.applyIncomingObservation({
      syncId: 'obs-remote-1',
      projectKey: 'proj-a',
      scope: 'personal',
      topicKey: null,
      type: 'decision',
      title: 'From another device',
      content: 'Synced from device B.',
      updatedAt: Date.now(),
      lamport: 1,
      deleted: false,
    })
    const row = store.get('obs-remote-1')
    expect(row).not.toBeNull()
    expect(row?.title).toBe('From another device')
  })

  it('is idempotent — applying the same incoming row twice does not duplicate', () => {
    const incoming = {
      syncId: 'obs-remote-2',
      projectKey: 'proj-a',
      scope: 'personal',
      topicKey: null,
      type: 'decision',
      title: 'Idempotent row',
      content: 'Should only exist once.',
      updatedAt: Date.now(),
      lamport: 1,
      deleted: false,
    }
    store.applyIncomingObservation(incoming)
    store.applyIncomingObservation(incoming)
    expect(store.count()).toBe(1)
  })

  it('findActiveTopicOwner finds the current holder of a topic_key, excluding a given sync_id', () => {
    store.save({ projectKey: 'proj-a', topicKey: 'architecture/x', type: 'architecture', title: 'X', content: 'Some content about X here.', source: 'mcp' })
    const owner = store.findActiveTopicOwner('proj-a', 'personal', 'architecture/x', 'not-the-owner')
    expect(owner).not.toBeNull()
  })
})

// Coverage for the connect-time project-registration fix (gap #1, CLAUDE.md task
// notes): electron/main.ts's memory:connect handler now calls ensureProject() for
// every known repo root plus '__global__' BEFORE running the importers, so
// memory-daemon.ts's doPull() (which bails out entirely when listProjects() is empty)
// has something to iterate even on a device that only ever imports and never captures
// live through memory-ipc-server.ts.
describe('MemoryStore — projects (ensureProject / listProjects)', () => {
  let dir: string
  let store: MemoryStore

  beforeEach(() => {
    dir = makeTmpDir('raven-memory-store-')
    store = new MemoryStore(join(dir, 'memory.db'))
  })

  afterEach(() => {
    store.close()
    cleanupTmp(dir)
  })

  it('registers a new project with enrolled=1 by default', () => {
    store.ensureProject({ projectKey: 'proj-a', displayName: 'raven-nest', rootPath: '/repos/raven-nest', remoteUrl: 'github.com/x/raven-nest' })
    const projects = store.listProjects()
    expect(projects).toEqual([{ projectKey: 'proj-a', displayName: 'raven-nest', enrolled: true }])
  })

  it('is idempotent — calling it again for the same project_key is a no-op (does not overwrite display_name)', () => {
    store.ensureProject({ projectKey: 'proj-a', displayName: 'raven-nest' })
    store.ensureProject({ projectKey: 'proj-a', displayName: 'renamed-locally-but-should-not-apply' })
    const projects = store.listProjects()
    expect(projects).toHaveLength(1)
    expect(projects[0].displayName).toBe('raven-nest')
  })

  it('registers the __global__ partition alongside repo-derived projects so doPull() has something to iterate', () => {
    store.ensureProject({ projectKey: 'proj-a', displayName: 'raven-nest' })
    store.ensureProject({ projectKey: '__global__', displayName: '__global__' })
    const keys = store.listProjects().map((p) => p.projectKey)
    expect(keys).toEqual(expect.arrayContaining(['proj-a', '__global__']))
  })

  it('listProjects returns [] when no project has ever been registered (the pre-fix broken state)', () => {
    expect(store.listProjects()).toEqual([])
  })
})

// Bug 1 & bug 2 fixes: importers need original timestamps preserved (not stamped to
// `now`) and a stable cross-device identity (not a fresh random sync_id per import run)
// so a local wipe + cloud reconnect doesn't re-insert duplicates. See
// electron/memory-importers/engram.ts for the importer-side half of this.
describe('MemoryStore — import identity & timestamps (bug 1 & bug 2 fixes)', () => {
  let dir: string
  let store: MemoryStore

  beforeEach(() => {
    dir = makeTmpDir('raven-memory-store-')
    store = new MemoryStore(join(dir, 'memory.db'))
  })

  afterEach(() => {
    store.close()
    cleanupTmp(dir)
  })

  it('uses caller-supplied createdAt/updatedAt/lastSeenAt on insert instead of stamping now', () => {
    const past = Date.now() - 1000 * 60 * 60 * 24 * 30 // 30 days ago
    const result = store.save({
      projectKey: 'proj-a',
      type: 'discovery',
      title: 'Imported row',
      content: 'Some imported content here.',
      source: 'import',
      createdAt: past,
      updatedAt: past + 1000,
      lastSeenAt: past + 2000,
    })
    const row = store.get(result.syncId)
    expect(row?.created_at).toBe(past)
    expect(row?.updated_at).toBe(past + 1000)
    expect(row?.last_seen_at).toBe(past + 2000)
  })

  it('stamps now for created_at/updated_at/last_seen_at when no timestamps are supplied (regression)', () => {
    const before = Date.now()
    const result = store.save({
      projectKey: 'proj-a',
      type: 'decision',
      title: 'Regular save',
      content: 'No timestamps supplied here.',
      source: 'mcp',
    })
    const row = store.get(result.syncId)
    expect(row!.created_at).toBeGreaterThanOrEqual(before)
    expect(row!.created_at).toBe(row!.updated_at)
    expect(row!.last_seen_at).toBe(row!.created_at)
  })

  it('uses a caller-supplied syncId on insert instead of generating a random one', () => {
    const result = store.save({
      projectKey: 'proj-a',
      type: 'discovery',
      title: 'Fixed id',
      content: 'Deterministic identity here.',
      source: 'import',
      syncId: 'obs-deterministic-test',
    })
    expect(result.syncId).toBe('obs-deterministic-test')
  })

  it('a caller-supplied syncId matching an existing ACTIVE row updates it in place instead of colliding on insert', () => {
    const first = store.save({
      projectKey: 'proj-a',
      type: 'discovery',
      title: 'v1',
      content: 'Version one content here.',
      source: 'import',
      syncId: 'obs-shared-id',
    })
    const second = store.save({
      projectKey: 'proj-a',
      type: 'discovery',
      title: 'v2',
      content: 'Version two content here.',
      source: 'import',
      syncId: 'obs-shared-id',
    })

    expect(second.syncId).toBe(first.syncId)
    expect(second.outcome).toBe('source_ref_updated')
    expect(store.count()).toBe(1) // not 2 — no PRIMARY KEY collision, no duplicate row
    const row = store.get('obs-shared-id')
    expect(row?.title).toBe('v2')
    expect(row?.revision_count).toBe(1)
  })

  it('a syncId matching a row pulled from the server (no source_ref) resolves via sync_id-match, not a fresh insert', () => {
    // Simulates the daemon's pull-apply path (§4.4) restoring a row after a local wipe —
    // applyIncomingObservation never sets source_ref (the server has no such column), so
    // Step 0's (source, source_ref) identity lookup in save() can never find this row
    // again on re-import; only the sync_id-match step can.
    store.applyIncomingObservation({
      syncId: 'obs-from-server',
      projectKey: 'proj-a',
      scope: 'personal',
      topicKey: null,
      type: 'discovery',
      title: 'Pulled from server',
      content: 'Synced from another device before this device was wiped.',
      updatedAt: Date.now() - 5000,
      lamport: 1,
      deleted: false,
    })
    expect(store.get('obs-from-server')?.source_ref).toBeNull()

    const result = store.save({
      projectKey: 'proj-a',
      type: 'discovery',
      title: 'Pulled from server',
      content: 'Synced from another device before this device was wiped.',
      source: 'import',
      sourceRef: 'engram:some-id', // no local row has this yet (wiped) — Step 0 can't find it
      syncId: 'obs-from-server', // but the sync_id survived the pull
    })

    expect(result.outcome).toBe('source_ref_updated')
    expect(result.syncId).toBe('obs-from-server')
    expect(store.count()).toBe(1) // NOT 2 — no duplicate inserted
  })

  it('a syncId matching a tombstoned row resolves to it as a duplicate without resurrecting it', () => {
    const first = store.save({
      projectKey: 'proj-a',
      type: 'discovery',
      title: 'Original',
      content: 'Original content here for testing.',
      source: 'import',
      syncId: 'obs-lineage',
    })
    store.deleteObservation(first.syncId)

    const result = store.save({
      projectKey: 'proj-a',
      type: 'discovery',
      title: 'Reimported after delete',
      content: 'Should not resurrect the tombstoned row.',
      source: 'import',
      syncId: 'obs-lineage',
    })

    expect(result.outcome).toBe('duplicate')
    expect(result.syncId).toBe('obs-lineage')
    const row = store.get('obs-lineage')
    expect(row?.deleted).toBe(1) // untouched
    expect(row?.content).toBeNull() // tombstone stays nulled, not overwritten
  })

  it('deriveImportSyncId is deterministic for the same inputs and differs when project/scope/type/hash differ', () => {
    const a1 = deriveImportSyncId('proj-a', 'personal', 'decision', 'hash-1')
    const a2 = deriveImportSyncId('proj-a', 'personal', 'decision', 'hash-1')
    const byHash = deriveImportSyncId('proj-a', 'personal', 'decision', 'hash-2')
    const byProject = deriveImportSyncId('proj-b', 'personal', 'decision', 'hash-1')
    const byScope = deriveImportSyncId('proj-a', 'project', 'decision', 'hash-1')
    const byType = deriveImportSyncId('proj-a', 'personal', 'bugfix', 'hash-1')
    expect(a1).toBe(a2)
    expect(a1).not.toBe(byHash)
    expect(a1).not.toBe(byProject)
    expect(a1).not.toBe(byScope)
    expect(a1).not.toBe(byType)
    expect(a1).toMatch(/^obs-[0-9a-f]{32}$/)
  })

  it('deriveImportSyncId is source-agnostic: does NOT take the import source as an input', () => {
    // Regression for the field failure this replaces: the OLD formula was
    // sha256(`${source}:${sourceRef}`), which meant two different importers (or two
    // engram installs with different internal sync_ids) for the SAME content diverged.
    // The new signature has no `source`/`sourceRef` parameter at all — this test just
    // documents that two calls with identical (projectKey, scope, type, contentHash)
    // always match, which is the whole point of excluding source from the seed.
    const fromEngramLikeContext = deriveImportSyncId('proj-a', 'personal', 'discovery', 'same-content-hash')
    const fromMarkdownLikeContext = deriveImportSyncId('proj-a', 'personal', 'discovery', 'same-content-hash')
    expect(fromEngramLikeContext).toBe(fromMarkdownLikeContext)
  })
})

// Content-derived import identity (cross-device dedupe fix): the field failure was 261
// duplicate content groups because deriveImportSyncId used to key off (source,
// sourceRef) instead of content. See deriveImportSyncId's doc comment in
// memory-store.ts for the full story.
describe('MemoryStore — content-derived import identity (cross-device dedupe fix)', () => {
  let dir: string
  let store: MemoryStore

  beforeEach(() => {
    dir = makeTmpDir('raven-memory-store-')
    store = new MemoryStore(join(dir, 'memory.db'))
  })

  afterEach(() => {
    store.close()
    cleanupTmp(dir)
  })

  it('two saves with identical content but DIFFERENT source_ref derive the same sync_id and converge on one row via Step 0.5, without violating idx_obs_source_ref', () => {
    const { hash } = computeContentIdentity('Shared title', 'Shared content body here.')
    const derivedSyncId = deriveImportSyncId('proj-a', 'personal', 'discovery', hash)

    // Simulates device A's engram sync_id.
    const first = store.save({
      projectKey: 'proj-a',
      type: 'discovery',
      title: 'Shared title',
      content: 'Shared content body here.',
      source: 'import',
      sourceRef: 'engram:device-a-id',
      syncId: derivedSyncId,
    })
    expect(first.outcome).toBe('inserted')
    expect(first.syncId).toBe(derivedSyncId)

    // Simulates device B's engram sync_id for the SAME underlying content, arriving in
    // the same import run (Step 0's source_ref lookup can't find it — this source_ref
    // has never been seen — so this must fall through to Step 0.5's sync_id match).
    let second: ReturnType<typeof store.save> | undefined
    expect(() => {
      second = store.save({
        projectKey: 'proj-a',
        type: 'discovery',
        title: 'Shared title',
        content: 'Shared content body here.',
        source: 'import',
        sourceRef: 'engram:device-b-id',
        syncId: derivedSyncId,
      })
    }).not.toThrow() // must NOT be a PRIMARY KEY or idx_obs_source_ref UNIQUE violation

    expect(second?.outcome).toBe('source_ref_updated')
    expect(second?.syncId).toBe(derivedSyncId)
    expect(store.count()).toBe(1) // one observation, not two

    const row = store.get(derivedSyncId)
    expect(row?.revision_count).toBe(1) // in-place update, not a fresh insert
    expect(row?.source_ref).toBe('engram:device-b-id') // last writer's source_ref wins, no leftover row holds the old one
  })
})

// Finding 1 fix: deriveImportSyncId used to ignore topic_key entirely, so two import rows
// sharing (projectKey, scope, type, content_hash) but carrying DIFFERENT topic_key values
// derived the SAME sync_id — save()'s Step 0.5 update path then silently dropped the
// second import's topic classification (it never writes topic_key on that path) while
// flipping source_ref to the second import's, and alternating re-imports ping-ponged
// source_ref on one row instead of ever producing two. See deriveImportSyncId's doc
// comment in memory-store.ts for the full story.
describe('MemoryStore — topic-aware import identity (Finding 1 fix)', () => {
  let dir: string
  let store: MemoryStore

  beforeEach(() => {
    dir = makeTmpDir('raven-memory-store-topic-')
    store = new MemoryStore(join(dir, 'memory.db'))
  })

  afterEach(() => {
    store.close()
    cleanupTmp(dir)
  })

  it('same content, DIFFERENT topicKey -> two distinct rows, both retrievable, distinct sync_ids', () => {
    const { hash } = computeContentIdentity('Shared title', 'Shared content body, byte-identical across both topics.')
    const syncIdTopicA = deriveImportSyncId('proj-a', 'personal', 'discovery', hash, 'topic/a')
    const syncIdTopicB = deriveImportSyncId('proj-a', 'personal', 'discovery', hash, 'topic/b')
    expect(syncIdTopicA).not.toBe(syncIdTopicB)

    const first = store.save({
      projectKey: 'proj-a',
      topicKey: 'topic/a',
      type: 'discovery',
      title: 'Shared title',
      content: 'Shared content body, byte-identical across both topics.',
      source: 'import',
      sourceRef: 'source:topic-a',
      syncId: syncIdTopicA,
    })
    const second = store.save({
      projectKey: 'proj-a',
      topicKey: 'topic/b',
      type: 'discovery',
      title: 'Shared title',
      content: 'Shared content body, byte-identical across both topics.',
      source: 'import',
      sourceRef: 'source:topic-b',
      syncId: syncIdTopicB,
    })

    expect(first.outcome).toBe('inserted')
    expect(second.outcome).toBe('inserted') // NOT folded into a Step 0.5 update or a Step 2 content dupe
    expect(first.syncId).not.toBe(second.syncId)
    expect(store.count()).toBe(2)

    const rowA = store.get(syncIdTopicA)
    const rowB = store.get(syncIdTopicB)
    expect(rowA?.topic_key).toBe('topic/a')
    expect(rowB?.topic_key).toBe('topic/b')
    expect(rowA?.source_ref).toBe('source:topic-a') // neither row's source_ref was clobbered by the other
    expect(rowB?.source_ref).toBe('source:topic-b')
  })

  it('same content, SAME topicKey, across two independent stores -> same sync_id (cross-device convergence preserved)', () => {
    const dir2 = makeTmpDir('raven-memory-store-topic-2-')
    const store2 = new MemoryStore(join(dir2, 'memory.db'))
    try {
      const { hash } = computeContentIdentity('Auth model', 'JWT-based auth with refresh tokens.')
      const syncId = deriveImportSyncId('proj-a', 'personal', 'architecture', hash, 'architecture/auth-model')

      const resultA = store.save({
        projectKey: 'proj-a',
        topicKey: 'architecture/auth-model',
        type: 'architecture',
        title: 'Auth model',
        content: 'JWT-based auth with refresh tokens.',
        source: 'import',
        sourceRef: 'device-a:some-id',
        syncId,
      })
      const resultB = store2.save({
        projectKey: 'proj-a',
        topicKey: 'architecture/auth-model',
        type: 'architecture',
        title: 'Auth model',
        content: 'JWT-based auth with refresh tokens.',
        source: 'import',
        sourceRef: 'device-b:some-other-id',
        syncId,
      })

      expect(resultA.syncId).toBe(resultB.syncId)
      expect(resultA.syncId).toBe(syncId)
    } finally {
      store2.close()
      cleanupTmp(dir2)
    }
  })
})

describe('MemoryStore — superseding the local row on a topic collision (C2)', () => {
  let dir: string
  let store: MemoryStore

  beforeEach(() => {
    dir = makeTmpDir('raven-memory-c2-')
    store = new MemoryStore(join(dir, 'memory.db'))
  })

  afterEach(() => {
    store.close()
    cleanupTmp(dir)
  })

  it('supersedes the local row and applies the incoming one without violating idx_obs_topic', () => {
    store.ensureProject({ projectKey: 'proj-a', displayName: 'proj-a' })
    store.save({
      projectKey: 'proj-a',
      scope: 'personal',
      type: 'decision',
      topicKey: 'deploy-target',
      title: 'local wins for now',
      content: 'written on this machine',
      source: 'mcp',
    })
    const local = store.context('proj-a', 10)[0]

    expect(() =>
      store.applyIncomingObservation({
        syncId: 'obs_remota',
        projectKey: 'proj-a',
        scope: 'personal',
        topicKey: 'deploy-target',
        type: 'decision',
        title: 'the remote one wins',
        content: 'written on the other machine',
        updatedAt: Date.now() + 60_000,
        lamport: 99,
        deleted: false,
        supersedeLocal: local.syncId,
      })
    ).not.toThrow()

    const active = store.context('proj-a', 10)
    expect(active).toHaveLength(1)
    expect(active[0].syncId).toBe('obs_remota')
    expect(store.get(local.syncId)?.superseded_by).toBe('obs_remota')
  })

  it('leaves the local row untouched when applying the incoming one throws', () => {
    store.ensureProject({ projectKey: 'proj-a', displayName: 'proj-a' })
    store.save({
      projectKey: 'proj-a',
      scope: 'personal',
      type: 'decision',
      topicKey: 'deploy-target',
      title: 'local',
      content: 'x',
      source: 'mcp',
    })
    const local = store.context('proj-a', 10)[0]

    expect(() =>
      store.applyIncomingObservation({
        syncId: 'obs_rota',
        projectKey: 'proj-a',
        scope: 'fails-the-CHECK',
        topicKey: 'deploy-target',
        type: 'decision',
        title: 'breaks the scope CHECK',
        content: 'x',
        updatedAt: Date.now(),
        lamport: 1,
        deleted: false,
        supersedeLocal: local.syncId,
      })
    ).toThrow()

    expect(store.get(local.syncId)?.superseded_by).toBeNull()
  })
})

describe('MemoryStore — schema versioning (C3)', () => {
  let dir: string

  beforeEach(() => { dir = makeTmpDir('raven-memory-c3-') })
  afterEach(() => { cleanupTmp(dir) })

  it('SCHEMA_VERSION is pinned to the published value', () => {
    expect(SCHEMA_VERSION).toBe(3)
  })

  // Task 8 (smoke/memory-bridge): the memory dir syncs across two machines, so a v1
  // database (blocked_reason column absent) opened by a build that already knows v2 is
  // the routine case, not an edge case — it's every existing user's database on upgrade.
  it('a v1 database gains blocked_reason via migration without losing data', () => {
    const dbPath = join(dir, 'memory.db')
    const v1 = new MemoryStore(dbPath)
    v1.ensureProject({ projectKey: 'proj-a', displayName: 'proj-a' })
    v1.save({ projectKey: 'proj-a', scope: 'personal', type: 'decision', title: 'pre-migration', content: 'x', source: 'mcp' })
    ;(v1 as unknown as { db: { pragma(s: string): unknown } }).db.pragma('user_version = 1')
    v1.close()

    const v2 = new MemoryStore(dbPath)
    expect(v2.schemaVersion).toBe(SCHEMA_VERSION)
    expect(v2.count()).toBe(1)
    // The real point of the test: the new column exists and is usable, not just that the
    // migration ran without throwing.
    const [row] = v2.pendingMutations()
    v2.blockMutations([{ seq: row.seq, reason: 'quota_exceeded' }])
    expect(v2.blockedMutations()).toHaveLength(1)
    v2.close()
  })

  it('a fresh database lands on the current version', () => {
    const store = new MemoryStore(join(dir, 'memory.db'))
    expect(store.schemaVersion).toBe(SCHEMA_VERSION)
    const userVersion = (store as unknown as { db: { pragma(s: string, o?: { simple?: boolean }): unknown } })
      .db.pragma('user_version', { simple: true })
    expect(userVersion).toBe(SCHEMA_VERSION)
    store.close()
  })

  it('reopening an existing database loses no data', () => {
    const first = new MemoryStore(join(dir, 'memory.db'))
    first.ensureProject({ projectKey: 'proj-a', displayName: 'proj-a' })
    first.save({
      projectKey: 'proj-a',
      scope: 'personal',
      type: 'decision',
      title: 'survives the reopen',
      content: 'x',
      source: 'mcp',
    })
    first.close()

    const second = new MemoryStore(join(dir, 'memory.db'))
    expect(second.schemaVersion).toBe(SCHEMA_VERSION)
    expect(second.count()).toBe(1)
    const userVersion = (second as unknown as { db: { pragma(s: string, o?: { simple?: boolean }): unknown } })
      .db.pragma('user_version', { simple: true })
    expect(userVersion).toBe(SCHEMA_VERSION)
    second.close()
  })

  // Two machines share one synced memory dir, so the day SCHEMA_VERSION becomes 2 the
  // machine still on 1 WILL open a v2 database. The loop simply doesn't run in that
  // direction, so the old code no-op'd, adopted the higher number and then wrote against
  // a schema it has never seen. main.ts's try/catch turns this throw into "memory
  // disabled for this session".
  it('refuses to open a database whose schema is newer than this build', () => {
    const dbPath = join(dir, 'memory.db')
    const store = new MemoryStore(dbPath)
    ;(store as unknown as { db: { pragma(s: string): unknown } }).db.pragma(`user_version = ${SCHEMA_VERSION + 1}`)
    store.close()

    expect(() => new MemoryStore(dbPath)).toThrow(/newer than this build/)
  })

  it('an old database with no user_version is adopted without deleting anything', () => {
    const legacy = new MemoryStore(join(dir, 'memory.db'))
    legacy.ensureProject({ projectKey: 'proj-a', displayName: 'proj-a' })
    legacy.save({
      projectKey: 'proj-a',
      scope: 'personal',
      type: 'decision',
      title: 'written before schema versioning existed',
      content: 'x',
      source: 'mcp',
    })
    // simulates the field state: tables created, user_version never set
    ;(legacy as unknown as { db: { pragma(s: string): unknown } }).db.pragma('user_version = 0')
    legacy.close()

    const migrated = new MemoryStore(join(dir, 'memory.db'))
    expect(migrated.schemaVersion).toBe(SCHEMA_VERSION)
    expect(migrated.count()).toBe(1)
    const userVersion = (migrated as unknown as { db: { pragma(s: string, o?: { simple?: boolean }): unknown } })
      .db.pragma('user_version', { simple: true })
    expect(userVersion).toBe(SCHEMA_VERSION)
    migrated.close()
  })
})

// La memoria es de la CUENTA DE NEST, no de la máquina ni de la IA. El store, en cambio,
// vive en `{home}/.raven-nest/memory/memory.db` — uno por máquina — y `pendingMutations()`
// no filtraba por nadie. Con un sign out / sign in (un botón de Settings), el daemon de la
// segunda cuenta empujaba a SU nube las memorias de la primera.
//
// Esto sella el autor en cada escritura y filtra el push. La partición de la base por
// cuenta es el paso siguiente; esto cierra la fuga a la nube ajena, que es la parte grave.
describe('MemoryStore — la memoria es de una cuenta de Nest', () => {
  let dir: string
  let store: MemoryStore

  const USER_A = 'user-aaaa'
  const USER_B = 'user-bbbb'

  function guardar(store: MemoryStore, title: string) {
    return store.save({
      projectKey: 'proj-a',
      type: 'decision',
      title,
      content: `Contenido de ${title}, con largo suficiente para no ser descartado.`,
      source: 'pty',
    })
  }

  beforeEach(() => {
    dir = makeTmpDir('raven-memory-owner-')
    store = new MemoryStore(join(dir, 'memory.db'))
  })

  afterEach(() => {
    store.close()
    cleanupTmp(dir)
  })

  it('sin cuenta activa no hay dueño', () => {
    expect(store.getOwnerUserId()).toBeNull()
  })

  it('la primera cuenta que entra reclama el store y adopta lo que ya habia', () => {
    guardar(store, 'Escrito antes de loguearse')

    const r = store.setCurrentUser(USER_A)

    expect(r.claimed).toBe(true)
    expect(r.adopted).toBeGreaterThan(0)
    expect(store.getOwnerUserId()).toBe(USER_A)
  })

  it('una segunda cuenta NO adopta lo de la primera', () => {
    guardar(store, 'De la primera cuenta')
    store.setCurrentUser(USER_A)

    const r = store.setCurrentUser(USER_B)

    expect(r.claimed).toBe(false)
    expect(r.adopted).toBe(0)
    expect(store.getOwnerUserId()).toBe(USER_A)
  })

  it('el push de una cuenta no arrastra las memorias de la otra', () => {
    guardar(store, 'De la primera cuenta')
    store.setCurrentUser(USER_A)
    expect(store.pendingMutations().length).toBe(1)

    store.setCurrentUser(USER_B)

    // Lo de A no aparece para B, que es la fuga que esto cierra.
    expect(store.pendingMutations()).toEqual([])
    expect(store.pendingMutationCount()).toBe(0)

    guardar(store, 'De la segunda cuenta')
    const deB = store.pendingMutations()
    expect(deB.length).toBe(1)
    expect(JSON.parse(deB[0].payload).title).toBe('De la segunda cuenta')
  })

  it('lo de la primera cuenta sigue ahi cuando vuelve, no se perdio', () => {
    guardar(store, 'De la primera cuenta')
    store.setCurrentUser(USER_A)
    store.setCurrentUser(USER_B)

    store.setCurrentUser(USER_A)

    expect(store.pendingMutations().length).toBe(1)
  })

  it('sella el autor en cada escritura nueva', () => {
    store.setCurrentUser(USER_A)
    guardar(store, 'Con dueño')

    const [m] = store.pendingMutations()
    expect(m.author_user_id).toBe(USER_A)
  })
})

// Task 1 del plan de memoria por cuenta multi-dispositivo (Step 1): originalmente este test
// llamaba setCurrentUser() dos veces sobre UNA sola instancia de MemoryStore compartida —
// eso prueba si search() filtra por autor DENTRO de un mismo archivo, que nunca fue el
// diseño elegido (setCurrentUser sella el autor de cada fila, pero no fue pensado para
// filtrar cada búsqueda) y por eso quedaba rojo para siempre incluso después de implementar
// el resto de la Task 1: physical separation vive en swapMemoryStore()/resolveStorePath(),
// no en MemoryStore.search(). Reescrito para ejercitar el camino real — el mismo que usa
// electron/main.ts en cada 'memory:setUser' — probando lo que la Task 1 realmente prometía:
// dos cuentas en la misma máquina terminan en archivos .db físicamente distintos.
describe('MemoryStore — la memoria de una cuenta no aparece en la busqueda de otra (Task 1)', () => {
  let home: string

  const USER_A = 'user-aaaa'
  const USER_B = 'user-bbbb'

  function fakeDaemon() {
    return { pause: vi.fn(async () => {}), resume: vi.fn(() => {}), setStore: vi.fn((_s: MemoryStore) => {}) }
  }
  function fakeIpcServer() {
    return { suspend: vi.fn(async () => {}), resume: vi.fn(() => {}), setStore: vi.fn((_s: MemoryStore) => {}) }
  }

  beforeEach(() => {
    home = makeTmpDir('raven-memory-isolation-')
  })

  afterEach(() => {
    cleanupTmp(home)
  })

  it('B no encuentra en la busqueda lo que A guardo antes de que B entrara', async () => {
    const localPath = resolveStorePath(home, null)
    const localStore = new MemoryStore(localPath)
    let ctx: SwapContext = { store: localStore, daemon: fakeDaemon(), ipcServer: fakeIpcServer(), currentStorePath: localPath }

    // A entra primero: adopta el _local (mismo flujo que 'memory:setUser' en main.ts).
    const afterA = await swapMemoryStore(ctx, home, USER_A)
    afterA.store.save({
      projectKey: 'proj-a',
      type: 'decision',
      title: 'Secreto de A',
      content: 'ContenidoUnicoDeLaCuentaA con largo suficiente para no ser descartado.',
      source: 'pty',
    })

    // B entra despues, en la misma maquina: es una cuenta real nueva, no hereda _local.
    ctx = { store: afterA.store, daemon: fakeDaemon(), ipcServer: fakeIpcServer(), currentStorePath: afterA.currentStorePath }
    const afterB = await swapMemoryStore(ctx, home, USER_B)

    const results = afterB.store.search('proj-a', 'ContenidoUnicoDeLaCuentaA')

    // Cada cuenta tiene su propia base fisica: B no ve nada de A.
    expect(results.length).toBe(0)
    expect(afterB.currentStorePath).not.toBe(afterA.currentStorePath)

    afterB.store.close()
  })
})

// Task 1 del plan de memoria por cuenta multi-dispositivo (Step 2): resolveStorePath es
// pura (cero fs) — sólo calcula el path, no decide si hay que migrar un store `_local`
// preexistente. Esa decisión la toma quien orquesta el swap (memory-account-switch.ts).
describe('resolveStorePath (Task 1, Step 2)', () => {
  const home = join('C:', 'Users', 'gero')

  it('userId null cae en la particion _local', () => {
    expect(resolveStorePath(home, null)).toBe(join(home, '.raven-nest', 'memory', '_local', 'memory.db'))
  })

  it('userId string vacia tambien cae en _local', () => {
    expect(resolveStorePath(home, '')).toBe(join(home, '.raven-nest', 'memory', '_local', 'memory.db'))
  })

  it('un userId concreto usa su propia subcarpeta', () => {
    expect(resolveStorePath(home, 'user-aaaa')).toBe(join(home, '.raven-nest', 'memory', 'user-aaaa', 'memory.db'))
  })

  it('dos userIds distintos no colisionan entre si ni con _local', () => {
    const a = resolveStorePath(home, 'user-aaaa')
    const b = resolveStorePath(home, 'user-bbbb')
    const local = resolveStorePath(home, null)
    expect(a).not.toBe(b)
    expect(a).not.toBe(local)
    expect(b).not.toBe(local)
  })
})
