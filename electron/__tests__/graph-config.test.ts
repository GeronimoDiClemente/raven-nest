import { describe, it, expect } from 'vitest'
import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { GraphConfigStore } from '../integrations/graph-config'

describe('GraphConfigStore', () => {
  it('returns defaults for an unknown repo', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'gc-')), 'graph-config.json')
    const s = new GraphConfigStore(file)
    expect(s.get('/repo/a')).toEqual({ defaultMode: 'auto', maxReviewRounds: 2 })
  })
  it('persists and reloads a per-repo config', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'gc-')), 'graph-config.json')
    new GraphConfigStore(file).set('/repo/a', { defaultMode: 'gate', maxReviewRounds: 3 })
    expect(new GraphConfigStore(file).get('/repo/a')).toEqual({ defaultMode: 'gate', maxReviewRounds: 3 })
  })
})
