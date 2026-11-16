// REAL live smoke for the graph eval-loop: drives the REAL orchestrator with
// REAL `claude` agents (spawned headless via `claude -p`) writing REAL artifacts
// on a REAL temp worktree. This is the true end-to-end smoke the plan/spec called
// out — a real LLM in the loop, so we see whether it produces a parseable
// {concerns, blocking} verdict and whether the loop converges / escalates.
//
// Gated behind GRAPH_LIVE_SMOKE=1 so `npm test` skips it (it costs tokens + time,
// needs an authenticated `claude` CLI on PATH, and is non-deterministic). Run:
//   GRAPH_LIVE_SMOKE=1 npx vitest run electron/__tests__/graph-eval-loop.live.test.ts
import { describe, it, expect } from 'vitest'
import { spawnSync } from 'child_process'
import { mkdtempSync, existsSync, readFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { planTick, dedupePersistentSignals } from '../integrations/graph-orchestrator'
import { artifactPath } from '../integrations/graph-handoff'
import { GraphRunStore } from '../integrations/graph-run-store'
import type { GraphTemplate, GraphNode } from '../integrations/graph-template'
import type { GraphRun, NodeRuntime } from '../integrations/graph-runner'
import type { StartAction } from '../integrations/graph-orchestrator'
import type { AgentState } from '../integrations/agent-status'

const LIVE = process.env.GRAPH_LIVE_SMOKE === '1'

// coder → rev(security) → gate → tester. Minimal so real agents finish fast.
const TEMPLATE: GraphTemplate = {
  id: 'live', name: 'live', createdAt: 0, updatedAt: 0,
  nodes: [
    {
      id: 'coder', role: 'coder', kind: 'agent', agent: 'claude', dependsOn: [],
      instructions: 'Create a file `add.js` in the current working directory that exports an add function: `module.exports = { add: (a, b) => a + b }`. Keep it minimal — just that one file.',
    },
    { id: 'rev', role: 'reviewer', kind: 'agent', agent: 'claude', focus: 'security', dependsOn: ['coder'] },
    { id: 'gate', role: 'gate', kind: 'gate', dependsOn: ['rev'] },
    {
      id: 'tester', role: 'tester', kind: 'agent', agent: 'claude', dependsOn: ['gate'],
      instructions: 'Check that add.js exists in the current directory and is syntactically valid JavaScript. Reply with PASS or FAIL and one line why.',
    },
  ],
}
const nodeById = (id: string): GraphNode => TEMPLATE.nodes.find((n) => n.id === id)!

// Spawn a REAL claude agent headless. Blocks until it exits (mirrors a pane's
// process finishing). Records the exit code so planTick's exit-code pass can see
// a crash. The reviewer's verdict file (if any) is read later by the orchestrator.
function runRealAgent(worktree: string, action: StartAction, exitCodes: Record<string, number>): void {
  const node = nodeById(action.nodeId)
  const rel = artifactPath(node)
  const isLeaf = !TEMPLATE.nodes.some((n) => n.dependsOn.includes(node.id))
  const writeHint = isLeaf ? '' : `\n\nWhen done, WRITE your handoff to '${rel}' (relative to the current directory) using your file-writing tool.`
  const prompt = `${action.input}${writeHint}\n\n(You are running non-interactively via 'claude -p'. Do the task NOW with your tools. Do not ask questions.)`
  const t0 = Date.now()
  const res = spawnSync('claude', ['-p', prompt, '--dangerously-skip-permissions'], {
    cwd: worktree, timeout: 180_000, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024,
  })
  exitCodes[action.paneId] = res.status ?? 1
  const wrote = existsSync(join(worktree, rel)) ? `wrote ${rel}` : 'no artifact'
  process.stdout.write(`   · ${action.nodeId} → claude exit=${res.status} (${Math.round((Date.now() - t0) / 1000)}s) ${wrote}\n`)
}

describe.skipIf(!LIVE)('graph eval-loop LIVE smoke (real claude agents)', () => {
  it('drives real claude through the loop to a terminal state', () => {
    const worktree = mkdtempSync(join(tmpdir(), 'graph-live-wt-'))
    const store = new GraphRunStore(join(mkdtempSync(join(tmpdir(), 'graph-live-store-')), 'graph-runs.json'))
    const readArtifact = (wt: string, rel: string): string | null => {
      try { return readFileSync(join(wt, rel), 'utf8') } catch { return null }
    }
    const nodes: Record<string, NodeRuntime> = {}
    for (const n of TEMPLATE.nodes) nodes[n.id] = { state: 'queued' }
    let run: GraphRun = {
      runId: 'run-live', ticketId: 'T-live', templateId: TEMPLATE.id, worktreePath: worktree,
      branch: 'feat/live', startedAt: 0, mode: 'auto', round: 0, nodes,
    }
    store.save(run, [])
    process.stdout.write(`\n── LIVE smoke · worktree ${worktree} ──\n`)

    const exitCodes: Record<string, number> = {}
    let pendingDone = new Set<string>()
    let seen: string[] = []
    let outcome: 'completed' | 'escalated' | 'timeout' = 'timeout'

    for (let tick = 1; tick <= 16; tick++) {
      const samples: Record<string, AgentState> = {}
      for (const id of pendingDone) samples[id] = 'done'
      const plan = planTick(TEMPLATE, run, samples, {
        now: tick, readArtifact, maxReviewRounds: 1,
        exitCode: (paneId) => exitCodes[paneId] ?? null,
      })

      const states = TEMPLATE.nodes.map((n) => `${n.id}:${plan.run.nodes[n.id].state}`).join(' ')
      const started = plan.start.map((s) => s.nodeId).join(',') || '-'
      const evs = plan.events.map((e) => e.type.replace('graph.', '')).join(',') || '-'
      process.stdout.write(`tick ${String(tick).padStart(2)} | round ${plan.run.round} | start:${started} | ${states}${plan.blockedOn.length ? ` | blockedOn:${plan.blockedOn.join(',')}` : ''}${evs !== '-' ? ` | ev:${evs}` : ''}\n`)

      for (const action of plan.start) runRealAgent(worktree, action, exitCodes)
      pendingDone = new Set(plan.start.map((a) => a.nodeId))

      const { seen: nextSeen } = dedupePersistentSignals(plan.events, new Set(seen))
      seen = [...nextSeen]
      store.save(plan.run, seen)
      run = store.get(run.runId)!.run

      if (plan.completed) { outcome = 'completed'; break }
      if (plan.events.some((e) => e.type === 'graph.escalated')) { outcome = 'escalated'; break }
    }

    // Print the final verdict the real reviewer wrote, for inspection.
    const revArtifact = readArtifact(worktree, artifactPath(nodeById('rev')))
    process.stdout.write(`\n── outcome: ${outcome} · reviewer verdict: ${revArtifact ? revArtifact.slice(0, 200) : '(none written)'} ──\n`)

    // Non-deterministic real LLM: the meaningful assertion is that the loop
    // reached a TERMINAL state (converged or escalated) rather than hanging.
    expect(outcome === 'completed' || outcome === 'escalated').toBe(true)
  }, 600_000)
})
