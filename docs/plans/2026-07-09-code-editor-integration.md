# Editor de código embebido — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Versión:** v2 (2026-07-10). Cambios vs v1: (a) Monaco se bundlea local (offline) — Task 1 suma `monaco-editor`, `src/lib/monaco-setup.ts` y el registro de workers; el default de `@monaco-editor/react` descarga Monaco desde CDN en runtime, inaceptable en una app de escritorio. (b) Ubicación correcta de dependencias para no inflar el instalador (~90MB de `monaco-editor`). (c) Los pasos de verificación ya no afirman que `npm run build` chequea tipos — `electron-vite build` transpila con esbuild sin typecheck; la verificación real por task es vitest. (d) Anclajes de línea re-verificados contra el código el 2026-07-10 (`diff:get` en `main.ts:1673`, etc.).

**Goal:** Sumar un editor de código embebido (Monaco) a Nest, navegable desde un nuevo panel "Explorer" en el Sidebar, integrado como un tipo de pane más (`aiType: 'editor'`) dentro del mecanismo de panes existente.

**Architecture:** Nuevo módulo main-process `electron/fs-bridge.ts` (read/write/listDir/watch, con scoping por `worktreePath` vía `realpath`) expuesto por IPC (`fs:*`) y por `preload.ts` como `window.fs`. `EditorPane` (Monaco) y `ExplorerPanel` son componentes React nuevos que se integran al mecanismo de panes/Sidebar existente sin tocar `PaneLayoutEngine`. Ver `docs/specs/2026-07-09-code-editor-integration-design.md` para el diseño completo.

**Tech Stack:** Electron (main process, Node puro) + React/TypeScript (renderer) + `chokidar` (file watching cross-plataforma) + `@monaco-editor/react` + `monaco-editor` (editor, bundleado local — nunca CDN) + Vitest (unit/component tests) + Playwright `_electron` (E2E, infraestructura ya existente en `e2e/`). Build tool: **electron-vite** (config en `electron.vite.config.ts` — no existe `vite.config.ts`).

## Global Constraints

- Node engine `>=20.19` (de `package.json`) — no usar APIs de Node más nuevas que esa versión.
- Todo acceso a filesystem crudo vive en el main process (`electron/`); el renderer solo llama a `window.fs.*` vía IPC, nunca `require('fs')` directo.
- Todo path recibido por un handler IPC nuevo se valida con `isAbsolute()` antes de usarse, igual que los handlers existentes (`diff:get`, `worktree:create`) — rechazar con `{ ok: false, error }`, nunca lanzar una excepción no capturada hacia el renderer.
- Ningún archivo de test debe mockear `window` directamente — usar `BridgeProvider`/`useBridge()` (`src/lib/bridge.ts`), como ya hace `bridge-context.test.tsx`.
- Los panes de editor cuentan contra el mismo `MAX_PANES` (12) / `planLimits.maxPanes` que las terminales — no se agrega lógica de conteo separada.
- v1 explícitamente NO incluye: crear/renombrar/borrar archivos desde el Explorer, filtrado por `.gitignore`, IntelliSense/LSP real, ni multi-root workspaces (ver spec, sección "Fuera de alcance").
- Monaco se sirve SIEMPRE desde el bundle local (`loader.config({ monaco })` en `src/lib/monaco-setup.ts`, Task 1) — ningún `<Editor>` puede montarse sin que ese módulo se haya importado en el entry (`src/main.tsx`). Nunca cargar Monaco desde CDN.
- Ubicación de dependencias nuevas: lo que corre en el main process y se carga de `node_modules` en runtime (`chokidar`) → `dependencies`; lo que Vite bundlea en el renderer (`monaco-editor`, `@monaco-editor/react`) → `devDependencies`. Motivo: `electron-builder` empaqueta las prod deps en el instalador y `monaco-editor` pesa ~90MB que ya viven en `dist/**`.
- `npm run build` = `electron-vite build` (esbuild): valida sintaxis, imports y bundling, **NO chequea tipos** (no hay script de typecheck en el repo). La verificación con dientes de cada task es su suite de vitest.

---

### Task 1: Branch dedicada + dependencias + bootstrap offline de Monaco

**Files:**
- Modify: `package.json`
- Create: `src/lib/monaco-setup.ts`
- Modify: `src/main.tsx`
- Modify: `electron.vite.config.ts`

**Interfaces:**
- Produces: `chokidar` importable desde `electron/` (Task 2); `@monaco-editor/react` importable desde `src/` con Monaco resuelto desde el bundle local — cualquier `<Editor>` montado después de este task funciona sin internet (Task 6).

- [ ] **Step 1: Crear la branch dedicada**

```bash
git checkout -b feat/code-editor-integration
```

- [ ] **Step 2: Instalar las dependencias nuevas — OJO con dónde va cada una**

```bash
npm install chokidar
npm install -D monaco-editor @monaco-editor/react
```

Expected: `chokidar` queda en `dependencies` (corre en el main process, que `externalizeDepsPlugin` NO bundlea — se carga de `node_modules` en runtime y `electron-builder` lo empaqueta como a `node-pty`/`koffi`). `monaco-editor` y `@monaco-editor/react` quedan en `devDependencies` (Vite los bundlea en `dist/**`; si fueran prod deps, `electron-builder` metería ~90MB de `node_modules/monaco-editor` duplicados en el instalador). `package-lock.json` se actualiza.

- [ ] **Step 3: Crear `src/lib/monaco-setup.ts` (Monaco local + workers)**

Por defecto `@monaco-editor/react` descarga Monaco desde el CDN de jsdelivr en runtime — sin internet, el editor no abre. Este módulo lo reemplaza por el paquete local y registra los web workers vía imports `?worker` de Vite (patrón oficial del README de `@monaco-editor/react` para Vite; el renderer de electron-vite es un build Vite estándar):

```ts
// src/lib/monaco-setup.ts
// Registers the locally-bundled Monaco (no CDN) and its web workers.
// Must be imported from the renderer entry (src/main.tsx) before any
// <Editor> from @monaco-editor/react mounts.
import { loader } from '@monaco-editor/react'
import * as monaco from 'monaco-editor'
import editorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker'
import jsonWorker from 'monaco-editor/esm/vs/language/json/json.worker?worker'
import cssWorker from 'monaco-editor/esm/vs/language/css/css.worker?worker'
import htmlWorker from 'monaco-editor/esm/vs/language/html/html.worker?worker'
import tsWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker?worker'

self.MonacoEnvironment = {
  getWorker(_workerId: string, label: string) {
    if (label === 'json') return new jsonWorker()
    if (label === 'css' || label === 'scss' || label === 'less') return new cssWorker()
    if (label === 'html' || label === 'handlebars' || label === 'razor') return new htmlWorker()
    if (label === 'typescript' || label === 'javascript') return new tsWorker()
    return new editorWorker()
  },
}

loader.config({ monaco })
```

Si TypeScript se queja por los imports `?worker`, agregar `/// <reference types="vite/client" />` al inicio del archivo (o verificar que ya exista un `src/vite-env.d.ts`).

- [ ] **Step 4: Importar el setup en el entry del renderer**

En `src/main.tsx` (el entry que carga `src/index.html:11`), agregar como PRIMER import:

```ts
import './lib/monaco-setup'
```

Va en el entry y no en `EditorPane.tsx` a propósito: así los tests de componentes (Task 6) mockean `@monaco-editor/react` con `vi.mock` y jsdom nunca intenta cargar `monaco-editor` ni los workers `?worker` (que Vitest no resuelve).

- [ ] **Step 5: Pre-bundlear monaco-editor en dev**

En `electron.vite.config.ts`, dentro de la sección `renderer`, agregar:

```ts
optimizeDeps: {
  include: ['monaco-editor'],
},
```

Evita que el dev server de Vite descubra las decenas de módulos ESM de Monaco a demanda (recarga lenta / request storm la primera vez que se abre un editor en `npm run dev`).

- [ ] **Step 6: Verificar bundling**

Run: `npm run build`
Expected: build exitoso; en `dist/assets/` aparecen chunks de workers de Monaco (archivos `*worker*.js`). Esto valida imports y bundling — NO tipos (esbuild no typechequea).

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json src/lib/monaco-setup.ts src/main.tsx electron.vite.config.ts
git commit -m "chore(editor): chokidar + Monaco bundleado local con workers (sin CDN)"
```

---

### Task 2: `fs-bridge.ts` — módulo main-process con scoping

**Files:**
- Create: `electron/fs-bridge.ts`
- Test: `electron/__tests__/fs-bridge.test.ts`

**Interfaces:**
- Consumes: `makeTmpDir`/`cleanupTmp` de `electron/__tests__/setup.ts` (ya existen).
- Produces (usado por Task 3):
  ```ts
  export interface DirEntry { name: string; path: string; isDirectory: boolean }
  export class ScopeViolationError extends Error {}
  export class UnsupportedFileError extends Error {}  // binary or >5MB — readFile rejects, caller shows a message instead of Monaco
  export function readFile(worktreePath: string, relPath: string): Promise<string>
  export function writeFile(worktreePath: string, relPath: string, content: string): Promise<void>
  export function listDir(worktreePath: string, relPath: string): Promise<DirEntry[]>
  export class FsWatchRegistry {
    // opts.depth se pasa directo a chokidar. Para carpetas usar { depth: 0 }
    // (watchea la carpeta y sus hijos directos, SIN recursión — watchear un
    // directorio sin depth recorre todo su subárbol, node_modules incluido).
    watch(worktreePath: string, relPath: string, onChange: (worktreePath: string, relPath: string) => void, opts?: { depth?: number }): Promise<void>
    unwatch(worktreePath: string, relPath: string): Promise<void>
    closeAll(): Promise<void>
  }
  ```

- [ ] **Step 1: Escribir los tests (fallando)**

```ts
// electron/__tests__/fs-bridge.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, writeFileSync, symlinkSync } from 'fs'
import { join } from 'path'
import { makeTmpDir, cleanupTmp } from './setup'
import { readFile, writeFile, listDir, ScopeViolationError, UnsupportedFileError, FsWatchRegistry } from '../fs-bridge'

describe('fs-bridge', () => {
  let root: string

  beforeEach(() => {
    root = makeTmpDir('fs-bridge-')
  })

  afterEach(() => {
    cleanupTmp(root)
  })

  it('reads a file scoped to the worktree', async () => {
    writeFileSync(join(root, 'a.txt'), 'hello')
    await expect(readFile(root, 'a.txt')).resolves.toBe('hello')
  })

  it('writes a file scoped to the worktree', async () => {
    await writeFile(root, 'b.txt', 'world')
    await expect(readFile(root, 'b.txt')).resolves.toBe('world')
  })

  it('lists directory entries, hiding .git', async () => {
    mkdirSync(join(root, '.git'))
    mkdirSync(join(root, 'src'))
    writeFileSync(join(root, 'src', 'index.ts'), '')
    writeFileSync(join(root, 'README.md'), '')
    const entries = await listDir(root, '')
    const names = entries.map((e) => e.name)
    expect(names).toContain('src')
    expect(names).toContain('README.md')
    expect(names).not.toContain('.git')
  })

  it('lists nested directory entries by relPath', async () => {
    mkdirSync(join(root, 'src'))
    writeFileSync(join(root, 'src', 'index.ts'), '')
    const entries = await listDir(root, 'src')
    expect(entries).toEqual([{ name: 'index.ts', path: 'src/index.ts', isDirectory: false }])
  })

  it('rejects a relative path that escapes the worktree via ..', async () => {
    await expect(readFile(root, '../outside.txt')).rejects.toThrow(ScopeViolationError)
  })

  it('rejects a binary file', async () => {
    writeFileSync(join(root, 'bin.dat'), Buffer.from([0, 1, 2, 3]))
    await expect(readFile(root, 'bin.dat')).rejects.toThrow(UnsupportedFileError)
  })

  it('rejects a file larger than the readable size limit', async () => {
    writeFileSync(join(root, 'big.txt'), Buffer.alloc(6 * 1024 * 1024, 'a'))
    await expect(readFile(root, 'big.txt')).rejects.toThrow(UnsupportedFileError)
  })

  it('rejects a symlink that points outside the worktree', async ({ skip }) => {
    const outside = makeTmpDir('fs-bridge-outside-')
    writeFileSync(join(outside, 'secret.txt'), 'nope')
    try {
      symlinkSync(join(outside, 'secret.txt'), join(root, 'link.txt'))
    } catch {
      // Creating filesystem symlinks needs elevated privileges on some Windows
      // configurations (no Developer Mode, non-admin). Skip rather than fail
      // CI on a platform limitation unrelated to the scoping logic itself.
      cleanupTmp(outside)
      skip()
      return
    }
    await expect(readFile(root, 'link.txt')).rejects.toThrow(ScopeViolationError)
    cleanupTmp(outside)
  })

  it('watch() fires onChange when the watched file is modified', async () => {
    writeFileSync(join(root, 'watched.txt'), 'v1')
    const registry = new FsWatchRegistry()
    const changes: string[] = []
    await registry.watch(root, 'watched.txt', (_wt, relPath) => changes.push(relPath))
    // chokidar necesita un tick para terminar su scan inicial antes de reportar cambios.
    await new Promise((r) => setTimeout(r, 300))
    writeFileSync(join(root, 'watched.txt'), 'v2')
    await new Promise((r) => setTimeout(r, 500))
    expect(changes).toContain('watched.txt')
    await registry.closeAll()
  })

  it('unwatch() stops firing onChange', async () => {
    writeFileSync(join(root, 'watched2.txt'), 'v1')
    const registry = new FsWatchRegistry()
    const changes: string[] = []
    await registry.watch(root, 'watched2.txt', (_wt, relPath) => changes.push(relPath))
    await new Promise((r) => setTimeout(r, 300))
    await registry.unwatch(root, 'watched2.txt')
    writeFileSync(join(root, 'watched2.txt'), 'v2')
    await new Promise((r) => setTimeout(r, 500))
    expect(changes).toEqual([])
    await registry.closeAll()
  })

  it('watch() on a directory with depth 0 fires (with the DIR relPath) when a direct child is created', async () => {
    mkdirSync(join(root, 'dir'))
    const registry = new FsWatchRegistry()
    const changes: string[] = []
    await registry.watch(root, 'dir', (_wt, relPath) => changes.push(relPath), { depth: 0 })
    await new Promise((r) => setTimeout(r, 300))
    writeFileSync(join(root, 'dir', 'new.txt'), 'x')
    await new Promise((r) => setTimeout(r, 500))
    expect(changes).toContain('dir')
    await registry.closeAll()
  })
})
```

- [ ] **Step 2: Correr los tests y verificar que fallan**

Run: `npx vitest run electron/__tests__/fs-bridge.test.ts`
Expected: FAIL — `Cannot find module '../fs-bridge'`.

- [ ] **Step 3: Implementar `fs-bridge.ts`**

```ts
// electron/fs-bridge.ts
import { promises as fsp } from 'fs'
import { resolve, sep } from 'path'
import chokidar, { FSWatcher } from 'chokidar'

export interface DirEntry {
  name: string
  path: string        // relative to worktreePath, POSIX-style separators
  isDirectory: boolean
}

export class ScopeViolationError extends Error {
  constructor(worktreePath: string, relPath: string) {
    super(`Path escapes worktree: ${relPath} (worktree: ${worktreePath})`)
    this.name = 'ScopeViolationError'
  }
}

export class UnsupportedFileError extends Error {
  constructor(reason: 'binary' | 'too-large', relPath: string) {
    super(reason === 'binary' ? `Binary file, cannot edit: ${relPath}` : `File too large to edit (>5MB): ${relPath}`)
    this.name = 'UnsupportedFileError'
  }
}

const MAX_READABLE_BYTES = 5 * 1024 * 1024
const BINARY_SNIFF_BYTES = 8000

async function assertReadableAsText(full: string, relPath: string): Promise<void> {
  const stat = await fsp.stat(full)
  if (stat.size > MAX_READABLE_BYTES) throw new UnsupportedFileError('too-large', relPath)
  const handle = await fsp.open(full, 'r')
  try {
    const buffer = Buffer.alloc(Math.min(BINARY_SNIFF_BYTES, stat.size))
    await handle.read(buffer, 0, buffer.length, 0)
    if (buffer.includes(0)) throw new UnsupportedFileError('binary', relPath)
  } finally {
    await handle.close()
  }
}

async function resolveScoped(worktreePath: string, relPath: string): Promise<string> {
  const root = await fsp.realpath(worktreePath)
  const candidate = resolve(root, relPath)
  let real: string
  try {
    real = await fsp.realpath(candidate)
  } catch {
    // Target may not exist yet (e.g. about to be written) — the resolved
    // (non-realpath'd) candidate is still checked against `root` below.
    real = candidate
  }
  const rootWithSep = root.endsWith(sep) ? root : root + sep
  if (real !== root && !real.startsWith(rootWithSep)) {
    throw new ScopeViolationError(worktreePath, relPath)
  }
  return real
}

export async function readFile(worktreePath: string, relPath: string): Promise<string> {
  const full = await resolveScoped(worktreePath, relPath)
  await assertReadableAsText(full, relPath)
  return fsp.readFile(full, 'utf8')
}

export async function writeFile(worktreePath: string, relPath: string, content: string): Promise<void> {
  const full = await resolveScoped(worktreePath, relPath)
  await fsp.writeFile(full, content, 'utf8')
}

export async function listDir(worktreePath: string, relPath: string): Promise<DirEntry[]> {
  const full = await resolveScoped(worktreePath, relPath)
  const entries = await fsp.readdir(full, { withFileTypes: true })
  return entries
    .filter((e) => e.name !== '.git')
    .map((e) => ({
      name: e.name,
      path: relPath ? `${relPath}/${e.name}` : e.name,
      isDirectory: e.isDirectory(),
    }))
    .sort((a, b) => {
      if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1
      return a.name.localeCompare(b.name)
    })
}

export type FsChangeCallback = (worktreePath: string, relPath: string) => void

export class FsWatchRegistry {
  private watchers = new Map<string, FSWatcher>()

  private key(worktreePath: string, relPath: string): string {
    return `${worktreePath}::${relPath}`
  }

  async watch(worktreePath: string, relPath: string, onChange: FsChangeCallback, opts?: { depth?: number }): Promise<void> {
    const key = this.key(worktreePath, relPath)
    if (this.watchers.has(key)) return
    const full = await resolveScoped(worktreePath, relPath)
    const watcher = chokidar.watch(full, {
      ignoreInitial: true,
      depth: opts?.depth,
      awaitWriteFinish: { stabilityThreshold: 200, pollInterval: 50 },
    })
    const fire = () => onChange(worktreePath, relPath)
    watcher.on('change', fire).on('unlink', fire).on('add', fire).on('unlinkDir', fire).on('addDir', fire)
    this.watchers.set(key, watcher)
  }

  async unwatch(worktreePath: string, relPath: string): Promise<void> {
    const key = this.key(worktreePath, relPath)
    const watcher = this.watchers.get(key)
    if (!watcher) return
    await watcher.close()
    this.watchers.delete(key)
  }

  async closeAll(): Promise<void> {
    await Promise.all(Array.from(this.watchers.values()).map((w) => w.close()))
    this.watchers.clear()
  }
}
```

- [ ] **Step 4: Correr los tests y verificar que pasan**

Run: `npx vitest run electron/__tests__/fs-bridge.test.ts`
Expected: PASS — 11 tests (o 10 + 1 skipped si el runner no puede crear symlinks).

- [ ] **Step 5: Commit**

```bash
git add electron/fs-bridge.ts electron/__tests__/fs-bridge.test.ts
git commit -m "feat(editor): fs-bridge con scoping por worktree y watch vía chokidar"
```

---

### Task 3: IPC handlers + preload + tipos compartidos

**Files:**
- Modify: `electron/main.ts`
- Modify: `electron/preload.ts`
- Modify: `src/types.ts`

**Interfaces:**
- Consumes: `readFile`/`writeFile`/`listDir`/`FsWatchRegistry`/`DirEntry` de `electron/fs-bridge.ts` (Task 2).
- Produces: `window.fs.{readFile,writeFile,listDir,watch,unwatch,onChanged}` tipado, disponible para Tasks 5 y 6.

- [ ] **Step 1: Agregar el tipo `DirEntry` y el bloque `Window.fs` en `src/types.ts`**

`DirEntry` se define acá DUPLICADO respecto al `DirEntry` de `electron/fs-bridge.ts` (Task 2) a propósito, no por descuido: el renderer (`src/`) no puede importar módulos de `electron/` (son bundles separados; `fs-bridge.ts` importa `fs`/`chokidar`, que no existen en el bundle del renderer). Mismo patrón que ya usa el codebase para los tipos de diff — `DiffLine`/`DiffHunk`/`DiffFile`/`DiffResult` están definidos tanto en `electron/diff-engine.ts` como en `src/types.ts`. No unificar ambas definiciones con un import cruzado.

Insertar después del bloque `DiffResult` (cerca de la línea 74):

```ts
export interface DirEntry {
  name: string
  path: string
  isDirectory: boolean
}
```

Insertar dentro de `declare global { interface Window { ... } }`, después del bloque `diff` (cerca de la línea 481):

```ts
    fs: {
      readFile: (worktreePath: string, relPath: string) => Promise<{ ok: true; content: string } | { ok: false; error: string }>
      writeFile: (worktreePath: string, relPath: string, content: string) => Promise<{ ok: true } | { ok: false; error: string }>
      listDir: (worktreePath: string, relPath: string) => Promise<{ ok: true; entries: DirEntry[] } | { ok: false; error: string }>
      watch: (worktreePath: string, relPath: string, opts?: { depth?: number }) => Promise<{ ok: true } | { ok: false; error: string }>
      unwatch: (worktreePath: string, relPath: string) => Promise<void>
      onChanged: (cb: (worktreePath: string, relPath: string) => void) => () => void
    }
```

- [ ] **Step 2: Registrar los handlers IPC en `electron/main.ts`**

Agregar el import junto a los demás (cerca de la línea 126, al lado de `import { getDiff } from './diff-engine'`):

```ts
import { readFile as fsReadFile, writeFile as fsWriteFile, listDir as fsListDir, FsWatchRegistry } from './fs-bridge'
```

Agregar la instancia junto a los demás stores (cerca de la línea 153, después de `const metricsCollector = new MetricsCollector()`):

```ts
const fsWatchRegistry = new FsWatchRegistry()
app.on('before-quit', () => { fsWatchRegistry.closeAll() })
```

Agregar los handlers cerca de `diff:get` (el handler existente arranca en la línea 1673; agregar los nuevos justo después de su cierre):

```ts
ipcMain.handle('fs:readFile', async (_evt, worktreePath: string, relPath: string) => {
  if (!isAbsolute(worktreePath)) return { ok: false as const, error: 'worktreePath must be absolute' }
  try {
    const content = await fsReadFile(worktreePath, relPath)
    return { ok: true as const, content }
  } catch (err) {
    return { ok: false as const, error: err instanceof Error ? err.message : String(err) }
  }
})

ipcMain.handle('fs:writeFile', async (_evt, worktreePath: string, relPath: string, content: string) => {
  if (!isAbsolute(worktreePath)) return { ok: false as const, error: 'worktreePath must be absolute' }
  try {
    await fsWriteFile(worktreePath, relPath, content)
    return { ok: true as const }
  } catch (err) {
    return { ok: false as const, error: err instanceof Error ? err.message : String(err) }
  }
})

ipcMain.handle('fs:listDir', async (_evt, worktreePath: string, relPath: string) => {
  if (!isAbsolute(worktreePath)) return { ok: false as const, error: 'worktreePath must be absolute' }
  try {
    const entries = await fsListDir(worktreePath, relPath)
    return { ok: true as const, entries }
  } catch (err) {
    return { ok: false as const, error: err instanceof Error ? err.message : String(err) }
  }
})

ipcMain.handle('fs:watch', async (_evt, worktreePath: string, relPath: string, opts?: { depth?: number }) => {
  if (!isAbsolute(worktreePath)) return { ok: false as const, error: 'worktreePath must be absolute' }
  try {
    await fsWatchRegistry.watch(worktreePath, relPath, (wt, rp) => broadcast('fs:changed', wt, rp), opts)
    return { ok: true as const }
  } catch (err) {
    return { ok: false as const, error: err instanceof Error ? err.message : String(err) }
  }
})

ipcMain.handle('fs:unwatch', async (_evt, worktreePath: string, relPath: string) => {
  await fsWatchRegistry.unwatch(worktreePath, relPath)
})
```

- [ ] **Step 3: Exponer el bridge en `electron/preload.ts`**

Agregar después del bloque `diff` (después de la línea 268):

```ts
contextBridge.exposeInMainWorld('fs', {
  readFile: (worktreePath: string, relPath: string) => ipcRenderer.invoke('fs:readFile', worktreePath, relPath),
  writeFile: (worktreePath: string, relPath: string, content: string) =>
    ipcRenderer.invoke('fs:writeFile', worktreePath, relPath, content),
  listDir: (worktreePath: string, relPath: string) => ipcRenderer.invoke('fs:listDir', worktreePath, relPath),
  watch: (worktreePath: string, relPath: string, opts?: { depth?: number }) => ipcRenderer.invoke('fs:watch', worktreePath, relPath, opts),
  unwatch: (worktreePath: string, relPath: string) => ipcRenderer.invoke('fs:unwatch', worktreePath, relPath),
  onChanged: (cb: (worktreePath: string, relPath: string) => void) => {
    const handler = (_e: IpcRendererEvent, worktreePath: string, relPath: string) => cb(worktreePath, relPath)
    ipcRenderer.on('fs:changed', handler)
    return () => ipcRenderer.removeListener('fs:changed', handler)
  },
})
```

- [ ] **Step 4: Verificar bundling**

Run: `npm run build`
Expected: build exitoso — valida que los imports nuevos en `main.ts`/`preload.ts` resuelven y bundlean (esbuild NO chequea tipos; los errores de tipos del bloque `Window.fs` los marca el editor/LSP, revisarlos ahí antes de commitear).

No hay test unitario dedicado para este glue de IPC — mismo criterio que el resto del codebase (p.ej. `diff:get` tampoco tiene test propio; lo que se testea es la lógica pura en `diff-engine.test.ts`). La cobertura de esta capa de wiring llega vía el E2E de la Task 8.

- [ ] **Step 5: Commit**

```bash
git add electron/main.ts electron/preload.ts src/types.ts
git commit -m "feat(editor): exponer bridge fs por IPC (readFile/writeFile/listDir/watch)"
```

---

### Task 4: Tipos de dominio — `AIType`, `AI_CONFIG`, `PaneNode`, `EditorTab`

**Files:**
- Modify: `src/types.ts`

**Interfaces:**
- Produces (usado por Tasks 5, 6, 7):
  ```ts
  export type AIType = /* ...existentes... */ | 'editor'
  export interface EditorTab { relPath: string; dirty: boolean }
  // PaneNode gana: editorTabs?: EditorTab[]; activeEditorTabPath?: string
  // AI_CONFIG.editor: { label: 'Editor', color: '#4EC9B0', bg: '#0d1f1c', cmd: '', noAccount: true }
  ```

- [ ] **Step 1: Agregar `'editor'` al union `AIType`**

```ts
export type AIType = 'claude' | 'gemini' | 'codex' | 'copilot' | 'opencode' | 'terminal' | 'custom' | 'browser' | 'editor'
```

- [ ] **Step 2: Agregar el tipo `EditorTab` y los campos nuevos en `PaneNode`**

```ts
export interface EditorTab {
  relPath: string  // path relativo al repoPath del pane, POSIX-style
  dirty: boolean
}
```

En `PaneNode`, agregar después de `shellId?: string`:

```ts
  editorTabs?: EditorTab[]        // editor panes only: open files
  activeEditorTabPath?: string    // editor panes only: which tab is focused
```

- [ ] **Step 3: Agregar la entrada `editor` a `AI_CONFIG`**

```ts
export const AI_CONFIG: Record<AIType, { label: string; color: string; bg: string; cmd: string; noAccount?: boolean }> = {
  claude:   { label: 'Claude',   color: '#E07B54', bg: '#2a1a14', cmd: 'claude'     },
  gemini:   { label: 'Gemini',   color: '#4F9EFF', bg: '#0d1f35', cmd: 'gemini'     },
  codex:    { label: 'Codex',    color: '#aaaaaa', bg: '#1c1c1c', cmd: 'codex'      },
  copilot:  { label: 'Copilot',  color: '#7C5CFC', bg: '#150d2e', cmd: 'gh copilot' },
  opencode: { label: 'OpenCode', color: '#FFFFFF', bg: '#111111', cmd: 'opencode', noAccount: true },
  terminal: { label: 'Terminal', color: '#888888', bg: '#1a1a1a', cmd: '',           noAccount: true },
  custom:   { label: 'Custom',   color: '#888888', bg: '#1a1a1a', cmd: '',           noAccount: true },
  browser:  { label: 'Browser',  color: '#0066FF', bg: '#0a1428', cmd: '',           noAccount: true },
  editor:   { label: 'Editor',   color: '#4EC9B0', bg: '#0d1f1c', cmd: '',           noAccount: true },
}
```

- [ ] **Step 4: Verificar que nada se rompe**

Run: `npm run build && npx vitest run`
Expected: build exitoso y suite existente en verde. OJO: esbuild no chequea tipos, así que la exhaustividad de `Record<AIType, ...>` (p.ej. que `AI_CONFIG` tenga la entrada `editor`) NO la valida este comando — la marca el editor/LSP; revisar que no queden diagnósticos de TS en `src/types.ts` antes de commitear. `renderPane` en `App.tsx` usa un `? :` no exhaustivo, no un switch, así que no hay otros puntos de exhaustividad que tocar.

- [ ] **Step 5: Commit**

```bash
git add src/types.ts
git commit -m "feat(editor): agregar aiType 'editor', EditorTab y campos de PaneNode"
```

---

### Task 5: `ExplorerPanel` (árbol de archivos del Sidebar)

**Files:**
- Create: `src/components/ExplorerPanel.tsx`
- Test: `src/__tests__/components/ExplorerPanel.test.tsx`

**Interfaces:**
- Consumes: `useBridge()`/`BridgeProvider` (`src/lib/bridge.ts`), `window.fs.{listDir,watch,unwatch,onChanged}` (Task 3), `DirEntry` (`src/types.ts`, Task 3).
- Produces (usado por Task 7):
  ```ts
  export function ExplorerPanel(props: { worktreePath: string | null; onFileOpen: (relPath: string) => void }): JSX.Element
  ```

Requisito del spec cubierto acá: el árbol se re-suscribe a cambios de las carpetas cargadas (root + expandidas) para reflejar archivos que crean/borran los subagentes de las terminales del mismo tab. Cada carpeta se watchea con `{ depth: 0 }` — sin recursión, si no watchear una carpeta cercana al root arrastraría `node_modules` entero.

- [ ] **Step 1: Escribir el test (fallando)**

```tsx
// src/__tests__/components/ExplorerPanel.test.tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { BridgeProvider } from '../../lib/bridge'
import { ExplorerPanel } from '../../components/ExplorerPanel'

function makeMockBridge() {
  let changeCb: ((wt: string, rel: string) => void) | null = null
  const rootEntries = [
    { name: 'src', path: 'src', isDirectory: true },
    { name: 'README.md', path: 'README.md', isDirectory: false },
  ]
  const fs = {
    listDir: vi.fn().mockImplementation((_wt: string, relPath: string) => {
      if (relPath === '') return Promise.resolve({ ok: true, entries: [...rootEntries] })
      if (relPath === 'src') {
        return Promise.resolve({ ok: true, entries: [{ name: 'index.ts', path: 'src/index.ts', isDirectory: false }] })
      }
      return Promise.resolve({ ok: true, entries: [] })
    }),
    watch: vi.fn().mockResolvedValue({ ok: true }),
    unwatch: vi.fn().mockResolvedValue(undefined),
    onChanged: vi.fn((cb: (wt: string, rel: string) => void) => {
      changeCb = cb
      return () => { changeCb = null }
    }),
  }
  const bridge = { fs } as unknown as Window & typeof globalThis
  return { bridge, rootEntries, fireChange: (wt: string, rel: string) => changeCb?.(wt, rel) }
}

describe('ExplorerPanel', () => {
  it('shows a placeholder when there is no active worktree', () => {
    render(<ExplorerPanel worktreePath={null} onFileOpen={vi.fn()} />)
    expect(screen.getByText(/no hay repo activo/i)).toBeInTheDocument()
  })

  it('renders the root listing', async () => {
    const { bridge } = makeMockBridge()
    render(<BridgeProvider value={bridge}><ExplorerPanel worktreePath="/repo" onFileOpen={vi.fn()} /></BridgeProvider>)
    await waitFor(() => expect(screen.getByText('README.md')).toBeInTheDocument())
    expect(screen.getByText('src')).toBeInTheDocument()
  })

  it('calls onFileOpen when a file entry is clicked', async () => {
    const { bridge } = makeMockBridge()
    const onFileOpen = vi.fn()
    render(<BridgeProvider value={bridge}><ExplorerPanel worktreePath="/repo" onFileOpen={onFileOpen} /></BridgeProvider>)
    await waitFor(() => screen.getByText('README.md'))
    fireEvent.click(screen.getByText('README.md'))
    expect(onFileOpen).toHaveBeenCalledWith('README.md')
  })

  it('expands a directory and lists its children on click', async () => {
    const { bridge } = makeMockBridge()
    render(<BridgeProvider value={bridge}><ExplorerPanel worktreePath="/repo" onFileOpen={vi.fn()} /></BridgeProvider>)
    await waitFor(() => screen.getByText('src'))
    fireEvent.click(screen.getByText('src'))
    await waitFor(() => expect(screen.getByText('index.ts')).toBeInTheDocument())
  })

  it('watches the root (depth 0) and re-lists it when a change is reported', async () => {
    const { bridge, rootEntries, fireChange } = makeMockBridge()
    render(<BridgeProvider value={bridge}><ExplorerPanel worktreePath="/repo" onFileOpen={vi.fn()} /></BridgeProvider>)
    await waitFor(() => screen.getByText('README.md'))
    expect(bridge.fs.watch).toHaveBeenCalledWith('/repo', '', { depth: 0 })
    rootEntries.push({ name: 'NEW.txt', path: 'NEW.txt', isDirectory: false })
    fireChange('/repo', '')
    await waitFor(() => expect(screen.getByText('NEW.txt')).toBeInTheDocument())
  })

  it('watches an expanded directory (depth 0) and unwatches it on collapse', async () => {
    const { bridge } = makeMockBridge()
    render(<BridgeProvider value={bridge}><ExplorerPanel worktreePath="/repo" onFileOpen={vi.fn()} /></BridgeProvider>)
    await waitFor(() => screen.getByText('src'))
    fireEvent.click(screen.getByText('src'))
    await waitFor(() => expect(bridge.fs.watch).toHaveBeenCalledWith('/repo', 'src', { depth: 0 }))
    fireEvent.click(screen.getByText('src'))
    await waitFor(() => expect(bridge.fs.unwatch).toHaveBeenCalledWith('/repo', 'src'))
  })
})
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npx vitest run src/__tests__/components/ExplorerPanel.test.tsx`
Expected: FAIL — `Cannot find module '../../components/ExplorerPanel'`.

- [ ] **Step 3: Implementar `ExplorerPanel.tsx`**

```tsx
// src/components/ExplorerPanel.tsx
import { useCallback, useEffect, useRef, useState } from 'react'
import { useBridge } from '../lib/bridge'
import type { DirEntry } from '../types'

interface ExplorerPanelProps {
  worktreePath: string | null
  onFileOpen: (relPath: string) => void
}

export function ExplorerPanel({ worktreePath, onFileOpen }: ExplorerPanelProps) {
  const bridge = useBridge()
  const [entriesByDir, setEntriesByDir] = useState<Record<string, DirEntry[]>>({})
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const entriesByDirRef = useRef(entriesByDir)
  entriesByDirRef.current = entriesByDir
  // Dirs we watch besides root. Collapsing a parent leaves its expanded
  // children watched until unmount/worktree switch — bounded (depth-0
  // watchers are cheap) and simpler than tracking the subtree.
  const watchedDirsRef = useRef(new Set<string>())

  const loadDir = useCallback((relPath: string) => {
    if (!worktreePath) return
    bridge.fs.listDir(worktreePath, relPath).then((res) => {
      if (res.ok) setEntriesByDir((e) => ({ ...e, [relPath]: res.entries }))
    })
  }, [worktreePath, bridge])

  useEffect(() => {
    setEntriesByDir({})
    setExpanded({})
    if (!worktreePath) return
    loadDir('')
    bridge.fs.watch(worktreePath, '', { depth: 0 })
    const unsubscribe = bridge.fs.onChanged((wt, relPath) => {
      if (wt !== worktreePath) return
      // El watcher reporta el relPath de la CARPETA watcheada (ver Task 2);
      // si la tenemos cargada, se re-lista.
      if (entriesByDirRef.current[relPath] !== undefined) loadDir(relPath)
    })
    return () => {
      unsubscribe()
      bridge.fs.unwatch(worktreePath, '')
      watchedDirsRef.current.forEach((dir) => bridge.fs.unwatch(worktreePath, dir))
      watchedDirsRef.current.clear()
    }
  }, [worktreePath, loadDir, bridge])

  const toggleDir = useCallback((relPath: string) => {
    if (!worktreePath) return
    const willExpand = !expanded[relPath]
    setExpanded((e) => ({ ...e, [relPath]: willExpand }))
    if (willExpand) {
      if (!entriesByDirRef.current[relPath]) loadDir(relPath)
      bridge.fs.watch(worktreePath, relPath, { depth: 0 })
      watchedDirsRef.current.add(relPath)
    } else {
      bridge.fs.unwatch(worktreePath, relPath)
      watchedDirsRef.current.delete(relPath)
    }
  }, [worktreePath, expanded, loadDir, bridge])

  if (!worktreePath) {
    return <div className="explorer-panel explorer-panel-empty">No hay repo activo</div>
  }

  const renderEntries = (relPath: string, depth: number) => {
    const entries = entriesByDir[relPath] ?? []
    return entries.map((entry) => (
      <div key={entry.path}>
        <div
          className="explorer-entry"
          style={{ paddingLeft: `${depth * 12 + 8}px` }}
          onClick={() => (entry.isDirectory ? toggleDir(entry.path) : onFileOpen(entry.path))}
        >
          <span className="explorer-entry-icon">{entry.isDirectory ? (expanded[entry.path] ? '▾' : '▸') : '·'}</span>
          <span className="explorer-entry-name">{entry.name}</span>
        </div>
        {entry.isDirectory && expanded[entry.path] && renderEntries(entry.path, depth + 1)}
      </div>
    ))
  }

  return <div className="explorer-panel">{renderEntries('', 0)}</div>
}
```

Agregar estilos mínimos en `src/styles/global.css` reusando la paleta ya existente para `.sidebar-item`/`.sidebar-label` (mismo tratamiento visual que el resto del Sidebar, sin diseño nuevo):

```css
.explorer-panel { font-size: 12px; overflow-y: auto; }
.explorer-panel-empty { padding: 8px; opacity: 0.6; }
.explorer-entry { display: flex; align-items: center; gap: 4px; padding: 2px 4px; cursor: pointer; }
.explorer-entry:hover { background: rgba(255, 255, 255, 0.06); }
.explorer-entry-icon { width: 10px; opacity: 0.7; }
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `npx vitest run src/__tests__/components/ExplorerPanel.test.tsx`
Expected: PASS — 6 tests.

- [ ] **Step 5: Commit**

```bash
git add src/components/ExplorerPanel.tsx src/__tests__/components/ExplorerPanel.test.tsx src/styles/global.css
git commit -m "feat(editor): componente ExplorerPanel (árbol de archivos lazy)"
```

---

### Task 6: `EditorPane` (Monaco, tabs, guardado, conflictos)

**Files:**
- Create: `src/components/EditorPane.tsx`
- Test: `src/__tests__/components/EditorPane.test.tsx`

**Interfaces:**
- Consumes: `useBridge()` (`src/lib/bridge.ts`), `window.fs.{readFile,writeFile,watch,unwatch,onChanged}` (Task 3), `PaneNode`/`EditorTab` (Task 4).
- Produces (usado por Task 7):
  ```ts
  export function EditorPane(props: {
    pane: PaneNode
    onTabsChange: (tabs: EditorTab[], activeEditorTabPath: string | undefined) => void
    onClose: () => void
    onFocus: () => void
    onOpenInNewPane: (relPath: string) => void
  }): JSX.Element
  ```

Nota de testeo: el test mockea `@monaco-editor/react` entero con `vi.mock`. Esto funciona porque el bootstrap de Monaco (`src/lib/monaco-setup.ts`, Task 1) se importa desde `src/main.tsx` y NO desde `EditorPane.tsx` — jsdom nunca ve `monaco-editor` ni los imports `?worker` (que Vitest no resuelve). No importar `monaco-setup` desde este componente.

- [ ] **Step 1: Escribir el test (fallando)**

```tsx
// src/__tests__/components/EditorPane.test.tsx
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { BridgeProvider } from '../../lib/bridge'
import { EditorPane } from '../../components/EditorPane'
import type { PaneNode } from '../../types'

vi.mock('@monaco-editor/react', () => ({
  default: ({ value, onChange }: { value: string; onChange: (v: string | undefined) => void }) => (
    <textarea data-testid="monaco-stub" value={value} onChange={(e) => onChange(e.target.value)} />
  ),
}))

function makePane(overrides: Partial<PaneNode> = {}): PaneNode {
  return {
    id: 'pane-1',
    aiType: 'editor',
    accountName: '',
    accountDir: '',
    borderColor: '#000',
    cmd: '',
    repoPath: '/repo',
    editorTabs: [{ relPath: 'a.ts', dirty: false }],
    activeEditorTabPath: 'a.ts',
    ...overrides,
  }
}

function makeMockBridge() {
  let changeCb: ((wt: string, rel: string) => void) | null = null
  const fs = {
    readFile: vi.fn().mockResolvedValue({ ok: true, content: 'hello' }),
    writeFile: vi.fn().mockResolvedValue({ ok: true }),
    watch: vi.fn().mockResolvedValue({ ok: true }),
    unwatch: vi.fn().mockResolvedValue(undefined),
    onChanged: vi.fn((cb: (wt: string, rel: string) => void) => {
      changeCb = cb
      return () => { changeCb = null }
    }),
  }
  const bridge = { fs } as unknown as Window & typeof globalThis
  return { bridge, fireChange: (wt: string, rel: string) => changeCb?.(wt, rel) }
}

describe('EditorPane', () => {
  afterEach(() => vi.clearAllMocks())

  it('loads and displays file content', async () => {
    const { bridge } = makeMockBridge()
    render(
      <BridgeProvider value={bridge}>
        <EditorPane pane={makePane()} onTabsChange={vi.fn()} onClose={vi.fn()} onFocus={vi.fn()} onOpenInNewPane={vi.fn()} />
      </BridgeProvider>,
    )
    await waitFor(() => expect(screen.getByTestId('monaco-stub')).toHaveValue('hello'))
  })

  it('marks the tab dirty after an edit', async () => {
    const { bridge } = makeMockBridge()
    const onTabsChange = vi.fn()
    render(
      <BridgeProvider value={bridge}>
        <EditorPane pane={makePane()} onTabsChange={onTabsChange} onClose={vi.fn()} onFocus={vi.fn()} onOpenInNewPane={vi.fn()} />
      </BridgeProvider>,
    )
    await waitFor(() => expect(screen.getByTestId('monaco-stub')).toHaveValue('hello'))
    fireEvent.change(screen.getByTestId('monaco-stub'), { target: { value: 'hello world' } })
    expect(onTabsChange).toHaveBeenCalledWith([{ relPath: 'a.ts', dirty: true }], 'a.ts')
  })

  it('shows a conflict banner when the file changes on disk while dirty', async () => {
    const { bridge, fireChange } = makeMockBridge()
    render(
      <BridgeProvider value={bridge}>
        <EditorPane
          pane={makePane({ editorTabs: [{ relPath: 'a.ts', dirty: true }] })}
          onTabsChange={vi.fn()}
          onClose={vi.fn()}
          onFocus={vi.fn()}
          onOpenInNewPane={vi.fn()}
        />
      </BridgeProvider>,
    )
    await waitFor(() => expect(bridge.fs.watch).toHaveBeenCalledWith('/repo', 'a.ts'))
    fireChange('/repo', 'a.ts')
    await waitFor(() => expect(screen.getByTestId('conflict-banner')).toBeInTheDocument())
  })

  it('does not show a conflict banner when the file changes and there are no unsaved edits', async () => {
    const { bridge, fireChange } = makeMockBridge()
    render(
      <BridgeProvider value={bridge}>
        <EditorPane pane={makePane()} onTabsChange={vi.fn()} onClose={vi.fn()} onFocus={vi.fn()} onOpenInNewPane={vi.fn()} />
      </BridgeProvider>,
    )
    await waitFor(() => expect(bridge.fs.watch).toHaveBeenCalledWith('/repo', 'a.ts'))
    fireChange('/repo', 'a.ts')
    await waitFor(() => expect(bridge.fs.readFile).toHaveBeenCalledTimes(2))
    expect(screen.queryByTestId('conflict-banner')).not.toBeInTheDocument()
  })

  it('shows a "file unavailable" message instead of Monaco when the initial read fails', async () => {
    const { bridge } = makeMockBridge()
    ;(bridge.fs.readFile as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ ok: false, error: 'Binary file, cannot edit: a.ts' })
    render(
      <BridgeProvider value={bridge}>
        <EditorPane pane={makePane()} onTabsChange={vi.fn()} onClose={vi.fn()} onFocus={vi.fn()} onOpenInNewPane={vi.fn()} />
      </BridgeProvider>,
    )
    await waitFor(() => expect(screen.getByTestId('file-unavailable')).toHaveTextContent('Binary file, cannot edit: a.ts'))
    expect(screen.queryByTestId('monaco-stub')).not.toBeInTheDocument()
  })

  it('shows a "file unavailable" message when a re-read after a change event fails (file removed on disk)', async () => {
    const { bridge, fireChange } = makeMockBridge()
    render(
      <BridgeProvider value={bridge}>
        <EditorPane pane={makePane()} onTabsChange={vi.fn()} onClose={vi.fn()} onFocus={vi.fn()} onOpenInNewPane={vi.fn()} />
      </BridgeProvider>,
    )
    await waitFor(() => expect(screen.getByTestId('monaco-stub')).toHaveValue('hello'))
    ;(bridge.fs.readFile as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ ok: false, error: 'ENOENT: no such file' })
    fireChange('/repo', 'a.ts')
    await waitFor(() => expect(screen.getByTestId('file-unavailable')).toHaveTextContent('ENOENT: no such file'))
  })

  it('alerts and keeps the tab dirty when saving fails', async () => {
    const { bridge } = makeMockBridge()
    ;(bridge.fs.writeFile as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ ok: false, error: 'EACCES: permission denied' })
    const onTabsChange = vi.fn()
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {})
    render(
      <BridgeProvider value={bridge}>
        <EditorPane pane={makePane()} onTabsChange={onTabsChange} onClose={vi.fn()} onFocus={vi.fn()} onOpenInNewPane={vi.fn()} />
      </BridgeProvider>,
    )
    await waitFor(() => expect(screen.getByTestId('monaco-stub')).toHaveValue('hello'))
    fireEvent.change(screen.getByTestId('monaco-stub'), { target: { value: 'edited' } })
    expect(onTabsChange).toHaveBeenCalledWith([{ relPath: 'a.ts', dirty: true }], 'a.ts')
    onTabsChange.mockClear()

    fireEvent.keyDown(window, { key: 's', ctrlKey: true })
    await waitFor(() => expect(alertSpy).toHaveBeenCalledWith(expect.stringContaining('EACCES: permission denied')))
    // setDirty(false) never fires on a failed save — onTabsChange stays untouched
    // since the last (successful) edit call, so the tab remains marked dirty.
    expect(onTabsChange).not.toHaveBeenCalled()
    alertSpy.mockRestore()
  })
})
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npx vitest run src/__tests__/components/EditorPane.test.tsx`
Expected: FAIL — `Cannot find module '../../components/EditorPane'`.

- [ ] **Step 3: Implementar `EditorPane.tsx`**

```tsx
// src/components/EditorPane.tsx
import { useCallback, useEffect, useRef, useState } from 'react'
import Editor from '@monaco-editor/react'
import { useBridge } from '../lib/bridge'
import type { EditorTab, PaneNode } from '../types'

interface EditorPaneProps {
  pane: PaneNode
  onTabsChange: (tabs: EditorTab[], activeEditorTabPath: string | undefined) => void
  onClose: () => void
  onFocus: () => void
  onOpenInNewPane: (relPath: string) => void
}

export function EditorPane({ pane, onTabsChange, onClose, onFocus, onOpenInNewPane }: EditorPaneProps) {
  const bridge = useBridge()
  const worktreePath = pane.repoPath
  const tabs = pane.editorTabs ?? []
  const activePath = pane.activeEditorTabPath ?? tabs[0]?.relPath

  const [contents, setContents] = useState<Record<string, string>>({})
  const [conflicts, setConflicts] = useState<Record<string, boolean>>({})
  // Read failures: initial open of a binary/oversized file, or a re-read after
  // a disk change fails (typically ENOENT — the file/worktree was removed).
  // Distinct from `conflicts`, which is only about unsaved-edits-vs-disk.
  const [loadErrors, setLoadErrors] = useState<Record<string, string>>({})
  const contentsRef = useRef(contents)
  contentsRef.current = contents
  const tabsRef = useRef(tabs)
  tabsRef.current = tabs

  useEffect(() => {
    if (!worktreePath) return
    tabs.forEach((tab) => {
      if (contentsRef.current[tab.relPath] !== undefined) return
      bridge.fs.readFile(worktreePath, tab.relPath).then((res) => {
        if (res.ok) {
          setContents((c) => ({ ...c, [tab.relPath]: res.content }))
          setLoadErrors((e) => { const { [tab.relPath]: _drop, ...rest } = e; return rest })
        } else {
          setLoadErrors((e) => ({ ...e, [tab.relPath]: res.error }))
        }
      })
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabs, worktreePath, bridge])

  useEffect(() => {
    if (!worktreePath) return
    tabs.forEach((tab) => bridge.fs.watch(worktreePath, tab.relPath))
    const unsubscribe = bridge.fs.onChanged((changedWorktree, relPath) => {
      if (changedWorktree !== worktreePath) return
      const tab = tabsRef.current.find((t) => t.relPath === relPath)
      if (!tab) return
      if (tab.dirty) {
        setConflicts((c) => ({ ...c, [relPath]: true }))
        return
      }
      bridge.fs.readFile(worktreePath, relPath).then((res) => {
        if (res.ok) {
          setContents((c) => ({ ...c, [relPath]: res.content }))
          setLoadErrors((e) => { const { [relPath]: _drop, ...rest } = e; return rest })
        } else {
          // Most commonly ENOENT — the file (or its whole worktree) was
          // removed on disk. No proactive pane teardown on worktree:remove
          // exists in this codebase for any pane type (see design spec,
          // "Manejo de errores") — this reuses the same watch/read path
          // conflicts already go through, so it needs no separate listener.
          setLoadErrors((e) => ({ ...e, [relPath]: res.error }))
        }
      })
    })
    return () => {
      unsubscribe()
      tabs.forEach((tab) => bridge.fs.unwatch(worktreePath, tab.relPath))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabs, worktreePath, bridge])

  const setDirty = useCallback((relPath: string, dirty: boolean) => {
    onTabsChange(tabs.map((t) => (t.relPath === relPath ? { ...t, dirty } : t)), activePath)
  }, [tabs, activePath, onTabsChange])

  const handleChange = useCallback((relPath: string, value: string | undefined) => {
    setContents((c) => ({ ...c, [relPath]: value ?? '' }))
    setDirty(relPath, true)
  }, [setDirty])

  const save = useCallback(async (relPath: string) => {
    if (!worktreePath) return
    const content = contentsRef.current[relPath] ?? ''
    const res = await bridge.fs.writeFile(worktreePath, relPath, content)
    if (res.ok) {
      setDirty(relPath, false)
      setConflicts((c) => ({ ...c, [relPath]: false }))
    } else {
      // No global toast service exists in this app (see design spec) — the
      // established precedent for surfacing a rare failure immediately is
      // window.alert (src/App.tsx:537-541, WorktreesSection.tsx:160).
      window.alert(`No se pudo guardar ${relPath}: ${res.error}`)
    }
  }, [worktreePath, bridge, setDirty])

  const keepMine = useCallback((relPath: string) => {
    setConflicts((c) => ({ ...c, [relPath]: false }))
  }, [])

  const reloadFromDisk = useCallback(async (relPath: string) => {
    if (!worktreePath) return
    const res = await bridge.fs.readFile(worktreePath, relPath)
    if (res.ok) setContents((c) => ({ ...c, [relPath]: res.content }))
    setConflicts((c) => ({ ...c, [relPath]: false }))
    setDirty(relPath, false)
  }, [worktreePath, bridge, setDirty])

  const closeTab = useCallback((relPath: string) => {
    const nextTabs = tabs.filter((t) => t.relPath !== relPath)
    const nextActive = activePath === relPath ? nextTabs[0]?.relPath : activePath
    onTabsChange(nextTabs, nextActive)
    if (nextTabs.length === 0) onClose()
  }, [tabs, activePath, onTabsChange, onClose])

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const isSave = (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's'
      if (isSave && activePath) {
        e.preventDefault()
        save(activePath)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [activePath, save])

  return (
    <div className="editor-pane" onFocus={onFocus} tabIndex={-1}>
      <div className="editor-pane-tabs">
        {tabs.map((tab) => (
          <div
            key={tab.relPath}
            className={`editor-tab${tab.relPath === activePath ? ' active' : ''}`}
            onClick={() => onTabsChange(tabs, tab.relPath)}
          >
            <span className="editor-tab-name">{tab.relPath.split('/').pop()}</span>
            {tab.dirty && <span className="editor-tab-dirty" data-testid={`dirty-${tab.relPath}`}>●</span>}
            <button
              className="editor-tab-move"
              title="Abrir en pane nuevo"
              onClick={(e) => { e.stopPropagation(); onOpenInNewPane(tab.relPath) }}
            >⇱</button>
            <button className="editor-tab-close" onClick={(e) => { e.stopPropagation(); closeTab(tab.relPath) }}>×</button>
          </div>
        ))}
      </div>
      {activePath && conflicts[activePath] && (
        <div className="editor-conflict-banner" data-testid="conflict-banner">
          El archivo cambió en disco.
          <button onClick={() => keepMine(activePath)}>Mantener mis cambios</button>
          <button onClick={() => reloadFromDisk(activePath)}>Recargar de disco</button>
        </div>
      )}
      {activePath && loadErrors[activePath] ? (
        <div className="editor-file-unavailable" data-testid="file-unavailable">
          {loadErrors[activePath]}
          <button onClick={() => closeTab(activePath)}>Cerrar</button>
        </div>
      ) : activePath && (
        <Editor path={activePath} value={contents[activePath] ?? ''} onChange={(value) => handleChange(activePath, value)} theme="vs-dark" />
      )}
    </div>
  )
}
```

Agregar estilos mínimos en `src/styles/global.css`:

```css
.editor-pane { display: flex; flex-direction: column; height: 100%; }
.editor-pane-tabs { display: flex; border-bottom: 1px solid rgba(255,255,255,0.1); }
.editor-tab { display: flex; align-items: center; gap: 4px; padding: 4px 8px; cursor: pointer; font-size: 12px; }
.editor-tab.active { background: rgba(255,255,255,0.08); }
.editor-tab-dirty { color: #4EC9B0; }
.editor-conflict-banner { display: flex; align-items: center; gap: 8px; padding: 6px 8px; background: #402a1a; font-size: 12px; }
.editor-file-unavailable { display: flex; align-items: center; gap: 8px; padding: 16px; opacity: 0.8; font-size: 12px; }
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `npx vitest run src/__tests__/components/EditorPane.test.tsx`
Expected: PASS — 7 tests.

- [ ] **Step 5: Commit**

```bash
git add src/components/EditorPane.tsx src/__tests__/components/EditorPane.test.tsx src/styles/global.css
git commit -m "feat(editor): componente EditorPane (Monaco, tabs, guardado, conflictos)"
```

---

### Task 7: Wiring — `App.tsx` (pane routing) + `Sidebar.tsx` (Explorer)

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/components/Sidebar.tsx`

**Interfaces:**
- Consumes: `ExplorerPanel` (Task 5), `EditorPane` (Task 6), `AI_CONFIG.editor` / `EditorTab` (Task 4).

- [ ] **Step 1: Extender `addPane` en `src/App.tsx` para aceptar campos iniciales opcionales**

Ubicar el `addPane` existente (línea ~239) y reemplazar su firma y cuerpo:

```ts
const addPane = useCallback((
  aiType: AIType, accountName: string, accountDir: string, borderColor: string,
  cmd: string, customLabel?: string, customColor?: string, shellId?: string,
  initial?: Partial<Pick<PaneNode, 'editorTabs' | 'activeEditorTabPath' | 'repoPath'>>,
) => {
  if (panesRef.current.length >= MAX_PANES) {
    setAddingPane(null)
    return
  }
  if (panesRef.current.length >= planLimits.maxPanes) {
    setAddingPane(null)
    setShowUpgrade(true)
    return
  }
  const worktreePath = addingPaneRef.current?.worktreePath
  updateActiveTab(t => {
    const pane: PaneNode = {
      id: generateId(), aiType, accountName, accountDir, borderColor, cmd,
      customLabel, customColor, shellId,
      repoPath: worktreePath ?? t.repoPath,
      ...initial,
    }
    const nextPanes = [...t.panes, pane]
    const currentSlots = getPreset(t.layoutId).slotCount
    const promoted = nextPanes.length > currentSlots
    const layoutId: LayoutId = promoted ? defaultLayoutFor(nextPanes.length) : t.layoutId
    return promoted
      ? { ...t, panes: nextPanes, layoutId, splitRatios: {} }
      : { ...t, panes: nextPanes, layoutId }
  })
  setAddingPane(null)
}, [updateActiveTab, planLimits.maxPanes])
```

- [ ] **Step 2: Agregar `updatePaneEditorTabs`, `openFileInEditor` y `moveEditorTabToNewPane`**

Agregar cerca de `updatePaneUrl` (línea ~421):

```ts
const updatePaneEditorTabs = useCallback((paneId: string, tabs: EditorTab[], activeEditorTabPath: string | undefined) => {
  updateActiveTab(t => ({
    ...t,
    panes: t.panes.map(p => p.id === paneId ? { ...p, editorTabs: tabs, activeEditorTabPath } : p),
  }))
}, [updateActiveTab])

const openFileInEditor = useCallback((relPath: string) => {
  const worktreePath = activeCellRepoPath
  if (!worktreePath) return
  const focusedId = focusedPaneIdRef.current
  const focusedPane = focusedId ? activeTab.panes.find(p => p.id === focusedId) : undefined
  const sameWorktreeEditor = (p: PaneNode) => p.aiType === 'editor' && p.repoPath === worktreePath
  const targetPane = focusedPane && sameWorktreeEditor(focusedPane) ? focusedPane : activeTab.panes.find(sameWorktreeEditor)

  if (targetPane) {
    updateActiveTab(t => ({
      ...t,
      panes: t.panes.map(p => {
        if (p.id !== targetPane.id) return p
        const existing = p.editorTabs ?? []
        const tabs = existing.some(tab => tab.relPath === relPath) ? existing : [...existing, { relPath, dirty: false }]
        return { ...p, editorTabs: tabs, activeEditorTabPath: relPath }
      }),
    }))
    return
  }

  addPane('editor', '', '', AI_CONFIG.editor.color, '', undefined, undefined, undefined, {
    editorTabs: [{ relPath, dirty: false }],
    activeEditorTabPath: relPath,
    repoPath: worktreePath,
  })
}, [activeTab, activeCellRepoPath, updateActiveTab, addPane])

const moveEditorTabToNewPane = useCallback((paneId: string, relPath: string) => {
  const sourcePane = activeTab.panes.find(p => p.id === paneId)
  if (!sourcePane) return
  updateActiveTab(t => ({
    ...t,
    panes: t.panes.map(p => {
      if (p.id !== paneId) return p
      const remaining = (p.editorTabs ?? []).filter(tab => tab.relPath !== relPath)
      return { ...p, editorTabs: remaining, activeEditorTabPath: remaining[0]?.relPath }
    }),
  }))
  addPane('editor', '', '', AI_CONFIG.editor.color, '', undefined, undefined, undefined, {
    editorTabs: [{ relPath, dirty: false }],
    activeEditorTabPath: relPath,
    repoPath: sourcePane.repoPath,
  })
}, [activeTab, updateActiveTab, addPane])
```

Agregar el import de `EditorPane` y `ExplorerPanel`, y de los tipos `EditorTab` (junto al resto de imports de `./types` y `./components/*` al inicio del archivo).

- [ ] **Step 3: Agregar la rama `editor` en `renderPane`**

En el `renderPane` de `PaneLayoutEngine` (línea ~1081), agregar la rama antes de `browser`:

```tsx
renderPane={(pane) => pane.aiType === 'editor'
  ? (
    <EditorPane
      key={pane.id}
      pane={pane}
      onTabsChange={(tabs, activeEditorTabPath) => updatePaneEditorTabs(pane.id, tabs, activeEditorTabPath)}
      onClose={() => removePane(pane.id)}
      onFocus={() => { setFocusedPaneId(pane.id); focusedPaneIdRef.current = pane.id }}
      onOpenInNewPane={(relPath) => moveEditorTabToNewPane(pane.id, relPath)}
    />
  )
  : pane.aiType === 'browser'
    ? (
      <BrowserCell
        key={pane.id}
        pane={pane}
        borderColor={pane.borderColor}
        siblingPaneIds={panes.filter(p => p.id !== pane.id).map(p => p.id)}
        workspaceRepoPath={activeTab.repoPath ?? pane.repoPath}
        siblingRepoPaths={Array.from(new Set(
          panes
            .map((p) => p.repoPath)
            .filter((p): p is string => !!p)
        ))}
        onClose={() => removePane(pane.id)}
        onNavigate={(url) => updatePaneUrl(pane.id, url)}
      />
    )
    : (
      <TerminalPane
        key={pane.id}
        pane={pane}
        ports={panePorts[pane.id] ?? []}
        isDragging={draggingId === pane.id}
        zoomed={zoomedPaneId === pane.id}
        zoomingOut={zoomedPaneId === pane.id && zoomingOut}
        onZoom={() => handleZoom(pane.id)}
        onClose={() => removePane(pane.id)}
        onColorChange={(c) => updatePaneColor(pane.id, c)}
        onNoteChange={(note) => updatePaneNote(pane.id, note)}
        fontSize={fontSize}
        onInput={(data) => {
          const targets = broadcastMode ? panes.map(p => p.id) : [pane.id]
          targets.forEach((id) => window.pty.write(id, data))
        }}
        onFocus={() => {
          setFocusedPaneId(pane.id)
          focusedPaneIdRef.current = pane.id
        }}
        onBusyChange={handleBusyChange}
        onActivity={handlePaneActivity}
        onJoinRequest={() => setJoinRequest({ paneId: pane.id, paneTitle: pane.customLabel ?? pane.accountName ?? 'Terminal' })}
        onPtyStarted={handlePtyStarted}
        allowSharing={planLimits.allowSharing}
        onRequireUpgrade={() => setShowUpgrade(true)}
      />
    )
}
```

- [ ] **Step 4: Pasar `onFileOpen` a `Sidebar` en su invocación**

En la invocación de `<Sidebar ... />` (línea ~997), agregar la prop:

```tsx
onFileOpen={openFileInEditor}
```

- [ ] **Step 5: Agregar la prop `onFileOpen` y montar `ExplorerPanel` en `src/components/Sidebar.tsx`**

En la interfaz de props (`interface Props` abre en la línea 21 de `Sidebar.tsx`; agregar antes del `}` que la cierra — la desestructuración de props de `Sidebar` arranca en la línea 63; `activeCellRepoPath?: string` ya existe como prop en la línea 50):

```ts
  onFileOpen: (relPath: string) => void
```

Agregar `onFileOpen` a la desestructuración de props de `Sidebar` (junto a `activeCellRepoPath`, etc.).

Montar el panel después del bloque de `WorktreesSection` (después de la línea 531, antes del `<div className="sidebar-section-divider" />`):

```tsx
{/* ── EXPLORER (árbol de archivos del worktree activo) ───── */}
{expanded && (
  <div className="sidebar-explorer-wrap">
    <ExplorerPanel worktreePath={activeCellRepoPath ?? null} onFileOpen={onFileOpen} />
  </div>
)}
```

Agregar el import: `import { ExplorerPanel } from './ExplorerPanel'`.

- [ ] **Step 6: Verificar que el proyecto compila y los tests existentes siguen pasando**

Run: `npm run build && npx vitest run`
Expected: build exitoso; toda la suite existente sigue en verde (nada de lo tocado en `App.tsx`/`Sidebar.tsx` rompe tests previos — los cambios son aditivos: nuevos parámetros opcionales, nueva rama condicional, nuevo prop opcional).

- [ ] **Step 7: Commit**

```bash
git add src/App.tsx src/components/Sidebar.tsx
git commit -m "feat(editor): integrar EditorPane/ExplorerPanel al flujo de panes y al Sidebar"
```

---

### Task 8: E2E (Playwright + Electron) y checklist de smoke-test manual multiplataforma

**Files:**
- Create: `e2e/editor.spec.ts`
- Create: `docs/testing/editor-cross-platform-checklist.md`

**Interfaces:**
- Consumes: `launchHarness`/`teardown`/`initRepo`/`writeFile` de `e2e/helpers/harness.ts` (ya existen).

- [ ] **Step 1: Escribir el test E2E**

```ts
// e2e/editor.spec.ts
import { test } from '@playwright/test'
import { readFileSync } from 'fs'
import { join } from 'path'
import { launchHarness, teardown, expect } from './helpers/harness'

test('abrir un archivo desde el Explorer, editarlo y guardarlo actualiza el disco', async () => {
  const h = await launchHarness({ withRepo: true })

  // Vincular el repo del harness como repo activo de la tab.
  await h.page.evaluate((repoDir) => {
    ;(window as unknown as { __e2e_linkRepo?: (p: string) => void }).__e2e_linkRepo?.(repoDir)
  }, h.repoDir)

  await h.page.locator('.sidebar-repo-link, .sidebar-repo-name').first().click().catch(() => {})

  await expect(h.page.locator('.explorer-panel')).toBeVisible({ timeout: 10_000 })
  await h.page.locator('.explorer-entry-name', { hasText: 'README.md' }).click()

  const editorTextarea = h.page.locator('.monaco-editor textarea')
  await expect(editorTextarea).toBeVisible({ timeout: 10_000 })
  await editorTextarea.click()
  await h.page.keyboard.press('Control+A')
  await h.page.keyboard.type('# edited by e2e\n')

  const isMac = process.platform === 'darwin'
  await h.page.keyboard.press(isMac ? 'Meta+S' : 'Control+S')

  await expect(async () => {
    const content = readFileSync(join(h.repoDir, 'README.md'), 'utf8')
    expect(content).toBe('# edited by e2e\n')
  }).toPass({ timeout: 5000 })

  await teardown(h)
})
```

Nota para quien implemente: este test asume que existe algún mecanismo de test (`__e2e_linkRepo` o equivalente) para vincular un repo sin pasar por el diálogo real de selección de carpeta (`window.dialog.openFolder`, que abre un diálogo nativo del SO y no es automatizable con Playwright). Si no existe todavía, agregarlo como un pequeño hook condicionado a `window.appFlags?.e2eBypass` (mismo flag que ya usa `RAVEN_E2E=1`, ver `electron/preload.ts:97-99`), análogo a como el resto del harness ya bypassea auth. Ajustar el selector real del botón de "Link repo" (`.sidebar-repo-link`) contra el DOM real si difiere del inferido acá.

- [ ] **Step 2: Correr el E2E y verificar que pasa**

Run: `npm run pre-e2e && npm run e2e -- editor.spec.ts`
Expected: PASS. Si falla por el mecanismo de vinculación de repo mencionado en el Step 1, resolverlo antes de continuar — es la única pieza de este test sin precedente exacto en el harness existente.

- [ ] **Step 3: Escribir el checklist de smoke-test manual multiplataforma**

```markdown
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
```

- [ ] **Step 4: Commit**

```bash
git add e2e/editor.spec.ts docs/testing/editor-cross-platform-checklist.md
git commit -m "test(editor): E2E de abrir/editar/guardar + checklist de smoke-test manual"
```

---

## Execution Handoff

Al terminar todas las tareas: correr `npm run build && npx vitest run` una vez más de punta a punta, y ejecutar el checklist de la Task 8 en al menos un SO antes de abrir el PR desde `feat/code-editor-integration` hacia `main`.
