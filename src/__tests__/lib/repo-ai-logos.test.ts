import { describe, it, expect } from 'vitest'
import { groupAITypesByRepoPath, sliceAILogos, MAX_VISIBLE_AI_LOGOS, type PaneAIRef } from '../../lib/repo-ai-logos'
import type { AIType } from '../../types'

function pane(aiType: AIType, repoPath?: string): PaneAIRef {
  return { aiType, repoPath }
}

// workspace-shell-design §3: "Agrupando los panes abiertos por repoPath sale,
// para cada repo o worktree, el conjunto de IAs corriendo ahi." Puro y
// testeable aparte del componente que lo pinta.
describe('groupAITypesByRepoPath', () => {
  it('returns an empty map for no panes — el caso de ninguna IA', () => {
    expect(groupAITypesByRepoPath([]).size).toBe(0)
  })

  it('skips panes without a repoPath — no se pueden atribuir a ninguna fila', () => {
    const byPath = groupAITypesByRepoPath([pane('claude', undefined)])
    expect(byPath.size).toBe(0)
  })

  it('groups distinct aiTypes under their repoPath', () => {
    const byPath = groupAITypesByRepoPath([
      pane('claude', '/repo/a'),
      pane('codex', '/repo/a'),
    ])
    expect(byPath.get('/repo/a')).toEqual(['claude', 'codex'])
  })

  it('dedupes repeated aiType at the same path (two claude panes ⇒ one logo)', () => {
    const byPath = groupAITypesByRepoPath([
      pane('claude', '/repo/a'),
      pane('claude', '/repo/a'),
    ])
    expect(byPath.get('/repo/a')).toEqual(['claude'])
  })

  it('keeps separate paths independent, including different worktrees of the same repo', () => {
    const byPath = groupAITypesByRepoPath([
      pane('claude', '/repo/main'),
      pane('gemini', '/repo/worktrees/feature-x'),
    ])
    expect(byPath.get('/repo/main')).toEqual(['claude'])
    expect(byPath.get('/repo/worktrees/feature-x')).toEqual(['gemini'])
  })

  it('preserves first-seen order, not alphabetical', () => {
    const byPath = groupAITypesByRepoPath([
      pane('qwen', '/repo/a'),
      pane('claude', '/repo/a'),
    ])
    expect(byPath.get('/repo/a')).toEqual(['qwen', 'claude'])
  })

  it('handles more than 3 distinct IAs on the same path — feeds the +N case', () => {
    const byPath = groupAITypesByRepoPath([
      pane('claude', '/repo/a'),
      pane('gemini', '/repo/a'),
      pane('codex', '/repo/a'),
      pane('copilot', '/repo/a'),
      pane('qwen', '/repo/a'),
    ])
    expect(byPath.get('/repo/a')).toHaveLength(5)
  })
})

describe('sliceAILogos', () => {
  it('shows everything with no overflow when at or under the max', () => {
    expect(sliceAILogos([])).toEqual({ visible: [], overflow: 0 })
    expect(sliceAILogos(['claude'])).toEqual({ visible: ['claude'], overflow: 0 })
    expect(sliceAILogos(['claude', 'gemini', 'codex'])).toEqual({
      visible: ['claude', 'gemini', 'codex'],
      overflow: 0,
    })
    expect(MAX_VISIBLE_AI_LOGOS).toBe(3)
  })

  it('caps at MAX_VISIBLE_AI_LOGOS and folds the rest into overflow — the "+N" case', () => {
    const { visible, overflow } = sliceAILogos(['claude', 'gemini', 'codex', 'copilot', 'qwen'])
    expect(visible).toEqual(['claude', 'gemini', 'codex'])
    expect(overflow).toBe(2)
  })
})
