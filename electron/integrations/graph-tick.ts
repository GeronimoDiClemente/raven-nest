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

/** Agent → CLI binary. Mirrors AI_CONFIG.cmd in src/types.ts (the renderer's
 *  launcher). 'custom' has no fixed command and is skipped. */
export const AGENT_CLI: Record<Exclude<WorkerAgent, 'custom'>, string> = {
  claude: 'claude',
  gemini: 'gemini',
  codex: 'codex',
  copilot: 'copilot',
  opencode: 'opencode',
}

/** The shell command that launches an agent node's interactive CLI, with an
 *  optional `--model` flag. A missing/custom agent → '' (the caller skips the
 *  launch); an unsafe model degrades to the bare command. */
export function launchCommand(action: Pick<StartAction, 'agent' | 'model'>): string {
  const agent = action.agent
  if (!agent || agent === 'custom') return ''
  const base = AGENT_CLI[agent]
  if (!base) return ''
  if (action.model && SAFE_MODEL.test(action.model)) return `${base} --model ${action.model}`
  return base
}
