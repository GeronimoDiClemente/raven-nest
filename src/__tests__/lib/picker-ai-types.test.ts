import { describe, it, expect } from 'vitest'
import { PICKER_AI_TYPES } from '../../types'

describe('PICKER_AI_TYPES', () => {
  it('excluye editor (nacería cascarón sin tabs) y custom (card propia)', () => {
    expect(PICKER_AI_TYPES).not.toContain('editor')
    expect(PICKER_AI_TYPES).not.toContain('custom')
  })
  it('mantiene los agentes y la terminal', () => {
    for (const t of ['claude', 'gemini', 'codex', 'copilot', 'opencode', 'deepseek', 'grok', 'qwen', 'cursor', 'terminal']) {
      expect(PICKER_AI_TYPES).toContain(t)
    }
  })
})
