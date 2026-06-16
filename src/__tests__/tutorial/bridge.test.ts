// src/__tests__/tutorial/bridge.test.ts
import { describe, it, expect } from 'vitest'
import { bridge } from '../../lib/bridge'

// `bridge` always delegates to window. Per-subtree demo overrides go through
// the React context (useBridge/BridgeProvider) — covered in
// src/__tests__/components/bridge-context.test.tsx.
describe('bridge (window delegation)', () => {
  it('delegates to window.* live', () => {
    const real = { list: async () => ['real'] }
    ;(window as unknown as { accounts: unknown }).accounts = real
    expect((bridge as unknown as { accounts: unknown }).accounts).toBe(real)
  })

  it('reflects later window changes (live proxy, not a snapshot)', () => {
    const g1 = { v: 1 }
    ;(window as unknown as { git: unknown }).git = g1
    expect((bridge as unknown as { git: { v: number } }).git).toBe(g1)
    const g2 = { v: 2 }
    ;(window as unknown as { git: unknown }).git = g2
    expect((bridge as unknown as { git: { v: number } }).git).toBe(g2)
  })
})
