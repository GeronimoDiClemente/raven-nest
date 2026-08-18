// Path de modelo Monaco calificado por worktree.
//
// Los modelos de Monaco son GLOBALES (registro por URI) y @monaco-editor/react
// los keyea por el prop `path`. Usar el relPath pelado hacía que dos panes
// sobre worktrees DISTINTOS con el mismo archivo compartieran un único modelo:
// el último read pisaba el buffer del otro y Ctrl+S escribía en disco el
// contenido del worktree equivocado. El path calificado hace la identidad
// worktree+archivo explícita — y de paso habilita matching EXACTO (nada de
// endsWith, que confundía foo.ts con src/foo.ts).
//
// El token del worktree es un hash (djb2) y no el path crudo: los paths de
// Windows traen ":" y "\" que monaco.Uri.parse malinterpreta como scheme.

function worktreeToken(worktreePath: string): string {
  let h = 5381
  for (let i = 0; i < worktreePath.length; i++) {
    h = ((h << 5) + h + worktreePath.charCodeAt(i)) >>> 0
  }
  return h.toString(36)
}

export function modelPathFor(worktreePath: string, relPath: string): string {
  return `nest-${worktreeToken(worktreePath)}/${relPath.replace(/\\/g, '/')}`
}
