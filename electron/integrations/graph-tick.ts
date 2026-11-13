// Testable seam between the pure orchestrator core and main.ts's effect layer.
// `sampleGraph` turns per-pane observable signals into the AgentState record
// planTick consumes; `launchCommand` turns a StartAction's agent+model into the
// shell command main writes into a headless PTY. No fs/PTY/Electron here — the
// caller injects the per-pane sampler and performs the real spawn.
import { deriveAgentState, type AgentState, type AgentStatusInput } from './agent-status'
import type { GraphRun } from './graph-runner'
import type { StartAction } from './graph-orchestrator'
import type { WorkerAgent } from './worker-spec-store'

/** Everything deriveAgentState needs except the clock (injected once per tick). */
export type PaneSignals = Omit<AgentStatusInput, 'now'>

/** main.ts's port: the live signals for a paneId, or null if that pane was
 *  never created (a node the orchestrator hasn't launched yet). */
export type PaneSampler = (paneId: string) => PaneSignals | null

/** Fold each launched node's pane signals into the AgentState record planTick
 *  consumes. Nodes without a paneId (queued/gates) are omitted so
 *  syncNodeStates leaves them untouched; an unfindable pane is skipped too. */
export function sampleGraph(run: GraphRun, sample: PaneSampler, now: number): Record<string, AgentState> {
  const out: Record<string, AgentState> = {}
  for (const [id, rt] of Object.entries(run.nodes)) {
    if (!rt.paneId) continue
    const sig = sample(rt.paneId)
    if (!sig) continue
    out[id] = deriveAgentState({ ...sig, now })
  }
  return out
}

/** Model ids in practice are alphanumerics plus `. _ - / :`. Anything with a
 *  space or shell metacharacter is unsafe (the command is written to a shell)
 *  and drops the flag rather than emitting an injectable command — same guard
 *  as src/lib/launch-cmd.ts, kept here so electron stays self-contained. */
const SAFE_MODEL = /^[A-Za-z0-9._:/-]+$/

/** Headless invocation shape for an agent CLI. `argv` receives the shell
 *  expression that yields the composed prompt (read from a file, see
 *  `launchCommand`) plus the already-validated model tokens (`['--model', m]`
 *  or `[]`), and returns the CLI's argument list after the binary name.
 *
 *  Only agents with a VERIFIED unattended (print/exec + skip-permissions) mode
 *  are listed — an omitted agent yields '' so the caller skips it rather than
 *  spawning an interactive TUI that would stall the run (never reaches 'done',
 *  never writes its artifact). gemini/copilot/opencode: TODO once their
 *  headless flags are confirmed in a live smoke. */
interface HeadlessSpec {
  bin: string
  argv: (promptExpr: string, modelTokens: string[]) => string[]
}
const HEADLESS: Partial<Record<WorkerAgent, HeadlessSpec>> = {
  // claude -p "<prompt>" --dangerously-skip-permissions  (prompt is -p's value,
  // so it must come right after -p; model tokens go last).
  claude: { bin: 'claude', argv: (p, m) => ['-p', p, '--dangerously-skip-permissions', ...m] },
  // codex exec <flags> "<prompt>"  (exec = non-interactive subcommand; prompt
  // is the trailing positional, so model tokens go before it).
  codex: { bin: 'codex', argv: (p, m) => ['exec', '--dangerously-bypass-approvals-and-sandbox', ...m, p] },
}

/** Single-quote a string for a POSIX shell: wrap in '…' and turn each embedded
 *  ' into '\'' (close-quote, escaped-quote, reopen). */
function sqPosix(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`
}

/** Single-quote a string for PowerShell: wrap in '…' and double each ' . */
function sqPowershell(s: string): string {
  return `'${s.replace(/'/g, `''`)}'`
}

/** The shell command that launches an agent node HEADLESS: it reads the
 *  composed handoff prompt from `promptPath` (main writes it before spawning,
 *  so a multi-KB multi-line prompt never has to be typed into the pty) and
 *  runs the CLI unattended, replacing the shell so the pty closes with the
 *  CLI's own exit code — that's what lets `deriveAgentState` reach 'done' and
 *  what surfaces a real exit code for the failed path.
 *
 *  A missing/custom/headless-incapable agent → '' (the caller skips the launch
 *  and writes no prompt file); an unsafe model degrades to no `--model` flag. */
export function launchCommand(
  action: Pick<StartAction, 'agent' | 'model'>,
  opts: { promptPath: string; isWin: boolean },
): string {
  const agent = action.agent
  if (!agent) return ''
  const spec = HEADLESS[agent]
  if (!spec) return ''

  const modelTokens = action.model && SAFE_MODEL.test(action.model) ? ['--model', action.model] : []
  if (opts.isWin) {
    // PowerShell: `& cli … ; exit $LASTEXITCODE` — `&` invokes, and the trailing
    // exit closes the shell with the CLI's exit code so the pty terminates.
    const promptExpr = `(Get-Content -Raw ${sqPowershell(opts.promptPath)})`
    return `& ${spec.bin} ${spec.argv(promptExpr, modelTokens).join(' ')}; exit $LASTEXITCODE`
  }
  // POSIX: `exec` replaces the shell so the CLI's exit code becomes the pty's.
  const promptExpr = `"$(cat ${sqPosix(opts.promptPath)})"`
  return `exec ${spec.bin} ${spec.argv(promptExpr, modelTokens).join(' ')}`
}
