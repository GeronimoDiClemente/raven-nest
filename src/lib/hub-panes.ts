import type { WorkspaceTab } from '../types'

/**
 * Quita los ids en `removed` del hubPanes de TODA tab Hub. Al cerrar un pane
 * (desde su workspace o cerrando el workspace entero) hay que podar su id del
 * Hub: sin esto quedaba colgante en la sesión persistida y shouldConfirmTabClose
 * preguntaba por "curación" que ya no existe. Devuelve el mismo array (y las
 * mismas referencias de tab) cuando no hay nada que podar.
 */
export function pruneHubPanes(tabs: WorkspaceTab[], removed: ReadonlySet<string>): WorkspaceTab[] {
  if (removed.size === 0) return tabs
  return tabs.map(t => {
    if (!t.isHub) return t
    const cur = t.hubPanes ?? []
    if (!cur.some(id => removed.has(id))) return t
    return { ...t, hubPanes: cur.filter(id => !removed.has(id)) }
  })
}
