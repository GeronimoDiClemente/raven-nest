// src/integrations/terminalCapture.ts
// Captura las últimas líneas visibles del terminal enfocado para adjuntarlas
// al compose bar de un panel de integración (hito 2: reemplaza el placeholder
// del hito 1 por output real del pane activo).
import { getTerminal } from '../terminal-instances'

export function captureTerminalOutput(paneId: string | null, maxLines = 30): string {
  if (!paneId) return ''
  const term = getTerminal(paneId)
  if (!term) return ''

  const buffer = term.buffer.active
  // TUI apps (vim, less, fzf) usan el buffer alternate — no tiene sentido
  // adjuntar su pantalla como "output de terminal" (mismo guard de useXterm.ts).
  if (buffer.type === 'alternate') return ''

  // Recorre desde la línea del cursor hacia arriba para no incluir filas por
  // debajo del contenido real (scrollback vacío).
  const startY = buffer.baseY + buffer.cursorY
  const collected: string[] = []
  for (let y = startY; y >= 0; y--) {
    const line = buffer.getLine(y)
    if (!line) continue
    collected.push(line.translateToString(true))
  }

  // Salta las líneas vacías finales (las más cercanas al cursor, ej. un
  // prompt sin nada tipeado todavía) para no gastar el budget de líneas en
  // blancos.
  let start = 0
  while (start < collected.length && collected[start].trim() === '') start++

  const lastLines = collected.slice(start, start + maxLines)
  return lastLines.reverse().join('\n')
}
