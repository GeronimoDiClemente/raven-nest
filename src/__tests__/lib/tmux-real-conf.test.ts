import { describe, it, expect } from 'vitest'
import { parseTmuxConf, type ParsedKeybinding } from '../../lib/tmux/parse'

// A realistic slice of a common .tmux.conf (oh-my-tmux / vim-tmux-navigator style):
// prefix remap, splits, no-prefix alt-hjkl nav, repeatable resize, copy-mode,
// options and TPM plugins. Exercises bind flags (-n / -r / -T) and the literal `-` key.
const REAL_CONF = `
# ── prefix ──
unbind C-b
set -g prefix C-a
bind C-a send-prefix

# ── splits ──
bind | split-window -h
bind - split-window -v

# ── pane nav (no prefix, alt+hjkl) ──
bind -n M-h select-pane -L
bind -n M-j select-pane -D
bind -n M-k select-pane -U
bind -n M-l select-pane -R

# ── resize (repeatable, not mappable) ──
bind -r H resize-pane -L 5

# ── windows ──
bind -n M-n next-window
bind -n M-p previous-window
bind c new-window

# ── zoom ──
bind z resize-pane -Z

# ── copy mode ──
setw -g mode-keys vi
bind -T copy-mode-vi v send-keys -X begin-selection
bind Enter copy-mode

# ── options ──
set -g history-limit 50000
set -g mouse on
set -g base-index 1

# ── plugins (TPM) ──
set -g @plugin 'tmux-plugins/tpm'
run '~/.tmux/plugins/tpm/tpm'
`

const find = (kbs: ParsedKeybinding[], includes: string) =>
  kbs.find(k => k.source.includes(includes))!

describe('parseTmuxConf on a real .tmux.conf', () => {
  const plan = parseTmuxConf(REAL_CONF)

  it('handles no-prefix (-n) binds: key + command past the flag', () => {
    const h = find(plan.keybindings, 'M-h select-pane -L')
    expect(h.action).toBe('prevPane')
    expect(h.suggested).toBe('Ctrl+Alt+h') // M- prefix stripped from the key
    expect(find(plan.keybindings, 'M-l select-pane -R').action).toBe('nextPane')
    expect(find(plan.keybindings, 'M-n next-window').action).toBe('nextTab')
    expect(find(plan.keybindings, 'M-p previous-window').action).toBe('prevTab')
  })

  it('treats a literal `-` as the key, not a flag', () => {
    const dash = find(plan.keybindings, 'bind - split-window -v')
    expect(dash.action).toBe('newPane')
    expect(dash.suggested).toBe('Ctrl+Alt+-')
  })

  it('maps splits and zoom', () => {
    expect(find(plan.keybindings, 'bind | split-window -h').action).toBe('newPane')
    expect(find(plan.keybindings, 'resize-pane -Z').action).toBe('toggleZoom')
    expect(find(plan.keybindings, 'bind c new-window').action).toBe('newPane')
  })

  it('skips arg-taking flags (-T table) to find the real key + command', () => {
    const copy = find(plan.keybindings, 'copy-mode-vi v send-keys')
    expect(copy.action).toBeNull() // send-keys has no Nest action
  })

  it('leaves genuinely unmappable binds unsupported (resize, copy-mode, send-prefix)', () => {
    expect(find(plan.keybindings, '-r H resize-pane -L 5').action).toBeNull()
    expect(find(plan.keybindings, 'bind Enter copy-mode').action).toBeNull()
    expect(find(plan.keybindings, 'send-prefix').action).toBeNull()
  })

  it('does not turn `unbind` lines into keybindings', () => {
    expect(plan.keybindings.some(k => k.source.startsWith('unbind'))).toBe(false)
  })

  it('classifies options and never-execute constructs correctly', () => {
    const byName = Object.fromEntries(plan.options.map(o => [o.name, o]))
    expect(byName['history-limit']).toMatchObject({ target: 'scrollback', status: 'direct', value: '50000' })
    expect(byName['mouse'].status).toBe('covered')
    expect(byName['base-index'].status).toBe('unsupported')
    expect(byName['mode-keys'].status).toBe('unsupported')
    // TPM plugin + run-shell go to the never-executed bucket
    expect(plan.unsupported.some(u => u.line.includes('@plugin'))).toBe(true)
    expect(plan.unsupported.some(u => u.line.startsWith('run '))).toBe(true)
  })

  it('maps exactly the 10 shortcuts Nest can represent', () => {
    expect(plan.keybindings.filter(k => k.action !== null)).toHaveLength(10)
  })
})
