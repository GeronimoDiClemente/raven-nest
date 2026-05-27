// src/__tests__/tutorial/harness-pty.test.ts
import { describe, it, expect, vi } from 'vitest'
import { createDemoHarness } from '../../tutorial/demo/harness'
import { createDemoState } from '../../tutorial/demo/fixtures'

describe('demo harness pty replay', () => {
  it('emits the pty script through onData after create', async () => {
    vi.useFakeTimers()
    const harness = createDemoHarness(createDemoState())
    harness.activate()

    const received: string[] = []
    window.pty.onData((_paneId, data) => received.push(data))
    await window.pty.create('pane-1', 'claude', 'C:/demo/account')

    await vi.advanceTimersByTimeAsync(2000)
    expect(received.join('')).toContain('Welcome to Claude Code (demo)')

    harness.deactivate()
    vi.useRealTimers()
  })
})
