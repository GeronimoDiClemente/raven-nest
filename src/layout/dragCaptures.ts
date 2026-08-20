import type { PaneNode } from '../types'

export interface DragCaptureSpec {
  paneId: string
  kind: 'browser' | 'dom'
}

// Al empezar un drag de panes, decidimos qué panes fotografiar:
// - TODOS los browser → su WebContentsView nativo se colapsa durante el drag
//   (pintaría sobre el fantasma), así que mostramos su foto congelada EN SU
//   LUGAR en vez de un hueco negro. Captura nativa ('browser'), siempre anda.
// - El pane arrastrado (si no es browser) → 'dom' para el fantasma del overlay
//   (best-effort: en terminal/editor GPU puede volver null y cae al ghost con
//   etiqueta).
export function collectDragCaptures(panes: PaneNode[], draggingId: string): DragCaptureSpec[] {
  const specs: DragCaptureSpec[] = []
  const seen = new Set<string>()
  for (const p of panes) {
    if (p.aiType === 'browser' && !seen.has(p.id)) {
      specs.push({ paneId: p.id, kind: 'browser' })
      seen.add(p.id)
    }
  }
  if (!seen.has(draggingId) && panes.some(p => p.id === draggingId)) {
    specs.push({ paneId: draggingId, kind: 'dom' })
  }
  return specs
}
