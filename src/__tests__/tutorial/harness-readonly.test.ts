// src/__tests__/tutorial/harness-readonly.test.ts
import { describe, it, expect, afterEach } from 'vitest'
import { createDemoHarness } from '../../tutorial/demo/harness'
import { createDemoState } from '../../tutorial/demo/fixtures'

// Reproduces Electron contextBridge: window.git is a read-only (getter-only),
// configurable property. Direct assignment (win.git = x) throws — the harness
// must use Object.defineProperty to swap it.
describe('demo harness with read-only (contextBridge-style) window props', () => {
  afterEach(() => {
    // Reset to a plain writable prop so other test files are unaffected.
    Object.defineProperty(window, 'git', { value: undefined, writable: true, configurable: true })
    Object.defineProperty(window, 'fetch', { value: globalThis.fetch, writable: true, configurable: true })
  })

  it('activates without throwing and swaps a read-only window.git', () => {
    const realGit = { listBranches: () => { throw new Error('real git called') } }
    Object.defineProperty(window, 'git', { get: () => realGit, configurable: true })

    const harness = createDemoHarness(createDemoState())
    expect(() => harness.activate()).not.toThrow()

    // Now resolves to the mock, not the real getter.
    expect((window as unknown as { git: { __real?: boolean; listBranches: unknown } }).git).not.toBe(realGit)

    harness.deactivate()
    // Original read-only getter is restored.
    expect((window as unknown as { git: unknown }).git).toBe(realGit)
  })

  it('activates without throwing when window.fetch is read-only', () => {
    const realFetch = (() => { throw new Error('real fetch called') }) as unknown as typeof fetch
    Object.defineProperty(window, 'fetch', { get: () => realFetch, configurable: true })

    const harness = createDemoHarness(createDemoState())
    expect(() => harness.activate()).not.toThrow()
    expect(window.fetch).not.toBe(realFetch)

    harness.deactivate()
    expect(window.fetch).toBe(realFetch)
  })
})
