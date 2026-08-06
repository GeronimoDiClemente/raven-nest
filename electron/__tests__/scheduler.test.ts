import { describe, it, expect, vi, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'fs'
import { tmpdir } from 'os'
import { dirname, join } from 'path'
import {
  parseTrigger,
  nextRun,
  describeSchedule,
  loadAutomations,
  saveAutomations,
  newAutomationId,
  Scheduler,
  type Automation,
} from '../integrations/scheduler'
import type { BlockStartedEvent } from '../integrations/bus-types'

function makeAutomation(over: Partial<Automation> = {}): Automation {
  return {
    id: 'a1',
    name: 'Nightly audit',
    trigger: 'daily',
    time: '18:00',
    prompt: 'Audit the repo for security issues and summarize.',
    enabled: true,
    createdAt: Date.parse('2026-01-01T00:00:00'),
    updatedAt: Date.parse('2026-01-01T00:00:00'),
    ...over,
  }
}

const tmpDirs: string[] = []
function tmpFile(): string {
  const dir = mkdtempSync(join(tmpdir(), 'scheduler-test-'))
  tmpDirs.push(dir)
  return join(dir, 'sub', 'automations.json') // sub/ doesn't exist: exercises mkdir -p
}

afterEach(() => {
  vi.restoreAllMocks()
  while (tmpDirs.length) {
    try { rmSync(tmpDirs.pop()!, { recursive: true, force: true }) } catch { /* ignore */ }
  }
})

describe('parseTrigger', () => {
  it('hourly: minute-only, every hour, ignores `time`', () => {
    expect(parseTrigger({ trigger: 'hourly', time: '18:00' })).toEqual({
      minute: [0], hour: '*', dom: '*', month: '*', dow: '*',
    })
  })

  it('daily: uses `time`, any day', () => {
    expect(parseTrigger({ trigger: 'daily', time: '18:30' })).toEqual({
      minute: [30], hour: [18], dom: '*', month: '*', dow: '*',
    })
  })

  it('daily: defaults to 09:00 when `time` is missing', () => {
    expect(parseTrigger({ trigger: 'daily' })).toEqual({
      minute: [0], hour: [9], dom: '*', month: '*', dow: '*',
    })
  })

  it('weekdays: Mon-Fri only', () => {
    expect(parseTrigger({ trigger: 'weekdays', time: '09:00' })).toEqual({
      minute: [0], hour: [9], dom: '*', month: '*', dow: [1, 2, 3, 4, 5],
    })
  })

  it('weekly: resolves to Monday (documented default — use raw cron for other days)', () => {
    expect(parseTrigger({ trigger: 'weekly', time: '09:00' })).toEqual({
      minute: [0], hour: [9], dom: '*', month: '*', dow: [1],
    })
  })

  it('raw cron: "0 18 * * 1-5" parses a range field', () => {
    expect(parseTrigger({ trigger: '0 18 * * 1-5' })).toEqual({
      minute: [0], hour: [18], dom: '*', month: '*', dow: [1, 2, 3, 4, 5],
    })
  })

  it('raw cron: comma list', () => {
    expect(parseTrigger({ trigger: '0,30 9 * * *' })).toEqual({
      minute: [0, 30], hour: [9], dom: '*', month: '*', dow: '*',
    })
  })

  it('raw cron: step values ("*/15")', () => {
    const expr = parseTrigger({ trigger: '*/15 * * * *' })
    expect(expr?.minute).toEqual([0, 15, 30, 45])
  })

  it('raw cron: day-of-week 7 normalizes to 0 (Sunday)', () => {
    expect(parseTrigger({ trigger: '0 9 * * 7' })).toEqual({
      minute: [0], hour: [9], dom: '*', month: '*', dow: [0],
    })
  })

  it('invalid: wrong field count → null', () => {
    expect(parseTrigger({ trigger: '0 18 * *' })).toBeNull()
  })

  it('invalid: out-of-range value → null', () => {
    expect(parseTrigger({ trigger: '60 18 * * *' })).toBeNull()
  })

  it('invalid: garbage token → null', () => {
    expect(parseTrigger({ trigger: 'not a cron' })).toBeNull()
  })
})

describe('nextRun — presets', () => {
  it('hourly: rolls to the next top of the hour', () => {
    const a = makeAutomation({ trigger: 'hourly' })
    const from = new Date(2026, 0, 5, 14, 23, 10)
    expect(nextRun(a, from)).toEqual(new Date(2026, 0, 5, 15, 0, 0, 0))
  })

  it('hourly: exactly on the hour still returns the NEXT hour (strictly after `from`)', () => {
    const a = makeAutomation({ trigger: 'hourly' })
    const from = new Date(2026, 0, 5, 15, 0, 0, 0)
    expect(nextRun(a, from)).toEqual(new Date(2026, 0, 5, 16, 0, 0, 0))
  })

  it('daily: before the trigger time → later today', () => {
    const a = makeAutomation({ trigger: 'daily', time: '18:00' })
    const from = new Date(2026, 0, 5, 9, 0, 0, 0)
    expect(nextRun(a, from)).toEqual(new Date(2026, 0, 5, 18, 0, 0, 0))
  })

  it('daily: after the trigger time → tomorrow', () => {
    const a = makeAutomation({ trigger: 'daily', time: '18:00' })
    const from = new Date(2026, 0, 5, 19, 0, 0, 0)
    expect(nextRun(a, from)).toEqual(new Date(2026, 0, 6, 18, 0, 0, 0))
  })

  it('weekdays: Friday evening skips the weekend to Monday', () => {
    // 2026-01-09 is a Friday.
    const a = makeAutomation({ trigger: 'weekdays', time: '09:00' })
    const from = new Date(2026, 0, 9, 20, 0, 0, 0)
    expect(nextRun(a, from)).toEqual(new Date(2026, 0, 12, 9, 0, 0, 0)) // next Monday
  })

  it('weekly: from a Monday before the trigger time → today', () => {
    const a = makeAutomation({ trigger: 'weekly', time: '09:00' })
    const from = new Date(2026, 0, 5, 8, 0, 0, 0) // Monday
    expect(nextRun(a, from)).toEqual(new Date(2026, 0, 5, 9, 0, 0, 0))
  })

  it('weekly: from a Monday after the trigger time → next Monday (+7d)', () => {
    const a = makeAutomation({ trigger: 'weekly', time: '09:00' })
    const from = new Date(2026, 0, 5, 10, 0, 0, 0) // Monday, after 09:00
    expect(nextRun(a, from)).toEqual(new Date(2026, 0, 12, 9, 0, 0, 0))
  })
})

describe('nextRun — raw cron', () => {
  it('"0 18 * * 1-5" from a Saturday finds the next Monday at 18:00', () => {
    const a = makeAutomation({ trigger: '0 18 * * 1-5', time: undefined })
    const from = new Date(2026, 0, 10, 8, 0, 0, 0) // Saturday
    expect(nextRun(a, from)).toEqual(new Date(2026, 0, 12, 18, 0, 0, 0))
  })

  it('invalid trigger → null', () => {
    const a = makeAutomation({ trigger: 'not a cron' })
    expect(nextRun(a, new Date(2026, 0, 5))).toBeNull()
  })

  it('impossible cron (day 31 of February never exists) → null, bounded search', () => {
    const a = makeAutomation({ trigger: '0 0 31 2 *' })
    const start = performance.now()
    expect(nextRun(a, new Date(2026, 0, 1))).toBeNull()
    // Sanity bound so a regression that removes the day cap doesn't hang CI.
    expect(performance.now() - start).toBeLessThan(2000)
  })
})

describe('nextRun — timezone note', () => {
  it('the `timezone` field is preserved but does NOT shift the computed instant (documented limitation)', () => {
    const from = new Date(2026, 0, 5, 9, 0, 0, 0)
    const withoutTz = makeAutomation({ trigger: 'daily', time: '18:00' })
    const withTz = makeAutomation({ trigger: 'daily', time: '18:00', timezone: 'Asia/Tokyo' })
    expect(nextRun(withTz, from)).toEqual(nextRun(withoutTz, from))
  })
})

describe('describeSchedule', () => {
  it('formats each preset and falls back to a cron label', () => {
    expect(describeSchedule({ trigger: 'hourly' })).toBe('Hourly')
    expect(describeSchedule({ trigger: 'daily', time: '18:00' })).toBe('Daily at 18:00')
    expect(describeSchedule({ trigger: 'daily' })).toBe('Daily at 09:00')
    expect(describeSchedule({ trigger: 'weekdays', time: '09:00' })).toBe('Weekdays at 09:00')
    expect(describeSchedule({ trigger: 'weekly', time: '09:00' })).toBe('Weekly (Mon) at 09:00')
    expect(describeSchedule({ trigger: '0 18 * * 1-5' })).toBe('Cron: 0 18 * * 1-5')
  })
})

describe('loadAutomations / saveAutomations', () => {
  it('missing file → []', () => {
    expect(loadAutomations(tmpFile())).toEqual([])
  })

  it('round-trips a saved automation, including optional fields', () => {
    const file = tmpFile()
    const a = makeAutomation({ repo: '/repos/widgets', provider: 'claude', timezone: 'America/Argentina/Buenos_Aires' })
    saveAutomations(file, [a])
    expect(loadAutomations(file)).toEqual([a])
  })

  it('corrupt JSON → warn + [] (never crashes)', () => {
    const file = tmpFile()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, '{ not json')
    expect(loadAutomations(file)).toEqual([])
    expect(warn).toHaveBeenCalled()
  })

  it('drops individually invalid entries (missing required fields) with a warn, keeps the rest', () => {
    const file = tmpFile()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, JSON.stringify({
      version: 1,
      automations: [
        { id: 'ok', name: 'Ok one', trigger: 'daily', prompt: 'p', enabled: true, createdAt: 1, updatedAt: 1 },
        { id: 'bad', name: 'Missing prompt', trigger: 'daily', enabled: true },
        { id: 'bad2', trigger: 'daily', prompt: 'p', enabled: 'nope' },
      ],
    }))
    const loaded = loadAutomations(file)
    expect(loaded.map((a) => a.id)).toEqual(['ok'])
    expect(warn).toHaveBeenCalled()
  })

  it('missing optional bookkeeping fields default instead of dropping the entry', () => {
    const file = tmpFile()
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, JSON.stringify({
      version: 1,
      automations: [{ id: 'a1', name: 'No timestamps', trigger: 'daily', prompt: 'p', enabled: true }],
    }))
    const loaded = loadAutomations(file)
    expect(loaded).toEqual([{
      id: 'a1', name: 'No timestamps', trigger: 'daily', prompt: 'p', enabled: true, createdAt: 0, updatedAt: 0,
    }])
  })

  it('saveAutomations creates missing parent directories (atomic write)', () => {
    const file = tmpFile()
    saveAutomations(file, [makeAutomation()])
    expect(loadAutomations(file)).toHaveLength(1)
  })
})

describe('newAutomationId', () => {
  it('returns a non-empty string and differs across calls', () => {
    const a = newAutomationId()
    const b = newAutomationId()
    expect(a).toMatch(/^[0-9a-f]+$/)
    expect(a.length).toBeGreaterThan(0)
    expect(a).not.toBe(b)
  })
})

describe('Scheduler.tick', () => {
  function fakeBus() {
    const events: BlockStartedEvent[] = []
    return { events, onEvent: (ev: BlockStartedEvent) => events.push(ev) }
  }

  it('fires a due, enabled automation: invokes runAutomation, emits block.started, records ok', async () => {
    const { events, onEvent } = fakeBus()
    const runAutomation = vi.fn(async () => ({ ok: true, summary: 'looked clean' }))
    const scheduler = new Scheduler({ runAutomation, onEvent })
    const a = makeAutomation({
      id: 'a1', name: 'Nightly audit', trigger: 'daily', time: '18:00',
      createdAt: new Date(2026, 0, 4, 8, 0).getTime(),
    })
    const now = new Date(2026, 0, 5, 18, 0, 0, 0)
    const result = await scheduler.tick([a], now)

    expect(runAutomation).toHaveBeenCalledTimes(1)
    expect(runAutomation).toHaveBeenCalledWith(a, now)
    expect(events).toEqual([{ type: 'block.started', taskId: 'a1', label: 'Nightly audit' }])
    expect(result.fired).toHaveLength(1)
    expect(result.fired[0]).toMatchObject({ lastRunAt: now.getTime(), lastResult: 'ok', lastSummary: 'looked clean' })
    expect(result.automations).toEqual(result.fired)
  })

  it('does not fire a disabled automation even if it would otherwise be due', async () => {
    const runAutomation = vi.fn(async () => ({ ok: true }))
    const scheduler = new Scheduler({ runAutomation })
    const a = makeAutomation({ trigger: 'daily', time: '18:00', enabled: false, createdAt: new Date(2026, 0, 4).getTime() })
    const result = await scheduler.tick([a], new Date(2026, 0, 5, 18, 0, 0, 0))

    expect(runAutomation).not.toHaveBeenCalled()
    expect(result.fired).toEqual([])
    expect(result.automations).toEqual([a])
  })

  it('does not fire an enabled automation that is not yet due', async () => {
    const runAutomation = vi.fn(async () => ({ ok: true }))
    const scheduler = new Scheduler({ runAutomation })
    // Created same day, before the 18:00 trigger — its first occurrence
    // (today 18:00) is still ahead of `now` (today 12:00).
    const a = makeAutomation({ trigger: 'daily', time: '18:00', createdAt: new Date(2026, 0, 5, 7, 0).getTime() })
    const result = await scheduler.tick([a], new Date(2026, 0, 5, 12, 0, 0, 0))

    expect(runAutomation).not.toHaveBeenCalled()
    expect(result.fired).toEqual([])
  })

  it('a rejecting runAutomation is caught and recorded as lastResult: error (does not throw, does not stall the tick)', async () => {
    const runAutomation = vi.fn(async () => { throw new Error('worktree create failed') })
    const scheduler = new Scheduler({ runAutomation })
    const a = makeAutomation({ trigger: 'daily', time: '18:00', createdAt: new Date(2026, 0, 4).getTime() })
    const now = new Date(2026, 0, 5, 18, 0, 0, 0)

    const result = await scheduler.tick([a], now)
    expect(result.fired[0]).toMatchObject({ lastResult: 'error', lastSummary: 'worktree create failed' })
  })

  it('an ok:false result is recorded as lastResult: error with its summary', async () => {
    const runAutomation = vi.fn(async () => ({ ok: false, summary: 'CLI exited 1' }))
    const scheduler = new Scheduler({ runAutomation })
    const a = makeAutomation({ trigger: 'daily', time: '18:00', createdAt: new Date(2026, 0, 4).getTime() })
    const result = await scheduler.tick([a], new Date(2026, 0, 5, 18, 0, 0, 0))
    expect(result.fired[0]).toMatchObject({ lastResult: 'error', lastSummary: 'CLI exited 1' })
  })

  it('uses createdAt as the anchor on the very first run (no lastRunAt yet)', async () => {
    const runAutomation = vi.fn(async () => ({ ok: true }))
    const scheduler = new Scheduler({ runAutomation })
    // Created just before 18:00 with no prior run — due today at 18:00.
    const a = makeAutomation({ trigger: 'daily', time: '18:00', createdAt: new Date(2026, 0, 5, 17, 59).getTime(), lastRunAt: undefined })
    const result = await scheduler.tick([a], new Date(2026, 0, 5, 18, 0, 0, 0))
    expect(result.fired).toHaveLength(1)
  })

  it('does not mutate the input automation objects', async () => {
    const runAutomation = vi.fn(async () => ({ ok: true }))
    const scheduler = new Scheduler({ runAutomation })
    const a = makeAutomation({ trigger: 'daily', time: '18:00', createdAt: new Date(2026, 0, 4).getTime() })
    const frozen = { ...a }
    await scheduler.tick([a], new Date(2026, 0, 5, 18, 0, 0, 0))
    expect(a).toEqual(frozen)
  })

  it('only fires the due automation out of a mixed batch', async () => {
    const runAutomation = vi.fn(async () => ({ ok: true }))
    const scheduler = new Scheduler({ runAutomation })
    const due = makeAutomation({ id: 'due', trigger: 'daily', time: '18:00', createdAt: new Date(2026, 0, 4).getTime() })
    // Created same day at noon: its first occurrence (today 22:00) is still ahead of `now` (today 18:00).
    const notDue = makeAutomation({ id: 'not-due', trigger: 'daily', time: '22:00', createdAt: new Date(2026, 0, 5, 12, 0).getTime() })
    const disabled = makeAutomation({ id: 'disabled', trigger: 'hourly', enabled: false, createdAt: new Date(2026, 0, 4).getTime() })
    const result = await scheduler.tick([due, notDue, disabled], new Date(2026, 0, 5, 18, 0, 0, 0))

    expect(runAutomation).toHaveBeenCalledTimes(1)
    expect(result.fired.map((a) => a.id)).toEqual(['due'])
    expect(result.automations.map((a) => a.id)).toEqual(['due', 'not-due', 'disabled'])
  })

  it('does not refire immediately on the next tick at the same `now` (anchor advances to lastRunAt)', async () => {
    const runAutomation = vi.fn(async () => ({ ok: true }))
    const scheduler = new Scheduler({ runAutomation })
    const a = makeAutomation({ trigger: 'daily', time: '18:00', createdAt: new Date(2026, 0, 4).getTime() })
    const now = new Date(2026, 0, 5, 18, 0, 0, 0)

    const first = await scheduler.tick([a], now)
    expect(first.fired).toHaveLength(1)

    const second = await scheduler.tick(first.automations, now)
    expect(second.fired).toEqual([])
    expect(runAutomation).toHaveBeenCalledTimes(1)
  })
})
