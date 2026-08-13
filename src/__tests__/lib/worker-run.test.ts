import { describe, it, expect } from 'vitest'
import { composeStepInput, nextStep } from '../../lib/worker-run'
import type { WorkerSpec } from '../../types'

const spec: WorkerSpec = {
  id: 'w', name: 'explore-then-implement', createdAt: 0, updatedAt: 0,
  steps: [
    { agent: 'opencode', model: 'cheap', instructions: 'Explore and find the bug.', role: 'explore' },
    { agent: 'claude', model: 'opus', instructions: 'Fix the bug.', role: 'implement' },
  ],
}

describe('composeStepInput', () => {
  it('non-final step appends the handoff-write instruction', () => {
    const out = composeStepInput('Explore and find the bug.', null, false)
    expect(out).toContain('Explore and find the bug.')
    expect(out).toContain('.nest/handoff.md')
  })
  it('final step prepends the handoff and omits the write instruction', () => {
    const out = composeStepInput('Fix the bug.', 'The bug is a missing await on line 42.', true)
    expect(out).toContain('missing await on line 42')
    expect(out).toContain('Fix the bug.')
    expect(out).not.toContain('.nest/handoff.md')
  })
})

describe('nextStep', () => {
  it('returns the next step when one exists', () => {
    expect(nextStep(spec, { workerId: 'w', stepIndex: 0 })).toEqual({ step: spec.steps[1], index: 1 })
  })
  it('returns null past the last step', () => {
    expect(nextStep(spec, { workerId: 'w', stepIndex: 1 })).toBeNull()
  })
})
