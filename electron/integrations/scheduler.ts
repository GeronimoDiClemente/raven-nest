// Epic C (H11) — scheduled agents: run a prompt on a schedule. Reactivates the
// bus's declared-but-unhandled `scheduleBlock` command / `block.started` event
// (see bus-commands.ts). Pure + DI, same shape as recipes.ts: plain functions
// for persistence/parsing (no Electron, no argless `Date.now()`/`new Date()` —
// every entry point takes the reference time as a parameter so tests are
// deterministic), plus one small `Scheduler` class for the tick loop. The real
// headless run (ephemeral worktree + CLI) is injected via `RunAutomationFn` —
// main.ts wires it; this module never spawns a process itself.
import { randomBytes } from 'crypto'
import { readFileSync, writeFileSync, mkdirSync, renameSync } from 'fs'
import { dirname } from 'path'
import type { BlockStartedEvent } from './bus-types'

export interface Automation {
  id: string
  name: string
  /** Preset keyword (`hourly`/`daily`/`weekdays`/`weekly`) or a raw 5-field
   *  cron string ("min hour dom month dow", e.g. `0 18 * * 1-5`). */
  trigger: string
  /** "HH:MM", used by the daily/weekdays/weekly presets. Ignored by `hourly`
   *  and by raw-cron triggers (the cron string already encodes the time). */
  time?: string
  /** IANA zone name. Persisted/round-tripped but NOT used to shift `nextRun`
   *  — see the timezone note on `nextRun` below. */
  timezone?: string
  prompt: string
  repo?: string
  provider?: string
  /** References a saved worker-spec (electron/integrations/worker-spec-store.ts)
   *  to resolve model/effort/instructions from. `model`/`effort` below, when
   *  set, take precedence (inline override of the referenced worker's first step). */
  workerId?: string
  model?: string
  effort?: 'low' | 'medium' | 'high'
  enabled: boolean
  createdAt: number
  updatedAt: number
  lastRunAt?: number
  lastResult?: 'ok' | 'error'
  lastSummary?: string
}

// ── Trigger parsing (presets + raw cron) ────────────────────────────────────

export type CronField = '*' | number[]

export interface CronExpr {
  minute: CronField
  hour: CronField
  dom: CronField
  month: CronField
  dow: CronField
}

const PRESET_TRIGGERS = ['hourly', 'daily', 'weekdays', 'weekly'] as const
export type PresetTrigger = (typeof PRESET_TRIGGERS)[number]

export const DEFAULT_TIME = '09:00'

function isPresetTrigger(trigger: string): trigger is PresetTrigger {
  return (PRESET_TRIGGERS as readonly string[]).includes(trigger)
}

function parseTimeOfDay(time: string | undefined): { hour: number; minute: number } {
  const raw = (time ?? DEFAULT_TIME).trim()
  const m = /^(\d{1,2}):(\d{2})$/.exec(raw)
  if (!m) return { hour: 9, minute: 0 }
  const hour = Number(m[1])
  const minute = Number(m[2])
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return { hour: 9, minute: 0 }
  return { hour, minute }
}

/**
 * Parses one raw cron field ("*", "5", "1-5", "0,30", "*\/15", or a comma list
 * of any of those) into a sorted, deduped list of allowed values, or `'*'` for
 * an unconstrained field. Returns null for anything malformed or out of
 * `[min, max]` — callers treat that as "invalid trigger", never throw.
 */
function parseCronField(raw: string, min: number, max: number): CronField | null {
  const trimmed = raw.trim()
  if (!trimmed) return null
  if (trimmed === '*') return '*'
  const values = new Set<number>()
  for (const part of trimmed.split(',')) {
    const m = /^(\*|\d+-\d+|\d+)(?:\/(\d+))?$/.exec(part.trim())
    if (!m) return null
    const [, base, stepRaw] = m
    const step = stepRaw ? Number(stepRaw) : 1
    if (!Number.isInteger(step) || step <= 0) return null
    let start: number
    let end: number
    if (base === '*') {
      start = min
      end = max
    } else if (base.includes('-')) {
      const [a, b] = base.split('-').map(Number)
      start = a
      end = b
    } else {
      start = end = Number(base)
    }
    if (!Number.isInteger(start) || !Number.isInteger(end) || start > end) return null
    if (start < min || end > max) return null
    for (let v = start; v <= end; v += step) values.add(v)
  }
  if (values.size === 0) return null
  return [...values].sort((a, b) => a - b)
}

/**
 * Resolves an automation's `trigger` (+ `time`) into a normalized 5-field cron
 * expression. Presets are sugar over specific field combinations; anything
 * else is parsed as a raw 5-field cron string ("min hour dom month dow"), e.g.
 * `0 18 * * 1-5`. Returns null for anything that doesn't parse — `nextRun`
 * treats that as "never runs" instead of throwing, so one bad trigger string
 * degrades safely instead of crashing the scheduler tick for every automation.
 *
 * `weekly` has no day-of-week field in the v1 model (the UI only offers a
 * time picker) — it always resolves to Monday. An automation that needs a
 * different day should use a raw cron trigger instead (e.g. `0 9 * * 3` for
 * Wednesday).
 */
export function parseTrigger(automation: Pick<Automation, 'trigger' | 'time'>): CronExpr | null {
  const { trigger, time } = automation
  if (isPresetTrigger(trigger)) {
    if (trigger === 'hourly') return { minute: [0], hour: '*', dom: '*', month: '*', dow: '*' }
    const { hour, minute } = parseTimeOfDay(time)
    if (trigger === 'daily') return { minute: [minute], hour: [hour], dom: '*', month: '*', dow: '*' }
    if (trigger === 'weekdays') return { minute: [minute], hour: [hour], dom: '*', month: '*', dow: [1, 2, 3, 4, 5] }
    return { minute: [minute], hour: [hour], dom: '*', month: '*', dow: [1] } // weekly → Monday
  }
  const fields = trigger.trim().split(/\s+/)
  if (fields.length !== 5) return null
  const minute = parseCronField(fields[0], 0, 59)
  const hour = parseCronField(fields[1], 0, 23)
  const dom = parseCronField(fields[2], 1, 31)
  const month = parseCronField(fields[3], 1, 12)
  const dowRaw = parseCronField(fields[4], 0, 7) // cron allows 0 AND 7 for Sunday
  if (minute === null || hour === null || dom === null || month === null || dowRaw === null) return null
  const dow = dowRaw === '*' ? '*' : [...new Set(dowRaw.map((d) => (d === 7 ? 0 : d)))].sort((a, b) => a - b)
  return { minute, hour, dom, month, dow }
}

function rangeArray(a: number, b: number): number[] {
  const out: number[] = []
  for (let v = a; v <= b; v++) out.push(v)
  return out
}

function fieldMatches(field: CronField, value: number): boolean {
  return field === '*' || field.includes(value)
}

function matchesDate(expr: CronExpr, date: Date): boolean {
  return fieldMatches(expr.dom, date.getDate())
    && fieldMatches(expr.month, date.getMonth() + 1)
    && fieldMatches(expr.dow, date.getDay())
}

// Safety valve: some cron expressions never match (e.g. day-of-month 31 with
// month February — impossible in the Gregorian calendar). Without a cap,
// nextRun would scan forever. A touch over 4 years covers every leap-year
// cycle for real schedules and is far past anything a user would configure;
// on an impossible expression the day-match check below short-circuits every
// iteration, so the cap is cheap even when hit.
const MAX_DAYS_SEARCHED = 366 * 4 + 1

/**
 * Earliest instant strictly after `from` that matches `automation`'s trigger,
 * or null if the trigger doesn't parse or never matches within the search
 * window. Scans candidate days for a dom/month/dow match, then picks the
 * smallest (hour, minute) pair on that day that's still after `from` — fast
 * for realistic presets/cron (typically a same-day or next-few-days match).
 *
 * Timezone note: `automation.timezone` is persisted and round-tripped but NOT
 * used to shift this computation — `from` and the returned Date are plain
 * instants interpreted in the host machine's local time zone, same as the
 * rest of the app. Cross-timezone scheduling (e.g. "6pm in a zone other than
 * the machine's") is a known follow-up, not implemented here.
 */
export function nextRun(automation: Automation, from: Date): Date | null {
  const expr = parseTrigger(automation)
  if (!expr) return null
  const hours = (expr.hour === '*' ? rangeArray(0, 23) : expr.hour).slice().sort((a, b) => a - b)
  const minutes = (expr.minute === '*' ? rangeArray(0, 59) : expr.minute).slice().sort((a, b) => a - b)
  if (hours.length === 0 || minutes.length === 0) return null

  for (let dayOffset = 0; dayOffset <= MAX_DAYS_SEARCHED; dayOffset++) {
    const day = new Date(from.getFullYear(), from.getMonth(), from.getDate() + dayOffset)
    if (!matchesDate(expr, day)) continue
    for (const h of hours) {
      for (const m of minutes) {
        const candidate = new Date(day.getFullYear(), day.getMonth(), day.getDate(), h, m, 0, 0)
        if (candidate.getTime() > from.getTime()) return candidate
      }
    }
  }
  return null
}

/** Human label for the list UI (e.g. "Daily at 18:00", "Cron: 0 18 * * 1-5").
 *  Pure string formatting over `trigger`/`time` — no cron matching, so it
 *  never disagrees with `nextRun` about whether a trigger is well-formed; an
 *  unparseable raw-cron trigger still gets a (harmless) "Cron: ..." label. */
export function describeSchedule(automation: Pick<Automation, 'trigger' | 'time'>): string {
  const { trigger, time } = automation
  switch (trigger) {
    case 'hourly': return 'Hourly'
    case 'daily': return `Daily at ${time ?? DEFAULT_TIME}`
    case 'weekdays': return `Weekdays at ${time ?? DEFAULT_TIME}`
    case 'weekly': return `Weekly (Mon) at ${time ?? DEFAULT_TIME}`
    default: return `Cron: ${trigger}`
  }
}

// ── Persistence (<ravenHome>/.raven-nest/automations.json) ─────────────────

/** Validates an automation loaded from disk (`unknown`), or null if invalid.
 *  Required: id/name/trigger/prompt (string) + enabled (boolean) — anything
 *  missing those is dropped rather than crashing the whole file (same
 *  contract as recipes.ts's `toStoredRecipe`). Optional fields default to a
 *  safe value (0 for timestamps) rather than causing a drop, since a record
 *  missing only bookkeeping fields is still usable. */
function toAutomation(x: unknown): Automation | null {
  if (!x || typeof x !== 'object') return null
  const r = x as Record<string, unknown>
  if (typeof r.id !== 'string' || typeof r.name !== 'string' || typeof r.trigger !== 'string'
    || typeof r.prompt !== 'string' || typeof r.enabled !== 'boolean') return null
  const out: Automation = {
    id: r.id,
    name: r.name,
    trigger: r.trigger,
    prompt: r.prompt,
    enabled: r.enabled,
    createdAt: typeof r.createdAt === 'number' ? r.createdAt : 0,
    updatedAt: typeof r.updatedAt === 'number' ? r.updatedAt : 0,
  }
  if (typeof r.time === 'string') out.time = r.time
  if (typeof r.timezone === 'string') out.timezone = r.timezone
  if (typeof r.repo === 'string') out.repo = r.repo
  if (typeof r.provider === 'string') out.provider = r.provider
  if (typeof r.workerId === 'string') out.workerId = r.workerId
  if (typeof r.model === 'string') out.model = r.model
  if (r.effort === 'low' || r.effort === 'medium' || r.effort === 'high') out.effort = r.effort
  if (typeof r.lastRunAt === 'number') out.lastRunAt = r.lastRunAt
  if (r.lastResult === 'ok' || r.lastResult === 'error') out.lastResult = r.lastResult
  if (typeof r.lastSummary === 'string') out.lastSummary = r.lastSummary
  return out
}

/**
 * Loads automations from disk. Missing file → `[]` (first run, no crash).
 * Corrupt JSON → warn + `[]`. Entries with an invalid shape are dropped
 * individually (with a warn) instead of discarding the whole file — same
 * robustness contract as `recipes.ts`'s `loadRecipes`.
 */
export function loadAutomations(filePath: string): Automation[] {
  let raw: string
  try {
    raw = readFileSync(filePath, 'utf8')
  } catch {
    return []
  }
  try {
    const data = JSON.parse(raw) as { automations?: unknown }
    const list = Array.isArray(data.automations) ? data.automations : []
    const out: Automation[] = []
    let dropped = 0
    for (const item of list) {
      const a = toAutomation(item)
      if (a) out.push(a)
      else dropped++
    }
    if (dropped > 0) console.warn('[scheduler] discarded', dropped, 'invalid automations from', filePath)
    return out
  } catch (err) {
    console.warn('[scheduler] automations.json unreadable, using empty list', err)
    return []
  }
}

/** Atomic write (tmp + rename), same pattern as recipes.ts/plugin-credentials.ts:
 *  a crash mid-write never corrupts automations.json. Best-effort: a disk
 *  failure logs a warn instead of throwing into the caller (an IPC handler). */
export function saveAutomations(filePath: string, automations: Automation[]): void {
  try {
    mkdirSync(dirname(filePath), { recursive: true })
    const tmp = `${filePath}.${randomBytes(6).toString('hex')}.tmp`
    writeFileSync(tmp, JSON.stringify({ version: 1, automations }, null, 2))
    renameSync(tmp, filePath)
  } catch (err) {
    console.warn('[scheduler] automations.json write failed', err)
  }
}

/** Short random id for a new automation — same shape as the OAuth state ids
 *  main.ts already generates (`randomBytes(N).toString('hex')`). */
export function newAutomationId(): string {
  return randomBytes(8).toString('hex')
}

// ── Scheduler (tick loop → dispatch) ────────────────────────────────────────

export interface AutomationRunResult {
  ok: boolean
  summary?: string
}

/** Runs one automation headlessly. The real implementation (ephemeral
 *  worktree + CLI run) is injected by main.ts — kept behind this seam so
 *  scheduler.ts stays pure/testable and never touches child processes. */
export type RunAutomationFn = (automation: Automation, now: Date) => Promise<AutomationRunResult>

export interface SchedulerDeps {
  runAutomation: RunAutomationFn
  /** Fired the instant an automation is dispatched, before `runAutomation`
   *  resolves — lets the bus route `block.started` to recipes (e.g. "nightly
   *  audit kicked off" → Slack). Optional and synchronous by design: the tick
   *  loop doesn't await it, matching the rest of the bus's fire-and-forget
   *  event emission (see main.ts's polling intervals). */
  onEvent?: (ev: BlockStartedEvent) => void
}

export interface TickResult {
  /** Every automation passed in, with `lastRunAt`/`lastResult`/`lastSummary`/
   *  `updatedAt` refreshed on the ones that fired this tick. Same length and
   *  order as the input. */
  automations: Automation[]
  /** Subset that actually fired this tick (post-update) — callers use this to
   *  decide whether persisting (`saveAutomations`) is worth doing. */
  fired: Automation[]
}

/**
 * Reactivates the bus's declared-but-unhandled `block.started` event (C3): on
 * each `tick`, fires every enabled automation whose next scheduled run has
 * arrived. "Due" is computed via `nextRun` anchored at `lastRunAt` (or
 * `createdAt` if it has never run) — so a catch-up after downtime fires the
 * automation once, not once per missed occurrence.
 *
 * Firing = emit `block.started` (best-effort, via `onEvent`) + invoke the
 * injected `runAutomation`. A rejection from `runAutomation` is caught and
 * recorded as `lastResult: 'error'` rather than thrown, so one failing
 * automation can't stall the rest of the tick.
 */
export class Scheduler {
  constructor(private deps: SchedulerDeps) {}

  async tick(automations: Automation[], now: Date): Promise<TickResult> {
    const out: Automation[] = []
    const fired: Automation[] = []
    for (const automation of automations) {
      if (!automation.enabled) {
        out.push(automation)
        continue
      }
      const anchor = new Date(automation.lastRunAt ?? automation.createdAt)
      const due = nextRun(automation, anchor)
      if (!due || due.getTime() > now.getTime()) {
        out.push(automation)
        continue
      }
      this.deps.onEvent?.({ type: 'block.started', taskId: automation.id, label: automation.name })
      let updated: Automation
      try {
        const result = await this.deps.runAutomation(automation, now)
        updated = {
          ...automation,
          lastRunAt: now.getTime(),
          lastResult: result.ok ? 'ok' : 'error',
          lastSummary: result.summary,
          updatedAt: now.getTime(),
        }
      } catch (err) {
        updated = {
          ...automation,
          lastRunAt: now.getTime(),
          lastResult: 'error',
          lastSummary: err instanceof Error ? err.message : String(err),
          updatedAt: now.getTime(),
        }
      }
      out.push(updated)
      fired.push(updated)
    }
    return { automations: out, fired }
  }
}
