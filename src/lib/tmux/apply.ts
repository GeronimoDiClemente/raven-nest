import type { Keybindings } from '../keybindings'
import type { TmuxImportPlan } from './parse'

/** An editable, selectable row for the import preview (one mappable tmux bind). */
export interface ImportRow {
  action: keyof Keybindings
  /** The original tmux line, shown for context. */
  source: string
  /** The Nest combo to apply — starts as the suggestion, editable in the preview. */
  combo: string
  /** Nest action already bound to `combo`, if any. */
  conflict?: string
  selected: boolean
}

/** The Nest action already bound to `combo`, or undefined if it's free. */
export function conflictFor(combo: string, current: Keybindings): string | undefined {
  for (const [action, binding] of Object.entries(current)) {
    if (binding === combo) return action
  }
  return undefined
}

/**
 * The binds a plan can actually apply (those that mapped to a Nest action), as
 * editable rows. Conflicting rows start unselected so a collision is never
 * applied without the user opting in.
 */
export function toImportRows(plan: TmuxImportPlan): ImportRow[] {
  const rows: ImportRow[] = []
  for (const kb of plan.keybindings) {
    if (kb.action === null) continue
    rows.push({
      action: kb.action,
      source: kb.source,
      combo: kb.suggested,
      conflict: kb.conflict,
      selected: !kb.conflict,
    })
  }
  return rows
}

/**
 * Merge the selected rows into an action -> combo patch for settings. When two
 * selected rows target the same action, the later one wins.
 */
export function applyPayload(rows: ImportRow[]): Partial<Record<keyof Keybindings, string>> {
  const patch: Partial<Record<keyof Keybindings, string>> = {}
  for (const row of rows) {
    if (row.selected) patch[row.action] = row.combo
  }
  return patch
}

const SCROLLBACK_MIN = 1000
const SCROLLBACK_MAX = 100_000

/** The scrollback (lines) to apply from a plan's `history-limit`, clamped to a
 *  sane range, or null when the conf sets no history-limit. */
export function scrollbackFromOptions(plan: TmuxImportPlan): number | null {
  const opt = plan.options.find(o => o.target === 'scrollback')
  if (!opt) return null
  const n = parseInt(opt.value, 10)
  if (!Number.isFinite(n)) return null
  return Math.min(SCROLLBACK_MAX, Math.max(SCROLLBACK_MIN, n))
}
