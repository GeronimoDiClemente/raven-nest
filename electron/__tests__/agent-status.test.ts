import { describe, it, expect } from 'vitest'
import {
  deriveAgentState,
  detectNeedsInput,
  type AgentStatusInput,
} from '../integrations/agent-status'

// Deterministic clock: everything is expressed relative to NOW, never Date.now().
const NOW = 1_700_000_000_000

function makeInput(over: Partial<AgentStatusInput> = {}): AgentStatusInput {
  return {
    hasPty: true,
    lastOutputAt: NOW - 30_000, // 30s ago: between "recent" (8s) and "idle" (120s)
    cpuPercent: 0,
    bufferTail: '',
    now: NOW,
    ...over,
  }
}

describe('deriveAgentState', () => {
  it('done: the pty exited, regardless of recent output or high cpu', () => {
    expect(
      deriveAgentState(
        makeInput({ hasPty: false, lastOutputAt: NOW, cpuPercent: 90, bufferTail: 'Continue? (y/n)' }),
      ),
    ).toBe('done')
  })

  it('working: high cpu with a live pty (even if output is stale)', () => {
    expect(deriveAgentState(makeInput({ cpuPercent: 42, lastOutputAt: NOW - 300_000 }))).toBe('working')
  })

  it('working: output 2s ago (< recentOutputMs) with idle cpu', () => {
    expect(deriveAgentState(makeInput({ cpuPercent: 0, lastOutputAt: NOW - 2_000 }))).toBe('working')
  })

  it('idle: no output for 5min (> idleAfterMs) with cpu 0', () => {
    expect(
      deriveAgentState(makeInput({ cpuPercent: 0, lastOutputAt: NOW - 300_000, bufferTail: 'some log line' })),
    ).toBe('idle')
  })

  it('idle: never produced output (lastOutputAt = null)', () => {
    expect(deriveAgentState(makeInput({ lastOutputAt: null, cpuPercent: 0 }))).toBe('idle')
  })

  it('needs_input: prompt in tail + quiescent (5s) + cpu 0', () => {
    expect(
      deriveAgentState(
        makeInput({
          bufferTail: 'Do you want to proceed?\n❯ 1. Yes\n  2. No',
          lastOutputAt: NOW - 5_000,
          cpuPercent: 0,
        }),
      ),
    ).toBe('needs_input')
  })

  it('needs_input: cpu exactly at the working threshold still counts as not-working (<=)', () => {
    expect(
      deriveAgentState(
        makeInput({ bufferTail: 'Continue? (y/n)', lastOutputAt: NOW - 5_000, cpuPercent: 8 }),
      ),
    ).toBe('needs_input')
  })

  it('working (not needs_input): prompt in tail but cpu is high → still busy', () => {
    expect(
      deriveAgentState(
        makeInput({
          bufferTail: 'Do you want to proceed?\n❯ 1. Yes\n  2. No',
          lastOutputAt: NOW - 5_000,
          cpuPercent: 42,
        }),
      ),
    ).toBe('working')
  })

  it('working (not needs_input): prompt in tail but output 1s ago (< quiescentMs) → still emitting', () => {
    expect(
      deriveAgentState(
        makeInput({ bufferTail: 'Continue? (y/n)', lastOutputAt: NOW - 1_000, cpuPercent: 0 }),
      ),
    ).toBe('working')
  })

  it('done wins over needs_input: prompt in tail but the pty exited', () => {
    expect(
      deriveAgentState(
        makeInput({ hasPty: false, bufferTail: 'Continue? (y/n)', lastOutputAt: NOW - 5_000, cpuPercent: 0 }),
      ),
    ).toBe('done')
  })

  it('default: live, some activity between recent and idle, no prompt → working (conservative)', () => {
    expect(deriveAgentState(makeInput({ cpuPercent: 0, lastOutputAt: NOW - 50_000, bufferTail: 'log' }))).toBe(
      'working',
    )
  })

  it('config: idleAfterMs override flips the same input from working to idle', () => {
    const input = makeInput({ cpuPercent: 0, lastOutputAt: NOW - 50_000, bufferTail: 'log' })
    expect(deriveAgentState(input)).toBe('working') // 50s < default 120s
    expect(deriveAgentState(input, { idleAfterMs: 30_000 })).toBe('idle') // 50s >= 30s
  })

  it('config: quiescentMs override flips the same input from working to needs_input', () => {
    const input = makeInput({ bufferTail: 'Continue? (y/n)', lastOutputAt: NOW - 1_500, cpuPercent: 0 })
    expect(deriveAgentState(input)).toBe('working') // 1.5s < default 2s quiescent
    expect(deriveAgentState(input, { quiescentMs: 1_000 })).toBe('needs_input') // 1.5s >= 1s
  })
})

describe('detectNeedsInput', () => {
  it('true: Claude Code style permission prompt with an arrow menu', () => {
    expect(detectNeedsInput('... Do you want to proceed?\n❯ 1. Yes\n  2. No')).toBe(true)
  })

  it('true: (y/n) confirmation', () => {
    expect(detectNeedsInput('Continue? (y/n)')).toBe(true)
  })

  it('true: [Y/n] overwrite confirmation', () => {
    expect(detectNeedsInput('Overwrite existing file? [Y/n]')).toBe(true)
  })

  it('true: press-enter prompt', () => {
    expect(detectNeedsInput('Press Enter to continue')).toBe(true)
  })

  it('false: ordinary test output', () => {
    expect(detectNeedsInput('Running tests...\nAll 42 passed')).toBe(false)
  })

  it('false: ordinary prose output', () => {
    expect(detectNeedsInput('Here is the updated function:\n  return a + b')).toBe(false)
  })

  it('false: empty tail', () => {
    expect(detectNeedsInput('')).toBe(false)
  })

  it('false: a normal unified diff', () => {
    expect(detectNeedsInput('@@ -1,4 +1,6 @@\n-  const x = 1\n+  const x = 2\n   return x')).toBe(false)
  })
})
