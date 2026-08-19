import { AI_CONFIG } from '../types'
import type { PaneNode } from '../types'

export interface PaneOverlayLabel {
  /** Texto a mostrar en el overlay de arrastre del pane. */
  text: string
  /** Color CSS del texto. */
  color: string
  /**
   * Editor con archivo abierto: basename del archivo activo. Cuando está
   * presente, el overlay renderiza además el FileIcon y colorea el texto según
   * la extensión (extClass), como en las tabs — por eso `color` se ignora.
   */
  fileName?: string
}

/** hostname navegable de una URL, sin `www.`; null si no es http(s) real. */
function hostname(url: string | undefined): string | null {
  if (!url) return null
  try {
    const h = new URL(url).hostname.replace(/^www\./, '')
    return h || null
  } catch {
    return null
  }
}

/**
 * Qué mostrar en el overlay de arrastre (dnd-kit DragOverlay) de un pane.
 * El editor muestra el archivo activo (no "Editor") y el browser su dominio
 * (no "Browser"); el resto mantiene el label del tipo como antes.
 */
export function paneOverlayLabel(pane: PaneNode): PaneOverlayLabel {
  if (pane.aiType === 'editor') {
    const file = pane.activeEditorTabPath?.split('/').pop()
    if (file) return { text: file, color: '', fileName: file }
    return { text: AI_CONFIG.editor.label, color: AI_CONFIG.editor.color }
  }
  if (pane.aiType === 'browser') {
    const host = hostname(pane.url)
    return host
      ? { text: host, color: AI_CONFIG.browser.color }
      : { text: AI_CONFIG.browser.label, color: AI_CONFIG.browser.color }
  }
  return {
    text: AI_CONFIG[pane.aiType]?.label ?? 'Terminal',
    color: AI_CONFIG[pane.aiType]?.color ?? '#888888',
  }
}
