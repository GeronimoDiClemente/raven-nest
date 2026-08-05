import { describe, it, expect } from 'vitest'
import { parseTmuxConf } from '../../lib/tmux/parse'
import { DEFAULT_SETTINGS } from '../../lib/keybindings'

const only = (src: string) => parseTmuxConf(src).keybindings[0]

describe('parseTmuxConf — keybinding intent mapping', () => {
  it('maps `select-pane -L` to the prevPane action (adapted)', () => {
    const plan = parseTmuxConf('bind h select-pane -L')
    expect(plan.keybindings).toHaveLength(1)
    const kb = plan.keybindings[0]
    expect(kb.action).toBe('prevPane')
    expect(kb.status).toBe('adapted')
    expect(kb.source).toBe('bind h select-pane -L')
  })

  it('maps the four select-pane directions (L/U -> prevPane, R/D -> nextPane)', () => {
    expect(only('bind h select-pane -L').action).toBe('prevPane')
    expect(only('bind k select-pane -U').action).toBe('prevPane')
    expect(only('bind l select-pane -R').action).toBe('nextPane')
    expect(only('bind j select-pane -D').action).toBe('nextPane')
  })

  it('maps window navigation to tab actions', () => {
    expect(only('bind n next-window').action).toBe('nextTab')
    expect(only('bind p previous-window').action).toBe('prevTab')
    expect(only('bind a last-window').action).toBe('prevTab')
  })

  it('maps new-window and split-window to newPane', () => {
    expect(only('bind c new-window').action).toBe('newPane')
    expect(only('bind % split-window -h').action).toBe('newPane')
    expect(only('bind - split-window -v').action).toBe('newPane')
  })

  it('maps zoom to toggleZoom', () => {
    expect(only('bind z resize-pane -Z').action).toBe('toggleZoom')
  })

  it('marks an unmappable bind as unsupported with a null action', () => {
    const kb = only('bind Enter copy-mode')
    expect(kb.action).toBeNull()
    expect(kb.status).toBe('unsupported')
  })

  it('suggests a Ctrl+Alt combo derived from the bound key', () => {
    expect(only('bind h select-pane -L').suggested).toBe('Ctrl+Alt+h')
    // tmux modifier prefixes (C-/M-/S-) are stripped from the suggestion base
    expect(only('bind C-h select-pane -L').suggested).toBe('Ctrl+Alt+h')
  })

  it('accepts the `bind-key` alias identically to `bind`', () => {
    expect(only('bind-key n next-window').action).toBe('nextTab')
  })
})

describe('parseTmuxConf — options', () => {
  it('maps history-limit to the scrollback target (direct)', () => {
    const opt = parseTmuxConf('set -g history-limit 10000').options[0]
    expect(opt.name).toBe('history-limit')
    expect(opt.value).toBe('10000')
    expect(opt.target).toBe('scrollback')
    expect(opt.status).toBe('direct')
  })

  it('marks mouse as already covered by the terminal', () => {
    const opt = parseTmuxConf('set -g mouse on').options[0]
    expect(opt.name).toBe('mouse')
    expect(opt.status).toBe('covered')
  })

  it('marks prefix as unsupported (Nest has no prefix chords)', () => {
    const opt = parseTmuxConf('set -g prefix C-a').options[0]
    expect(opt.status).toBe('unsupported')
  })

  it('accepts set-option and setw aliases', () => {
    expect(parseTmuxConf('set-option -g history-limit 5000').options[0].target).toBe('scrollback')
    expect(parseTmuxConf('setw -g mouse on').options[0].name).toBe('mouse')
  })
})

describe('parseTmuxConf — parsing mechanics', () => {
  it('ignores comments and blank lines', () => {
    const plan = parseTmuxConf('# a comment\n\n   \nbind n next-window')
    expect(plan.keybindings).toHaveLength(1)
    expect(plan.options).toHaveLength(0)
  })

  it('counts only meaningful (non-blank, non-comment) parsed lines', () => {
    const plan = parseTmuxConf('# comment\n\nbind n next-window\nset -g mouse on')
    expect(plan.source.parsedLines).toBe(2)
  })

  it('returns empty collections (not crash) for an empty conf', () => {
    const plan = parseTmuxConf('')
    expect(plan.keybindings).toEqual([])
    expect(plan.options).toEqual([])
    expect(plan.unsupported).toEqual([])
  })
})

describe('parseTmuxConf — conflict detection', () => {
  it('flags a suggested combo that collides with an existing Nest binding', () => {
    const current = { ...DEFAULT_SETTINGS.keybindings, globalSearch: 'Ctrl+Alt+h' }
    const kb = parseTmuxConf('bind h select-pane -L', { current }).keybindings[0]
    expect(kb.suggested).toBe('Ctrl+Alt+h')
    expect(kb.conflict).toBe('globalSearch')
  })

  it('sets no conflict when the suggested combo is free', () => {
    const kb = parseTmuxConf('bind h select-pane -L', {
      current: DEFAULT_SETTINGS.keybindings,
    }).keybindings[0]
    expect(kb.conflict).toBeUndefined()
  })
})

describe('parseTmuxConf — line continuations & quoting', () => {
  it('joins a line ending with a backslash to the next', () => {
    const plan = parseTmuxConf('bind h \\\n  select-pane -L')
    expect(plan.keybindings).toHaveLength(1)
    expect(plan.keybindings[0].action).toBe('prevPane')
  })

  it('strips quotes from a quoted option value', () => {
    expect(parseTmuxConf('set -g history-limit "5000"').options[0].value).toBe('5000')
  })
})

describe('parseTmuxConf — unsupported constructs (never executed)', () => {
  it('records run-shell as unsupported and never runs it', () => {
    const plan = parseTmuxConf('run-shell "~/evil.sh"')
    expect(plan.unsupported).toHaveLength(1)
    expect(plan.unsupported[0].line).toContain('run-shell')
    expect(plan.keybindings).toHaveLength(0)
    expect(plan.options).toHaveLength(0)
  })

  it('records if-shell as unsupported', () => {
    expect(parseTmuxConf('if-shell "true" "set -g mouse on"').unsupported).toHaveLength(1)
  })

  it('records TPM @plugin declarations as unsupported (not as an option)', () => {
    const plan = parseTmuxConf("set -g @plugin 'tmux-plugins/tpm'")
    expect(plan.unsupported).toHaveLength(1)
    expect(plan.options).toHaveLength(0)
  })

  it('records source-file as unsupported (the pure parser cannot follow it)', () => {
    expect(parseTmuxConf('source-file ~/.tmux.other.conf').unsupported).toHaveLength(1)
  })
})
