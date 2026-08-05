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

/**
 * Constructs the import deliberately never acts on. The parser is pure text —
 * it NEVER executes anything a conf references (run-shell, if-shell, source-file).
 */
const UNSUPPORTED_CONSTRUCTS: Record<string, string> = {
  'run-shell': 'runs a shell command — the import never executes conf contents',
  run: 'runs a shell command — the import never executes conf contents',
  'if-shell': 'conditional shell logic — not supported',
  'source-file': 'includes another file — not followed by the parser',
  source: 'includes another file — not followed by the parser',
}

/** Fold tmux line continuations (a line ending in `\`) into single logical lines. */
function logicalLines(text: string): string[] {
  const out: string[] = []
  let buf: string | null = null
  for (const line of text.split('\n')) {
    const cur: string = buf === null ? line : `${buf} ${line.trim()}`
    if (cur.trimEnd().endsWith('\\')) {
      buf = cur.trimEnd().slice(0, -1).trimEnd()
    } else {
      out.push(cur)
      buf = null
    }
  }
  if (buf !== null) out.push(buf)
  return out
}

/** Split a line into tokens, honoring single/double quotes and stripping them. */
function tokenize(line: string): string[] {
  const tokens: string[] = []
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(line)) !== null) {
    tokens.push(m[1] ?? m[2] ?? m[3])
  }
  return tokens
}

/** The Nest action already bound to `combo`, if any. */
function findConflict(combo: string, current: Keybindings): string | undefined {
  for (const [action, binding] of Object.entries(current)) {
    if (binding === combo) return action
  }
  return undefined
}

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

  for (const raw of logicalLines(text)) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue

    const tokens = tokenize(line)
    const head = tokens[0]
    if (!head) continue
    parsedLines++

    // Never act on shell / control-flow directives (%if, run-shell, source-file…).
    if (head.startsWith('%') || Object.hasOwn(UNSUPPORTED_CONSTRUCTS, head)) {
      unsupported.push({
        line,
        reason: UNSUPPORTED_CONSTRUCTS[head] ?? 'tmux control-flow directive — not supported',
      })
      continue
    }

    if (BIND_CMDS.has(head)) {
      const key = tokens[1]
      const action = mapBindCommand(tokens.slice(2))
      const suggested = suggestCombo(key)
      const conflict = opts.current ? findConflict(suggested, opts.current) : undefined
      keybindings.push({
        source: line,
        action,
        suggested,
        ...(conflict ? { conflict } : {}),
        status: action ? 'adapted' : 'unsupported',
      })
      continue
    }

    if (SET_CMDS.has(head)) {
      const rest = tokens.slice(1).filter(t => !t.startsWith('-'))
      const name = rest[0] ?? ''
      // @-prefixed options are user/plugin options (e.g. TPM) — not portable.
      if (name.startsWith('@')) {
        unsupported.push({ line, reason: 'tmux plugin / user option (e.g. TPM) — not supported' })
        continue
      }
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
