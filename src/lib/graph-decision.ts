// Lectura pura de un run: ¿hay un gate esperando que un humano decida, y qué lo
// está frenando? El board usa esto para decidir si muestra la barra de decisión.
//
// No decide nada por sí mismo: aprobar o pedir cambios encola un `pendingDecision`
// por IPC y el tick del orquestador es el único que lo aplica (single-writer).
import type { GraphTemplate, GraphRun } from '../types'

export interface GateConcerns {
  /** Etiqueta del reviewer: `role` o `role · focus`. */
  from: string
  items: string[]
}
export interface PendingGate {
  gateId: string
  /** Vacío en modo `gate` cuando el review pasó limpio y el gate frena igual. */
  concerns: GateConcerns[]
}

/** El primer gate del template que está esperando una decisión humana, con los
 *  concerns de los reviewers de los que depende que hayan bloqueado. `null` si
 *  ningún gate está esperando. */
export function pendingGate(template: GraphTemplate, run: GraphRun): PendingGate | null {
  const gate = template.nodes.find(
    (n) => n.kind === 'gate' && ['blocked', 'needs_input'].includes(run.nodes[n.id]?.state ?? ''),
  )
  if (!gate) return null

  const byId = new Map(template.nodes.map((n) => [n.id, n]))
  const concerns: GateConcerns[] = []
  for (const upId of gate.dependsOn) {
    const verdict = run.nodes[upId]?.verdict
    if (!verdict?.blocking) continue
    const up = byId.get(upId)
    const from = up ? (up.focus ? `${up.role} · ${up.focus}` : up.role) : upId
    concerns.push({ from, items: verdict.concerns })
  }
  return { gateId: gate.id, concerns }
}
