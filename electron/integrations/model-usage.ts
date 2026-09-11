// Epic A (H9) — Model Usage / Quota bar. Replicates Orca's `58% left 2h6m`
// hook: read whatever usage/rate-limit state a CLI ALREADY persists to disk,
// no API calls, no extra auth (`docs/INTEGRATIONS_ORCA_BACKLOG.md` A1/A2).
//
// A1 = find + read + parse one provider's on-disk usage cache into a plain
// shape. A2 = derive the per-window warning flag (crosses 80%) and a
// human time-to-reset label. Both are pure: the parser takes file CONTENT,
// never touches fs itself, so every provider's format is unit-testable
// without a real CLI install (`readXUsage` is the only impure half, and
// it's a thin try/catch wrapper around `readFileSync` + the pure parser).
//
// ── Finding (2026-09-09/11, macOS, Claude Code CLI 2.1.236) ────────────────
//
// Prior research (2026-08-15, Windows) concluded no CLI persists a
// quota+reset window locally — see the "⛔ BLOCKED" note above A1 in the
// backlog. Re-checked from scratch on this machine, including a newer CLI
// build, and found ONE real source: Claude Code's own top-level state file
//
//     <home>/.claude.json          (NOT the `.claude/` directory — that one
//                                    only has `stats-cache.json`, historical
//                                    token counts with no limit/resetAt, and
//                                    `projects/**/*.jsonl` transcripts with
//                                    per-message `usage.*_tokens`, also with
//                                    no limit/resetAt — both confirm the old
//                                    finding, they're just not the right file)
//
// grows a `cachedUsageUtilization` object once the CLI has fetched usage at
// least once (rendering a statusline with the `rate_limits` field, hitting a
// limit, or running `/usage`). Shape actually observed on a live file
// (KEYS AND TYPES ONLY below — this is exactly the user's own quota
// numbers, so it's fine to describe the shape, but no raw value from any
// real file was ever hardcoded here or printed anywhere):
//
//   cachedUsageUtilization: {
//     fetchedAtMs: number        // epoch ms of the CLI's own last refresh
//     accountUuid: string
//     utilization: {
//       five_hour: { utilization: number /* 0-100 */, resets_at: string /* ISO */ | null,
//                     limit_dollars, used_dollars, remaining_dollars, locked_reason (all
//                     seen null on a subscription account — dollar figures are presumably
//                     for metered/API billing, not parsed here) }
//       seven_day:  { same shape as five_hour }
//       limits: Array<{ kind: string /* e.g. "session" | "weekly_all" | "weekly_scoped" */,
//                        group: string /* e.g. "session" | "weekly" */,
//                        percent: number, severity: string /* e.g. "normal" */,
//                        resets_at: string | null, is_active: boolean,
//                        scope?: { model?: {...}, surface?: ... } }>
//       // + a long tail of per-feature/model quota slots (seven_day_opus,
//       // seven_day_sonnet, nimbus_quill, tangelo, cinder_cove, copper_kite,
//       // amber_ladder, juniper_tide, extra_usage, spend, ...) that were ALL
//       // `null` on the inspected account. Codenamed/speculative and
//       // unconfirmed — intentionally NOT parsed here to avoid guessing a
//       // shape from an all-null sample. Extend `parseClaudeUsage` if/when
//       // one is seen populated.
//     }
//   }
//
// This lines up with the CLI's own changelog (`~/.claude/cache/changelog.md`
// on this machine): "Added `rate_limits` field to statusline scripts for
// displaying Claude.ai rate limit usage (5-hour and 7-day windows with
// `used_percentage` and `resets_at`)" — `utilization`/`resets_at` here are
// that same statusline contract, just cached to disk under a different key
// so a statusline script (or us) doesn't need to be running to read it.
// Only two windows are shipped for Claude: 5-hour and 7-day (weekly). There
// is no "daily" window — `windows.daily`/`windows.fable` stay reserved on
// the type for other providers/future Claude windows, never populated here.
//
// The field is ABSENT on a fresh install, or a CLI version that predates
// this cache, or one that has simply never rendered a statusline / hit a
// limit / run `/usage` yet — that's the normal "nothing to show" case, not
// an error: `parseClaudeUsage`/`readClaudeUsage` return `null`.
//
// ── Other providers ─────────────────────────────────────────────────────
//
// Re-checked on this machine (macOS) alongside Claude, deliberately NOT
// guessed from memory:
//   - codex: `~/.codex/` exists but is empty other than a pid lockfile under
//     `tmp/arg0/.../.lock`. No `sessions/`, `auth.json`, or anything
//     usage-shaped, even though the `codex` binary is installed. Nothing to
//     parse — matches the prior Windows finding.
//   - gemini, copilot, deepseek, opencode, qwen, cursor, grok: no CLI config
//     directory with usage/quota content was found at all on this machine
//     (either not installed, or its config dir holds nothing usage-shaped).
//     Nothing to verify against, so nothing is implemented — see the
//     backlog note (A1): "no inventes proveedores que no puedas verificar".
// `readModelUsage` below dispatches on provider and returns `null` for all
// of these; add a `read<Provider>Usage` next to `readClaudeUsage` (same
// findPath → readFileSync try/catch → pure `parse<Provider>Usage`) the day
// one of them is actually inspected on a machine that has real data, and
// wire it into the switch.

import { readFileSync } from 'fs'
import { join } from 'path'
import type { AIType } from '../../src/types'

/** Rate-limit windows this module knows how to read. Only `fiveHour` and
 *  `weekly` are ever populated today (Claude's two shipped windows) — `daily`
 *  and `fable` are reserved for a provider/window that hasn't been verified
 *  yet (see the file header). */
export type UsageWindowKind = 'fiveHour' | 'daily' | 'weekly' | 'fable'

export interface UsageWindow {
  /** 0-100, as reported by the CLI. */
  pct: number
  /** ISO-8601 timestamp from the CLI's own cache, or null if it didn't report one. */
  resetAt: string | null
  /** True once `pct` has crossed (>=) the warning threshold. */
  warning: boolean
}

export interface ProviderUsage {
  provider: AIType
  /** Opaque account identifier from the CLI's own cache (e.g. Claude's `accountUuid`), or null. */
  account: string | null
  /** Epoch ms of the CLI's own last refresh of this cache, or null if unknown. Lets a
   *  consumer show "as of 12m ago" instead of implying this is live. */
  fetchedAt: number | null
  windows: Partial<Record<UsageWindowKind, UsageWindow>>
}

/** A2: the pct at which a window flips into "warn the user" territory. */
export const WARNING_THRESHOLD_PCT = 80

function toUsageWindow(pct: unknown, resetAt: unknown): UsageWindow | null {
  if (typeof pct !== 'number' || !Number.isFinite(pct)) return null
  return {
    pct,
    resetAt: typeof resetAt === 'string' ? resetAt : null,
    warning: pct >= WARNING_THRESHOLD_PCT,
  }
}

/** A2: human time-to-reset label for a window, e.g. "2h6m", "3d 2h", "45m".
 *  Null when there's no resetAt to work from, or it fails to parse. "0m"
 *  once the reset instant has passed (still a well-formed label; a stale
 *  cache is a display concern for the caller, not this function's job). */
export function formatTimeToReset(resetAt: string | null, nowMs: number): string | null {
  if (!resetAt) return null
  const resetMs = Date.parse(resetAt)
  if (!Number.isFinite(resetMs)) return null
  const diffMs = resetMs - nowMs
  if (diffMs <= 0) return '0m'
  const totalMinutes = Math.round(diffMs / 60_000)
  const days = Math.floor(totalMinutes / (60 * 24))
  const hours = Math.floor((totalMinutes % (60 * 24)) / 60)
  const minutes = totalMinutes % 60
  if (days > 0) return `${days}d ${hours}h`
  if (hours > 0) return minutes > 0 ? `${hours}h${minutes}m` : `${hours}h`
  return `${minutes}m`
}

// ── Claude ──────────────────────────────────────────────────────────────

export function claudeUsageFilePath(homeDir: string): string {
  return join(homeDir, '.claude.json')
}

/** Pure: parses the raw text content of `<home>/.claude.json`. Never touches fs. */
export function parseClaudeUsage(raw: string): ProviderUsage | null {
  let data: unknown
  try {
    data = JSON.parse(raw)
  } catch {
    return null
  }
  if (typeof data !== 'object' || data === null) return null

  const cached = (data as Record<string, unknown>).cachedUsageUtilization
  if (typeof cached !== 'object' || cached === null) return null
  const c = cached as Record<string, unknown>

  const utilization = c.utilization
  if (typeof utilization !== 'object' || utilization === null) return null
  const u = utilization as Record<string, unknown>

  const windows: Partial<Record<UsageWindowKind, UsageWindow>> = {}

  const fiveHour = u.five_hour
  if (typeof fiveHour === 'object' && fiveHour !== null) {
    const f = fiveHour as Record<string, unknown>
    const w = toUsageWindow(f.utilization, f.resets_at)
    if (w) windows.fiveHour = w
  }

  const sevenDay = u.seven_day
  if (typeof sevenDay === 'object' && sevenDay !== null) {
    const s = sevenDay as Record<string, unknown>
    const w = toUsageWindow(s.utilization, s.resets_at)
    if (w) windows.weekly = w
  }

  // Nothing usable found (e.g. the cache exists but both windows are
  // malformed/missing) — treat the same as "no cache at all".
  if (Object.keys(windows).length === 0) return null

  return {
    provider: 'claude',
    account: typeof c.accountUuid === 'string' ? c.accountUuid : null,
    fetchedAt: typeof c.fetchedAtMs === 'number' ? c.fetchedAtMs : null,
    windows,
  }
}

/** Impure half: locates and reads `<home>/.claude.json`, delegates parsing.
 *  File absent/unreadable/corrupt -> null, never throws. */
export function readClaudeUsage(homeDir: string): ProviderUsage | null {
  let raw: string
  try {
    raw = readFileSync(claudeUsageFilePath(homeDir), 'utf8')
  } catch {
    return null
  }
  return parseClaudeUsage(raw)
}

// ── Dispatch ────────────────────────────────────────────────────────────

/** Reads whatever usage/quota state `provider`'s CLI persisted to disk under
 *  `homeDir` (the real user home — see `electron/raven-home.ts`'s `userHome()`,
 *  or an account-scoped home for a specific Nest account). Unsupported/
 *  unverified providers return null (see the file header) — never throws. */
export function readModelUsage(provider: AIType, homeDir: string): ProviderUsage | null {
  switch (provider) {
    case 'claude':
      return readClaudeUsage(homeDir)
    default:
      return null
  }
}
