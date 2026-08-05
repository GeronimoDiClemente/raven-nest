import { describe, it, expect } from 'vitest'
import { toImportRows, applyPayload, conflictFor } from '../../lib/tmux/apply'
import { parseTmuxConf } from '../../lib/tmux/parse'
import { DEFAULT_SETTINGS } from '../../lib/keybindings'

describe('toImportRows', () => {
  it('keeps only the mappable binds (drops unsupported / null-action ones)', () => {
    const plan = parseTmuxConf('bind h select-pane -L\nbind Enter copy-mode')
    const rows = toImportRows(plan)
    expect(rows).toHaveLength(1)
    expect(rows[0].action).toBe('prevPane')
    expect(rows[0].combo).toBe('Ctrl+Alt+h')
    expect(rows[0].source).toBe('bind h select-pane -L')
  })

  it('starts non-conflicting rows selected and conflicting rows unselected', () => {
    const current = { ...DEFAULT_SETTINGS.keybindings, globalSearch: 'Ctrl+Alt+h' }
    const plan = parseTmuxConf('bind h select-pane -L\nbind n next-window', { current })
    const rows = toImportRows(plan)
    const byAction = Object.fromEntries(rows.map(r => [r.action, r]))
    expect(byAction.prevPane.conflict).toBe('globalSearch')
    expect(byAction.prevPane.selected).toBe(false)
    expect(byAction.nextTab.conflict).toBeUndefined()
    expect(byAction.nextTab.selected).toBe(true)
  })
})

describe('applyPayload', () => {
  it('includes only selected rows as an action -> combo patch', () => {
    const rows = [
      { action: 'prevPane' as const, source: '', combo: 'Ctrl+Alt+h', selected: true },
      { action: 'nextTab' as const, source: '', combo: 'Ctrl+Alt+n', selected: false },
    ]
    expect(applyPayload(rows)).toEqual({ prevPane: 'Ctrl+Alt+h' })
  })

  it('lets a later row win when two selected rows target the same action', () => {
    const rows = [
      { action: 'prevPane' as const, source: '', combo: 'Ctrl+Alt+h', selected: true },
      { action: 'prevPane' as const, source: '', combo: 'Ctrl+Alt+Left', selected: true },
    ]
    expect(applyPayload(rows)).toEqual({ prevPane: 'Ctrl+Alt+Left' })
  })
})

describe('conflictFor', () => {
  it('returns the Nest action already bound to a combo, or undefined', () => {
    expect(conflictFor('Meta+t', DEFAULT_SETTINGS.keybindings)).toBe('newPane')
    expect(conflictFor('Ctrl+Alt+q', DEFAULT_SETTINGS.keybindings)).toBeUndefined()
  })
})
