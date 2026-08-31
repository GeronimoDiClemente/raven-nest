---
title: "Raven Nest v1.0 — Worktrees + Spotlight + Superset-inspired QoL"
date: 2026-05-02
status: design-approved
release_target: v1.0.0
owner: Geronimo Di Clemente
brainstorm_session: .superpowers/brainstorm/7746-1777760489
---

# Raven Nest v1.0 — Design

## Context

Nest by RAVEN llega a v0.7.0 (2026-05-02) con Actions panel multi-provider GitHub + GitLab. v1.0 estaba originalmente planeada como "Worktrees + Spotlight" (release mayor). Este spec amplía v1.0 incorporando 7 quality-of-life features inspiradas en cómo trabaja Superset (https://superset.sh, ELv2, code editor para orquestar múltiples agentes IA en paralelo) — reimplementadas clean-room en patrones de Raven, sin copiar código (ELv2 incompatible con Apache 2.0 de Raven).

El posicionamiento elegido es **workflow-driven y configurable**, distinto del enfoque task-driven y opinionated de Superset. Mantenemos los diferenciadores de Nest (multi-AI side-by-side, multi-cuenta, Spotlight live-mirror, Teams real-time, Actions panel) y agregamos las QoL que Superset hizo bien: in-app browser, port forwarding visible, workspace presets reutilizables.

## Goals

1. Worktrees gestionados nativamente desde Nest, sin requerir CLI manual.
2. Modo Spotlight (live-mirror del worktree activo al root) como diferenciador único.
3. Reducir fricción del flow "crear worktree → empezar a trabajar" a 3 segundos en el happy path (Quick Worktree).
4. Visibilidad de puertos del dev server inline en la app, sin abrir browser externo.
5. Browser embebido para preview de dev server y docs sin salir de Nest.
6. Presets reutilizables versionados en el repo, compartibles vía git por todo el team.
7. Diff viewer side-by-side built-in para revisar cambios sin salir.
8. Open in IDE picker (VS Code, Cursor, JetBrains, Sublime, Xcode) — desbloquear devs no-VS Code.
9. Compatibilidad backward 100% con workspaces v0.7.

## Non-goals (v1.0)

- **Notifications centralizadas "agent needs attention"** — depende de eventos no cableados aún. Va a v1.0.x.
- **MCP servers gestionados desde UI visual** — el panel actual de MCP es suficiente. Va a v1.0.x.
- **Multi-agent co-edit** (Yjs/CRDT/pub-sub) — v1.1+ con Jorge.
- **Trigger manual de workflows GitHub/GitLab** — v1.1+ (decidido en spec del Actions panel v0.7).
- **Cambio de licencia** — Apache 2.0 confirmado (decisión 2026-05-02). Re-evaluación a 1-2 años.

## Scope final

| # | Feature | Origen |
|---|---|---|
| 1 | Worktrees gestionados desde la app | Plan original v1.0 |
| 2 | Modo Spotlight (live-mirror conductor-style) | Plan original v1.0 |
| 3 | Benchmark dashboard (RAM/CPU/disk Setup vs Spotlight) | Plan original v1.0 |
| 4 | In-app browser (cell-type) | Inspirado Superset |
| 5 | Port forwarding panel (banner arriba, híbrido) | Inspirado Superset |
| 6 | Workspace presets (`.raven/presets/*.json` per-repo) | Inspirado Superset |
| 7 | Diff viewer side-by-side built-in | Inspirado Superset |
| 8 | Quick worktree (`⌘⇧W` command palette) | Inspirado Superset |
| 9 | Open in IDE picker | Inspirado Superset |

## Architectural decisions

### Decision 1 — Clean-room reimplementation, no code copy from Superset

Superset usa Elastic License 2.0 (ELv2). Raven Nest es Apache 2.0. Copiar código ELv2 contamina la licencia. Estudiamos su arquitectura pública (estructura `packages/port-scanner`, `packages/panes`, etc.) y reimplementamos con patrones de Raven: stores en `electron/<dominio>-store.ts`, IPC `dominio:accion`, design tokens del sistema existente (`--raven-blue: #0066FF`, fondo `#000`).

### Decision 2 — Worktrees como adapter, no first-class entity

`Cell.repoPath` y `WorkspaceTab.repoPath` quedan inmutables (string path, opcional). Un nuevo `worktree-store` indexa metadata por path: `getWorktreeMeta(path) → WorktreeMeta | null`. Las features nuevas consultan el adapter; los componentes existentes (Actions panel, hooks GitHub/GitLab, terminales) no se enteran y no se tocan.

**Razones**:
- Cero migration de `~/.raven-nest/workspaces/*.json` existentes.
- Cero refactor de los ~10 componentes que hoy leen `repoPath`.
- APIs IPC actuales inmutables, solo se suman canales nuevos.
- Camino futuro a "Worktree first-class" (v2.0) abierto sin tocar consumidores.

### Decision 3 — Presets per-repo committeados (no per-user global)

`.raven/presets/*.json` versionados en el repo. Cada dev que clona recibe los presets. Code review en PRs. Onboarding nuevo dev = clonar + abrir en Nest + crear worktree → todo configurado.

Lo "per-user" (ej "siempre uso pnpm en lugar de npm") va a Settings, no a presets.

**Nota sobre el plan original v1.0**: el plan original mencionaba "dos modos por cell: Setup script y Spotlight". En este spec, el "modo Setup script" desaparece como concepto explícito de UI y queda **absorbido por preset**: cualquier worktree con un preset aplicado tiene setup script (los commands del preset). Worktree sin preset = no hay setup, comportamiento manual. "Spotlight" sigue existiendo como toggle on/off por cell (no se absorbe).

### Decision 4 — Browser cell, no panel side

`AIType` suma `'browser'`. Es un pane más en el grid (junto a Claude/Gemini/Terminal). Reaprovecha resize, zoom, keybinds del grid existente. Permite N browser cells simultáneos.

Tecnología: `WebContentsView` (Electron 30+) con `session.fromPartition('persist:browser-<workspaceId>')` para isolation de cookies entre Nests.

### Decision 5 — Port forwarding híbrido con filtrado por PID tree

Combina:
- **Declarado**: el preset declara `ports: [3000, 5173]`. Siempre visibles.
- **Discovered**: scan de puertos LISTEN abiertos por procesos hijos del PID del PTY de la cell. Filtra por subtree, no scan global del sistema (no aparecen Spotify/Dropbox).

Fallback: en Windows, si el shell no propaga PPid correctamente, modo "limited" con tag visible.

### Decision 6 — Setup script auto-corre con cancel disponible

Al crear worktree con preset, el `setup` corre automático en background. Cancel button visible mientras dura. Si falla → status `failed`, retry/edit buttons.

## UI: visual decisions

### Banner de ports (estilo Superset)

Banner fino entre `<TitleBar>` y `<TabBar>` (32px alto). Pills clickables con número de puerto. Click → abre nueva browser cell apuntando a `localhost:<port>`. Visible solo si hay worktree activo y al menos 1 puerto declarado o discovered.

### Browser cell con URL bar visible

Header del cell incluye back / forward / reload + URL editable + menú ⋯ (copy URL, open external, dev tools). Costo visual 28px, desbloquea uso para docs (MDN, Context7, Vercel docs) además de preview.

### Sidebar — sección "Worktrees" colapsable

Aparece solo cuando hay un repo activo en el tab. Lista todos los worktrees del repo (`main` root + N worktrees) con setup status dot:
- Verde `#00CC44` — listo
- Amarillo `#FFB800` — setup en curso
- Gris `#555` — idle / sin preset
- Rojo `#FF1A1A` — setup failed

Click en worktree → cambia `repoPath` de la cell focuseada. Click derecho → "Apply to all cells in tab" / "Open in IDE" / "Remove worktree".

### Modal "New worktree"

Branch picker (existente o nueva-desde) + path destino auto-sugerido en `.git/worktrees/<branch-slug>` + preset cards (Empty siempre como segunda opción). Botón "Create + Setup".

### Quick worktree (`⌘⇧W`)

Extension del Command Palette. Tipear branch name → Enter crea worktree con preset default + branch desde main. 3 keystrokes para empezar.

## Architecture

### Tipos nuevos (`src/types.ts`)

```ts
type AIType = 'claude' | 'gemini' | 'codex' | 'copilot'
            | 'opencode' | 'terminal' | 'custom' | 'browser'

interface PaneNode {
  // ... lo existente
  url?: string                // browser only
  sessionPartition?: string   // browser only — 'persist:browser-<workspaceId>'
}

interface WorktreeMeta {
  repoPath: string            // path absoluto canónico del worktree
  rootRepoPath: string        // path del repo principal
  branch: string
  presetId?: string
  setupState: 'idle' | 'running' | 'done' | 'failed' | 'cancelled' | 'orphaned'
  setupLog?: string           // últimas ~200 líneas
  declaredPorts: number[]
  detectedPorts: number[]
  devCmd?: string
  devPid?: number
  createdAt: number
  updatedAt: number
}

interface RavenPreset {
  id: string                  // slug, ej "nextjs-dev"
  name: string
  description?: string
  setup?: string[]
  dev?: string
  ports?: number[]
  env?: Record<string, string>
  postCreate?: string[]
  spotlightIgnore?: string[]
}
```

### Stores nuevos en `electron/`

| Store | Responsabilidad |
|---|---|
| `worktree-store.ts` | Indexa `WorktreeMeta` por path. Persistido en `~/.raven-nest/worktrees.json`. Hidrata desde `git worktree list --porcelain` al iniciar. Reconciliación cada 60s. |
| `preset-store.ts` | Carga `.raven/presets/*.json` por repo. Watch con chokidar para hot-reload. Schema validation. |
| `port-monitor.ts` | Escanea PIDs hijos del PTY de cada cell, cruza con `declaredPorts`. Cada 2s mientras hay cells visibles. |
| `spotlight-engine.ts` | chokidar mirror del worktree activo → root. Solo una instancia activa por repo simultáneamente. |
| `ide-launcher.ts` | Detecta binarios (`code`, `cursor`, `idea`, `subl`, `xed`) en PATH. Cache TTL 1h. |
| `diff-engine.ts` | Wrapper sobre `git diff --no-color` con parsing a estructura side-by-side. |
| `benchmark-recorder.ts` | Sample RAM/CPU/disk del PID del PTY + del worktree path. |

### IPC channels nuevos

```
worktree:list(repoPath)                     → WorktreeMeta[]
worktree:create({ repoPath, branch, fromBranch?, path?, presetId? })
worktree:remove(worktreePath)
worktree:get(worktreePath)                  → WorktreeMeta
worktree:set-preset(worktreePath, presetId)

preset:list(repoPath)                       → RavenPreset[]
preset:save(repoPath, preset)
preset:apply(worktreePath, presetId)        → kicks off setup
preset:cancel-setup(worktreePath)

port:list(worktreePath?)                    → { declared, detected, all }

browser:create(paneId, url, partition)
browser:navigate / reload / back / forward(paneId, ...)
browser:reposition(paneId, bounds)

diff:get(worktreePath, { base? })           → DiffResult

ide:detect()                                → { name, binPath }[]
ide:open(binPath, worktreePath)

spotlight:start(worktreePath)
spotlight:stop()
spotlight:status()                          → { activeWorktreePath?, eventsPerSec }

benchmark:start(cellId)
benchmark:stop(cellId)
benchmark:get(cellId)                       → samples
```

### Lo que NO se toca

- `PaneNode.repoPath` — sigue siendo path string opcional.
- `WorkspaceTab.repoPath`, `Workspace.repoPath` — igual.
- `pty.create()` API — igual.
- Workspace JSON shape — backward-compat (campos nuevos opcionales).
- Actions panel, hooks GitHub/GitLab, Sidebar de v0.7 — inmutables. Solo se les **agrega** la sección "Worktrees" y el banner "Ports".

### Browser cell — implementación

- Renderer crea `<div>` placeholder. Main process spawnnea `WebContentsView` con `session.fromPartition('persist:browser-<workspaceId>')` y lo mounta en las coords del placeholder.
- Reposicionamiento en resize/scroll vía `browser:reposition(paneId, bounds)`.
- Cookies/storage aislados por workspace.
- Cleanup: al destruir cell o cerrar workspace, `view.webContents.destroy()`.
- Security: `nodeIntegration: false`, `contextIsolation: true`, `sandbox: true`.

## Componentes UI nuevos

### Globales (montados en `App.tsx`)

| Componente | Ubicación | Responsabilidad |
|---|---|---|
| `<PortsBanner>` | Entre `<TitleBar>` y `<TabBar>` | Pills de puertos. Resuelve qué worktree mostrar así: si todas las cells visibles del tab apuntan al mismo `repoPath` → muestra esos ports. Si las cells apuntan a worktrees distintos → agrupa por worktree con sub-headers (`feat/auth · :3000 :5173` / `main · :8080`). Click en pill → abre browser cell apuntando a `localhost:<port>`. |
| `<NewWorktreeModal>` | Portal `.dialog-overlay` | Branch picker + path + preset cards. Trigger desde sidebar `+` o desde Quick Worktree palette si user quiere flow completo. |
| `<QuickWorktreePalette>` | Portal, extension del Command Palette `⌘K` | `⌘⇧W` → input "branch name" → Enter crea worktree con preset default. |
| `<IDEPickerMenu>` | Portal/dropdown | Lista IDEs detectados al hacer "Open in IDE". |

### Sidebar (extensiones)

| Componente | Ubicación | Responsabilidad |
|---|---|---|
| `<WorktreesSection>` | `Sidebar.tsx` debajo de "Repos linkeados al tab" | Colapsable. Lista worktrees con setup status dot. Click → cambia `repoPath` de cell focuseada. |
| `<SetupProgressPill>` | Inline en cada item de `<WorktreesSection>` | `running` con spinner + cancel. `failed` con error + retry. |

### Cells (nuevos pane types)

| Componente | Responsabilidad |
|---|---|
| `<BrowserCell>` | Renderiza `<div>` placeholder; el `WebContentsView` real lo mounta el main process. Header: URL bar + back/forward/reload + ⋯. |
| `<DiffViewerPanel>` | NO es cell. Drawer derecho con `⌘⇧D`. File tree izquierda + side-by-side derecha. Lib base: `react-diff-viewer-continued` envuelta. |

### Settings panel (extensiones)

| Componente | Ubicación | Responsabilidad |
|---|---|---|
| `<PresetEditor>` | `SettingsPanel.tsx` → "Presets" | Edit/create/delete presets del repo activo. JSON validado contra schema. |
| `<BenchmarkDashboard>` | `SettingsPanel.tsx` → "Worktrees → Benchmarks" | Gráfico RAM/CPU/disk por cell con worktree. Filtro por modo (Setup vs Spotlight). |
| `<SpotlightToggle>` | Header de cada cell con worktree | Toggle on/off. Solo una activa por repo. Indicador visual (border especial / icono pulse). |

### Estilos / tokens (heredados del design system)

- Browser cell border: `--raven-blue` (`#0066FF`)
- Ports pills: bg `#111`, color `#0066FF`, border `#1e1e1e`, hover `#0066FF22`
- Setup status dots: verde `#00CC44`, amarillo `#FFB800`, gris `#555`, rojo `#FF1A1A`
- Diff viewer: dark theme consistente — added bg `#00CC4422`, removed bg `#FF1A1A22`

### Atajos nuevos

| Atajo | Acción |
|---|---|
| `⌘⇧W` | Quick Worktree palette |
| `⌘⇧D` | Toggle Diff Viewer |
| `⌘⇧B` | Crear Browser cell |
| `⌥⌘⇧O` | Open in IDE picker |

Todos rebindables en Settings → Keybinds.

## Data flows clave

### Flow 1 — Crear worktree con preset (caso central)

```
User → Renderer                Main                       FS / git
  ⌘⇧W o + sidebar
   │
   ▼ preset:list(repoPath)
                          → readdir(.raven/presets)
                          → RavenPreset[]
   ◀────────────────────────
   │
   User selecciona branch + preset + path
   │
   ▼ worktree:create(opts)
                          → git worktree add <path> <branch>
                          → writeWorktreeMeta() to ~/.raven-nest/worktrees.json
                          → WorktreeMeta
   ◀────────────────────────
   │
   ▼ preset:apply(wt, presetId)
                          → spawn setup chain (sequential)
                          ← setup:progress (línea por línea)
                          ← setup:done
   Sidebar dot verde
```

**Reglas**:
- Worktree se crea ANTES de aplicar preset. Si preset falla, worktree existe (no rollback). User ve "Setup failed" con retry.
- Setup commands sequential. Si uno falla, para. Estado `failed`. setupLog guarda output.
- Cancel mid-setup: `preset:cancel-setup(worktreePath)` mata spawn con SIGTERM, limpia shell tree.

### Flow 2 — Click en port pill → abre browser cell

```
User clicks pill :3000
   │
   ▼ Renderer dispatch
WorkspaceStore: insert nueva cell
  { aiType: 'browser', url: 'http://localhost:3000',
    sessionPartition: 'persist:browser-<workspaceId>',
    repoPath: <worktree del tab activo>,
    borderColor: '#0066FF' }
   │
   ▼ <BrowserCell> mount → browser:create(paneId, url, partition)
                          → new WebContentsView({ session: fromPartition(partition) })
                          → view.webContents.loadURL(url)
                          → mainWindow.contentView.addChildView(view)
                          → view.setBounds(boundsFromPlaceholder)
                          → Map<paneId, WebContentsView> registered
```

Resize/scroll → `browser:reposition(paneId, bounds)` → main actualiza `setBounds`.

### Flow 3 — Auto-detect port (descubrimiento)

```
PortMonitor polling loop (cada 2s, solo si hay cells visibles):
  Para cada cell con repoPath de worktree:
    getPaneInfo(paneId) → ptyPid

    Windows: netstat -ano | filter PID ∈ pidTree(ptyPid)
    macOS:   lsof -P -i -n -p <pid> recursivo
    Linux:   /proc/<pid>/net/tcp + walk /proc/*/status PPid

    ports detectados = puertos LISTEN únicos
    wtMeta.detectedPorts = ports - wtMeta.declaredPorts
    emit 'port:update' al renderer
      → <PortsBanner> re-render con pill nuevo + badge "discovered"
```

**Performance**: scan solo si cell visible. Cap a 20 cells simultáneas.

### Flow 4 — Toggle Spotlight on

```
User click "Spotlight ON" en cell del worktree X
  → spotlight:start(worktreePathX)

Main:
  1. Si ya hay Spotlight activo en otro worktree → spotlight:stop() del anterior
  2. SpotlightEngine: chokidar.watch(worktreePathX, {
       ignored: ['.git', 'node_modules', 'dist', ...preset.spotlightIgnore],
       followSymlinks: false
     })
  3. on('all', (event, path) => {
       const rel = relative(worktreePathX, path)
       const target = join(rootRepoPath, rel)
       if (event === 'unlink') fs.unlink(target)
       else fs.copyFile(path, target)
     })
  4. Tracking: events/sec, bytes/sec → emit 'spotlight:status'

Renderer:
  Cell border cambia a estilo "spotlight" (pulso azul sutil)
  Indicador en header del cell
```

**Edge cases**:
- Conflicto edit root vs worktree → Spotlight gana (last-write).
- File lock Windows → retry backoff 50ms × 3.
- inotify limit Linux → mensaje claro al user para `fs.inotify.max_user_watches`.

### Flow 5 — Open in IDE

```
User → menú worktree → "Open in IDE"
  → ide:detect() (cache TTL 1h)
  → <IDEPickerMenu> dropdown con IDEs encontrados
  User clic "Cursor"
  → ide:open(cursorBinPath, worktreePath)
  → spawn(cursorBinPath, [worktreePath], { detached: true })
```

Detección por plataforma:
- macOS: `mdfind "kMDItemCFBundleIdentifier == ..."` + paths conocidos
- Windows: registry `HKCU\Software\Classes\<editor>` + `%LOCALAPPDATA%\<Editor>`
- Linux: `which code cursor idea sublime_text xed`

### Flow 6 — Diff viewer

```
⌘⇧D
  → diff:get(worktreePath, { base: 'HEAD' })
  → Main: execSync(`git -C ${wt} diff --no-color HEAD`)
         → parse → DiffResult { files: [{ path, hunks }] }
  → <DiffViewerPanel> abre como drawer derecho
     File tree izquierda + side-by-side derecha
     Watch: chokidar sobre worktree → re-fetch on change (debounced 500ms)
```

## Error handling + edge cases

### Worktrees

| Caso | Handling |
|---|---|
| Worktree creado fuera de Nest (CLI directo) | Aparece en `git worktree list` sin meta. Sidebar dot gris + tag "external". User puede asignar preset. |
| User borra worktree con `git worktree remove` | Reconciliación al inicio + cada 60s. Meta huérfana → `setupState='orphaned'`, ofrecer "Clean up". |
| Path con espacios o unicode | Quote en todos los `git -C "<path>"`. Tests específicos. |
| Disco lleno mid-setup | Spawn ENOSPC → `setupState='failed'`, log error, retry button. |
| Branch borrada upstream | `git worktree list` lo muestra detached HEAD. Dot gris + warning tooltip. No bloquea uso. |

### Presets

| Caso | Handling |
|---|---|
| `.raven/presets/x.json` JSON inválido | `<PresetEditor>` error inline. CLI ops ignoran preset roto, log a console. No crash. |
| Preset id duplicado entre archivos | Última lectura gana, warning. UI muestra ⚠ en editor. |
| Setup referencia binario no instalado | Spawn ENOENT → "Command not found: pnpm. Install pnpm or edit preset." Retry/Edit. |
| Setup tarda mucho | No timeout duro. Cancel siempre visible. Warning sutil "still running, no output" tras 60s sin output, no kill. |
| Secrets en setup output | Output filtrado por regex configurable (`SECRET_PATTERNS` settings). Default: `(?i)(token\|key\|password\|secret)=\S+`. |

### Browser cell

| Caso | Handling |
|---|---|
| URL inválida / DNS fail / timeout | Página error custom con Retry / Open in external. No alert nativo. |
| `localhost:3000` no respondiendo | Detect ECONNREFUSED → overlay "Waiting for localhost:3000...". Auto-retry 2s hasta 30s. |
| WebContentsView crash | `render-process-gone` → unmount + retry button. |
| 10+ browser cells (memory) | Soft warning en el 6to. No bloquea. |
| Cookie partition corrupta | Bail to fresh partition + warning. User pierde cookies del browser cell, no del SO. |

### Port forwarding

| Caso | Handling |
|---|---|
| PID tree no rastreable Windows | Fallback: scan global filtrado solo por `declaredPorts`. Auto-detect off, tag "limited". |
| Falso positivo (puerto SO matchea) | UI muestra source: "declared" vs "discovered" con tooltip "open by PID 12345". |
| Vite cambia :5173 → :5174 (puerto ocupado) | Auto-detect lo descubre. Banner muestra ambos: 5173 declared tachado + 5174 discovered activo. |
| IPv6-only ports | Soportar parsing `::` en netstat/lsof. Mostrar como `[::]:3000`. |

### Spotlight

| Caso | Handling |
|---|---|
| Edit concurrente root vs worktree | Spotlight gana (last-write). Documentado en tooltip del toggle. |
| Filesystem case-insensitive vs sensitive | `path.resolve()`. No transformar casing. |
| File lock Windows | Retry backoff 50ms × 3. Si falla, log + emit `spotlight:warning` (no crash). |
| Symlinks dentro del worktree | `chokidar` con `followSymlinks: false`. Documentado. |
| inotify limit Linux | Catch error, mensaje "Spotlight stopped: too many open files. Increase fs.inotify.max_user_watches." |
| `node_modules`, `dist`, `.git` cambian | Ignorados por defecto. `spotlightIgnore` del preset extiende. |

### IDE picker

| Caso | Handling |
|---|---|
| IDE detectado pero spawn falla | Catch ENOENT, "Failed to launch <IDE>. Check installation." con "Re-detect". |
| Cache stale | Botón "Re-detect" en menu. TTL 1h. |
| Path con espacios | Spawn con args array (no shell), no string concat. |

### Diff viewer

| Caso | Handling |
|---|---|
| Diff > 10k líneas | "Diff too large to render. Open in editor instead." con "Open in IDE". |
| Binary files | Skip render, "Binary file modified: <path>". |
| Submódulos | SHA before/after, sin expand. |
| LFS files | Detect marker, "LFS object updated". |

### Reconciliación general

Al startup y cada 60s:
- `git worktree prune`
- Cross-check `worktrees.json` vs `git worktree list`
- Marcar orphaned, eliminar refs a paths inexistentes
- Re-hidratar `WorktreeMeta` desde filesystem

## Testing strategy

Plan: **automatización con `playwright-e2e-builder` skill** (instalada global en `~/.agents/skills/playwright-e2e-builder/`, 187+ installs, soporta Electron via `_electron.launch`). NO se arma agente QA custom — la skill instalada cubre el lifecycle E2E (Page Object Model + auth persistence + visual regression + CI).

La lista completa abajo es el INPUT que se le pasará a la skill cuando llegue el momento de implementar tests.

### A. Unit tests (Vitest, en `electron/__tests__/` y `src/__tests__/`)

**`worktree-store.ts`**
- [ ] `getWorktreeMeta(path)` devuelve null para path no registrado
- [ ] `setWorktreeMeta` persiste a disco y se recupera en próximo load
- [ ] `removeWorktree(path)` borra del store y dispara cleanup
- [ ] Reconciliación detecta worktrees externos (CLI directo)
- [ ] Reconciliación marca orphaned los paths inexistentes
- [ ] Path con espacios y unicode se hashea correctamente
- [ ] Concurrent write a `worktrees.json` no corrompe (lock o atomic rename)

**`preset-store.ts`**
- [ ] Carga `.raven/presets/*.json` correctamente
- [ ] JSON inválido NO crashea — skip con warning
- [ ] Schema validation rechaza preset sin `name`
- [ ] Hot-reload chokidar dispara update event
- [ ] `savePreset` escribe a `.raven/presets/<id>.json` con id slug normalizado
- [ ] Duplicado de id → último gana, warning emitido

**`port-monitor.ts`**
- [ ] Mock spawn de `netstat`/`lsof` devuelve ports correctos
- [ ] Filtro por PID tree solo retorna puertos del subtree
- [ ] Cross-reference declared vs detected funciona
- [ ] Polling para si no hay cells activas
- [ ] Soporta IPv6 (`[::]:3000`)
- [ ] Fallback a "limited" mode cuando PID tree no rastreable

**`spotlight-engine.ts`**
- [ ] Solo una instancia activa por repo simultáneamente
- [ ] Mirror de file create / modify / delete
- [ ] Ignora `.git`, `node_modules`, `dist` por defecto
- [ ] Custom `spotlightIgnore` del preset se respeta
- [ ] `followSymlinks: false`
- [ ] File lock Windows → retry con backoff
- [ ] Stop limpia chokidar (no leak handles)

**`ide-launcher.ts`**
- [ ] Detect cachea por TTL 1h
- [ ] "Re-detect" invalida cache
- [ ] Spawn con args array — test path con espacios
- [ ] Spawn fallido emite error con nombre del IDE

**`diff-engine.ts`**
- [ ] Parser convierte `git diff` a `{ files: [{ path, hunks }] }`
- [ ] Binary files marcados sin contenido
- [ ] Renamed files (R100) detectados
- [ ] Submódulos parseados como SHA-before/after
- [ ] LFS markers detectados
- [ ] Diff > 10k líneas devuelve `oversized: true` sin parsear

**`benchmark-recorder.ts`**
- [ ] Sample RAM/CPU/disk del PID correcto
- [ ] Filtro por modo (Setup vs Spotlight)
- [ ] Process muere mid-sample → no crashea, marca `processGone: true`

### B. Integration tests (con git real, en tmpdir)

- [ ] `worktree:create` con branch existente → worktree real + meta correcto
- [ ] `worktree:create` con branch nueva desde main → branch creada
- [ ] `worktree:create` + preset Next.js → setup corre, ports declarados, status `done`
- [ ] `worktree:create` + preset que falla → status `failed`, log con error
- [ ] Cancel mid-setup → SIGTERM, status `cancelled`, retry funciona
- [ ] `worktree:remove` borra worktree + meta + para watchers
- [ ] Spotlight: editar archivo en worktree → aparece en root en < 200ms
- [ ] Spotlight: borrar archivo en worktree → desaparece en root
- [ ] Spotlight: switch a otro worktree → primero stop, segundo start
- [ ] Conflicto file lock → no crash
- [ ] Browser cell `localhost:3000` cuando dev server arranca → carga sin reload manual
- [ ] Browser cell partition X NO ve cookies de partition Y
- [ ] Diff viewer refresh debounceado al editar archivos rápido
- [ ] IDE launcher abre worktree en VS Code (CI con VS Code instalado)

### C. Manual QA checklist (UI / no automatizable fácil)

**Flow happy path (the demo)**
- [ ] Abrir Nest → repo raven-nest activo
- [ ] `⌘⇧W` → tipear "feat/test" → Enter → worktree creado en 3 segundos
- [ ] Setup status verde en sidebar
- [ ] Banner ports muestra :3000 + :5173
- [ ] Click :3000 → browser cell abierto mostrando dev server
- [ ] Editar archivo en cell de Claude → cambio aparece en browser cell sin reload manual (hot reload)
- [ ] `⌘⇧D` → diff viewer muestra el cambio side-by-side
- [ ] Click en menu worktree → "Open in Cursor" → Cursor abre el path

**Visual / UX**
- [ ] Banner ports renderiza con tokens correctos (azul `#0066FF`, no verde)
- [ ] Sidebar Worktrees: dots con colores correctos según status
- [ ] Browser cell URL bar: back/forward greyout cuando no hay history
- [ ] Modal "New worktree": preset cards con border azul cuando selected
- [ ] Diff viewer: dark theme consistente con resto de Nest
- [ ] IDE picker: iconos de cada IDE
- [ ] Spotlight cell: border distintivo (pulso azul sutil)
- [ ] `<SetupProgressPill>` running → spinner suave

**Keybinds**
- [ ] `⌘⇧W` abre Quick Worktree
- [ ] `⌘⇧D` toggle Diff Viewer
- [ ] `⌘⇧B` crea browser cell
- [ ] `⌥⌘⇧O` abre IDE picker
- [ ] Todos rebindables en Settings → Keybinds

**Edge UX**
- [ ] Sidebar Worktrees oculta cuando no hay repo activo
- [ ] Banner ports oculto cuando no hay worktree con ports
- [ ] Crear worktree con branch existente → "Branch exists, will check it out"
- [ ] Modal path auto-sugerido editable
- [ ] Cancel setup mid-pnpm-install → spinner para, status "cancelled", dev server no levantado

### D. Cross-platform smoke tests

Correr happy path completo en:

- [ ] **Windows 11**: PowerShell + cmd. Path con `C:\` y backslash. PID tree con `wmic`.
- [ ] **macOS arm64**: zsh, lsof. Notarization NO afecta worktrees.
- [ ] **macOS Intel**: idem (cuando shippeés Intel build).
- [ ] **Linux Ubuntu/Debian**: bash, /proc, inotify limits.
- [ ] **Linux Fedora**: idem.

Específicos por plataforma:
- [ ] Win: shell sin propagar PPid → port-monitor cae a "limited" gracefully
- [ ] Win: file lock al copiar en Spotlight → retry funciona
- [ ] macOS: AppleScript / `mdfind` para detectar Cursor y Xcode
- [ ] Linux: inotify limit alcanzado → mensaje claro

### E. Stress / performance

- [ ] **10 worktrees activos simultáneos**: scan ports < 10% CPU del proceso main
- [ ] **5 browser cells abiertos**: total RAM proceso < 1GB
- [ ] **Spotlight con 1000 file changes/sec**: no pierde eventos, no corrompe destino
- [ ] **Diff de 10k líneas**: viewer dice "too large", no intenta render
- [ ] **Setup con 500MB de deps**: progreso visible, cancel responde en < 2s
- [ ] **Workspace JSON con 50 cells**: load time < 1s

### F. Security

- [ ] Browser cells partition X NO acceden a cookies partition Y
- [ ] Setup output filtra patterns de secrets — verificar log + display
- [ ] Browser cell NO puede acceder a `file://` o `app://` (csp restrictivo)
- [ ] WebContentsView con `nodeIntegration: false`, `contextIsolation: true`, `sandbox: true`
- [ ] Preset NO puede escribir fuera del repo (path traversal en `setup` → contained al cwd)
- [ ] IPC channels validan inputs (path traversal en `worktreePath`, etc.)

### G. Regresión (lo que NO debe romperse)

- [ ] Workspaces existentes (sin worktrees) cargan igual que en v0.7
- [ ] Cells sin `repoPath` siguen funcionando
- [ ] Actions panel multi-provider sigue funcionando idéntico
- [ ] Terminal sharing entre Nests sigue funcionando
- [ ] Voice input (Whisper) sin cambios
- [ ] MCP panel sin cambios
- [ ] Auto-update no se rompe (electron-updater respeta WebContentsView nuevo)

**Total**: ~110 checks. Golden path del QA antes de release.

## Open questions

Ninguna bloqueante para empezar implementación. Decisiones diferidas a v1.0.x:
- Notifications centralizadas "agent needs attention"
- MCP servers gestionados desde UI

## Implementation order (sugerido para writing-plans)

1. `worktree-store.ts` + IPC `worktree:*` (sin UI todavía, testeable solo)
2. `preset-store.ts` + IPC `preset:*`
3. `<NewWorktreeModal>` + `<WorktreesSection>` (UI básica para crear/listar)
4. `<QuickWorktreePalette>` (`⌘⇧W`)
5. `port-monitor.ts` + IPC `port:*` + `<PortsBanner>`
6. `<BrowserCell>` + IPC `browser:*` + `WebContentsView` integration
7. `spotlight-engine.ts` + IPC `spotlight:*` + `<SpotlightToggle>`
8. `ide-launcher.ts` + IPC `ide:*` + `<IDEPickerMenu>`
9. `diff-engine.ts` + IPC `diff:*` + `<DiffViewerPanel>`
10. `benchmark-recorder.ts` + IPC `benchmark:*` + `<BenchmarkDashboard>`
11. `<PresetEditor>` (`SettingsPanel.tsx`)
12. Tests + cross-platform QA con `playwright-e2e-builder` skill
13. Polish + release prep

## References

- Spec previo del Actions panel (v0.7) que estableció constraint worktree-friendly: implícito en componentes con `branch` first-class.
- Superset OSS-source-available repo (estudio para clean-room): https://github.com/superset-sh/superset (ELv2 — no copiar código)
- Decisión de licencia Apache 2.0 confirmada 2026-05-02.
- `playwright-e2e-builder` skill instalada en `~/.agents/skills/playwright-e2e-builder/`.
