// Live-ish smoke for the graph eval-loop (capa ①). This is NOT a unit test of a
// single function — it drives the REAL orchestrator (`planTick`), the REAL
// persistence round-trip (`GraphRunStore` on a real temp file), and REAL
// filesystem artifact handoff over a real temp worktree. The only fake is the
// AGENT: instead of spawning `claude`/`codex` PTYs, a deterministic in-process
// "agent" writes the real `.nest/graph/*` artifacts each node would produce.
//
// It proves the end-to-end behaviour that no unit test covers on its own:
//   1. auto mode: a blocking reviewer verdict rewinds the coder, the re-run
//      makes the verdict clean, the gate passes, the tester runs, the run
//      completes — the whole self-heal loop against a real filesystem.
//   2. gate mode: a blocking reviewer holds the gate for a human; a queued
//      `approve` decision (single-writer) unblocks it and the run completes.
//
// Run it and watch the trace:
//   npx vitest run electron/__tests__/graph-eval-loop.smoke.test.ts
import { describe, it, expect } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'fs'
import { tmpdir } from 'os'
import { join, dirname } from 'path'
import { planTick, dedupePersistentSignals } from '../integrations/graph-orchestrator'
import { artifactPath } from '../integrations/graph-handoff'
import { GraphRunStore } from '../integrations/graph-run-store'
import type { GraphTemplate, GraphNode } from '../integrations/graph-template'
import type { GraphRun, GraphMode, NodeRuntime } from '../integrations/graph-runner'
import type { StartAction } from '../integrations/graph-orchestrator'
import type { AgentState } from '../integrations/agent-status'

// architect → coder → rev(security) → gate → tester(leaf)
const TEMPLATE: GraphTemplate = {
  id: 'smoke', name: 'smoke', createdAt: 0, updatedAt: 0,
  nodes: [
    { id: 'architect', role: 'architect', kind: 'agent', agent: 'claude', dependsOn: [] },
    { id: 'coder', role: 'coder', kind: 'agent', agent: 'codex', dependsOn: ['architect'] },
    { id: 'rev', role: 'reviewer', kind: 'agent', agent: 'claude', focus: 'security', dependsOn: ['coder'] },
    { id: 'gate', role: 'gate', kind: 'gate', dependsOn: ['rev'] },
    { id: 'tester', role: 'tester', kind: 'agent', agent: 'claude', dependsOn: ['gate'] },
  ],
}

function nodeById(id: string): GraphNode {
  return TEMPLATE.nodes.find((n) => n.id === id)!
}

// The deterministic "agent": writes the real artifact a node's CLI would leave.
// The reviewer blocks until it sees the coder's FIXED marker (i.e. until the
// re-run happened), exactly what a real security reviewer would do.
function runFakeAgent(worktree: string, action: StartAction, counts: Record<string, number>): void {
  const node = nodeById(action.nodeId)
  counts[action.nodeId] = (counts[action.nodeId] ?? 0) + 1
  const write = (rel: string, content: string) => {
    const abs = join(worktree, rel)
    mkdirSync(dirname(abs), { recursive: true })
    writeFileSync(abs, content)
  }
  if (node.role === 'architect') {
    write(artifactPath(node), '# plan\n1. wrap retries\n2. keep idempotency safe')
  } else if (node.role === 'coder') {
    const revised = action.input.includes('Revision requested')
    write(artifactPath(node), revised ? 'coder: FIXED — per-attempt idempotency key' : 'coder: initial retry loop')
  } else if (node.role === 'reviewer') {
    const coder = (() => { try { return readFileSync(join(worktree, artifactPath(nodeById('coder'))), 'utf8') } catch { return '' } })()
    const clean = coder.includes('FIXED')
    const verdict = clean
      ? { concerns: [], blocking: false }
      : { concerns: ['idempotency key reused across retries → double-charge'], blocking: true }
    write(artifactPath(node), JSON.stringify(verdict))
  } else if (node.role === 'tester') {
    write(artifactPath(node), 'tester: 12 passed')
  }
}

interface DriveResult { run: GraphRun; ticks: number; counts: Record<string, number>; completed: boolean }

// Reconstructs main.ts's graphOrchestratorTick loop headlessly: sample → plan →
// run started agents → persist round-trip → repeat. `onTick` lets a scenario
// inject a human decision (single-writer: it sets pendingDecision on the run).
function drive(
  mode: GraphMode,
  onTick?: (plan: ReturnType<typeof planTick>, store: GraphRunStore) => void,
  maxTicks = 40,
): DriveResult {
  const worktree = mkdtempSync(join(tmpdir(), 'graph-smoke-wt-'))
  const store = new GraphRunStore(join(mkdtempSync(join(tmpdir(), 'graph-smoke-store-')), 'graph-runs.json'))
  const readArtifact = (wt: string, rel: string): string | null => {
    try { return readFileSync(join(wt, rel), 'utf8') } catch { return null }
  }
  const nodes: Record<string, NodeRuntime> = {}
  for (const n of TEMPLATE.nodes) nodes[n.id] = { state: 'queued' }
  let run: GraphRun = {
    runId: 'run-smoke', ticketId: 'T-482', templateId: TEMPLATE.id, worktreePath: worktree,
    branch: 'feat/482', startedAt: 0, mode, round: 0, nodes,
  }
  store.save(run, [])
  const counts: Record<string, number> = {}
  let pendingDone = new Set<string>() // nodes started last tick → 'done' this tick
  let seen: string[] = []

  for (let tick = 1; tick <= maxTicks; tick++) {
    const samples: Record<string, AgentState> = {}
    for (const id of pendingDone) samples[id] = 'done'

    const plan = planTick(TEMPLATE, run, samples, { now: tick, readArtifact, maxReviewRounds: 2 })

    // Trace line so the run is watchable. process.stdout.write bypasses vitest's
    // console interception so the trace shows in a normal `vitest run`.
    const states = TEMPLATE.nodes.map((n) => `${n.id}:${plan.run.nodes[n.id].state}`).join(' ')
    const started = plan.start.map((s) => s.nodeId).join(',') || '-'
    const evs = plan.events.map((e) => e.type.replace('graph.', '')).join(',') || '-'
    process.stdout.write(`tick ${String(tick).padStart(2)} | round ${plan.run.round} | start:${started} | ${states}${plan.blockedOn.length ? ` | blockedOn:${plan.blockedOn.join(',')}` : ''}${evs !== '-' ? ` | ev:${evs}` : ''}\n`)

    for (const action of plan.start) runFakeAgent(worktree, action, counts)
    pendingDone = new Set(plan.start.map((a) => a.nodeId))

    const { seen: nextSeen } = dedupePersistentSignals(plan.events, new Set(seen))
    seen = [...nextSeen]
    store.save(plan.run, seen)

    // A scenario may queue a human decision here (writes pendingDecision to the
    // store), so reload AFTER onTick — that's the persistence round-trip the next
    // tick reads, and it must include any queued decision (single-writer).
    onTick?.(plan, store)
    run = store.get(run.runId)!.run

    if (plan.completed) return { run, ticks: tick, counts, completed: true }
  }
  return { run, ticks: maxTicks, counts, completed: false }
}

describe('graph eval-loop live smoke', () => {
  it('auto mode: blocking review → auto-repair re-runs coder → converges → completes', () => {
    process.stdout.write('\n── SCENARIO A: auto mode, self-heal ──\n')
    const { run, counts, completed } = drive('auto')
    expect(completed).toBe(true)                 // the run finished on its own
    expect(counts.coder).toBe(2)                 // ran once, blocked, re-ran once
    expect(counts.rev).toBe(2)                   // reviewed the block and the fix
    expect(counts.tester).toBe(1)                // gate passed → tester ran
    expect(run.round).toBe(1)                    // exactly one auto-repair round
    expect(run.nodes.tester.state).toBe('done')
  })

  it('gate mode: blocking review holds the gate → human approve unblocks → completes', () => {
    process.stdout.write('\n── SCENARIO B: gate mode, human approve ──\n')
    let approved = false
    const { run, counts, completed } = drive('gate', (plan, store) => {
      // The gate is held for a human (blockedOn). Queue an approve decision the
      // way the IPC handler would — the tick applies it (single-writer).
      if (!approved && plan.blockedOn.includes('gate')) {
        const p = store.get('run-smoke')!
        store.save({ ...p.run, pendingDecision: { kind: 'approve', gateId: 'gate' } }, p.seen)
        approved = true
        process.stdout.write('       ↳ human queued: approve gate\n')
      }
    })
    expect(completed).toBe(true)
    expect(approved).toBe(true)                  // we actually hit the held gate
    expect(counts.coder).toBe(1)                 // no auto-repair in gate mode
    expect(run.nodes.gate.state).toBe('done')
    expect(run.nodes.tester.state).toBe('done')
  })
})
