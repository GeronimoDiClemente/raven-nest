# Plan 1 — Worktree Foundation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implementar gestión nativa de git worktrees en Nest: crear, listar, borrar, seleccionar — con sidebar section, modal completo y quick-create palette (`⌘⇧W`). NO incluye presets (Plan 2), ports (Plan 3), browser cells (Plan 4) ni Spotlight (Plan 5).

**Architecture:** Adapter pattern. `Cell.repoPath` queda inmutable (string path). Nuevo `WorktreeStore` indexa `WorktreeMeta` por path en `~/.raven-nest/worktrees.json`. Hidrata desde `git worktree list --porcelain`. UI consulta el store para enriquecer cada path con metadata. Componentes existentes (Actions panel, terminales) no se tocan.

**Tech Stack:** TypeScript 5.7 · Electron 33 · React 18 · Vite 6 · electron-vite 3 · Vitest (NEW — primera vez en este repo) · `child_process.execSync` para git ops · React Portal para modales.

**Spec referenciado:** `docs/superpowers/specs/2026-05-02-raven-v1-worktrees-spotlight-design.md`

---

## File Structure

### Create

| Path | Responsabilidad |
|---|---|
| `electron/worktree-store.ts` | Store: persistencia `WorktreeMeta`, hidratación desde git, reconciliación |
| `electron/__tests__/worktree-store.test.ts` | Unit tests del store |
| `src/components/WorktreesSection.tsx` | Sidebar section colapsable con lista de worktrees |
| `src/components/NewWorktreeModal.tsx` | Modal completo de creación (branch + path; preset cards llegan en Plan 2) |
| `src/components/QuickWorktreePalette.tsx` | `⌘⇧W` extension del Command Palette |
| `vitest.config.ts` | Config raíz para vitest |
| `electron/__tests__/setup.ts` | Setup compartido de tests (tmpdir helpers) |

### Modify

| Path | Cambio |
|---|---|
| `package.json` | Agregar deps `vitest`, `@vitest/ui`, scripts `test`, `test:watch` |
| `src/types.ts` | Agregar `WorktreeMeta` interface + `Window.worktree` augmentation |
| `electron/main.ts` | Importar `WorktreeStore`, instanciar, registrar handlers `worktree:*` |
| `electron/preload.ts` | Exponer `window.worktree` API |
| `src/components/Sidebar.tsx` | Importar y montar `<WorktreesSection>` debajo del bloque "Repos linkeados al tab" |
| `src/components/CommandPalette.tsx` | Detectar atajo `⌘⇧W` y montar `<QuickWorktreePalette>` |
| `src/styles/global.css` | Estilos `.worktrees-section`, `.worktree-item`, `.worktree-dot`, `.new-worktree-modal` |

### NO se toca (importante)

- `electron/workspace-store.ts`, `electron/pty-manager.ts` — inmutables.
- `src/types.ts` `PaneNode`, `WorkspaceTab`, `Workspace` — sus campos `repoPath` quedan idénticos.
- `electron/main.ts` handlers existentes (`pty:*`, `git:*`) — sin cambios.
- Workspace JSON shape — backward-compat 100%.

---

## Task 0: Instalar y configurar Vitest

**Files:**
- Modify: `C:/Users/gerod/Dev/raven-nest/package.json`
- Create: `C:/Users/gerod/Dev/raven-nest/vitest.config.ts`
- Create: `C:/Users/gerod/Dev/raven-nest/electron/__tests__/setup.ts`

- [ ] **Step 1: Instalar dependencias**

```bash
cd "C:/Users/gerod/Dev/raven-nest"
npm install --save-dev vitest @vitest/ui
```

- [ ] **Step 2: Agregar scripts a `package.json`**

En la sección `"scripts"`, agregar después del último script existente:

```json
"test": "vitest run",
"test:watch": "vitest",
"test:ui": "vitest --ui"
```

- [ ] **Step 3: Crear `vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['electron/__tests__/**/*.test.ts', 'src/__tests__/**/*.test.ts'],
    setupFiles: ['electron/__tests__/setup.ts'],
  },
})
```

- [ ] **Step 4: Crear `electron/__tests__/setup.ts`**

```ts
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

export function makeTmpDir(prefix = 'raven-test-'): string {
  return mkdtempSync(join(tmpdir(), prefix))
}

export function cleanupTmp(path: string): void {
  try { rmSync(path, { recursive: true, force: true }) } catch {}
}
```

- [ ] **Step 5: Verificar que vitest corre**

```bash
npm test
```

Expected: `No test files found, exiting with code 1` (es OK por ahora — vitest detectó el config y no hay tests aún).

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json vitest.config.ts electron/__tests__/setup.ts
git commit -m "chore: add vitest test framework

Adds vitest + @vitest/ui as devDependencies. Test files under
electron/__tests__/ and src/__tests__/ run via 'npm test'.

Part of v1.0 Worktree Foundation (Plan 1)."
```

---

## Task 1: Definir tipo `WorktreeMeta` en `src/types.ts`

**Files:**
- Modify: `C:/Users/gerod/Dev/raven-nest/src/types.ts`

- [ ] **Step 1: Agregar interface después de `PaneNode`**

Buscar la línea `export interface PaneNode {` (línea ~9). Después de su cierre, agregar:

```ts
export interface WorktreeMeta {
  repoPath: string                   // path absoluto canónico del worktree
  rootRepoPath: string               // path del repo principal (igual a repoPath si es root)
  branch: string                     // branch checked out
  presetId?: string                  // opaco en Plan 1; consumido en Plan 2
  setupState: 'idle' | 'running' | 'done' | 'failed' | 'cancelled' | 'orphaned'
  setupLog?: string                  // últimas ~200 líneas
  declaredPorts: number[]            // del preset (vacío en Plan 1)
  detectedPorts: number[]            // discovered runtime (vacío en Plan 1)
  devCmd?: string
  devPid?: number
  createdAt: number
  updatedAt: number
}
```

- [ ] **Step 2: Augment `Window` interface**

Buscar el bloque `declare global { interface Window { ... } }` (línea ~141). Agregar dentro, antes del cierre `}`:

```ts
worktree: {
  list: (repoPath: string) => Promise<WorktreeMeta[]>
  create: (opts: { repoPath: string; branch: string; fromBranch?: string; path?: string; presetId?: string }) => Promise<WorktreeMeta>
  remove: (worktreePath: string) => Promise<void>
  get: (worktreePath: string) => Promise<WorktreeMeta | null>
  setPreset: (worktreePath: string, presetId: string | null) => Promise<void>
}
```

- [ ] **Step 3: Verificar TypeScript compila**

```bash
npx tsc --noEmit -p tsconfig.web.json
```

Expected: cero errores nuevos (puede haber pre-existentes mencionados en memoria, son OK).

- [ ] **Step 4: Commit**

```bash
git add src/types.ts
git commit -m "feat(types): add WorktreeMeta interface and window.worktree API"
```

---

## Task 2: Skeleton `WorktreeStore` con primer test

**Files:**
- Create: `C:/Users/gerod/Dev/raven-nest/electron/worktree-store.ts`
- Create: `C:/Users/gerod/Dev/raven-nest/electron/__tests__/worktree-store.test.ts`

- [ ] **Step 1: Crear el test file con primer test**

```ts
// electron/__tests__/worktree-store.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { WorktreeStore } from '../worktree-store'
import { makeTmpDir, cleanupTmp } from './setup'

describe('WorktreeStore', () => {
  let storeDir: string
  let store: WorktreeStore

  beforeEach(() => {
    storeDir = makeTmpDir('worktree-store-')
    store = new WorktreeStore(storeDir)
  })

  afterEach(() => {
    cleanupTmp(storeDir)
  })

  it('returns null for an unregistered path', () => {
    expect(store.get('/some/nonexistent/path')).toBeNull()
  })
})
```

- [ ] **Step 2: Crear el store mínimo (skeleton)**

```ts
// electron/worktree-store.ts
import { join } from 'path'
import { mkdirSync } from 'fs'
import type { WorktreeMeta } from '../src/types'

export class WorktreeStore {
  private storeDir: string
  private storeFile: string

  constructor(storeDir: string) {
    this.storeDir = storeDir
    this.storeFile = join(storeDir, 'worktrees.json')
    mkdirSync(storeDir, { recursive: true })
  }

  get(repoPath: string): WorktreeMeta | null {
    return null  // placeholder, Task 3 lo implementa correctamente
  }
}
```

- [ ] **Step 3: Correr test**

```bash
npm test
```

Expected: 1 test passes.

- [ ] **Step 4: Commit**

```bash
git add electron/worktree-store.ts electron/__tests__/worktree-store.test.ts
git commit -m "feat(electron): scaffold WorktreeStore with first test"
```

---

## Task 3: `setMeta` + `get` con persistencia

**Files:**
- Modify: `C:/Users/gerod/Dev/raven-nest/electron/__tests__/worktree-store.test.ts`
- Modify: `C:/Users/gerod/Dev/raven-nest/electron/worktree-store.ts`

- [ ] **Step 1: Agregar test de set + get**

Agregar dentro del `describe`:

```ts
it('persists and retrieves WorktreeMeta', () => {
  const meta: WorktreeMeta = {
    repoPath: '/tmp/repo/.git/worktrees/feat-x',
    rootRepoPath: '/tmp/repo',
    branch: 'feat/x',
    setupState: 'idle',
    declaredPorts: [],
    detectedPorts: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  }
  store.setMeta(meta)
  const got = store.get('/tmp/repo/.git/worktrees/feat-x')
  expect(got).toEqual(meta)
})

it('persists across instances (reload from disk)', () => {
  const meta: WorktreeMeta = {
    repoPath: '/tmp/repo/.git/worktrees/feat-y',
    rootRepoPath: '/tmp/repo',
    branch: 'feat/y',
    setupState: 'idle',
    declaredPorts: [],
    detectedPorts: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  }
  store.setMeta(meta)
  const reloaded = new WorktreeStore(storeDir)
  expect(reloaded.get('/tmp/repo/.git/worktrees/feat-y')).toEqual(meta)
})
```

Y agregar el import al top:

```ts
import type { WorktreeMeta } from '../../src/types'
```

- [ ] **Step 2: Correr test (debe fallar)**

```bash
npm test
```

Expected: 2 tests fail (`store.setMeta is not a function`).

- [ ] **Step 3: Implementar `setMeta` + persistencia**

Reemplazar `worktree-store.ts` entero con:

```ts
import { join } from 'path'
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'fs'
import type { WorktreeMeta } from '../src/types'

export class WorktreeStore {
  private storeFile: string
  private metas: Map<string, WorktreeMeta> = new Map()

  constructor(storeDir: string) {
    mkdirSync(storeDir, { recursive: true })
    this.storeFile = join(storeDir, 'worktrees.json')
    this.load()
  }

  private load(): void {
    if (!existsSync(this.storeFile)) return
    try {
      const raw = readFileSync(this.storeFile, 'utf8')
      const arr = JSON.parse(raw) as WorktreeMeta[]
      this.metas = new Map(arr.map((m) => [m.repoPath, m]))
    } catch {
      this.metas = new Map()
    }
  }

  private persist(): void {
    const tmpFile = `${this.storeFile}.tmp`
    writeFileSync(tmpFile, JSON.stringify(Array.from(this.metas.values()), null, 2))
    // atomic rename
    require('fs').renameSync(tmpFile, this.storeFile)
  }

  get(repoPath: string): WorktreeMeta | null {
    return this.metas.get(repoPath) ?? null
  }

  setMeta(meta: WorktreeMeta): void {
    this.metas.set(meta.repoPath, { ...meta, updatedAt: Date.now() })
    this.persist()
  }

  remove(repoPath: string): void {
    this.metas.delete(repoPath)
    this.persist()
  }

  list(): WorktreeMeta[] {
    return Array.from(this.metas.values())
  }
}
```

- [ ] **Step 4: Correr test**

```bash
npm test
```

Expected: 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add electron/worktree-store.ts electron/__tests__/worktree-store.test.ts
git commit -m "feat(electron): WorktreeStore set/get/persist with atomic write"
```

---

## Task 4: `remove` + listar todos

**Files:**
- Modify: `C:/Users/gerod/Dev/raven-nest/electron/__tests__/worktree-store.test.ts`

- [ ] **Step 1: Agregar tests**

```ts
it('removes a meta', () => {
  const meta: WorktreeMeta = {
    repoPath: '/tmp/r/.git/worktrees/x',
    rootRepoPath: '/tmp/r',
    branch: 'x',
    setupState: 'idle',
    declaredPorts: [],
    detectedPorts: [],
    createdAt: 1, updatedAt: 1,
  }
  store.setMeta(meta)
  store.remove('/tmp/r/.git/worktrees/x')
  expect(store.get('/tmp/r/.git/worktrees/x')).toBeNull()
})

it('lists all metas', () => {
  store.setMeta({ repoPath: '/a', rootRepoPath: '/r', branch: 'a', setupState: 'idle', declaredPorts: [], detectedPorts: [], createdAt: 1, updatedAt: 1 })
  store.setMeta({ repoPath: '/b', rootRepoPath: '/r', branch: 'b', setupState: 'idle', declaredPorts: [], detectedPorts: [], createdAt: 2, updatedAt: 2 })
  expect(store.list()).toHaveLength(2)
})
```

- [ ] **Step 2: Correr tests**

```bash
npm test
```

Expected: 5 tests pass (los métodos ya están en Task 3).

- [ ] **Step 3: Commit**

```bash
git add electron/__tests__/worktree-store.test.ts
git commit -m "test(electron): WorktreeStore remove + list coverage"
```

---

## Task 5: Hidratar desde `git worktree list --porcelain`

**Files:**
- Modify: `C:/Users/gerod/Dev/raven-nest/electron/worktree-store.ts`
- Modify: `C:/Users/gerod/Dev/raven-nest/electron/__tests__/worktree-store.test.ts`

- [ ] **Step 1: Agregar test (con git real en tmpdir)**

Agregar al top:

```ts
import { execSync } from 'child_process'
```

Y nuevo test:

```ts
it('hydrates from git worktree list', () => {
  const repoPath = makeTmpDir('git-repo-')
  execSync(`git -C "${repoPath}" init -q`)
  execSync(`git -C "${repoPath}" config user.email test@example.com`)
  execSync(`git -C "${repoPath}" config user.name Test`)
  execSync(`git -C "${repoPath}" commit -q --allow-empty -m initial`)
  execSync(`git -C "${repoPath}" branch feat/test`)
  const wtPath = `${repoPath}-wt-feat-test`
  execSync(`git -C "${repoPath}" worktree add "${wtPath}" feat/test`)

  const got = store.hydrateFromGit(repoPath)
  expect(got.length).toBeGreaterThanOrEqual(1)
  const featWt = got.find((m) => m.branch === 'feat/test')
  expect(featWt).toBeDefined()
  expect(featWt!.rootRepoPath).toBe(repoPath)

  cleanupTmp(repoPath)
  cleanupTmp(wtPath)
})
```

- [ ] **Step 2: Correr (debe fallar)**

```bash
npm test
```

Expected: fail con `store.hydrateFromGit is not a function`.

- [ ] **Step 3: Implementar `hydrateFromGit`**

Agregar al `WorktreeStore`:

```ts
hydrateFromGit(repoPath: string): WorktreeMeta[] {
  let raw: string
  try {
    raw = execSync(`git -C "${repoPath}" worktree list --porcelain`, {
      encoding: 'utf8',
      timeout: 5000,
    })
  } catch {
    return []
  }
  // Parse porcelain: each entry is "worktree <path>\nHEAD <sha>\nbranch <ref>\n\n"
  const blocks = raw.trim().split(/\n\n+/)
  const result: WorktreeMeta[] = []
  let rootRepoPath = ''
  for (const block of blocks) {
    const lines = block.split('\n')
    const wtPath = lines.find((l) => l.startsWith('worktree '))?.slice(9) ?? ''
    const branchLine = lines.find((l) => l.startsWith('branch '))?.slice(7) ?? ''
    const branch = branchLine.replace(/^refs\/heads\//, '') || '(detached)'
    if (!wtPath) continue
    if (!rootRepoPath) rootRepoPath = wtPath  // first entry is the root
    const existing = this.get(wtPath)
    const now = Date.now()
    const meta: WorktreeMeta = existing ?? {
      repoPath: wtPath,
      rootRepoPath,
      branch,
      setupState: 'idle',
      declaredPorts: [],
      detectedPorts: [],
      createdAt: now,
      updatedAt: now,
    }
    meta.branch = branch
    meta.rootRepoPath = rootRepoPath
    this.metas.set(wtPath, meta)
    result.push(meta)
  }
  this.persist()
  return result
}
```

Agregar import al top del file:

```ts
import { execSync } from 'child_process'
```

- [ ] **Step 4: Correr test**

```bash
npm test
```

Expected: 6 tests pass.

- [ ] **Step 5: Commit**

```bash
git add electron/worktree-store.ts electron/__tests__/worktree-store.test.ts
git commit -m "feat(electron): hydrate WorktreeStore from git worktree list"
```

---

## Task 6: Reconciliación — marcar orphaned

**Files:**
- Modify: `C:/Users/gerod/Dev/raven-nest/electron/worktree-store.ts`
- Modify: `C:/Users/gerod/Dev/raven-nest/electron/__tests__/worktree-store.test.ts`

- [ ] **Step 1: Agregar test**

```ts
it('marks orphaned metas (path no longer in git list)', () => {
  // Set a meta for a path that does not exist on disk
  store.setMeta({
    repoPath: '/tmp/nonexistent-wt',
    rootRepoPath: '/tmp/r',
    branch: 'gone',
    setupState: 'done',
    declaredPorts: [],
    detectedPorts: [],
    createdAt: 1, updatedAt: 1,
  })
  // Reconcile against an empty git list (mock: empty array returned)
  store.reconcile([])
  expect(store.get('/tmp/nonexistent-wt')?.setupState).toBe('orphaned')
})
```

- [ ] **Step 2: Correr (debe fallar)**

```bash
npm test
```

Expected: fail con `store.reconcile is not a function`.

- [ ] **Step 3: Implementar `reconcile`**

Agregar al `WorktreeStore`:

```ts
reconcile(activeWorktreePaths: string[]): void {
  const activeSet = new Set(activeWorktreePaths)
  for (const [path, meta] of this.metas) {
    if (!activeSet.has(path) && meta.setupState !== 'orphaned') {
      this.metas.set(path, { ...meta, setupState: 'orphaned', updatedAt: Date.now() })
    }
  }
  this.persist()
}
```

- [ ] **Step 4: Correr test**

```bash
npm test
```

Expected: 7 tests pass.

- [ ] **Step 5: Commit**

```bash
git add electron/worktree-store.ts electron/__tests__/worktree-store.test.ts
git commit -m "feat(electron): WorktreeStore reconcile marks orphaned"
```

---

## Task 7: IPC handlers `worktree:list`, `worktree:get`, `worktree:setPreset`

**Files:**
- Modify: `C:/Users/gerod/Dev/raven-nest/electron/main.ts`

- [ ] **Step 1: Agregar import y instancia al top**

Después de la línea `import { WorkspaceStore } from './workspace-store'` (línea ~33), agregar:

```ts
import { WorktreeStore } from './worktree-store'
```

Después de `const ptyManager = new PtyManager()` (línea ~40), agregar:

```ts
const worktreeStore = new WorktreeStore(pathJoin(homedir(), '.raven-nest'))
```

- [ ] **Step 2: Registrar handlers (al final de la sección de `ipcMain.handle` existente)**

Buscar el bloque donde están los handlers `git:*` o cualquier sección clara de IPC. Agregar en una sección nueva claramente comentada:

```ts
// === Worktree handlers (Plan 1 — v1.0) ===

ipcMain.handle('worktree:list', async (_evt, repoPath: string) => {
  if (!isAbsolute(repoPath)) throw new Error('repoPath must be absolute')
  worktreeStore.hydrateFromGit(repoPath)
  return worktreeStore.list().filter((m) => m.rootRepoPath === repoPath)
})

ipcMain.handle('worktree:get', async (_evt, worktreePath: string) => {
  if (!isAbsolute(worktreePath)) throw new Error('worktreePath must be absolute')
  return worktreeStore.get(worktreePath)
})

ipcMain.handle('worktree:setPreset', async (_evt, worktreePath: string, presetId: string | null) => {
  if (!isAbsolute(worktreePath)) throw new Error('worktreePath must be absolute')
  const meta = worktreeStore.get(worktreePath)
  if (!meta) throw new Error('Worktree not found')
  worktreeStore.setMeta({ ...meta, presetId: presetId ?? undefined })
})
```

- [ ] **Step 3: Verificar TypeScript compila**

```bash
npx tsc --noEmit -p tsconfig.node.json
```

Expected: cero errores nuevos.

- [ ] **Step 4: Commit**

```bash
git add electron/main.ts
git commit -m "feat(ipc): worktree:list, worktree:get, worktree:setPreset handlers"
```

---

## Task 8: IPC handler `worktree:create`

**Files:**
- Modify: `C:/Users/gerod/Dev/raven-nest/electron/main.ts`

- [ ] **Step 1: Agregar handler después de los anteriores**

```ts
ipcMain.handle('worktree:create', async (_evt, opts: {
  repoPath: string
  branch: string
  fromBranch?: string
  path?: string
  presetId?: string
}) => {
  if (!isAbsolute(opts.repoPath)) throw new Error('repoPath must be absolute')
  if (!opts.branch || !/^[a-zA-Z0-9._/\-]+$/.test(opts.branch)) {
    throw new Error(`Invalid branch name: ${opts.branch}`)
  }

  const slug = opts.branch.replace(/[\/]/g, '-').replace(/[^a-zA-Z0-9._\-]/g, '')
  const wtPath = opts.path ?? pathJoin(opts.repoPath, '.git', 'worktrees', slug)

  // Check if branch exists
  let branchExists = false
  try {
    execSync(`git -C "${opts.repoPath}" show-ref --verify --quiet "refs/heads/${opts.branch}"`, {
      timeout: 3000,
    })
    branchExists = true
  } catch { branchExists = false }

  // Build git worktree add command
  let cmd: string
  if (branchExists) {
    cmd = `git -C "${opts.repoPath}" worktree add "${wtPath}" "${opts.branch}"`
  } else {
    const from = opts.fromBranch ?? 'HEAD'
    cmd = `git -C "${opts.repoPath}" worktree add -b "${opts.branch}" "${wtPath}" "${from}"`
  }

  try {
    execSync(cmd, { encoding: 'utf8', timeout: 10000 })
  } catch (err) {
    throw new Error(`git worktree add failed: ${err instanceof Error ? err.message : String(err)}`)
  }

  // Persist meta
  const now = Date.now()
  const meta = {
    repoPath: wtPath,
    rootRepoPath: opts.repoPath,
    branch: opts.branch,
    presetId: opts.presetId,
    setupState: 'idle' as const,
    declaredPorts: [],
    detectedPorts: [],
    createdAt: now,
    updatedAt: now,
  }
  worktreeStore.setMeta(meta)
  return meta
})
```

- [ ] **Step 2: Verificar TypeScript**

```bash
npx tsc --noEmit -p tsconfig.node.json
```

Expected: cero errores nuevos.

- [ ] **Step 3: Commit**

```bash
git add electron/main.ts
git commit -m "feat(ipc): worktree:create with git worktree add + meta persist"
```

---

## Task 9: IPC handler `worktree:remove`

**Files:**
- Modify: `C:/Users/gerod/Dev/raven-nest/electron/main.ts`

- [ ] **Step 1: Agregar handler**

```ts
ipcMain.handle('worktree:remove', async (_evt, worktreePath: string) => {
  if (!isAbsolute(worktreePath)) throw new Error('worktreePath must be absolute')
  const meta = worktreeStore.get(worktreePath)
  if (!meta) throw new Error('Worktree not found in store')

  try {
    execSync(`git -C "${meta.rootRepoPath}" worktree remove "${worktreePath}" --force`, {
      encoding: 'utf8',
      timeout: 10000,
    })
  } catch (err) {
    throw new Error(`git worktree remove failed: ${err instanceof Error ? err.message : String(err)}`)
  }

  worktreeStore.remove(worktreePath)
})
```

- [ ] **Step 2: Verificar TypeScript**

```bash
npx tsc --noEmit -p tsconfig.node.json
```

- [ ] **Step 3: Commit**

```bash
git add electron/main.ts
git commit -m "feat(ipc): worktree:remove handler"
```

---

## Task 10: Exponer `window.worktree` en preload

**Files:**
- Modify: `C:/Users/gerod/Dev/raven-nest/electron/preload.ts`

- [ ] **Step 1: Agregar exposure al final del file (antes del último `})`)**

```ts
contextBridge.exposeInMainWorld('worktree', {
  list: (repoPath: string) => ipcRenderer.invoke('worktree:list', repoPath),
  create: (opts: unknown) => ipcRenderer.invoke('worktree:create', opts),
  remove: (worktreePath: string) => ipcRenderer.invoke('worktree:remove', worktreePath),
  get: (worktreePath: string) => ipcRenderer.invoke('worktree:get', worktreePath),
  setPreset: (worktreePath: string, presetId: string | null) =>
    ipcRenderer.invoke('worktree:setPreset', worktreePath, presetId),
})
```

- [ ] **Step 2: Verificar TypeScript**

```bash
npx tsc --noEmit -p tsconfig.node.json
```

- [ ] **Step 3: Smoke test manual**

Correr la app:

```bash
npm run dev
```

Abrir DevTools del renderer (View → Toggle Developer Tools en el menú). En la consola:

```js
await window.worktree.list('C:/Users/gerod/Dev/raven-nest')
```

Expected: array (probablemente con 1 entry — el root). Si hay error de "isAbsolute", revisar Step 1 del Task 7.

- [ ] **Step 4: Commit**

```bash
git add electron/preload.ts
git commit -m "feat(preload): expose window.worktree API"
```

---

## Task 11: Componente `<WorktreesSection>`

**Files:**
- Create: `C:/Users/gerod/Dev/raven-nest/src/components/WorktreesSection.tsx`
- Modify: `C:/Users/gerod/Dev/raven-nest/src/styles/global.css`

- [ ] **Step 1: Crear componente**

```tsx
// src/components/WorktreesSection.tsx
import { useEffect, useState } from 'react'
import type { WorktreeMeta } from '../types'

interface Props {
  repoPath: string | null
  activeRepoPath: string | undefined  // current cell's repoPath, for highlighting
  onSelect: (worktreePath: string) => void
  onNewClick: () => void
}

const STATUS_DOT_CLASS: Record<WorktreeMeta['setupState'], string> = {
  idle: 'wt-dot-gray',
  running: 'wt-dot-yellow',
  done: 'wt-dot-green',
  failed: 'wt-dot-red',
  cancelled: 'wt-dot-gray',
  orphaned: 'wt-dot-gray',
}

export function WorktreesSection({ repoPath, activeRepoPath, onSelect, onNewClick }: Props) {
  const [worktrees, setWorktrees] = useState<WorktreeMeta[]>([])
  const [expanded, setExpanded] = useState(true)

  useEffect(() => {
    if (!repoPath) { setWorktrees([]); return }
    let cancelled = false
    void window.worktree.list(repoPath).then((wts) => {
      if (!cancelled) setWorktrees(wts)
    }).catch(() => { if (!cancelled) setWorktrees([]) })
    return () => { cancelled = true }
  }, [repoPath])

  if (!repoPath) return null  // hide entirely when no repo active

  return (
    <div className="worktrees-section">
      <div className="wt-section-header" onClick={() => setExpanded(!expanded)}>
        <span>{expanded ? '▾' : '▸'} Worktrees</span>
        <button
          className="wt-add-btn"
          onClick={(e) => { e.stopPropagation(); onNewClick() }}
          title="New worktree"
        >+</button>
      </div>
      {expanded && (
        <div className="wt-list">
          {worktrees.map((wt) => (
            <div
              key={wt.repoPath}
              className={`wt-item ${activeRepoPath === wt.repoPath ? 'wt-item-active' : ''}`}
              onClick={() => onSelect(wt.repoPath)}
              title={wt.repoPath}
            >
              <span className={`wt-dot ${STATUS_DOT_CLASS[wt.setupState]}`} />
              <span className="wt-branch">{wt.branch}</span>
              <span className="wt-meta">
                {wt.repoPath === wt.rootRepoPath ? 'root' : ''}
              </span>
            </div>
          ))}
          {worktrees.length === 0 && (
            <div className="wt-empty">No worktrees</div>
          )}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Agregar estilos al final de `src/styles/global.css`**

```css
/* === Worktrees Section (Plan 1) === */
.worktrees-section { padding: 8px 0; border-top: 1px solid var(--border); }
.wt-section-header {
  display: flex; justify-content: space-between; align-items: center;
  padding: 6px 12px; color: var(--text-muted); font-size: 10px;
  text-transform: uppercase; letter-spacing: 0.5px; cursor: pointer;
}
.wt-section-header:hover { color: var(--text-secondary); }
.wt-add-btn {
  background: transparent; border: none; color: var(--raven-blue);
  font-size: 14px; cursor: pointer; padding: 0 4px;
}
.wt-list { display: flex; flex-direction: column; }
.wt-item {
  display: flex; align-items: center; gap: 6px;
  padding: 6px 12px; cursor: pointer; font-size: 12px;
  color: var(--text-secondary);
}
.wt-item:hover { background: #111; color: var(--text-primary); }
.wt-item-active {
  background: rgba(0, 102, 255, 0.10); color: var(--text-primary);
  border-left: 2px solid var(--raven-blue); padding-left: 10px;
}
.wt-dot {
  width: 6px; height: 6px; border-radius: 50%; flex-shrink: 0;
}
.wt-dot-green { background: #00CC44; }
.wt-dot-yellow { background: #FFB800; }
.wt-dot-red { background: #FF1A1A; }
.wt-dot-gray { background: #555; }
.wt-branch { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.wt-meta {
  color: var(--text-muted); font-size: 9px; font-family: 'JetBrains Mono', monospace;
}
.wt-empty { padding: 6px 12px; color: var(--text-muted); font-size: 11px; font-style: italic; }
```

- [ ] **Step 3: Verificar TypeScript**

```bash
npx tsc --noEmit -p tsconfig.web.json
```

- [ ] **Step 4: Commit**

```bash
git add src/components/WorktreesSection.tsx src/styles/global.css
git commit -m "feat(ui): WorktreesSection component for sidebar"
```

---

## Task 12: Integrar `<WorktreesSection>` en `Sidebar.tsx`

**Files:**
- Modify: `C:/Users/gerod/Dev/raven-nest/src/components/Sidebar.tsx`

- [ ] **Step 1: Identificar dónde montar**

Abrir `src/components/Sidebar.tsx`. Buscar el bloque que renderiza `<RepoActionsBar>` (introducido en v0.7). El `<WorktreesSection>` se monta JUSTO DESPUÉS de ese bloque.

- [ ] **Step 2: Agregar import**

Al top del file:

```tsx
import { WorktreesSection } from './WorktreesSection'
```

- [ ] **Step 3: Identificar props que recibe Sidebar**

Inspeccionar la interface `Props` del Sidebar. Necesitamos:
- `repoPath: string | undefined` (del tab activo)
- `activeCellRepoPath: string | undefined` (del cell focuseado)
- `onWorktreeSelect: (path: string) => void` (callback para cambiar el repoPath de la cell)
- `onNewWorktree: () => void` (callback para abrir modal)

Si las props no existen, agregarlas a la interface y propagarlas desde el padre (típicamente `App.tsx`).

- [ ] **Step 4: Montar el componente**

Después del `<RepoActionsBar>` (o donde sea natural en el árbol):

```tsx
<WorktreesSection
  repoPath={repoPath ?? null}
  activeRepoPath={activeCellRepoPath}
  onSelect={onWorktreeSelect}
  onNewClick={onNewWorktree}
/>
```

- [ ] **Step 5: En `App.tsx`, definir los callbacks y pasarlos al Sidebar**

```tsx
// (Conceptualmente — el código exacto depende del shape actual)
const handleWorktreeSelect = (worktreePath: string) => {
  // Cambiar el repoPath de la cell focuseada
  // Si no hay cell focuseada, cambiar el repoPath del tab
  setTabRepoPath(activeTab.id, worktreePath)
}

const [showNewWorktree, setShowNewWorktree] = useState(false)
const handleNewWorktree = () => setShowNewWorktree(true)
```

- [ ] **Step 6: Smoke test**

```bash
npm run dev
```

Abrir Nest, linkear un repo al tab activo. Verificar que la sección "▾ Worktrees" aparece en sidebar con al menos 1 item (el root). Si no hay repo activo, no aparece.

- [ ] **Step 7: Commit**

```bash
git add src/components/Sidebar.tsx src/App.tsx
git commit -m "feat(ui): mount WorktreesSection in Sidebar with select/new callbacks"
```

---

## Task 13: Componente `<NewWorktreeModal>`

**Files:**
- Create: `C:/Users/gerod/Dev/raven-nest/src/components/NewWorktreeModal.tsx`
- Modify: `C:/Users/gerod/Dev/raven-nest/src/styles/global.css`

- [ ] **Step 1: Crear componente**

```tsx
// src/components/NewWorktreeModal.tsx
import { useState } from 'react'
import type { WorktreeMeta } from '../types'

interface Props {
  open: boolean
  repoPath: string
  onClose: () => void
  onCreated: (meta: WorktreeMeta) => void
}

export function NewWorktreeModal({ open, repoPath, onClose, onCreated }: Props) {
  const [branch, setBranch] = useState('')
  const [path, setPath] = useState('')
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!open) return null

  const slug = branch.replace(/[\/]/g, '-').replace(/[^a-zA-Z0-9._\-]/g, '')
  const suggestedPath = path || `${repoPath}/.git/worktrees/${slug || '<branch>'}`

  const handleCreate = async () => {
    if (!branch.trim()) { setError('Branch name required'); return }
    setError(null); setCreating(true)
    try {
      const meta = await window.worktree.create({
        repoPath,
        branch: branch.trim(),
        path: path.trim() || undefined,
      })
      onCreated(meta)
      setBranch(''); setPath(''); onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setCreating(false)
    }
  }

  return (
    <div className="dialog-overlay" onClick={onClose}>
      <div className="dialog new-worktree-modal" onClick={(e) => e.stopPropagation()}>
        <div className="dialog-title">New worktree</div>
        <div className="dialog-sub">{repoPath.split(/[\/\\]/).pop()}</div>

        <label className="field-label">Branch</label>
        <input
          className="field-input"
          value={branch}
          onChange={(e) => setBranch(e.target.value)}
          placeholder="feat/billing"
          autoFocus
          disabled={creating}
        />

        <label className="field-label">Path (optional)</label>
        <input
          className="field-input"
          value={path}
          onChange={(e) => setPath(e.target.value)}
          placeholder={suggestedPath}
          disabled={creating}
        />

        {error && <div className="modal-error">{error}</div>}

        <div className="dialog-actions">
          <button className="dialog-cancel" onClick={onClose} disabled={creating}>Cancel</button>
          <button className="btn-primary" onClick={handleCreate} disabled={creating || !branch.trim()}>
            {creating ? 'Creating…' : 'Create'}
          </button>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Agregar estilos**

Append a `src/styles/global.css`:

```css
.new-worktree-modal { width: 480px; }
.dialog-sub { color: var(--text-muted); font-size: 11px; margin-bottom: 16px; }
.field-label {
  display: block; font-size: 10px; color: var(--text-secondary);
  text-transform: uppercase; letter-spacing: 0.4px; margin: 12px 0 4px;
}
.field-input {
  width: 100%; box-sizing: border-box; background: var(--bg-elevated);
  border: 1px solid var(--border); border-radius: 4px;
  padding: 8px 10px; color: var(--text-primary);
  font-size: 12px; font-family: 'JetBrains Mono', monospace;
}
.field-input:focus { outline: none; border-color: var(--raven-blue); }
.modal-error {
  margin-top: 12px; padding: 8px 10px; background: rgba(255, 26, 26, 0.10);
  border: 1px solid rgba(255, 26, 26, 0.40); color: #FF6666;
  font-size: 11px; border-radius: 4px;
}
.dialog-actions {
  display: flex; justify-content: flex-end; gap: 8px; margin-top: 20px;
}
.btn-primary {
  background: var(--raven-blue); color: white; border: none;
  padding: 8px 16px; border-radius: 4px; font-size: 12px; cursor: pointer;
}
.btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }
```

- [ ] **Step 3: Verificar TypeScript**

```bash
npx tsc --noEmit -p tsconfig.web.json
```

- [ ] **Step 4: Commit**

```bash
git add src/components/NewWorktreeModal.tsx src/styles/global.css
git commit -m "feat(ui): NewWorktreeModal component"
```

---

## Task 14: Wirear `<NewWorktreeModal>` desde `App.tsx`

**Files:**
- Modify: `C:/Users/gerod/Dev/raven-nest/src/App.tsx`

- [ ] **Step 1: Agregar import + state**

```tsx
import { NewWorktreeModal } from './components/NewWorktreeModal'

// Dentro del componente App:
const [newWorktreeOpen, setNewWorktreeOpen] = useState(false)
```

- [ ] **Step 2: Pasar `onNewWorktree` al Sidebar**

```tsx
<Sidebar
  // ... props existentes
  onNewWorktree={() => setNewWorktreeOpen(true)}
/>
```

- [ ] **Step 3: Montar el modal cerca del cierre del componente**

```tsx
{activeTab?.repoPath && (
  <NewWorktreeModal
    open={newWorktreeOpen}
    repoPath={activeTab.repoPath}
    onClose={() => setNewWorktreeOpen(false)}
    onCreated={(meta) => {
      // Auto-select el nuevo worktree en la cell focuseada
      handleWorktreeSelect(meta.repoPath)
    }}
  />
)}
```

- [ ] **Step 4: Smoke test**

```bash
npm run dev
```

1. Linkear un repo al tab activo
2. En sidebar → sección Worktrees → click en `+`
3. Modal se abre
4. Tipear "test-branch" en Branch field
5. Click "Create"
6. Verificar:
   - Worktree creado en disco (`ls .git/worktrees/`)
   - Aparece en sidebar como item activo
   - Cell del tab cambió su `repoPath` al worktree

- [ ] **Step 5: Commit**

```bash
git add src/App.tsx
git commit -m "feat(ui): wire NewWorktreeModal from sidebar + auto-select on create"
```

---

## Task 15: Componente `<QuickWorktreePalette>` y atajo `⌘⇧W`

**Files:**
- Create: `C:/Users/gerod/Dev/raven-nest/src/components/QuickWorktreePalette.tsx`
- Modify: `C:/Users/gerod/Dev/raven-nest/src/components/CommandPalette.tsx`
- Modify: `C:/Users/gerod/Dev/raven-nest/src/App.tsx`

- [ ] **Step 1: Crear componente**

```tsx
// src/components/QuickWorktreePalette.tsx
import { useEffect, useRef, useState } from 'react'
import type { WorktreeMeta } from '../types'

interface Props {
  open: boolean
  repoPath: string
  onClose: () => void
  onCreated: (meta: WorktreeMeta) => void
}

export function QuickWorktreePalette({ open, repoPath, onClose, onCreated }: Props) {
  const [branch, setBranch] = useState('')
  const [creating, setCreating] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (open) inputRef.current?.focus()
  }, [open])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  const handleCreate = async () => {
    if (!branch.trim()) return
    setCreating(true)
    try {
      const meta = await window.worktree.create({
        repoPath,
        branch: branch.trim(),
      })
      onCreated(meta)
      setBranch('')
      onClose()
    } catch {
      // For Plan 1, errors fail silently to terminal — Plan 2+ adds toast
    } finally {
      setCreating(false)
    }
  }

  return (
    <div className="dialog-overlay" onClick={onClose}>
      <div className="quick-worktree" onClick={(e) => e.stopPropagation()}>
        <div className="qw-label">New worktree from main →</div>
        <input
          ref={inputRef}
          className="qw-input"
          value={branch}
          onChange={(e) => setBranch(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') void handleCreate() }}
          placeholder="branch name (e.g. feat/billing)"
          disabled={creating}
        />
        <div className="qw-hint">Enter to create · Esc to cancel</div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Agregar estilos**

Append a `src/styles/global.css`:

```css
.quick-worktree {
  position: fixed; top: 25%; left: 50%; transform: translateX(-50%);
  background: var(--bg-surface); border: 1px solid var(--border);
  border-radius: 8px; padding: 16px 20px; min-width: 480px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
}
.qw-label { color: var(--text-muted); font-size: 11px; margin-bottom: 8px; }
.qw-input {
  width: 100%; box-sizing: border-box; background: var(--bg-app);
  border: 1px solid var(--border); border-radius: 4px;
  padding: 10px 12px; color: var(--text-primary);
  font-size: 14px; font-family: 'JetBrains Mono', monospace;
}
.qw-input:focus { outline: none; border-color: var(--raven-blue); }
.qw-hint { color: var(--text-muted); font-size: 10px; margin-top: 8px; }
```

- [ ] **Step 3: Wirear en `App.tsx`**

```tsx
import { QuickWorktreePalette } from './components/QuickWorktreePalette'

// state
const [quickWorktreeOpen, setQuickWorktreeOpen] = useState(false)

// global keybind effect
useEffect(() => {
  const onKey = (e: KeyboardEvent) => {
    const isCmdShift = (e.metaKey || e.ctrlKey) && e.shiftKey
    if (isCmdShift && e.key.toLowerCase() === 'w') {
      e.preventDefault()
      if (activeTab?.repoPath) setQuickWorktreeOpen(true)
    }
  }
  window.addEventListener('keydown', onKey)
  return () => window.removeEventListener('keydown', onKey)
}, [activeTab])

// montar al final
{activeTab?.repoPath && (
  <QuickWorktreePalette
    open={quickWorktreeOpen}
    repoPath={activeTab.repoPath}
    onClose={() => setQuickWorktreeOpen(false)}
    onCreated={(meta) => handleWorktreeSelect(meta.repoPath)}
  />
)}
```

- [ ] **Step 4: Smoke test**

```bash
npm run dev
```

1. Linkear repo al tab
2. Presionar `Ctrl+Shift+W` (o `⌘⇧W` en mac)
3. Palette aparece arriba-centro
4. Tipear "feat/quick-test" → Enter
5. Worktree creado, palette se cierra, sidebar lo muestra activo

- [ ] **Step 5: Commit**

```bash
git add src/components/QuickWorktreePalette.tsx src/App.tsx src/styles/global.css
git commit -m "feat(ui): QuickWorktreePalette with Cmd+Shift+W shortcut"
```

---

## Task 16: Click derecho en worktree — menu contextual (remove)

**Files:**
- Modify: `C:/Users/gerod/Dev/raven-nest/src/components/WorktreesSection.tsx`

- [ ] **Step 1: Agregar context menu state**

Reemplazar el `<div className="wt-item">` con:

```tsx
<div
  key={wt.repoPath}
  className={`wt-item ${activeRepoPath === wt.repoPath ? 'wt-item-active' : ''}`}
  onClick={() => onSelect(wt.repoPath)}
  onContextMenu={(e) => {
    e.preventDefault()
    setContextMenu({ x: e.clientX, y: e.clientY, worktreePath: wt.repoPath, isRoot: wt.repoPath === wt.rootRepoPath })
  }}
  title={wt.repoPath}
>
  ...
</div>
```

Y agregar al top del componente:

```tsx
const [contextMenu, setContextMenu] = useState<{
  x: number; y: number; worktreePath: string; isRoot: boolean
} | null>(null)

const handleRemove = async () => {
  if (!contextMenu) return
  if (contextMenu.isRoot) { setContextMenu(null); return }
  if (!confirm(`Remove worktree at ${contextMenu.worktreePath}?`)) {
    setContextMenu(null); return
  }
  try {
    await window.worktree.remove(contextMenu.worktreePath)
    // refrescar lista
    if (repoPath) {
      const fresh = await window.worktree.list(repoPath)
      setWorktrees(fresh)
    }
  } catch (err) {
    alert(`Failed: ${err instanceof Error ? err.message : err}`)
  } finally {
    setContextMenu(null)
  }
}
```

Al final del JSX (antes del cierre del componente):

```tsx
{contextMenu && (
  <div
    className="wt-context-menu"
    style={{ top: contextMenu.y, left: contextMenu.x }}
    onClick={(e) => e.stopPropagation()}
  >
    <button
      className="wt-ctx-item"
      onClick={handleRemove}
      disabled={contextMenu.isRoot}
    >
      {contextMenu.isRoot ? 'Cannot remove root' : 'Remove worktree'}
    </button>
  </div>
)}
```

Y un effect para cerrar el menu al click afuera:

```tsx
useEffect(() => {
  if (!contextMenu) return
  const close = () => setContextMenu(null)
  window.addEventListener('click', close)
  return () => window.removeEventListener('click', close)
}, [contextMenu])
```

- [ ] **Step 2: Estilos del menu**

Append a `global.css`:

```css
.wt-context-menu {
  position: fixed; background: var(--bg-elevated);
  border: 1px solid var(--border); border-radius: 4px;
  padding: 4px 0; min-width: 180px; z-index: 1000;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.5);
}
.wt-ctx-item {
  display: block; width: 100%; text-align: left;
  background: transparent; border: none; color: var(--text-primary);
  padding: 6px 12px; font-size: 12px; cursor: pointer;
}
.wt-ctx-item:hover { background: rgba(0, 102, 255, 0.10); }
.wt-ctx-item:disabled { color: var(--text-muted); cursor: not-allowed; }
```

- [ ] **Step 3: Smoke test**

1. Click derecho en un worktree no-root → "Remove worktree" → confirmar → worktree borrado
2. Click derecho en root → opción disabled "Cannot remove root"

- [ ] **Step 4: Commit**

```bash
git add src/components/WorktreesSection.tsx src/styles/global.css
git commit -m "feat(ui): right-click context menu to remove worktree"
```

---

## Task 17: Integration test E2E — happy path desde Vitest

**Files:**
- Create: `C:/Users/gerod/Dev/raven-nest/electron/__tests__/worktree-integration.test.ts`

- [ ] **Step 1: Test que recorre el flow completo del store + git**

```ts
// electron/__tests__/worktree-integration.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { execSync } from 'child_process'
import { existsSync } from 'fs'
import { WorktreeStore } from '../worktree-store'
import { makeTmpDir, cleanupTmp } from './setup'

describe('Worktree integration (happy path)', () => {
  let repoPath: string
  let storeDir: string
  let store: WorktreeStore
  const wtPath: string[] = []

  beforeAll(() => {
    repoPath = makeTmpDir('repo-')
    storeDir = makeTmpDir('store-')
    execSync(`git -C "${repoPath}" init -q`)
    execSync(`git -C "${repoPath}" config user.email t@t.com`)
    execSync(`git -C "${repoPath}" config user.name T`)
    execSync(`git -C "${repoPath}" commit -q --allow-empty -m initial`)
    store = new WorktreeStore(storeDir)
  })

  afterAll(() => {
    cleanupTmp(repoPath)
    cleanupTmp(storeDir)
    for (const w of wtPath) cleanupTmp(w)
  })

  it('hydrate of fresh repo returns single root entry', () => {
    const wts = store.hydrateFromGit(repoPath)
    expect(wts).toHaveLength(1)
    expect(wts[0].rootRepoPath).toBe(repoPath)
  })

  it('after git worktree add, hydrate returns 2 entries', () => {
    const wt = `${repoPath}-wt-feat-test`
    wtPath.push(wt)
    execSync(`git -C "${repoPath}" worktree add -b feat/test "${wt}"`)
    const wts = store.hydrateFromGit(repoPath)
    expect(wts).toHaveLength(2)
    const feat = wts.find((w) => w.branch === 'feat/test')
    expect(feat).toBeDefined()
    expect(existsSync(feat!.repoPath)).toBe(true)
  })

  it('reconcile after manual git worktree remove marks orphaned', () => {
    const wt = `${repoPath}-wt-feat-test`
    execSync(`git -C "${repoPath}" worktree remove "${wt}" --force`)
    const fresh = store.hydrateFromGit(repoPath).map((m) => m.repoPath)
    store.reconcile(fresh)
    // The previously-listed feat/test path should now be marked orphaned
    const orphaned = store.list().find((m) => m.branch === 'feat/test')
    expect(orphaned?.setupState).toBe('orphaned')
  })
})
```

- [ ] **Step 2: Correr**

```bash
npm test
```

Expected: 10 tests pass (7 unit + 3 integration).

- [ ] **Step 3: Commit**

```bash
git add electron/__tests__/worktree-integration.test.ts
git commit -m "test(integration): worktree happy path with real git"
```

---

## Task 18: Self-review final + smoke test full UX

**Files:** ninguno modificado, solo verificación.

- [ ] **Step 1: Correr todo el suite**

```bash
npm test
```

Expected: 10/10 passing.

- [ ] **Step 2: TypeScript clean**

```bash
npx tsc --noEmit -p tsconfig.web.json
npx tsc --noEmit -p tsconfig.node.json
```

Expected: cero errores nuevos vs baseline (los pre-existentes mencionados en memoria son OK).

- [ ] **Step 3: Build production**

```bash
npm run build
```

Expected: build completa sin errores.

- [ ] **Step 4: Smoke test UX completo**

Correr `npm run dev`. Hacer cada uno y verificar:

- [ ] Linkear repo al tab activo → sidebar muestra "▾ Worktrees" con root visible
- [ ] Click `+` en sección → modal abre
- [ ] Tipear branch + click Create → worktree creado, aparece en sidebar
- [ ] `Ctrl+Shift+W` → palette aparece arriba-centro
- [ ] Tipear "feat/quick" + Enter → worktree creado
- [ ] Click en un worktree no-active → cell switchea a ese path
- [ ] Click derecho en worktree no-root → opción "Remove worktree" funciona
- [ ] Click derecho en root → "Cannot remove root" disabled
- [ ] Sin repo activo en tab → sección Worktrees oculta
- [ ] Close + reopen Nest → worktrees siguen apareciendo (persistencia OK)

- [ ] **Step 5: Verificar archivo de persistencia**

```bash
cat ~/.raven-nest/worktrees.json
```

Expected: array JSON con todos los worktrees creados.

- [ ] **Step 6: Commit final del plan**

```bash
git add -A
git commit -m "chore(plan-1): worktree foundation complete

- WorktreeStore with persistence + git hydration + reconciliation
- IPC handlers worktree:list/create/remove/get/setPreset
- WorktreesSection sidebar component with status dots
- NewWorktreeModal with branch/path fields
- QuickWorktreePalette with Cmd+Shift+W shortcut
- Right-click context menu for remove
- 10 unit + integration tests passing

Closes Plan 1 of v1.0 implementation. Plans 2-6 pending.
Spec: docs/superpowers/specs/2026-05-02-raven-v1-worktrees-spotlight-design.md"
```

---

## Done

Plan 1 completo. Output: gestión nativa de worktrees funcionando end-to-end. Backward compat 100%.

**Próximo plan**: Plan 2 (Preset system). Se escribirá DESPUÉS de mergear Plan 1 a `main`, incorporando aprendizajes de la implementación.
