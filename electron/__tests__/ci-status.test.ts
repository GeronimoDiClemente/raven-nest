import { describe, it, expect } from 'vitest'
import { runsToStatus, type WorkflowRun } from '../integrations/ci-status'

const run = (over: Partial<WorkflowRun>): WorkflowRun => ({
  id: 1, name: 'CI', status: 'completed', conclusion: 'success',
  html_url: 'u', head_branch: 'feat/x', ...over,
})

describe('runsToStatus', () => {
  it('sin runs → unknown', () => expect(runsToStatus([])).toBe('unknown'))
  it('último completado success → success', () =>
    expect(runsToStatus([run({ conclusion: 'success' })])).toBe('success'))
  it('último completado failure → failure', () =>
    expect(runsToStatus([run({ conclusion: 'failure' })])).toBe('failure'))
  it('in_progress → running', () =>
    expect(runsToStatus([run({ status: 'in_progress', conclusion: null })])).toBe('running'))
  it('queued → running', () =>
    expect(runsToStatus([run({ status: 'queued', conclusion: null })])).toBe('running'))
  it('cancelled/skipped → unknown', () =>
    expect(runsToStatus([run({ conclusion: 'cancelled' })])).toBe('unknown'))
  it('mira SOLO el primero (más reciente)', () =>
    expect(runsToStatus([run({ conclusion: 'failure' }), run({ conclusion: 'success' })])).toBe('failure'))
})
