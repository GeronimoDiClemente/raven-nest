import { describe, it, expect, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  parseClaudeUsage,
  readClaudeUsage,
  claudeUsageFilePath,
  readModelUsage,
  formatTimeToReset,
  WARNING_THRESHOLD_PCT,
} from '../integrations/model-usage'

// Deterministic clock, never Date.now() in a test.
const NOW = Date.parse('2026-09-11T12:00:00.000Z')

function fixture(overrides: {
  fiveHourPct?: number
  fiveHourReset?: string | null
  sevenDayPct?: number
  sevenDayReset?: string | null
  accountUuid?: string | null
  fetchedAtMs?: number | null
} = {}) {
  const {
    fiveHourPct = 58,
    fiveHourReset = '2026-09-11T17:00:00.000Z',
    sevenDayPct = 41,
    sevenDayReset = '2026-09-14T00:00:00.000Z',
    accountUuid = 'acct-123',
    fetchedAtMs = NOW - 60_000,
  } = overrides
  return {
    cachedUsageUtilization: {
      fetchedAtMs,
      accountUuid,
      utilization: {
        five_hour: {
          utilization: fiveHourPct,
          resets_at: fiveHourReset,
          limit_dollars: null,
          used_dollars: null,
          remaining_dollars: null,
          locked_reason: null,
        },
        seven_day: {
          utilization: sevenDayPct,
          resets_at: sevenDayReset,
          limit_dollars: null,
          used_dollars: null,
          remaining_dollars: null,
          locked_reason: null,
        },
        // A representative slice of the long tail of null feature-flagged
        // slots seen on a real account — must be ignored, not crash.
        nimbus_quill: null,
        seven_day_opus: null,
        extra_usage: { is_enabled: false, used_credits: 0 },
        limits: [
          { kind: 'session', group: 'session', percent: fiveHourPct, severity: 'normal', resets_at: fiveHourReset, is_active: false },
          { kind: 'weekly_all', group: 'weekly', percent: sevenDayPct, severity: 'normal', resets_at: sevenDayReset, is_active: true },
        ],
      },
    },
  }
}

describe('parseClaudeUsage', () => {
  it('parses a real-shaped cache into fiveHour + weekly windows', () => {
    const result = parseClaudeUsage(JSON.stringify(fixture()))
    expect(result).toEqual({
      provider: 'claude',
      account: 'acct-123',
      fetchedAt: NOW - 60_000,
      windows: {
        fiveHour: { pct: 58, resetAt: '2026-09-11T17:00:00.000Z', warning: false },
        weekly: { pct: 41, resetAt: '2026-09-14T00:00:00.000Z', warning: false },
      },
    })
  })

  it('fails if the five_hour window stops being read (mutation guard)', () => {
    // Sanity check for the test above: strip five_hour from the fixture and
    // confirm the window actually disappears — proves the assertion isn't
    // vacuously true.
    const raw = fixture()
    // @ts-expect-error deliberately corrupting the fixture for this check
    raw.cachedUsageUtilization.utilization.five_hour = null
    const result = parseClaudeUsage(JSON.stringify(raw))
    expect(result?.windows.fiveHour).toBeUndefined()
    expect(result?.windows.weekly).toBeDefined()
  })

  it('returns null for invalid JSON', () => {
    expect(parseClaudeUsage('{ not json')).toBeNull()
  })

  it('returns null when cachedUsageUtilization is absent (fresh install / old CLI)', () => {
    expect(parseClaudeUsage(JSON.stringify({ someOtherKey: true }))).toBeNull()
  })

  it('returns null when cachedUsageUtilization is present but has no usable window', () => {
    const raw = {
      cachedUsageUtilization: {
        fetchedAtMs: NOW,
        accountUuid: 'acct-123',
        utilization: { five_hour: null, seven_day: null },
      },
    }
    expect(parseClaudeUsage(JSON.stringify(raw))).toBeNull()
  })

  it('returns null for a non-object JSON value', () => {
    expect(parseClaudeUsage('42')).toBeNull()
    expect(parseClaudeUsage('null')).toBeNull()
  })

  it('drops a window whose resets_at is missing/non-string but keeps pct-only data', () => {
    const raw = fixture({ sevenDayReset: null })
    const result = parseClaudeUsage(JSON.stringify(raw))
    expect(result?.windows.weekly).toEqual({ pct: 41, resetAt: null, warning: false })
  })
})

describe('warning flag — crosses exactly at 80%, not before', () => {
  it('79% is not a warning', () => {
    const result = parseClaudeUsage(JSON.stringify(fixture({ fiveHourPct: 79 })))
    expect(result?.windows.fiveHour?.warning).toBe(false)
  })

  it('80% IS a warning (the threshold itself counts)', () => {
    const result = parseClaudeUsage(JSON.stringify(fixture({ fiveHourPct: 80 })))
    expect(result?.windows.fiveHour?.warning).toBe(true)
  })

  it('81% is a warning', () => {
    const result = parseClaudeUsage(JSON.stringify(fixture({ fiveHourPct: 81 })))
    expect(result?.windows.fiveHour?.warning).toBe(true)
  })

  it('the exported threshold constant is 80 (guards against silently changing the cutoff)', () => {
    expect(WARNING_THRESHOLD_PCT).toBe(80)
  })
})

describe('formatTimeToReset', () => {
  it('formats a multi-day reset as "Xd Yh"', () => {
    expect(formatTimeToReset('2026-09-14T00:00:00.000Z', NOW)).toBe('2d 12h')
  })

  it('formats an hours+minutes reset as "XhYm"', () => {
    expect(formatTimeToReset('2026-09-11T14:06:00.000Z', NOW)).toBe('2h6m')
  })

  it('formats an exact-hour reset as "Xh" without a trailing 0m', () => {
    expect(formatTimeToReset('2026-09-11T15:00:00.000Z', NOW)).toBe('3h')
  })

  it('formats a sub-hour reset as "Xm"', () => {
    expect(formatTimeToReset('2026-09-11T12:45:00.000Z', NOW)).toBe('45m')
  })

  it('returns "0m" once the reset instant has passed', () => {
    expect(formatTimeToReset('2026-09-11T00:00:00.000Z', NOW)).toBe('0m')
  })

  it('returns null when resetAt is null', () => {
    expect(formatTimeToReset(null, NOW)).toBeNull()
  })

  it('returns null when resetAt fails to parse', () => {
    expect(formatTimeToReset('not-a-date', NOW)).toBeNull()
  })
})

describe('claudeUsageFilePath', () => {
  it('points at <home>/.claude.json, not the .claude/ directory', () => {
    expect(claudeUsageFilePath('/home/gero')).toBe('/home/gero/.claude.json')
  })
})

describe('readClaudeUsage (disk I/O)', () => {
  const tmpDirs: string[] = []
  function tmpHome(): string {
    const dir = mkdtempSync(join(tmpdir(), 'model-usage-test-'))
    tmpDirs.push(dir)
    return dir
  }

  afterEach(() => {
    while (tmpDirs.length) {
      const dir = tmpDirs.pop()!
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('reads and parses a real file on disk', () => {
    const home = tmpHome()
    writeFileSync(join(home, '.claude.json'), JSON.stringify(fixture()))
    const result = readClaudeUsage(home)
    expect(result?.windows.fiveHour?.pct).toBe(58)
    expect(result?.windows.weekly?.pct).toBe(41)
  })

  it('returns null silently when the file is absent (normal case, not an error)', () => {
    const home = tmpHome()
    expect(readClaudeUsage(home)).toBeNull()
  })

  it('returns null, never throws, when the file has invalid JSON', () => {
    const home = tmpHome()
    writeFileSync(join(home, '.claude.json'), '{ this is not json at all')
    expect(() => readClaudeUsage(home)).not.toThrow()
    expect(readClaudeUsage(home)).toBeNull()
  })
})

describe('readModelUsage dispatch', () => {
  const tmpDirs: string[] = []
  function tmpHome(): string {
    const dir = mkdtempSync(join(tmpdir(), 'model-usage-test-'))
    tmpDirs.push(dir)
    return dir
  }

  afterEach(() => {
    while (tmpDirs.length) {
      const dir = tmpDirs.pop()!
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('routes "claude" to readClaudeUsage', () => {
    const home = tmpHome()
    writeFileSync(join(home, '.claude.json'), JSON.stringify(fixture()))
    expect(readModelUsage('claude', home)?.windows.fiveHour?.pct).toBe(58)
  })

  it('returns null for an unverified provider (e.g. codex) instead of guessing a format', () => {
    const home = tmpHome()
    expect(readModelUsage('codex', home)).toBeNull()
  })

  it('returns null for every other provider in AI_CONFIG', () => {
    const home = tmpHome()
    for (const provider of ['gemini', 'copilot', 'deepseek', 'opencode', 'qwen', 'cursor', 'grok'] as const) {
      expect(readModelUsage(provider, home)).toBeNull()
    }
  })
})
