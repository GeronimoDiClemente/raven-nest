// Pure logic to infer what an AI-CLI pane is doing from a few observable
// signals (pty liveness, last-output timestamp, cpu of the process tree, and
// the tail of the scrollback). No fs / process / PTY access lives here — the
// caller (main.ts, out of scope) samples the real inputs and passes them in,
// so this module stays 100% unit-testable with an injected clock (`now`).

export type AgentState = 'working' | 'needs_input' | 'idle' | 'done'

export interface AgentStatusInput {
  hasPty: boolean // is the CLI process still alive?
  lastOutputAt: number | null // epoch ms of the last PTY output (null = never)
  cpuPercent: number // cpu of the pane's process tree (0..~100)
  bufferTail: string // last chars of the PTY scrollback
  now: number // current epoch ms (injected)
}

export interface AgentStatusConfig {
  idleAfterMs?: number // no output for longer than this → idle (default 120_000)
  recentOutputMs?: number // output more recent than this → working (default 8_000)
  workingCpuPercent?: number // cpu above this → working (default 8)
  quiescentMs?: number // no output for at least this to consider needs_input (default 2_000)
}

const DEFAULTS: Required<AgentStatusConfig> = {
  idleAfterMs: 120_000,
  recentOutputMs: 8_000,
  workingCpuPercent: 8,
  quiescentMs: 2_000,
}

export function deriveAgentState(input: AgentStatusInput, config?: AgentStatusConfig): AgentState {
  const { idleAfterMs, recentOutputMs, workingCpuPercent, quiescentMs } = { ...DEFAULTS, ...config }
  const { hasPty, lastOutputAt, cpuPercent, bufferTail, now } = input

  // 1. done: the process exited. Highest priority — trumps a lingering prompt,
  //    recent output, or high cpu still reported for the sampling window.
  if (!hasPty) return 'done'

  const sinceOutput = lastOutputAt != null ? now - lastOutputAt : null

  // 2. needs_input: a decision prompt is on screen AND the pane has gone quiet
  //    (no output for at least quiescentMs) AND cpu is not clearly busy.
  //    Conservative: a prompt in the tail with high cpu or fresh output means
  //    the agent is still working, not waiting on the human.
  const quiescent = sinceOutput != null && sinceOutput >= quiescentMs
  if (detectNeedsInput(bufferTail) && quiescent && cpuPercent <= workingCpuPercent) {
    return 'needs_input'
  }

  // 3. working: busy cpu, or output produced very recently.
  const recentOutput = sinceOutput != null && sinceOutput < recentOutputMs
  if (cpuPercent > workingCpuPercent || recentOutput) return 'working'

  // 4. idle: never produced output, or has been silent past the idle window.
  if (lastOutputAt == null || (sinceOutput != null && sinceOutput >= idleAfterMs)) return 'idle'

  // 5. default: alive with some activity between "recent" and "idle" and no
  //    prompt → assume working (conservative: if it's alive and not clearly
  //    idle, treat it as busy rather than silently stalled).
  return 'working'
}

// Conservative heuristic for "the CLI is waiting on a human decision".
// Prefer false negatives over false positives: we only match fairly specific
// prompt shapes so normal agent output (prose, diffs, logs, "done", "Running
// tests") never reads as needs_input. Patterns live near the end of the
// scrollback, so matching the tail is enough.
// NOTE: tune with more patterns after live validation against real CLIs.
const NEEDS_INPUT_PATTERNS: RegExp[] = [
  /do you want to\b/i, // Claude Code permission prompt ("Do you want to proceed?")
  /❯\s*\d+\.\s*(?:yes|no)\b/i, // arrow-selected menu item ("❯ 1. Yes")
  /\b1\.\s*yes\b[\s\S]{0,80}\b2\.\s*no\b/i, // numbered choice list ("1. Yes … 2. No")
  /\(y\/n\)/i, // (y/n)
  /\[y\/n\]/i, // [y/n] / [Y/n]
  /\(yes\/no\)/i, // (yes/no)
  /press enter to continue/i, // "Press Enter to continue"
  /\bcontinue\?/i, // "Continue? "
  /\boverwrite\b[^\n]*\?/i, // "Overwrite existing file?"
  /\ballow (?:this|command|the)\b/i, // "Allow this" / "Allow command"
  /\bapprove\b[^\n]*\?/i, // "Approve …?"
]

export function detectNeedsInput(bufferTail: string): boolean {
  if (!bufferTail) return false
  return NEEDS_INPUT_PATTERNS.some((re) => re.test(bufferTail))
}
