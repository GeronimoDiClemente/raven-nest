// Worker-spec store: a reusable named config `{agents, model, effort,
// instructions}` describing how a type of task is run. Persistence-only for
// now (UI/IPC come later) — same validated/atomic/versioned-JSON pattern as
// scheduler.ts's loadAutomations/saveAutomations and recipes.ts.
import { readFileSync, writeFileSync, mkdirSync, renameSync } from 'fs'
import { dirname, join } from 'path'
import { randomBytes } from 'crypto'
import { ravenHome } from '../raven-home'

export type WorkerAgent = 'claude' | 'gemini' | 'codex' | 'copilot' | 'opencode' | 'custom'

export interface WorkerStep {
  agent: WorkerAgent
  customCliId?: string
  model?: string
  effort?: 'low' | 'medium' | 'high'
  instructions?: string
  role?: string
  /** Saved CLI account to launch this step with (bypasses the account picker
   *  at run time). Unset = ask at launch, same as before this field existed. */
  account?: string
}

export interface WorkerSpec {
  id: string
  name: string
  description?: string
  steps: WorkerStep[]
  createdAt: number
  updatedAt: number
}

const VALID_AGENTS: WorkerAgent[] = ['claude', 'gemini', 'codex', 'copilot', 'opencode', 'custom']

function toStep(x: unknown): WorkerStep | null {
  if (!x || typeof x !== 'object') return null
  const r = x as Record<string, unknown>
  if (typeof r.agent !== 'string' || !VALID_AGENTS.includes(r.agent as WorkerAgent)) return null
  const out: WorkerStep = { agent: r.agent as WorkerAgent }
  if (typeof r.customCliId === 'string') out.customCliId = r.customCliId
  if (typeof r.model === 'string') out.model = r.model
  if (r.effort === 'low' || r.effort === 'medium' || r.effort === 'high') out.effort = r.effort
  if (typeof r.instructions === 'string') out.instructions = r.instructions
  if (typeof r.role === 'string') out.role = r.role
  if (typeof r.account === 'string') out.account = r.account
  return out
}

/** Validates a worker spec loaded from disk (`unknown`), or null if invalid.
 *  Required: id/name (string) + steps (non-empty array of valid steps).
 *  Malformed individual steps are dropped, not the whole spec — but a spec
 *  left with zero steps afterward is dropped too (same contract as
 *  scheduler.ts's toAutomation: drop the record, never crash the whole file). */
function toWorkerSpec(x: unknown): WorkerSpec | null {
  if (!x || typeof x !== 'object') return null
  const r = x as Record<string, unknown>
  if (typeof r.id !== 'string' || typeof r.name !== 'string' || !Array.isArray(r.steps)) return null
  const steps = r.steps.map(toStep).filter((s): s is WorkerStep => s !== null)
  if (steps.length === 0) return null
  const out: WorkerSpec = {
    id: r.id,
    name: r.name,
    steps,
    createdAt: typeof r.createdAt === 'number' ? r.createdAt : 0,
    updatedAt: typeof r.updatedAt === 'number' ? r.updatedAt : 0,
  }
  if (typeof r.description === 'string') out.description = r.description
  return out
}

/**
 * Loads worker specs from disk. Missing file → `[]` (first run, no crash).
 * Corrupt JSON → warn + `[]`. Entries with an invalid shape are dropped
 * individually (with a warn) instead of discarding the whole file — same
 * robustness contract as scheduler.ts's loadAutomations.
 */
export function loadWorkerSpecs(filePath: string): WorkerSpec[] {
  let raw: string
  try {
    raw = readFileSync(filePath, 'utf8')
  } catch {
    return []
  }
  try {
    const data = JSON.parse(raw) as { workers?: unknown }
    const list = Array.isArray(data.workers) ? data.workers : []
    const out: WorkerSpec[] = []
    let dropped = 0
    for (const item of list) {
      const w = toWorkerSpec(item)
      if (w) out.push(w)
      else dropped++
    }
    if (dropped > 0) console.warn('[worker-spec] discarded', dropped, 'invalid worker specs from', filePath)
    return out
  } catch (err) {
    console.warn('[worker-spec] worker-specs.json unreadable, using empty list', err)
    return []
  }
}

/** Atomic write (tmp + rename), same pattern as scheduler.ts/recipes.ts: a
 *  crash mid-write never corrupts worker-specs.json. Best-effort: a disk
 *  failure logs a warn instead of throwing into the caller (an IPC handler). */
export function saveWorkerSpecs(filePath: string, workers: WorkerSpec[]): void {
  try {
    mkdirSync(dirname(filePath), { recursive: true })
    const tmp = `${filePath}.${randomBytes(6).toString('hex')}.tmp`
    writeFileSync(tmp, JSON.stringify({ version: 1, workers }, null, 2))
    renameSync(tmp, filePath)
  } catch (err) {
    console.warn('[worker-spec] worker-specs.json write failed', err)
  }
}

/** Short random id for a new worker spec — same shape as scheduler.ts's
 *  newAutomationId / the OAuth state ids main.ts already generates. */
export function newWorkerSpecId(): string {
  return randomBytes(8).toString('hex')
}

export function defaultWorkerSpecPath(): string {
  return join(ravenHome(), '.raven-nest', 'worker-specs.json')
}

export class WorkerSpecStore {
  constructor(private filePath: string = defaultWorkerSpecPath()) {}

  list(): WorkerSpec[] {
    return loadWorkerSpecs(this.filePath)
  }

  save(spec: WorkerSpec): WorkerSpec {
    const specs = this.list()
    const idx = specs.findIndex((s) => s.id === spec.id)
    if (idx >= 0) specs[idx] = spec
    else specs.push(spec)
    saveWorkerSpecs(this.filePath, specs)
    return spec
  }

  delete(id: string): boolean {
    const specs = this.list()
    const next = specs.filter((s) => s.id !== id)
    saveWorkerSpecs(this.filePath, next)
    return next.length !== specs.length
  }
}
