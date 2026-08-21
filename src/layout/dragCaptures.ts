import type { PaneNode } from '../types'

export interface DragCaptureSpec {
  paneId: string
  kind: 'browser' | 'dom'
}

// Al empezar un drag de panes, fotografiamos TODOS los browser: su
// WebContentsView nativo se colapsa durante el drag (pintaría sobre el
// fantasma), así que mostramos su foto congelada EN SU LUGAR en vez de un
// hueco negro. Captura nativa ('browser'), siempre anda.
//
// El pane ARRASTRADO no se fotografía. Se intentaba con kind 'dom' (captura de
// la ventana + crop), pero para entonces React ya pintó el DragOverlay encima
// del pane origen: la "foto" era el propio fantasma opaco, un rectángulo gris.
// El ghost con etiqueta (archivo / dominio / tipo) es lo que se ve igual.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function collectDragCaptures(panes: PaneNode[], _draggingId?: string): DragCaptureSpec[] {
  const specs: DragCaptureSpec[] = []
  const seen = new Set<string>()
  for (const p of panes) {
    if (p.aiType === 'browser' && !seen.has(p.id)) {
      specs.push({ paneId: p.id, kind: 'browser' })
      seen.add(p.id)
    }
  }
  return specs
}
