// Tipear un texto en un pane y mandar el Enter aparte: los TUIs de agentes (claude/codex)
// tratan "texto + \r" en un solo write como pegado y no lo envían.

export function typeThenSubmit(
  write: (paneId: string, data: string) => void,
  setTimer: (fn: () => void, ms: number) => unknown,
  paneId: string,
  text: string,
  delayMs = 500
): void {
  write(paneId, text)
  setTimer(() => write(paneId, '\r'), delayMs)
}
