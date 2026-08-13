import { describe, it, expect } from 'vitest'
import { appendModelFlag } from '../../lib/launch-cmd'

describe('appendModelFlag', () => {
  it('appends "<flag> <model>" when both flag and model are present', () => {
    expect(appendModelFlag('claude', '--model', 'opus')).toBe('claude --model opus')
    expect(appendModelFlag('gemini', '-m', 'gemini-2.5-pro')).toBe('gemini -m gemini-2.5-pro')
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
