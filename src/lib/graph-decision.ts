// Lectura pura de un run: ¿hay un gate esperando que un humano decida, y qué lo
// está frenando? El board usa esto para decidir si muestra la barra de decisión.
//
// El estado del gate se DERIVA de sus upstream, no se lee. Un gate retenido para
// decisión no escribe nada en `run.nodes`: graph-orchestrator lo mete en
// `heldGates` → `plan.blockedOn`, y main solo persiste `plan.run`, así que
// `blockedOn` muere en el tick y nunca llega acá. Un gate solo pasa de 'queued' a
// 'done' (lo aplica applyDecision o el modo auto) o a 'skipped'.
//
// Espejo de `gateState` en electron/integrations/graph-runner.ts. Se duplica a
// propósito en vez de importarse: el renderer no cruza a electron/, misma
// convención que src/lib/graph-view.ts y src/lib/launch-cmd.ts.
import type { GraphTemplate, GraphRun, NodeRunState } from '../types'

/** Estados que significan "este nodo terminó su corrida", bien o mal. Un gate
 *  recién se puede evaluar cuando todos sus upstream llegaron a uno de estos. */
const RESOLVED: NodeRunState[] = ['done', 'needs_input', 'blocked', 'failed', 'skipped']

export interface GateConcerns {
  /** Etiqueta del reviewer: `role` o `role · focus`. */
  from: string
  items: string[]
}
export interface PendingGate {
  gateId: string
  /** Vacío cuando el gate frena por modo y no porque alguien haya bloqueado. */
  concerns: GateConcerns[]
}

/** El primer gate del template que está esperando una decisión humana, con los
 *  concerns de los reviewers de los que depende que hayan bloqueado.
 *
 *  Espera decisión cuando todos sus upstream terminaron y además:
 *   · alguno no terminó en 'done' (bloqueó, falló) → siempre necesita un humano; o
 *   · terminaron todos limpios pero el modo es 'gate'/'step' → retenido a propósito.
 *
 *  En modo 'auto' un gate limpio se resuelve solo, así que no devuelve nada. */
export function pendingGate(template: GraphTemplate, run: GraphRun): PendingGate | null {
  const byId = new Map(template.nodes.map((n) => [n.id, n]))
  const stateOf = (id: string): NodeRunState => run.nodes[id]?.state ?? 'queued'

  for (const gate of template.nodes) {
    if (gate.kind !== 'gate') continue
    // Ya resuelto (aprobado y aplicado por el tick, o cortado por una falla).
    if (['done', 'skipped'].includes(stateOf(gate.id))) continue

    const deps = gate.dependsOn.map(stateOf)
    if (deps.some((s) => !RESOLVED.includes(s))) continue        // todavía corriendo
    const blocked = !deps.every((s) => s === 'done')
    if (!blocked && run.mode === 'auto') continue                // se resuelve solo

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
  return null
}
