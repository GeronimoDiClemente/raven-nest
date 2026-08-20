// Graph-run store: persists the live GraphRun of each active ticket-graph plus
// its per-run dedup `seen` set (the keys dedupePersistentSignals uses so a gate
// that stays blocked / a node that stays needs_input isn't re-notified every
// tick). Same validated/atomic/versioned-JSON pattern as worker-spec-store.ts
// and worktree-signals' saveNotified — the orchestrator tick in main.ts owns
// the effects, this only remembers state across restarts.
import { readFileSync, writeFileSync, mkdirSync, renameSync } from 'fs'
import { dirname, join } from 'path'
import { randomBytes } from 'crypto'
import { ravenHome } from '../raven-home'
import type { GraphRun, NodeRuntime, NodeRunState } from './graph-runner'

/** A persisted graph run: the run itself + the dedup keys already notified. */
export interface PersistedGraphRun {
  run: GraphRun
  seen: string[]
}

const NODE_STATES: NodeRunState[] = [
  'queued', 'running', 'needs_input', 'blocked', 'done', 'failed', 'skipped',
]

function toNodeRuntime(x: unknown): NodeRuntime | null {
  if (!x || typeof x !== 'object') return null
  const r = x as Record<string, unknown>
  if (typeof r.state !== 'string' || !NODE_STATES.includes(r.state as NodeRunState)) return null
  const out: NodeRuntime = { state: r.state as NodeRunState }
  if (typeof r.paneId === 'string') out.paneId = r.paneId
  if (typeof r.startedAt === 'number') out.startedAt = r.startedAt
  if (typeof r.endedAt === 'number') out.endedAt = r.endedAt
  if (typeof r.summary === 'string') out.summary = r.summary
  if (typeof r.artifact === 'string') out.artifact = r.artifact
  if (r.verdict && typeof r.verdict === 'object') {
    const v = r.verdict as Record<string, unknown>
    if (typeof v.blocking === 'boolean') {
      out.verdict = {
        blocking: v.blocking,
        concerns: Array.isArray(v.concerns) ? v.concerns.filter((c): c is string => typeof c === 'string') : [],
      }
    }
  }
  if (typeof r.exitCode === 'number') out.exitCode = r.exitCode
  return out
}

/** Validate a GraphRun loaded from disk (`unknown` → typed | null). Required:
 *  runId/ticketId/templateId/worktreePath/branch (string), startedAt (number),
 *  and a nodes record of valid NodeRuntimes. A single malformed node drops the
 *  whole run (its state is meaningless without every node) — same "drop the
 *  record, never crash the file" contract as worker-spec-store's toWorkerSpec. */
function toGraphRun(x: unknown): GraphRun | null {
  if (!x || typeof x !== 'object') return null
  const r = x as Record<string, unknown>
  if (typeof r.runId !== 'string' || typeof r.ticketId !== 'string') return null
  if (typeof r.templateId !== 'string' || typeof r.worktreePath !== 'string') return null
  if (typeof r.branch !== 'string' || typeof r.startedAt !== 'number') return null
  if (!r.nodes || typeof r.nodes !== 'object') return null
  const nodes: Record<string, NodeRuntime> = {}
  for (const [id, raw] of Object.entries(r.nodes as Record<string, unknown>)) {
    const rt = toNodeRuntime(raw)
    if (!rt) return null
    nodes[id] = rt
  }
  const mode = r.mode === 'gate' || r.mode === 'step' ? r.mode : 'auto'
  const out: GraphRun = {
    runId: r.runId, ticketId: r.ticketId, templateId: r.templateId,
    worktreePath: r.worktreePath, branch: r.branch, startedAt: r.startedAt,
    nodes, mode, round: typeof r.round === 'number' ? r.round : 0,
  }
  if (r.revisionNotes && typeof r.revisionNotes === 'object') {
    const rn: Record<string, string> = {}
    for (const [k, v] of Object.entries(r.revisionNotes as Record<string, unknown>)) if (typeof v === 'string') rn[k] = v
    out.revisionNotes = rn
  }
  const pd = r.pendingDecision as Record<string, unknown> | undefined
  if (pd && (pd.kind === 'approve' && typeof pd.gateId === 'string')) out.pendingDecision = { kind: 'approve', gateId: pd.gateId }
  else if (pd && (pd.kind === 'requestChanges' && typeof pd.feedback === 'string')) out.pendingDecision = { kind: 'requestChanges', feedback: pd.feedback }
  return out
}

function toPersistedGraphRun(x: unknown): PersistedGraphRun | null {
  if (!x || typeof x !== 'object') return null
  const r = x as Record<string, unknown>
  const run = toGraphRun(r.run)
  if (!run) return null
  const seen = Array.isArray(r.seen) ? r.seen.filter((s): s is string => typeof s === 'string') : []
  return { run, seen }
}

/** Load persisted runs. Missing file → `[]` (first run, no crash). Corrupt JSON
 *  → warn + `[]`. Invalid entries are dropped individually with a warn. */
export function loadGraphRuns(filePath: string): PersistedGraphRun[] {
  let raw: string
  try {
    raw = readFileSync(filePath, 'utf8')
  } catch {
    return []
  }
  try {
    const data = JSON.parse(raw) as { runs?: unknown }
    const list = Array.isArray(data.runs) ? data.runs : []
    const out: PersistedGraphRun[] = []
    let dropped = 0
    for (const item of list) {
      const p = toPersistedGraphRun(item)
      if (p) out.push(p)
      else dropped++
    }
    if (dropped > 0) console.warn('[graph-run] discarded', dropped, 'invalid graph runs from', filePath)
    return out
  } catch (err) {
    console.warn('[graph-run] graph-runs.json unreadable, using empty list', err)
    return []
  }
}

/** Atomic write (tmp + rename), same pattern as worker-spec-store. Best-effort:
 *  a disk failure logs a warn instead of throwing into the caller (the tick). */
export function saveGraphRuns(filePath: string, runs: PersistedGraphRun[]): void {
  try {
    mkdirSync(dirname(filePath), { recursive: true })
    const tmp = `${filePath}.${randomBytes(6).toString('hex')}.tmp`
    writeFileSync(tmp, JSON.stringify({ version: 1, runs }, null, 2))
    renameSync(tmp, filePath)
  } catch (err) {
    console.warn('[graph-run] graph-runs.json write failed', err)
  }
}

export function defaultGraphRunPath(): string {
  return join(ravenHome(), '.raven-nest', 'graph-runs.json')
}

export class GraphRunStore {
  constructor(private filePath: string = defaultGraphRunPath()) {}

  list(): PersistedGraphRun[] {
    return loadGraphRuns(this.filePath)
  }

  get(runId: string): PersistedGraphRun | null {
    return this.list().find((p) => p.run.runId === runId) ?? null
  }

  getByTicket(ticketId: string): PersistedGraphRun | null {
    return this.list().find((p) => p.run.ticketId === ticketId) ?? null
  }

  save(run: GraphRun, seen: string[]): PersistedGraphRun {
    const runs = this.list()
    const entry: PersistedGraphRun = { run, seen }
    const idx = runs.findIndex((p) => p.run.runId === run.runId)
    if (idx >= 0) runs[idx] = entry
    else runs.push(entry)
    saveGraphRuns(this.filePath, runs)
    return entry
  }

  delete(runId: string): boolean {
    const runs = this.list()
    const next = runs.filter((p) => p.run.runId !== runId)
    saveGraphRuns(this.filePath, next)
    return next.length !== runs.length
  }
}
