// Spec §7.1 — "if sync is blocked, fail loudly and visibly. No silent drops." El dato ya se
// escribe (mutation_log.blocked_reason, memory-store.ts:1213) y nadie lo lee nunca.
import { describe, it, expect } from 'vitest'
import { buildDoctorReport } from '../memory-doctor'
import type { MutationLogRow } from '../memory-store'

const row = (seq: number, reason: string | null, createdAt: number): MutationLogRow => ({
  seq, sync_id: 's-' + seq, op: 'upsert', payload: '{}', created_at: createdAt,
  pushed_at: null, last_error: reason, blocked_reason: reason,
})

describe('buildDoctorReport', () => {
  it('sin filas bloqueadas el reporte esta vacio', () => {
    expect(buildDoctorReport([])).toEqual({ blockedTotal: 0, groups: [] })
  })

  it('agrupa por razon, cuenta, y se queda con la mas vieja', () => {
    const report = buildDoctorReport([
      row(1, 'quota_exceeded', 100),
      row(2, 'quota_exceeded', 200),
      row(3, 'project_limit_reached', 300),
    ])
    expect(report.blockedTotal).toBe(3)
    expect(report.groups).toHaveLength(2)
    expect(report.groups[0]).toEqual({
      reason: 'quota_exceeded', count: 2, oldestAt: 100, reversible: true,
    })
  })

  it('ordena de mas a menos, para que el titular sea el bloqueo mas grande', () => {
    const report = buildDoctorReport([
      row(1, 'project_limit_reached', 100),
      row(2, 'quota_exceeded', 200),
      row(3, 'quota_exceeded', 300),
    ])
    expect(report.groups[0].reason).toBe('quota_exceeded')
  })

  it('marca terminal lo que no es reversible — no se arregla subiendo el plan', () => {
    const report = buildDoctorReport([row(1, 'team_scope_not_allowed', 100)])
    expect(report.groups[0].reversible).toBe(false)
  })

  it('project_not_shared_with_team es reversible: se destraba compartiendo el proyecto', () => {
    const report = buildDoctorReport([row(1, 'project_not_shared_with_team', 100)])
    expect(report.groups[0].reversible).toBe(true)
  })

  it('ignora las filas sin blocked_reason: son pendientes normales, no bloqueos', () => {
    expect(buildDoctorReport([row(1, null, 100)]).blockedTotal).toBe(0)
  })
})
