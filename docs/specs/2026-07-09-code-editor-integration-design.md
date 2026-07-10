# Editor de código embebido en Nest — Design Spec

**Fecha:** 2026-07-09
**Estado:** Aprobado para pasar a plan de implementación

## Contexto y objetivo

Nest es hoy un terminal multiplexer (Electron + xterm.js/node-pty) para correr subagentes en paralelo, con soporte de repos/worktrees y un diff viewer de solo lectura (`DiffViewerPanel.tsx`). El objetivo de este cambio es sumar un editor de código embebido, estilo VS Code, para poder ver y editar archivos línea por línea sin salir de Nest — sin reemplazar la opción existente de abrir un IDE externo (`ide-launcher.ts`), que se mantiene tal cual.

## Arquitectura

### Explorer (nuevo panel del Sidebar)

Nueva sección en `Sidebar.tsx`, al mismo nivel que `MyReposPanel`/`WorktreesSection`, que muestra el árbol de archivos del **tab activo**: usa el mismo `repoPath`/`worktreePath` que ya usan las terminales de ese tab, sin selector propio. Al cambiar de tab, el árbol cambia solo.

- Carga **lazy**: al expandir una carpeta se pide su listado (`fs.listDir`), no se lee el árbol completo de entrada. Necesario para repos grandes y para no pagar costo de I/O por adelantado en ningún SO.
- Oculta siempre `.git`. Filtrado por `.gitignore` queda fuera de v1 (ver "Fuera de alcance").
- El árbol se re-suscribe a cambios de las carpetas expandidas (mismo watcher que el resto del sistema, ver más abajo) para reflejar archivos creados/borrados por un subagente corriendo en una terminal del mismo tab — consistente con el principio de "detectar y avisar" del resto del diseño.

### Editor pane (nuevo tipo de pane)

Se suma un nuevo tipo de pane al lado del pane de terminal existente, integrado al árbol de `PaneLayoutEngine` — se puede splitear contra una terminal igual que hoy se splitea una terminal contra otra.

- Sidebar interno con tabs de archivos abiertos (no un pane nuevo por archivo). Cada tab tiene indicador de "cambios sin guardar" (dot).
- Arrastrar una tab hacia afuera del pane la mueve a un split nuevo del layout — mismo mecanismo de splits que ya existe para terminales.
- Motor de edición: **Monaco Editor** (`@monaco-editor/react`), mismo motor que VS Code. Nueva dependencia.
- Guardado: manual, Ctrl+S / Cmd+S (Monaco resuelve la diferencia de atajo por plataforma sola). Dispara `bridge.fs.write(path, content)`.
- Estado de tabs abiertas (lista de archivos, tab activa, dirty flag por archivo) es propio de cada pane de editor, con el mismo patrón de ownership de estado que ya usan los panes de terminal en `PaneNode`.

### Flujo de apertura de archivo

1. Click en un archivo del Explorer.
2. Si el tab activo tiene un pane de editor enfocado, se abre ahí como tab nueva (o se enfoca la tab si ya estaba abierto).
3. Si no hay ningún pane de editor en el tab activo, se crea uno nuevo splitéando el layout actual — mismo mecanismo que "nueva terminal".

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

## Multiplataforma (Windows / macOS / Linux)

- Todo el fs bridge corre en el main process (Node puro) — nunca en el renderer. Evita diferencias de sandboxing entre SO.
- File watching con **chokidar** en vez de `fs.watch` nativo: el soporte de `recursive` de `fs.watch` es inconsistente entre SO (anda en macOS/Windows, no en Linux) y chokidar ya resuelve esas diferencias. Nueva dependencia chica, justificada por evitar bugs específicos de plataforma.
- Paths normalizados con las utilidades de Node (`path.normalize`/`path.sep`), sin asumir separador manualmente en código nuevo — mismo cuidado que ya tiene `worktree-store.ts`.
- El workflow de release ya buildea Windows/Mac/Linux en paralelo (`gh workflow run "Build (Windows, Mac, Linux)"`), lo que valida al menos que compila en los tres.

## Testing

Sin necesidad de levantar Electron real para la mayoría de los casos — el main process es Node puro y ya hay precedente de testearlo así (`electron/__tests__/worktree-store.test.ts`, `electron/__tests__/cli-install-runner.test.ts`).

1. **Main process (`fs-bridge.ts`)** — unit tests con Vitest: scoping rechaza paths fuera del worktree, el watcher dispara eventos correctos ante cambios, manejo de errores de escritura.
2. **Componentes React (Explorer, tabs del editor)** — React Testing Library, mismo patrón que `src/__tests__/components/bridge-context.test.tsx`: se mockea `window.bridge.fs.*` y se testea render del árbol, apertura de tabs al clickear, aparición del banner de conflicto.
3. **Multiplataforma real** — no hay atajo: se valida corriendo la app en cada SO. El plan de implementación incluye un smoke-test manual mínimo por SO antes de mergear (abrir archivo, editar, guardar, provocar conflicto de disco).

## Manejo de errores

- Escritura falla (permisos, disco lleno, archivo borrado externamente) → toast de error; la tab NO se marca como guardada.
- Archivo binario o demasiado grande → el Explorer lo muestra, pero al abrirlo Monaco avisa que no se puede editar en vez de trabarse.
- Worktree borrado mientras el editor lo tiene abierto → las tabs de ese worktree se cierran con aviso, análogo a `killByCwdPrefix` para terminales.

## Fuera de alcance (v1)

- IntelliSense/LSP real (autocompletado con language server por lenguaje) — Monaco default únicamente.
- Múltiples repos en un mismo Explorer (multi-root workspace).
- Decoraciones de git inline (gutter de líneas modificadas) reusando `diff-engine` — fast-follow natural, no en v1.
- Operaciones de gestión de archivos desde el Explorer (crear/renombrar/borrar archivo o carpeta) — v1 es solo abrir/ver/editar/guardar archivos existentes. El fs bridge no expone `create`/`delete`/`rename` todavía.
- Filtrado del árbol por `.gitignore` — v1 solo excluye `.git`.

## Plan de trabajo

Se crea una branch/worktree dedicada para esta integración antes de empezar la implementación.
