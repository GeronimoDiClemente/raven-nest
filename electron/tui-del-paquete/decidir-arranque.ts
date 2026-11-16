// Si `nestmux-memory` sin argumentos puede abrir la TUI. Aparte de `arrancar.ts` a propósito:
// el CLI lo importa estáticamente, y `arrancar.ts` arrastra React e Ink, que sólo se cargan
// con el `import()` del caso `tui`.

export type Decision = 'abrir' | 'ayuda' | 'sin-modo-crudo'

export function decidirArranque(t: { stdinTTY: boolean; stdoutTTY: boolean; tieneSetRawMode: boolean }): Decision {
  // Un pipe de cualquier lado (`echo | nestmux-memory`, `nestmux-memory | less`) no es una
  // persona mirando una terminal: la ayuda de siempre.
  if (!t.stdinTTY || !t.stdoutTTY) return 'ayuda'
  if (!t.tieneSetRawMode) return 'sin-modo-crudo'
  return 'abrir'
}
