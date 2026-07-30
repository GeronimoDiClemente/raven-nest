import { describe, it, expect } from 'vitest'
import { trendVsPrev, topAreasFromFiles } from '../../lib/employee-analytics'

describe('trendVsPrev', () => {
  it('returns a signed percentage delta vs the previous period', () => {
    expect(trendVsPrev(120, 100)).toBe(20)
    expect(trendVsPrev(80, 100)).toBe(-20)
  })
  it('is 0 when unchanged, and null when there is no previous baseline', () => {
    expect(trendVsPrev(50, 50)).toBe(0)
    expect(trendVsPrev(5, 0)).toBeNull() // no baseline → "new", caller renders specially
  })
})

describe('topAreasFromFiles', () => {
  it('sums additions+deletions per top-2 path segments, sorted desc', () => {
    const prs = [
      { files: [{ path: 'src/components/A.tsx', additions: 10, deletions: 5 }, { path: 'src/components/B.tsx', additions: 3, deletions: 2 }] },
      { files: [{ path: 'src/hooks/x.ts', additions: 40, deletions: 0 }] },
      { files: [{ path: 'README.md', additions: 1, deletions: 1 }] },
    ]
    expect(topAreasFromFiles(prs, 2)).toEqual([
      { dir: 'src/hooks', lines: 40 },
      { dir: 'src/components', lines: 20 },
    ])
  })
  it('is empty when no PR carries files', () => {
    expect(topAreasFromFiles([{ files: [] }], 5)).toEqual([])
  })
})
