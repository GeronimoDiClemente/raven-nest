// src/__tests__/tutorial/worktrees-tour.test.ts
import { describe, it, expect } from 'vitest'
import { worktreesTour } from '../../tutorial/tours/worktrees'

describe('worktrees tour copy', () => {
  it('has 13 steps in the guided order', () => {
    expect(worktreesTour.steps.map((s) => s.id)).toEqual([
      'header', 'add', 'branch', 'presets', 'env', 'create', 'list',
      'diff', 'diff-panel', 'drag-terminal', 'sync-cwd', 'pr', 'menu',
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

  it('wires action-driven advance on the two interactive-mock steps', () => {
    const byId = Object.fromEntries(worktreesTour.steps.map((s) => [s.id, s]))
    expect(byId['drag-terminal'].advanceOnAction).toBe('drop')
    expect(byId['drag-terminal'].anchor).toBe('[data-tour-id="wt-list"]')
    expect(byId['sync-cwd'].advanceOnAction).toBe('sync')
    expect(byId['sync-cwd'].anchor).toBe('[data-tour-id="pane-sync-cwd-btn"]')
  })
})
