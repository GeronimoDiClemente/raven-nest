// Spec §7.1, robado de engram: "if sync is blocked, fail loudly and visibly. No silent
// drops." El dato ya se escribe desde la Task 8 de memory-bridge (mutation_log.blocked_reason,
// memory-store.ts:1213) y nunca lo leyo nadie. Esto solo lo agrupa: puro, sin tocar la base.
import type { MutationLogRow } from './memory-store'
import { REVERSIBLE_REJECTIONS } from './memory-daemon'

export interface BlockedGroup {
  reason: string
  count: number
  /** La mas vieja del grupo: cuanto hace que esto esta trabado. */
  oldestAt: number
  /**
   * Reversible = se destraba solo cuando cambia la condicion (subir el plan, compartir el
   * proyecto) y la mutacion se reintenta con el mismo payload. Terminal = no se destraba.
   * La distincion es de memory-daemon.ts, no se re-decide aca.
   */
  reversible: boolean
}

export interface DoctorReport {
  blockedTotal: number
  /** De mayor a menor, para que el titular de la UI sea el bloqueo mas grande. */
  groups: BlockedGroup[]
}

export function buildDoctorReport(rows: MutationLogRow[]): DoctorReport {
  const byReason = new Map<string, BlockedGroup>()

  for (const r of rows) {
    const reason = r.blocked_reason
    if (!reason) continue
    const existing = byReason.get(reason)
    if (existing) {
      existing.count += 1
      if (r.created_at < existing.oldestAt) existing.oldestAt = r.created_at
    } else {
      byReason.set(reason, {
        reason,
        count: 1,
        oldestAt: r.created_at,
        reversible: REVERSIBLE_REJECTIONS.has(reason),
      })
    }
  }

  const groups = [...byReason.values()].sort(
    (a, b) => b.count - a.count || a.reason.localeCompare(b.reason)
  )
  return { blockedTotal: groups.reduce((sum, g) => sum + g.count, 0), groups }
}
