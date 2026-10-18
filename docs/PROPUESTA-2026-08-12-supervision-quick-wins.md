# Propuesta: 3 mejoras para supervisar agentes

> Tres features chicas y concretas. Para cada una: qué problema resuelve, qué propongo, y cómo se haría sobre el código actual. — Elise, 2026-08-12

La idea común: Nest ya es muy bueno **corriendo** varios agentes a la vez. Estas tres lo hacen mejor **avisándote qué pasa con ellos**.

---

## 1. Radar de conflictos entre worktrees — `S`

**El problema.** Dos agentes en ramas distintas pueden estar tocando los mismos archivos, y nadie se entera hasta el merge — cuando el conflicto ya es grande.

**La propuesta.** Nest avisa apenas dos worktrees tienen cambios sobre el mismo archivo: chip de alerta en ambos panes con la lista de archivos en colisión, y sugerencia de qué rama conviene mergear primero.

**Cómo.** Los datos ya están: `git:status` por worktree (`electron/main.ts`) da los archivos modificados — solo falta cruzarlos entre worktrees con un watcher. Sin dependencias nuevas. Shippeable en días.

---

## 2. Baton Pass: pasar contexto entre panes — `S`

**El problema.** Cuando un agente llena su contexto, o hay que seguir el trabajo en otro pane o mañana, el traspaso es copy-paste manual. Y el auto-compact de Claude pierde detalle sin avisar.

**La propuesta.** Un botón por pane que le pide al agente escribir su resumen de traspaso (qué hizo, qué decidió, qué falta) y lo inyecta como primer prompt en otro pane. Extra: aviso cuando Claude está por auto-compactar, para generar el resumen a tiempo.

**Cómo.** Inyectar texto a un pane ya existe (`window.pty.write` — lo usan snippets y broadcast). El resumen se guarda como archivo en el worktree. No pisa la memoria de contextos de Bautista (GUIA-EQUIPO §5): esto es traspaso inmediato entre panes, no persistencia entre sesiones.

---

## 3. Semáforo de agentes — `M`

**El problema.** El dot del Hub dice "activo/inactivo", pero no dice *por qué* un pane está quieto: ¿terminó? ¿espera que le aprueben un permiso? ¿se colgó? Con varios agentes abiertos, uno puede quedar 20 minutos frenado sin que nadie lo vea.

**La propuesta.** Estado visible por pane — *trabajando / esperando input / pidiendo permiso / terminó / error* — con badge en el header y notificación del sistema con click para saltar al pane que te necesita.

**Cómo.** Extiende el clasificador de actividad que ya existe (`src/hub-activity.ts`) con patrones por CLI: las regex que reconocen prompts de permiso y spinners ya están en `src/lib/terminal-chrome.ts` (hoy solo filtran ruido visual). Notificaciones con la API nativa de Electron. Sin dependencias nuevas.

---

## Por qué estas tres

- Atacan los dolores más repetidos de correr agentes en paralelo: perder el hilo de quién hace qué, conflictos que explotan al merge, contexto que se pierde.
- Las tres reutilizan piezas que ya están en el código; ninguna suma dependencias.
- El semáforo además deja la base para cosas más grandes (checks automáticos al terminar un agente, cola de revisión) si más adelante interesan.

Si alguna les cierra, la escribo como spec en `docs/specs/` con el formato de siempre.
