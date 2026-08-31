import { describe, it, expect } from 'vitest'
import { isAgentPane, broadcastTargets } from '../../lib/broadcast'
import type { PaneNode } from '../../types'

function pane(id: string, aiType: PaneNode['aiType']): PaneNode {
  return { id, aiType, accountName: '', accountDir: '', borderColor: '', cmd: '' }
}

// El broadcast escribe al PTY de cada target: solo tiene sentido en panes
// corriendo un agente de IA. Editor y browser no tienen PTY; una terminal
// plana es una shell del usuario, no un agente (pedido explícito 2026-08-18).
describe('isAgentPane', () => {
  it('treats AI CLIs as agents', () => {
    for (const t of ['claude', 'gemini', 'codex', 'copilot', 'opencode', 'custom'] as const) {
      expect(isAgentPane(t)).toBe(true)
    }
  })
  it('excludes editor, browser and plain terminals', () => {
    for (const t of ['editor', 'browser', 'terminal'] as const) {
      expect(isAgentPane(t)).toBe(false)
    }
  })
})

describe('broadcastTargets', () => {
  const panes = [
    pane('a', 'claude'),
    pane('b', 'terminal'),
    pane('c', 'editor'),
    pane('d', 'gemini'),
    pane('e', 'browser'),
  ]

  it('targets the source pane plus every agent pane, once each', () => {
    // Tipear en la terminal plana 'b' con broadcast: la entrada va a la
    // propia shell Y a los agentes — nunca al editor ni al browser.
    expect(broadcastTargets(panes, 'b')).toEqual(['b', 'a', 'd'])
  })

  it('does not duplicate the source when it is itself an agent', () => {
    expect(broadcastTargets(panes, 'a')).toEqual(['a', 'd'])
  })

  it('falls back to just the source with no agents around', () => {
    expect(broadcastTargets([pane('x', 'terminal'), pane('y', 'editor')], 'x')).toEqual(['x'])
  })
})
