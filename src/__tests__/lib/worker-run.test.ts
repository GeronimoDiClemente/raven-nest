import { describe, it, expect } from 'vitest'
import { composeStepInput, nextStep, upsertWorkerSpec } from '../../lib/worker-run'
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

describe('upsertWorkerSpec', () => {
  it('appends a spec whose id is not in the list (e.g. created after mount → resolvable for hasNextStep)', () => {
    const out = upsertWorkerSpec([], spec)
    expect(out).toEqual([spec])
    // The run resolves against the merged list: nextStep now sees a real spec.
    expect(nextStep(out.find((s) => s.id === 'w')!, { workerId: 'w', stepIndex: 0 })).not.toBeNull()
  })

  it('replaces (not duplicates) an existing spec so an edited worker\'s fresh steps win', () => {
    const stale: WorkerSpec = { ...spec, name: 'old-name', steps: [spec.steps[0]!] }
    const edited: WorkerSpec = { ...spec, name: 'new-name' } // same id, 2 steps
    const out = upsertWorkerSpec([stale], edited)
    expect(out).toHaveLength(1)
    expect(out[0]).toBe(edited)
    expect(out[0]!.steps).toHaveLength(2)
  })

  it('preserves other specs and appends the edited one at the end', () => {
    const other: WorkerSpec = { ...spec, id: 'other', name: 'other' }
    const out = upsertWorkerSpec([other, spec], { ...spec, name: 'v2' })
    expect(out.map((s) => s.id)).toEqual(['other', 'w'])
    expect(out.find((s) => s.id === 'w')!.name).toBe('v2')
  })
})
