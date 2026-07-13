# Spec (borrador): Editor + Review de cambios en Nest — aprendizajes de Superset

> Estado: BORRADOR para charlar con Gero/Bauti antes de codear (el editor es área de Bauti según GUIA-EQUIPO §5; el review/diff toca área común).
> Fuente: análisis del código de github.com/superset-sh/superset (open source, clonado 2026-07-13). Superset = competencia directa: "Code Editor for the AI Agents Era", orquesta Claude Code/Codex/etc. en git worktrees. MISMO stack que Nest: Electron + electron-vite + React + TS.

## Cómo lo tiene Superset (resumen ejecutivo)

Tres pilares:

### 1. Editor integrado — CodeMirror 6 (NO Monaco)
- Pane `kind:"file"` (`FilePane`) con un **registry de vistas** con prioridades estilo VS Code (`exclusive > default > builtin > option`): CodeView (editor), ImageView, VideoView, MarkdownPreview, BinaryWarning. `resolveViews(filePath, meta)` decide; un `.md` ofrece toggle Preview/Code.
- CodeMirror 6 con 3 `Compartment` (language/theme/editable) para reconfigurar sin recrear. Lenguaje por extensión con **imports dinámicos** (`@codemirror/lang-*` + legacy-modes para shell/toml/etc.).
- Theme construido desde tokens JS del design system (no CSS vars directo) + `HighlightStyle` de lezer para syntax.
- **`fileDocumentStore`**: store singleton fuera de React (Map por `workspaceId:absolutePath`, refcounting, `useSyncExternalStore`). Maneja: dirty (`content !== savedContent`), guardado Ctrl+S con **optimistic concurrency** (revision `ifMatch` → conflict), binarios (detección `\0`), límite 10MB, orphaned (borrado externo), rename.
- **Watcher de cambios externos** (@parcel/watcher, throttling copiado de VS Code): si un agente modifica el archivo y el buffer está limpio → recarga sola; si está dirty → banner "external change", nunca pisa. Conflicto al guardar → Save/Don't Save/Cancel.
- Auto-pin de la pestaña cuando el doc pasa a dirty (evita que un pane preview se recicle con cambios sin guardar).

### 2. Review de cambios — DiffPane con @pierre/diffs
- Pane `kind:"diff"` que renderiza **el changeset completo del worktree** (todos los archivos apilados, headers sticky), no un diff por archivo. Navegación por scroll/focus a archivo/línea.
- Render: `CodeView` de `@pierre/diffs` (read-only), **split/unified** toggle, syntax con **Shiki en worker pool** (tokenizeMaxLength 200k para lockfiles).
- Datos: `useChangeset` deriva de git status (uncommitted / against-base / commit concreto, staged/unstaged). Diffs por archivo con queries paralelas.
- **Acciones**: discard por archivo y masivo, stage/unstage all, "Viewed" (colapsa), abrir en editor interno (a la línea del diff) o externo, comentarios de PR como anotaciones.
- **CLAVE estratégica: commit/merge/push/PR NO están en la UI** — los ejecuta el agente o el usuario en la terminal. La UI solo lee estado de PRs. Simplifica muchísimo el alcance.

### 3. Detección agente→UI — GitWatcher + eventos
- Watcher server-side por worktree: `fs.watch` de `.git/` (commits/staging/branch) + watcher del árbol de trabajo (ediciones). Debounce 300ms/1s. Emite `git:changed` con paths.
- El cliente invalida sus queries → refetch status+diffs → badges se actualizan solos: **+N/−M por workspace/tarea**, puntitos de estado por archivo/carpeta en el árbol, conteos por sección.
- **El loop diferenciador**: seleccionás líneas EN el diff → composer → "pedile a un agente que lo arregle" → arma prompt con contexto archivo/rango → lo manda a una terminal de agente existente o crea una nueva → el agente edita → GitWatcher → el diff se refresca solo.

## Qué tiene Nest hoy (ventaja: mismo stack)
- Sistema de panes agnóstico (`PaneLayoutEngine`), precedente de pane no-terminal: `BrowserCell` (`AIType` incluye 'browser').
- `DiffViewerPanel` casero (tipos `DiffFile`/`DiffLine`, git diff vía IPC bridge).
- `worktree-store` + agentes corriendo en terminales (el corazón de Nest).
- Convenciones: IPC `<domain>:<action>` (no tRPC), hooks planos (NO React Query — prohibido por guía), `global.css` con tokens, sin deps nuevas sin charla.

## Plan de integración propuesto (fases = PRs chicos apilados)

**Decisiones previas (charla con Gero/Bauti):**
1. Editor: **CodeMirror 6** (validado por la competencia; liviano, modular, themeable; la guía ya pedía spec para Monaco vs CodeMirror — esto la responde). Deps `@codemirror/*` → package.json = zona sensible → OK de Gero.
2. Ownership: editor = área de Bauti (guía §5). Opciones: (a) lo hace Bauti con esta spec, (b) lo hace Matías coordinado, (c) split: Bauti editor / Matías review+watcher (adyacente a su DiffViewer/worktrees).
3. Diff: ¿adoptar `@pierre/diffs`+shiki (dep nueva, mucho gratis) o evolucionar el DiffViewerPanel casero? Recomendación: casero primero (cero deps), evaluar pierre si duele.

**Fase 1 — EditorPane MVP (~3 PRs):**
- PR-a: dominio IPC `fs:` en electron/main.ts (read/write con revision para conflict, stat) + preload + types. Patrón store existente. Tests del caso `''`/undefined (pitfall de la guía).
- PR-b: componente `EditorPane` con CodeMirror 6 (lineNumbers, history, search, bracket matching, Ctrl+S, dirty indicator en el tab). Lenguaje por extensión con imports dinámicos (empezar con ts/js/json/css/html/md/python). Theme desde los tokens de Nest (leer CSS vars una vez con getComputedStyle → construir EditorView.theme).
- PR-c: integración: `'editor'` en `AIType`, `SessionPane.filePath` (persistencia de sesión), rama en `renderPane` (patrón BrowserCell), opción en NewPaneDialog + "Open file" desde DiffViewerPanel.

**Fase 2 — Watcher + robustez (~1-2 PRs):**
- Watcher en main (chokidar o @parcel/watcher) → broadcast `fs:changed` → recarga si limpio / banner si dirty / conflict al guardar (semántica exacta de Superset, es la correcta). OJO pitfall guía: broadcasts main→renderer mueren en silencio tras hide/restore del tray — testear ese flujo.

**Fase 3 — Review upgrade (~2 PRs):**
- Changeset view por worktree en DiffViewerPanel: lista de archivos con +N/−M, discard por archivo (guard + confirm — pitfall deletes de la guía), "Open file" a la línea.
- Badge "+N −M" por worktree en la sidebar (GitWatcher liviano: debounce de git status).

**Fase 4 — El loop con agentes (el diferenciador, ~1-2 PRs):**
- Seleccionar líneas en el diff → "Fix with agent" → prompt con contexto (archivo, rango, diff) → inyectar a una terminal de agente existente o crear pane nuevo. Nest ya tiene TODO para esto (agentes en panes + PTY).

**Fuera de alcance v1:** file tree completo (entrada: diff + quick-open después), markdown preview, comentarios de PR, video/image views.

## Rutas de referencia en el repo de Superset (github.com/superset-sh/superset)
- Editor: `apps/desktop/src/renderer/routes/_authenticated/_dashboard/v2-workspace/$workspaceId/hooks/usePaneRegistry/components/FilePane/registry/views/CodeView/components/CodeEditor/`
- Store de documentos: `.../\$workspaceId/state/fileDocumentStore/`
- Diff: `.../usePaneRegistry/components/DiffPane/` + `packages/host-service/src/trpc/router/git/git.ts`
- Watcher: `packages/host-service/src/events/git-watcher.ts`, `packages/workspace-fs/src/watch.ts`
- Registry de panes: `.../hooks/usePaneRegistry/usePaneRegistry.tsx`
