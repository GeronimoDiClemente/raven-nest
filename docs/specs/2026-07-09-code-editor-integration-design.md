# Editor de código embebido en Nest — Design Spec

**Fecha:** 2026-07-09 (v1.2: 2026-07-10)
**Estado:** Aprobado para pasar a plan de implementación (v1.1 — corregido el mecanismo de panes/splits y el límite de plan tras verificar el código real; v1.2 — Monaco debe bundlearse localmente, no cargarse desde CDN, ver "Monaco offline")

## Contexto y objetivo

Nest es hoy un terminal multiplexer (Electron + xterm.js/node-pty) para correr subagentes en paralelo, con soporte de repos/worktrees y un diff viewer de solo lectura (`DiffViewerPanel.tsx`). El objetivo de este cambio es sumar un editor de código embebido, estilo VS Code, para poder ver y editar archivos línea por línea sin salir de Nest — sin reemplazar la opción existente de abrir un IDE externo (`ide-launcher.ts`), que se mantiene tal cual.

## Arquitectura

### Explorer (nuevo panel del Sidebar)

Nueva sección en `Sidebar.tsx`, al mismo nivel que `MyReposPanel`/`WorktreesSection`, que muestra el árbol de archivos del **tab activo**: usa el mismo `repoPath`/`worktreePath` que ya usan las terminales de ese tab, sin selector propio. Al cambiar de tab, el árbol cambia solo.

- Carga **lazy**: al expandir una carpeta se pide su listado (`fs.listDir`), no se lee el árbol completo de entrada. Necesario para repos grandes y para no pagar costo de I/O por adelantado en ningún SO.
- Oculta siempre `.git`. Filtrado por `.gitignore` queda fuera de v1 (ver "Fuera de alcance").
- El árbol se re-suscribe a cambios de las carpetas expandidas (mismo watcher que el resto del sistema, ver más abajo) para reflejar archivos creados/borrados por un subagente corriendo en una terminal del mismo tab — consistente con el principio de "detectar y avisar" del resto del diseño.

### Editor pane (nuevo tipo de pane)

**Corrección post-verificación de código (v1.1 del spec):** `PaneLayoutEngine` no es un árbol de splits libre. `panes` es un array plano (`PaneNode[]`) por tab, y el layout (`layoutId`) es un preset fijo de un catálogo (`1`, `2V`, `2H`, `3C`... hasta `12C`, ver `src/layout/presets.ts`) que se recalcula solo según cuántos panes hay (`defaultLayoutFor(nextPanes.length)`, usado en `addPane`, `src/App.tsx:239-274`). No existe "splitear una posición libre" — agregar un pane siempre es empujar al array y dejar que el preset se re-acomode.

El editor se modela igual que ya se modela `browser` hoy: un valor nuevo de `AIType` (`'editor'`, sumado al union en `src/types.ts:1`), con su entrada en `AI_CONFIG` (`src/types.ts:198-207`), y una rama nueva en `renderPane` (`src/App.tsx:1081`): `pane.aiType === 'editor' ? <EditorCell .../> : ...`. No hace falta un discriminante `kind` nuevo — el codebase ya usa `aiType` para esto.

- Sidebar interno con tabs de archivos abiertos (no un pane nuevo por archivo). Cada tab tiene indicador de "cambios sin guardar" (dot). Este estado (lista de archivos abiertos, tab activa, dirty flag) vive en el propio `PaneNode` del editor (mismo array `panes` que usan las terminales), no en un store aparte.
- "Abrir en pane nuevo" (sacar una tab a un pane aparte) es una acción de menú contextual en la tab, no un drag-and-drop de posición libre (no hay ese mecanismo en el codebase): remueve el archivo de las tabs internas del pane actual y agrega un `PaneNode` `aiType: 'editor'` nuevo con ese único archivo — mismo `addPane` que agrega una terminal.
- **Límite de panes:** los panes de editor cuentan contra el mismo `MAX_PANES`/`planLimits.maxPanes` que las terminales. Si el usuario está en el límite del plan y clickea un archivo, ve el mismo modal de upgrade que hoy ve al intentar agregar una terminal — cero lógica nueva de conteo, decisión explícita para mantener consistencia con el resto de la app.
- Motor de edición: **Monaco Editor** (`@monaco-editor/react` + `monaco-editor`), mismo motor que VS Code. Nuevas dependencias (ver "Monaco offline" para por qué son dos y dónde va cada una).
- Guardado: manual, Ctrl+S / Cmd+S (Monaco resuelve la diferencia de atajo por plataforma sola). Dispara `bridge.fs.write(path, content)`.

### Flujo de apertura de archivo

1. Click en un archivo del Explorer.
2. Si el tab activo ya tiene un pane con `aiType: 'editor'` (el último enfocado), el archivo se abre ahí como tab nueva (o se enfoca la tab si ya estaba abierto) — actualización in-place del `PaneNode`, sin tocar el array `panes`.
3. Si no hay ningún pane de editor en el tab activo, se agrega un `PaneNode` nuevo con `aiType: 'editor'` — mismo `addPane` que agrega una terminal, sujeto al mismo límite de plan (punto anterior).

### Conflictos de archivo (disco vs editor)

Nest corre subagentes en paralelo que pueden modificar archivos abiertos en el editor. Por archivo abierto, el main process mantiene un watcher:

- Sin cambios sin guardar en el editor → el archivo se recarga solo cuando cambia en disco.
- Con cambios sin guardar → banner de conflicto ("el archivo cambió en disco: ¿mantener tus cambios o recargar?"), nunca se pisa nada en silencio.

## Bridge de filesystem (nuevo)

Hoy `preload.ts` solo expone `git`, `worktree`, `diff`, `pathUtils`, `ide` — no hay lectura/escritura de archivos cruda. Se suma:

```
fs.readFile(path)          → contenido de un archivo
fs.writeFile(path, content) → escritura (usada por Ctrl+S)
fs.listDir(path)            → listado de una carpeta (para el Explorer, lazy)
fs.watch(path)               → suscripción a cambios; usada tanto por
                                archivos abiertos en el editor como por
                                carpetas expandidas en el Explorer
```

Los handlers viven en el main process (`electron/fs-bridge.ts`, nuevo módulo). **Cada path recibido se resuelve con `realpath` y se valida contra el `repoPath`/`worktreePath` correspondiente antes de tocar disco** — un pane de editor no puede leer ni escribir nada fuera del repo/worktree al que pertenece. Mismo principio de scoping que ya aplica `worktree-store.ts`, extendido a fs plano.

## Monaco offline (corrección v1.2, post-research)

`@monaco-editor/react` **por defecto NO bundlea Monaco: lo descarga en runtime desde el CDN de jsdelivr** vía su `loader`. La app hoy no tiene CSP (nada lo bloquearía), pero en una app de escritorio eso significa que el editor no abre sin internet y que metemos una dependencia de red en runtime. Corrección obligatoria:

- Se instala también el paquete **`monaco-editor`** y se lo registra local con `loader.config({ monaco })` en un módulo de setup (`src/lib/monaco-setup.ts`) importado desde el entry del renderer (`src/main.tsx`), **antes** de que se monte cualquier `<Editor>`.
- Los web workers de Monaco (editor + TS/JSON/CSS/HTML) se registran vía `self.MonacoEnvironment.getWorker` con imports `?worker` de Vite — patrón oficial documentado por `@monaco-editor/react` para Vite; funciona igual bajo `electron-vite` (el renderer es un build Vite estándar).
- **Ubicación de dependencias:** `electron-builder` empaqueta las `dependencies` de `node_modules` en el instalador (así llegan `node-pty`/`koffi`). `monaco-editor` pesa ~90MB en `node_modules` y Vite ya lo bundlea en `dist/**` → **`monaco-editor` y `@monaco-editor/react` van en `devDependencies`**. `chokidar` en cambio corre en el main process, que `externalizeDepsPlugin` no bundlea (se carga de `node_modules` en runtime) → **`chokidar` va en `dependencies`**.

## Multiplataforma (Windows / macOS / Linux)

- Todo el fs bridge corre en el main process (Node puro) — nunca en el renderer. Evita diferencias de sandboxing entre SO.
- File watching con **chokidar** en vez de `fs.watch` nativo: el soporte de `recursive` de `fs.watch` es inconsistente entre SO (anda en macOS/Windows, no en Linux) y chokidar ya resuelve esas diferencias. Nueva dependencia chica, justificada por evitar bugs específicos de plataforma.
- Paths normalizados con las utilidades de Node (`path.normalize`/`path.sep`), sin asumir separador manualmente en código nuevo — mismo cuidado que ya tiene `worktree-store.ts`.
- El workflow de release ya buildea Windows/Mac/Linux en paralelo (`gh workflow run "Build (Windows, Mac, Linux)"`), lo que valida al menos que compila en los tres.

## Testing

Sin necesidad de levantar Electron real para la mayoría de los casos — el main process es Node puro y ya hay precedente de testearlo así (`electron/__tests__/worktree-store.test.ts`, `electron/__tests__/cli-install-runner.test.ts`).

1. **Main process (`fs-bridge.ts`)** — unit tests con Vitest: scoping rechaza paths fuera del worktree, el watcher dispara eventos correctos ante cambios, manejo de errores de escritura.
2. **Componentes React (Explorer, tabs del editor)** — React Testing Library, mismo patrón que `src/__tests__/components/bridge-context.test.tsx`: se mockea el `BridgeProvider` (no `window` directo) y se testea render del árbol, apertura de tabs al clickear, aparición del banner de conflicto.
3. **Corrección post-verificación:** ya hay infraestructura Playwright + Electron instalada (`@playwright/test`, scripts `e2e`/`e2e:ui`/`pre-e2e` en `package.json`), sin tests E2E reales todavía sobre esta feature. El plan de implementación suma un test E2E real (abrir archivo, editar, guardar, verificar contenido en disco) que corre en CI sobre al menos un SO, más smoke-test manual mínimo en los otros dos antes de mergear — ya no es "solo manual".

## Manejo de errores

- Escritura falla (permisos, disco lleno, archivo borrado externamente) → `window.alert(...)` con el error; la tab NO se marca como guardada. **Corrección post-verificación:** no existe un servicio de toasts global en la app — el precedente real (`src/App.tsx:537-541`, `WorktreesSection.tsx:160`) es `window.alert(...)` para fallas raras que necesitan feedback inmediato. Se sigue ese mismo patrón en vez de inventar un componente de toast nuevo.
- Archivo binario o demasiado grande → el Explorer lo muestra, pero al abrirlo el bridge de fs rechaza la lectura (`UnsupportedFileError`) y el pane de editor muestra un mensaje en vez de Monaco, en vez de trabarse.
- **Corrección post-verificación:** no existe precedente en el codebase de que borrar un worktree limpie proactivamente el estado de panes en React (`worktree:remove` en `WorktreesSection.tsx:155` solo llama al IPC y refresca la lista de worktrees; la limpieza de PTYs vía `killByCwdPrefix` pasa en el main process, no en el estado de panes del renderer — un pane de terminal huérfano queda en pantalla igual hoy). Implementar limpieza proactiva de panes solo para el editor sería inconsistente con ese precedente. En su lugar: el mismo watcher por archivo abierto (ya necesario para conflictos) detecta que el archivo desapareció — la próxima lectura falla (ENOENT) y el pane muestra "este archivo ya no existe en disco" con la opción de cerrar la tab, sin lógica nueva de "escuchar worktree:remove".

## Fuera de alcance (v1)

- IntelliSense/LSP real (autocompletado con language server por lenguaje) — Monaco default únicamente.
- Múltiples repos en un mismo Explorer (multi-root workspace).
- Decoraciones de git inline (gutter de líneas modificadas) reusando `diff-engine` — fast-follow natural, no en v1.
- Operaciones de gestión de archivos desde el Explorer (crear/renombrar/borrar archivo o carpeta) — v1 es solo abrir/ver/editar/guardar archivos existentes. El fs bridge no expone `create`/`delete`/`rename` todavía.
- Filtrado del árbol por `.gitignore` — v1 solo excluye `.git`.

## Plan de trabajo

Se crea una branch/worktree dedicada para esta integración antes de empezar la implementación.
