// src/__tests__/tutorial/section-tours.test.ts
import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { getTour, listTourIds } from '../../tutorial/registry'
import { WORKSPACE_SECTIONS } from '../../components/teamSections'
import type { TourId } from '../../tutorial/types'

const SECTION_TOURS: Record<string, string[]> = {
  'my-repos': ['header', 'add', 'nav', 'list', 'actions'],
  teams: ['header', 'switcher', 'members', 'chat', 'snippets'],
}

/**
 * Every `data-tour-id` the app can actually render.
 *
 * Literal ones are scraped from the source; the one dynamic anchor
 * (`teams-nav-${section}`) is expanded from the section list it maps over, so
 * deleting a section really does remove its anchor from this set. Without that
 * expansion the check would happily accept `teams-nav-anything`.
 */
function renderableTourIds(): Set<string> {
  const ids = new Set<string>()
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === '__tests__' || entry.name === 'node_modules') continue
      const full = join(dir, entry.name)
      if (entry.isDirectory()) { walk(full); continue }
      if (!entry.name.endsWith('.tsx')) continue
      for (const m of readFileSync(full, 'utf8').matchAll(/data-tour-id=["']([^"'$]+)["']/g)) {
        ids.add(m[1])
      }
    }
  }
  walk(resolve(process.cwd(), 'src'))
  for (const section of WORKSPACE_SECTIONS) ids.add(`teams-nav-${section}`)
  return ids
}

describe('section tours (my-repos, teams)', () => {
  it('registers both tours alongside worktrees', () => {
    expect([...listTourIds()].sort()).toEqual(['my-repos', 'teams', 'worktrees'])
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

      // Shape alone is not enough: a step whose anchor no longer exists in the
      // markup doesn't crash, it just floats an unanchored tooltip describing a
      // section that was deleted. That is how the teams tour kept pointing at
      // `teams-nav-repos` after Repos moved to Personal.
      it('anchors every step to a tour id the app still renders', () => {
        const renderable = renderableTourIds()
        for (const s of tour!.steps) {
          const anchorId = /^\[data-tour-id="(.+)"\]$/.exec(s.anchor)?.[1]
          expect(anchorId, `unparseable anchor ${s.anchor}`).toBeDefined()
          expect(renderable, `step "${s.id}" targets ${s.anchor}`).toContain(anchorId!)
        }
      })
    })
  }
})
