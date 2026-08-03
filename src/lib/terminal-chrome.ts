// Shared terminal-output text utilities. Extracted from TerminalPane so the
// Hub activity signal (hub-activity.ts) can classify raw PTY chunks with the
// same rules the pane already uses. The regexes below are byte-identical to
// the previous inline TerminalPane definitions — do not diverge them.

// CSI sequences, charset selects, keypad modes, BEL, and carriage returns.
export const ANSI_RE = /\x1b\[[0-9;?]*[a-zA-Z]|\x1b[()][A-Z0-9]|\x1b[=>]|\x07|\r/g
export const stripAnsi = (s: string): string => s.replace(ANSI_RE, '')

export const PROMPT_RE = /^\s*[\$\#\>❯➜]\s*$|^\s*$|^[0-9]+\s*$|\(base\)/
// Claude/Gemini UI chrome: status bars, keyboard hints, spinner lines
export const UI_CHROME_RE = /tab to cycle|shift\+tab|bypass|permission|esc to interrupt|working\.\.\.|thinking\.\.\.|⠋|⠙|⠹|⠸|⠼|⠴|⠦|⠧|⠇|⠏|\([^)]{0,40}to [^)]{0,30}\)/i

export function filterChrome(text: string): string {
  return text
    .split(/[\r\n]+/)
    .filter((l) => !UI_CHROME_RE.test(l.trim()) && !PROMPT_RE.test(l.trim()))
    .join('\n')
    .trim()
}

// OSC sequences (e.g. window-title updates: ESC ] 0 ; title BEL) carry no
// visible payload but survive stripAnsi once its BEL terminator is consumed,
// so strip them explicitly before the visible-content check.
const OSC_RE = /\x1b\][\s\S]*?(?:\x07|\x1b\\)/g

/**
 * True when a raw PTY chunk contains printable output — text or spinner glyphs
 * — rather than only cursor moves, colour codes, clears or title updates. Used
 * to gate the Hub "active" signal so an idle TUI that merely repaints its
 * chrome doesn't read as working. Deliberately coarser than filterChrome
 * (which strips spinners): a spinner IS a real work signal here.
 */
export function hasVisibleOutput(data: string): boolean {
  // /\S/.test short-circuits at the first non-whitespace char instead of
  // building a whole whitespace-stripped copy just to measure its length —
  // same result, one fewer full-string allocation per PTY chunk (this runs on
  // every chunk of every pane via hub-activity).
  return /\S/.test(stripAnsi(data.replace(OSC_RE, '')))
}
