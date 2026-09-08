// Query de solo lectura del indice del hilo, para `memory:teamThread:read` (Task 10, el
// panel). Usa el mismo agrupamiento que `planTeamThread` (EL GUARDIA + agrupamiento por
// rama, en team-thread-note.ts) pero sin escribir a disco ni calcular contenido/hash/
// warnings — el panel solo necesita las filas del indice.
import { groupThreadBranches, threadIndexRowFor, type ThreadGroupingConfigWithStates, type ThreadIndexBranch } from './team-thread-note'
import type { MemoryRecord } from './memory-port'

export type ThreadIndexQueryConfig = ThreadGroupingConfigWithStates

export function queryThreadIndexBranches(records: MemoryRecord[], config: ThreadIndexQueryConfig): ThreadIndexBranch[] {
  return groupThreadBranches(records, config).map(threadIndexRowFor)
}
