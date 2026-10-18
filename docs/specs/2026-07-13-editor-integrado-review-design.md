# Spec (borrador): Editor integrado + review de cambios en Nest

> Estado: BORRADOR para charlar antes de codear (el editor es área de Bauti según GUIA-EQUIPO §5; el review/diff toca área común).
> Basado en un relevamiento del estado del arte de editores/IDEs orientados a agentes y en los patrones de editor de VS Code.

## Objetivo

Cerrar el loop dentro de Nest: hoy los agentes editan archivos en worktrees y el usuario tiene que irse a otro editor para ver/tocar el resultado. La propuesta: poder **ver los cambios (review), abrir el archivo, editarlo y guardarlo** sin salir de Nest, y desde el review **mandarle correcciones al agente**.

## Diseño propuesto

### 1. Editor integrado — CodeMirror 6 (decisión: no Monaco)

La guía pedía spec para la decisión Monaco vs CodeMirror. Propuesta: **CodeMirror 6**.
- Modular: se paga solo lo que se usa (core ~300KB vs varios MB de Monaco); carga de lenguajes por **import dinámico** según extensión.
- Theming programático limpio (construir el theme desde los tokens CSS de Nest).
- Arquitectura de `Compartment` permite reconfigurar lenguaje/tema/readonly sin recrear el editor.
- Es la elección dominante en los editores embebidos de la generación actual.

**Pane `editor` con registry de vistas** (patrón de prioridades estilo VS Code `RegisteredEditorPriority`): según el archivo se resuelve la vista — código (default), imagen, preview de markdown con toggle Preview/Código, aviso para binarios. Extensible a futuro.

**Store de documentos compartido** (singleton fuera de React, `useSyncExternalStore`):
- Estado **dirty** (`contenido !== guardado`), indicador en el tab, auto-pin del tab al ensuciarse.
- **Guardado (Ctrl+S) con optimistic concurrency**: cada lectura lleva una `revision`; si el disco cambió al guardar → diálogo Save / Don't Save / Cancel.
- Detección de binarios, límite de tamaño con "cargar igual", estado orphaned si el archivo se borra.

### 2. Cambios externos (los agentes editan mientras mirás)

Watcher de archivos en el proceso main (throttling estilo VS Code) → broadcast `fs:changed` al renderer:
- Buffer **limpio** → el archivo se recarga solo.
- Buffer **dirty** → banner "el archivo cambió en disco", nunca pisar el trabajo del usuario.
- OJO pitfall conocido de Nest: los broadcasts main→renderer pueden morir tras hide/restore del tray — testear ese flujo.

### 3. Review de cambios (evolución del DiffViewerPanel)

- **Changeset view por worktree**: lista de archivos cambiados con +N/−M, diff completo apilado con headers sticky, toggle split/unified.
- Acciones por archivo: **descartar** (con confirm + guard contra identificadores vacíos — pitfall de la guía), marcar como visto, **abrir en el editor en la línea exacta**.
- Badge "+N −M" por worktree en la sidebar, actualizado por un watcher liviano de git status (debounced).
- **Alcance deliberado: commit/merge/push/PR quedan FUERA de la UI** — eso lo hace el agente o el usuario en la terminal, que ya es el corazón de Nest. Achica el riesgo y el diff.

### 4. "Fix with agent" desde el diff (el diferenciador)

Seleccionar líneas en el diff → composer → arma un prompt con contexto (archivo, rango, diff) → lo inyecta a una **terminal de agente existente o crea un pane nuevo**. Nest ya tiene agentes corriendo en panes con PTY: es el feature con mejor relación costo/impacto del plan.

## Integración con lo existente

- `'editor'` se suma al union `AIType`; `SessionPane` persiste `filePath` (patrón `BrowserCell`, el precedente exacto de pane no-terminal — GUIA-EQUIPO §5).
- Dominio IPC nuevo `fs:<action>` (read/write/stat con revision) en `electron/main.ts` + preload + `src/types.ts`, patrón store existente. Tests del caso `''`/`undefined` en identificadores.
- Estilos en `global.css` con tokens, prefijo `.ed-*` / `.cs-*`.
- Sin React Query ni state managers (convención del repo): hooks + store con `useSyncExternalStore`.

## Fases = PRs chicos apilados

1. **PR-a**: dominio IPC `fs:` + tests. **PR-b**: componente EditorPane (CodeMirror 6, dirty, Ctrl+S, lenguajes ts/js/json/css/html/md/py). **PR-c**: integración panes (AIType, NewPaneDialog, renderPane) + "Open file" desde el DiffViewerPanel.
2. Watcher `fs:changed` + conflictos.
3. Changeset view + badges por worktree.
4. "Fix with agent" desde el diff.

**Fuera de alcance v1:** file tree completo, markdown preview, comentarios de PR, vistas de imagen/video.

## Decisiones a tomar antes de codear

1. **Ownership**: editor es área de Bauti (§5). ¿Bauti solo con esta spec, coordinado, o split (editor / review)?
2. Deps `@codemirror/*` — package.json es zona sensible.
3. ¿Lib de diff rendering o evolucionar el DiffViewerPanel casero? Recomendación: casero primero (cero deps nuevas).
