// src/__tests__/supabase-swap.test.ts
import { describe, it, expect, vi, afterEach } from 'vitest'

// Stub the SDK so importing the module never builds a real network client.
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    __real: true,
    from: () => 'REAL_FROM',
    auth: { getUser: async () => ({ data: { user: null } }) },
  }),
}))

import { supabase, __setSupabaseClient, __resetSupabaseClient } from '../lib/supabase'

afterEach(() => __resetSupabaseClient())

describe('swappable supabase', () => {
  it('forwards to the real client by default', () => {
    expect(supabase.from('x' as never)).toBe('REAL_FROM')
  })

  it('routes calls to a swapped-in mock client', () => {
    const mock = { from: () => 'MOCK_FROM', auth: { getUser: async () => ({ data: { user: { id: 'demo' } } }) } }
    __setSupabaseClient(mock as never)
    expect(supabase.from('x' as never)).toBe('MOCK_FROM')
  })

  it('restores the real client on reset', () => {
    __setSupabaseClient({ from: () => 'MOCK_FROM' } as never)
    __resetSupabaseClient()
    expect(supabase.from('x' as never)).toBe('REAL_FROM')
  })
})
