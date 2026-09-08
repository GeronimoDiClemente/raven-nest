// Query de solo lectura del indice del hilo, para `memory:teamThread:read` (Task 10, el
// panel). Agrupa igual que `planTeamThread` (mismo filtro EL GUARDIA: scope team, este
// proyecto, tipo incluido, sin borrar, sin superseder) pero sin escribir a disco ni
// calcular contenido/hash/warnings — el panel solo necesita las filas del indice.
//
// Modulo aparte de team-thread-plan.ts (Task 2, ya testeado) a proposito: es el camino de
// ESCRITURA y no hace falta tocarlo para agregar un query nuevo. Un poco de duplicacion
// (el agrupamiento, ~15 lineas) a cambio de cero riesgo sobre esa suite.
import type { ObservationType } from '../memory-protocol'
import type { MemoryRecord } from './memory-port'
import { branchSlug, type EstadoRama, type ThreadIndexBranch } from './team-thread-note'

export interface ThreadIndexQueryConfig {
  projectKey: string
  includedTypes: ObservationType[]
  branchStates: Record<string, EstadoRama>
}

/** Copia de `ramaCanonica` en team-thread-plan.ts: desempate lexicografico para que el
 *  resultado no dependa del orden de llegada de `records` (mismo motivo alla). */
function ramaCanonica(entries: MemoryRecord[]): string | null {
  let branch: string | null = null
  for (const e of entries) {
    if (e.gitBranch === null) continue
    if (branch === null || e.gitBranch < branch) branch = e.gitBranch
  }
  return branch
}

export function queryThreadIndexBranches(records: MemoryRecord[], config: ThreadIndexQueryConfig): ThreadIndexBranch[] {
  const { projectKey, includedTypes, branchStates } = config
  const tipos = new Set(includedTypes)

  const elegibles = records.filter(
    (r) =>
      r.scope === 'team' &&
      r.projectKey === projectKey &&
      tipos.has(r.type) &&
      !r.deleted &&
      r.supersededBy === null,
  )

  const porRama = new Map<string, MemoryRecord[]>()
  for (const r of elegibles) {
    const slug = branchSlug(r.gitBranch)
    const bucket = porRama.get(slug)
    if (bucket) bucket.push(r)
    else porRama.set(slug, [r])
  }

  const rows: ThreadIndexBranch[] = []
  for (const [slug, entries] of porRama) {
    const branch = ramaCanonica(entries)
    const estado = (branch ? branchStates[branch] : undefined) ?? 'sin-worktree'
    const ordenadas = [...entries].sort((a, b) => b.createdAt - a.createdAt)
    rows.push({
      slug,
      branch: branch ?? 'general',
      estado,
      ultimoAutor: ordenadas[0].authorDisplay ?? 'desconocido',
      ultimaEntrada: ordenadas[0].createdAt,
      entradas: entries.length,
    })
  }
  return rows
}
