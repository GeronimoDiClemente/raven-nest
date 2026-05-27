// src/__tests__/tutorial/harness-opts.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../lib/supabase', () => ({
  __setSupabaseClient: vi.fn(),
  __resetSupabaseClient: vi.fn(),
}))

import { __setSupabaseClient } from '../../lib/supabase'
import { createDemoHarness } from '../../tutorial/demo/harness'
import { createDemoState } from '../../tutorial/demo/fixtures'

describe('selective harness', () => {
  beforeEach(() => vi.clearAllMocks())

  it('does NOT swap supabase by default', () => {
    const h = createDemoHarness(createDemoState())
    h.activate()
    expect(__setSupabaseClient).not.toHaveBeenCalled()
    h.deactivate()
  })

  it('swaps supabase only when opts.supabase is true', () => {
    const h = createDemoHarness(createDemoState(), { supabase: true })
    h.activate()
    expect(__setSupabaseClient).toHaveBeenCalledTimes(1)
    h.deactivate()
  })

  it('does NOT patch window.fetch by default', () => {
    const realFetch = window.fetch
    const h = createDemoHarness(createDemoState())
    h.activate()
    expect(window.fetch).toBe(realFetch)
    h.deactivate()
  })
})
