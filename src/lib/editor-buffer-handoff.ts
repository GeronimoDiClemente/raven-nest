// Mudanza de tabs entre panes de editor con el buffer sin guardar A CUESTAS.
//
// `contents` es estado interno de cada EditorPane: al mover una tab (botón
// "Open in new pane" o drag & drop) la metadata viaja por App pero el buffer
// no — el pane destino leía el disco y el edit sin guardar se esfumaba. El
// pane ORIGEN deja el buffer acá al iniciar la mudanza y el DESTINO lo
// consume en su carga en lugar de leer disco. Stash de un solo uso: si el
// drag se cancela, el origen lo descarta con dropTabBuffer.
export interface TabHandoff {
  content: string
  eol: '\n' | '\r\n'
  dirty: boolean
}

const stash = new Map<string, TabHandoff>()

const key = (worktreePath: string, relPath: string) => `${worktreePath}::${relPath}`

export function stashTabBuffer(worktreePath: string, relPath: string, handoff: TabHandoff): void {
  stash.set(key(worktreePath, relPath), handoff)
}

export function takeTabBuffer(worktreePath: string, relPath: string): TabHandoff | undefined {
  const k = key(worktreePath, relPath)
  const h = stash.get(k)
  stash.delete(k)
  return h
}

export function dropTabBuffer(worktreePath: string, relPath: string): void {
  stash.delete(key(worktreePath, relPath))
}

// Solo para tests.
export function __resetHandoffForTests(): void {
  stash.clear()
}
