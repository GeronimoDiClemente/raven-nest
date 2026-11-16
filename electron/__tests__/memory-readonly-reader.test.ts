import { describe, it, expect, afterEach } from 'vitest'
import { MemoryStore, resolveStorePath } from '../memory-store'
import { openReadonlyReader } from '../integrations/memory-readonly-reader'
import { makeTmpDir, cleanupTmp } from './setup'

let dirs: string[] = []
function tmp(): string {
  const d = makeTmpDir('vault-reader-')
  dirs.push(d)
  return d
}
afterEach(() => { dirs.forEach(cleanupTmp); dirs = [] })

describe('openReadonlyReader', () => {
  it('reads projects and records from the SAME per-account store MemoryStore writes to', () => {
    const home = tmp()
    const userId = 'user-123'
    const store = new MemoryStore(resolveStorePath(home, userId))
    store.ensureProject({ projectKey: 'proj1111aaaaaaaa', displayName: 'raven-nest', remoteUrl: 'https://github.com/org/raven-nest' })
    store.save({
      projectKey: 'proj1111aaaaaaaa',
      type: 'bugfix',
      title: 'Some fact',
      content: 'Some body',
      source: 'pty',
    })
    store.close()

    const { reader, close } = openReadonlyReader(home, userId)
    try {
      const projects = reader.listProjects()
      expect(projects).toHaveLength(1)
      expect(projects[0].displayName).toBe('raven-nest')
      expect(projects[0].remoteSlug).toBe('github.com/org/raven-nest')

      const records = reader.listRecords('proj1111aaaaaaaa')
      expect(records).toHaveLength(1)
      expect(records[0].title).toBe('Some fact')
      expect(records[0].deleted).toBe(false)

      const wm = reader.watermark('proj1111aaaaaaaa')
      expect(wm.count).toBe(1)
      expect(wm.maxUpdatedAt).toBeGreaterThan(0)
    } finally {
      close()
    }
  })

  it('includes tombstones and superseded rows in listRecords, unlike search()/context()', () => {
    const home = tmp()
    const userId = 'user-456'
    const store = new MemoryStore(resolveStorePath(home, userId))
    store.ensureProject({ projectKey: 'proj2222bbbbbbbb', displayName: 'other' })
    const { syncId } = store.save({ projectKey: 'proj2222bbbbbbbb', type: 'bugfix', title: 'Deletable', content: 'x', source: 'pty' })
    store.deleteObservation(syncId)
    store.close()

    const { reader, close } = openReadonlyReader(home, userId)
    try {
      const records = reader.listRecords('proj2222bbbbbbbb')
      expect(records).toHaveLength(1)
      expect(records[0].deleted).toBe(true)
      expect(records[0].content).toBeNull()
    } finally {
      close()
    }
  })

  it('degrades to a working empty reader (never throws) when the db does not exist', () => {
    const home = tmp()
    const { reader, close } = openReadonlyReader(home, 'nobody-ever-logged-in')
    expect(reader.listProjects()).toEqual([])
    expect(reader.listRecords('anything')).toEqual([])
    expect(reader.watermark('anything')).toEqual({ maxUpdatedAt: 0, count: 0 })
    expect(() => close()).not.toThrow()
  })
})
