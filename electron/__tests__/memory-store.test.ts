// NOTE ON EXECUTION: these tests require the better-sqlite3 native binding, which could
// not be built or fetched as a prebuilt binary in the sandbox this branch was developed
// in (no Visual Studio Build Tools, and no published better-sqlite3 prebuild for the
// sandbox's Node version — see the implementation report for details; this is exactly
// risk R-5 in docs/nest-memory-architecture.md §10). They are believed correct against
// the store's implementation and are written to run unmodified on any machine with a
// working `npm run postinstall` (electron-rebuild) or a compatible better-sqlite3
// prebuild. Run `npx vitest run electron/__tests__/memory-store.test.ts` to verify.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { join } from 'path'
import { makeTmpDir, cleanupTmp } from './setup'
import { MemoryStore } from '../memory-store'

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
