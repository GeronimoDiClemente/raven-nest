/**
 * ¿El evento de teclado nació dentro de un editor Monaco?
 *
 * El listener global de App corre en fase de CAPTURA, así que gana los atajos
 * antes que el editor. Para los que Monaco también usa (Ctrl+F = Find del
 * archivo) hay que cederle el evento: si no, Nest abre su búsqueda global y,
 * como no corta la propagación, Monaco abre su Find encima.
 */
export function isInsideCodeEditor(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false
  return target.closest('.monaco-editor') !== null
}
