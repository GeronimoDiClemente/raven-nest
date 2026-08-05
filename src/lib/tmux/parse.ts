import type { Keybindings } from '../keybindings'

/**
 * Pure parser for a `.tmux.conf`. No I/O — the caller (IPC layer) reads the file
 * and passes the text in. Produces a plan the preview UI can render and apply.
 *
 * The parser maps tmux *intent* to Nest actions, not keys to keys: a
 * `bind h select-pane -L` becomes "navigate to the previous pane" (prevPane),
 * with a suggested Nest combo the user can edit before applying. Translating keys
 * literally produces noise; translating intent produces a familiar setup.
 */

export type KeyStatus = 'direct' | 'adapted' | 'unsupported'
export type OptionStatus = 'direct' | 'covered' | 'unsupported'

export interface ParsedKeybinding {
  /** The original conf line, shown verbatim in the preview. */
  source: string
  /** The Nest action this bind maps to, or null when nothing fits. */
  action: keyof Keybindings | null
  /** Suggested Nest combo (editable in the preview). */
  suggested: string
  /** Nest action already using `suggested`, if any (set by conflict detection). */
  conflict?: string
  status: KeyStatus
}

export interface ParsedOption {
  name: string
  value: string
  /** The Nest setting this option maps to, when applicable. */
  target?: string
  status: OptionStatus
}

export interface UnsupportedLine {
  line: string
  reason: string
}

export interface TmuxImportPlan {
  source: { confPath: string; parsedLines: number; warnings: string[] }
  keybindings: ParsedKeybinding[]
  options: ParsedOption[]
  unsupported: UnsupportedLine[]
}

const BIND_CMDS = new Set(['bind', 'bind-key'])
const SET_CMDS = new Set(['set', 'set-option', 'setw', 'set-window-option'])

/** Map a tmux command (already split into tokens) to a Nest action. */
function mapBindCommand(tokens: string[]): keyof Keybindings | null {
  const [name, ...args] = tokens
  switch (name) {
    case 'select-pane':
      if (args.includes('-L') || args.includes('-U')) return 'prevPane'
      if (args.includes('-R') || args.includes('-D')) return 'nextPane'
      return null
    case 'next-window':
      return 'nextTab'
    case 'previous-window':
    case 'last-window':
      return 'prevTab'
    case 'new-window':
    case 'split-window':
      return 'newPane'
    case 'resize-pane':
      return args.includes('-Z') ? 'toggleZoom' : null
    default:
      return null
  }
}

/** Suggest a Nest combo from the tmux key, stripping tmux modifier prefixes. */
function suggestCombo(key: string): string {
  const base = key.replace(/^([CMS]-)+/, '')
  return `Ctrl+Alt+${base}`
}

function mapOption(name: string): { target?: string; status: OptionStatus } {
  switch (name) {
    case 'history-limit':
      return { target: 'scrollback', status: 'direct' }
    case 'mouse':
      return { status: 'covered' }
    default:
      return { status: 'unsupported' }
  }
}

export function parseTmuxConf(
  text: string,
  opts: { confPath?: string; current?: Keybindings } = {},
): TmuxImportPlan {
  const keybindings: ParsedKeybinding[] = []
  const options: ParsedOption[] = []
  const unsupported: UnsupportedLine[] = []
  let parsedLines = 0

  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    parsedLines++

    const tokens = line.split(/\s+/)
    const head = tokens[0]

    if (BIND_CMDS.has(head)) {
      const key = tokens[1]
      const command = tokens.slice(2)
      const action = mapBindCommand(command)
      keybindings.push({
        source: line,
        action,
        suggested: suggestCombo(key),
        status: action ? 'adapted' : 'unsupported',
      })
      continue
    }

    if (SET_CMDS.has(head)) {
      const rest = tokens.slice(1).filter(t => !t.startsWith('-'))
      const name = rest[0] ?? ''
      const value = rest.slice(1).join(' ')
      const { target, status } = mapOption(name)
      options.push({ name, value, target, status })
      continue
    }
  }

  return {
    source: { confPath: opts.confPath ?? '', parsedLines, warnings: [] },
    keybindings,
    options,
    unsupported,
  }
}
