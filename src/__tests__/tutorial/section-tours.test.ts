// src/__tests__/tutorial/section-tours.test.ts
import { describe, it, expect } from 'vitest'
import { getTour, listTourIds } from '../../tutorial/registry'
import type { TourId } from '../../tutorial/types'

const SECTION_TOURS: Record<string, string[]> = {
  activation: ['welcome', 'new-terminal', 'my-repos', 'team', 'outro'],
  'my-repos': ['header', 'add', 'nav', 'list', 'actions'],
  teams: ['header', 'switcher', 'repos', 'members', 'chat'],
}

describe('tours registry', () => {
  it('registers all four tours', () => {
    expect([...listTourIds()].sort()).toEqual(['activation', 'my-repos', 'teams', 'worktrees'])
  })

  for (const [id, ids] of Object.entries(SECTION_TOURS)) {
    describe(id, () => {
      const tour = getTour(id as TourId)

      it('is registered with the expected steps', () => {
        expect(tour).toBeDefined()
        expect(tour!.steps.map((s) => s.id)).toEqual(ids)
      })

      it('is bilingual, Next-only, and anchored to a data-tour-id', () => {
        for (const s of tour!.steps) {
          expect(s.title.en.length).toBeGreaterThan(0)
          expect(s.title.es.length).toBeGreaterThan(0)
          expect(s.body.en.length).toBeGreaterThan(0)
          expect(s.body.es.length).toBeGreaterThan(0)
          expect(s.advanceOnClick).toBeUndefined()
          expect(s.advanceOnAction).toBeUndefined()
          expect(s.anchor).toMatch(/^\[data-tour-id="/)
        }
      })
    })
  }
})
