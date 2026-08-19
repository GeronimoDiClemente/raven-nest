import { describe, it, expect } from 'vitest'
import { paneGroup, groupCounts, applyPaneFilter, newPaneBreaksFilter } from '../../lib/pane-filter'
import type { AIType, PaneNode } from '../../types'

function pane(id: string, aiType: AIType): PaneNode {
  return { id, aiType, accountName: '', accountDir: '', borderColor: '', cmd: '' }
}

// Filtro de vista por tipo de pane (pedido de Gero): dentro de un workspace
// o del Hub, ver solo agentes de IA, solo editores, etc. Es estado de VISTA:
// transitorio, default 'all', nunca muta panes/layoutId persistidos.
describe('paneGroup', () => {
  it('classifies AI agents via the same notion broadcast uses (custom ES agente, terminal NO)', () => {
    expect(paneGroup('claude')).toBe('agents')
    expect(paneGroup('gemini')).toBe('agents')
    expect(paneGroup('codex')).toBe('agents')
    expect(paneGroup('copilot')).toBe('agents')
    expect(paneGroup('opencode')).toBe('agents')
    expect(paneGroup('custom')).toBe('agents')
    expect(paneGroup('terminal')).toBe('terminal')
  })

  it('gives editor and browser their own groups', () => {
    expect(paneGroup('editor')).toBe('editor')
    expect(paneGroup('browser')).toBe('browser')
  })
})

describe('groupCounts', () => {
  it('counts panes per group, in stable order, omitting empty groups', () => {
    const panes = [
      pane('1', 'claude'), pane('2', 'editor'), pane('3', 'gemini'), pane('4', 'terminal'),
    ]
    expect(groupCounts(panes)).toEqual([
      { group: 'agents', count: 2 },
      { group: 'editor', count: 1 },
      { group: 'terminal', count: 1 },
    ])
  })

  it('returns empty for no panes', () => {
    expect(groupCounts([])).toEqual([])
  })
})

describe('applyPaneFilter', () => {
  const panes = [pane('a', 'claude'), pane('b', 'editor'), pane('c', 'terminal'), pane('d', 'gemini')]

  it("'all' shows everything and reports the filter as inactive", () => {
    expect(applyPaneFilter(panes, 'all')).toEqual({ panes, active: false })
  })

  it('a group filter shows only that group, preserving order', () => {
    const res = applyPaneFilter(panes, 'agents')
    expect(res.active).toBe(true)
    expect(res.panes.map(p => p.id)).toEqual(['a', 'd'])
  })

  // Un filtro que dejaría el workspace VACÍO no es un filtro, es un workspace
  // roto (p.ej. filtro 'editor' activo y el usuario cierra el último editor).
  // Cae a 'all' en vez de renderizar la nada.
  it('falls back to all when the filtered group has no panes', () => {
    const res = applyPaneFilter(panes, 'browser')
    expect(res).toEqual({ panes, active: false })
  })

  it('handles empty pane arrays without exploding', () => {
    expect(applyPaneFilter([], 'agents')).toEqual({ panes: [], active: false })
  })
})

// Un pane recién creado que el filtro ocultaría (filtro Agents + drop del
// Explorer abre un editor) parece un bug, no un filtro: el caller resetea a
// 'all' cuando esto da true.
describe('newPaneBreaksFilter', () => {
  const prev = new Set(['a'])

  it('is true when a NEW pane does not match the active filter', () => {
    const panes = [pane('a', 'claude'), pane('b', 'editor')]
    expect(newPaneBreaksFilter(prev, panes, 'agents')).toBe(true)
  })

  it('is false when the new pane matches the filter', () => {
    const panes = [pane('a', 'claude'), pane('b', 'gemini')]
    expect(newPaneBreaksFilter(prev, panes, 'agents')).toBe(false)
  })

  it('is false with filter all or without new panes', () => {
    expect(newPaneBreaksFilter(prev, [pane('a', 'claude'), pane('b', 'editor')], 'all')).toBe(false)
    expect(newPaneBreaksFilter(prev, [pane('a', 'claude')], 'agents')).toBe(false)
  })
})
