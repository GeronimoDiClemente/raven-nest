// src/__tests__/tutorial/worktrees-tour.test.ts
import { describe, it, expect } from 'vitest'
import { worktreesTour } from '../../tutorial/tours/worktrees'

describe('worktrees tour copy', () => {
  it('covers only the worktrees list-view anchors, in order', () => {
    expect(worktreesTour.steps.map((s) => s.id)).toEqual([
      'header', 'add', 'list', 'diff', 'pr', 'menu',
    ])
  })

  it('every step provides both English and Spanish copy', () => {
    for (const step of worktreesTour.steps) {
      expect(step.title.en.length).toBeGreaterThan(0)
      expect(step.title.es.length).toBeGreaterThan(0)
      expect(step.body.en.length).toBeGreaterThan(0)
      expect(step.body.es.length).toBeGreaterThan(0)
    }
  })

  it('is non-interactive: no step advances on click or action (Next-only)', () => {
    for (const step of worktreesTour.steps) {
      expect(step.advanceOnClick).toBeUndefined()
      expect(step.advanceOnAction).toBeUndefined()
    }
  })
})
