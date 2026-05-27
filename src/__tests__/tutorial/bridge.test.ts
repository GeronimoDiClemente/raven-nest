// src/__tests__/tutorial/bridge.test.ts
import { describe, it, expect, afterEach } from 'vitest'
import { bridge, __setBridgeOverrides, __clearBridgeOverrides } from '../../lib/bridge'

describe('bridge accessor', () => {
  afterEach(() => __clearBridgeOverrides())

  it('delegates to window.* by default', () => {
    const real = { list: async () => ['real'] }
    ;(window as unknown as { accounts: unknown }).accounts = real
    expect((bridge as unknown as { accounts: unknown }).accounts).toBe(real)
  })

  it('returns the override when set', async () => {
    __setBridgeOverrides({ accounts: { list: async () => ['mock'] } })
    const r = await (bridge as unknown as { accounts: { list: () => Promise<string[]> } }).accounts.list()
    expect(r[0]).toBe('mock')
  })

  it('falls back to window for keys not overridden', () => {
    const realGit = { ok: true }
    ;(window as unknown as { git: unknown }).git = realGit
    __setBridgeOverrides({ accounts: {} })
    expect((bridge as unknown as { git: unknown }).git).toBe(realGit)
  })

  it('clear restores full delegation', () => {
    const realGit = { v: 1 }
    ;(window as unknown as { git: unknown }).git = realGit
    __setBridgeOverrides({ git: { v: 2 } })
    __clearBridgeOverrides()
    expect((bridge as unknown as { git: { v: number } }).git).toBe(realGit)
  })
})
