# Editor de código — checklist de smoke-test manual (por SO)

Correr esto en Windows, macOS y Linux antes de mergear `feat/code-editor-integration`,
además del E2E automático (que solo corre en el SO del runner de CI que lo ejecute).

1. Abrir Nest, vincular un repo real.
2. Expandir el Explorer en el Sidebar — se ve el árbol de archivos, `.git` no aparece.
3. Expandir una carpeta con subcarpetas — el listado lazy carga solo esa carpeta.
4. Clickear un archivo — se abre un pane de editor nuevo con el contenido correcto.
5. Editar el archivo — la tab muestra el punto de "cambios sin guardar".
6. Ctrl+S (Cmd+S en mac) — el punto desaparece; verificar en un editor externo que el archivo en disco cambió.
7. Con el archivo abierto y SIN cambios sin guardar, modificar el archivo desde una terminal
   dentro de Nest (`echo cambio >> archivo`) — el editor debe recargar el contenido solo.
8. Con el archivo abierto y CON cambios sin guardar, modificar el archivo desde una terminal —
   debe aparecer el banner de conflicto con las dos opciones (mantener / recargar).
9. Clickear un segundo archivo — se abre como tab nueva en el mismo pane, no un pane nuevo.
10. Usar "Abrir en pane nuevo" en una tab — el archivo se mueve a un pane de editor separado.
11. Borrar el worktree activo desde el sidebar mientras el editor lo tiene abierto — las tabs de ese worktree se cierran con aviso, sin crash.
