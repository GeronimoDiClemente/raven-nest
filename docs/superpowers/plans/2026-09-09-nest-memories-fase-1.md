# Nest Memories — Fase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sacar la memoria de Settings y convertirla en una superficie propia — la fila `Memories` en la sidebar con estado inline, y un overlay con fila de estado + grafo por proyecto — haciendo visible por primera vez el fallo mudo de §2.2 (una sesión corriendo sin memoria) y las mutaciones bloqueadas que hoy nadie muestra.

**Architecture:** Todo lo de datos ya existe en `electron/memory-store.ts` (tabla `sessions`, `blockedMutations()`) y en `electron/memory-ipc-server.ts` (el bridge ve cada `hook.sessionStart`). La fase 1 no inventa un motor: agrega tres lecturas nuevas sobre lo que ya se escribe (`memory:sessions`, `memory:doctor`, `memory:vault:health`), un hook de renderer que las junta, y dos superficies de UI (la fila y el overlay) que reusan `TeamThreadGraph`, `TeamThreadPanel` y `MemoryVaultCard` mudándolos fuera de `SettingsPanel`. El único código de motor nuevo es el reconciliador de sesiones: cruzar los panes a los que `pty-manager.ts` les inyectó `NEST_MEMORY_SOCKET` contra las sesiones que el bridge realmente vio, porque esa diferencia **es** el fallo mudo.

**Tech Stack:** Electron (main) + React 18 + TypeScript · better-sqlite3 · node `net` (socket IPC del bridge) · vitest (proyectos `node` y `jsdom`, ver `vitest.config.ts`) · Postgres local vía Docker para los tests de `server/`.

**Spec:** `docs/superpowers/specs/2026-09-09-nest-memories-plugin-design.md`

## Global Constraints

Aplican a **todas** las tareas. Los requisitos de cada tarea incluyen implícitamente esta sección.

- **El nombre de la superficie nueva es `Memories`** (decidido por Gero el 2026-09-09, cierra §12.1 de la spec). Nunca `Memory` a secas para la fila, el overlay, las clases CSS ni los canales IPC nuevos: `ResourceBar` ya tiene una métrica llamada "Memory" que es la RAM. Los canales IPC **preexistentes** (`memory:status`, `memory:vault:*`, `memory:teamThread:*`) **no se renombran** — son contrato con el preload y con el bridge.
- **UI, código, comentarios de cara al usuario y copy: en inglés.** Los comentarios internos siguen la mezcla que ya tiene el repo. (Memoria `product-language-english`.)
- **Vista única, sin chips de scope** (spec §4.3). La pantalla de Memories **nunca** llama a `switchTeam` ni a nada que cambie el equipo activo: ese acoplamiento es el de `PersonalWorkspace.tsx:306` y la decisión explícita fue no heredarlo.
- **Escala de z-index: 1000 base / 1100 front / 1200 lo que se abra encima** (spec §5.4).
- **Multi-SO**: cada decisión de path o de proceso vale en Windows, Mac y Linux. (Memoria `multi-os-design`.)
- **Tests**: `npm test` (vitest, dos proyectos). El proyecto `node` cubre `electron/__tests__/**` y `src/__tests__/**/*.test.ts`; el `jsdom` cubre `src/__tests__/components/**/*.test.tsx` y `src/__tests__/hooks/**/*.test.tsx`. Un test de componente **tiene** que ser `.tsx` y vivir en `src/__tests__/components/` o no lo levanta ningún proyecto.
- **Después de correr `npm test` en local la app no arranca** hasta correr `npm run native:electron` (el `pretest` deja el binding de better-sqlite3 para Node puro). Ver CLAUDE.md.
- **Typecheck**: `npx tsc --noEmit` en la raíz NO CHEQUEA NADA. El chequeo real es `npx tsc -b`, que además emite `.js`/`.d.ts` al lado de los sources. Limpiar con `git clean -fd` **después de haber hecho `git add` de los archivos fuente NUEVOS** — clean no distingue un `.tsx` recién creado de un `.js` emitido. Hay ~15 errores de tipo preexistentes bajo `tsc -b` en código de main (pidusage, metrics-collector); ignorarlos, no arreglarlos acá.
- **Los tests de `server/` corren aparte**: `cd server && npm test`, contra el Postgres local (mismo Docker que ya usan `server/__tests__/*.test.ts` vía `getPool()`/`migrate()`). No están en el `vitest.config.ts` de la raíz.
- **Cada commit termina con**:
  ```
  Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01FJpV3ahxg1zn55JS9sxByP
  ```
- **Rama**: `feat/nest-memories`, worktree `.claude/worktrees/memory-smoke`. Local, **sin pushear** — Gero pidió explícitamente no ir a main.

## File Structure

**Se crean:**

| Archivo | Responsabilidad |
|---|---|
| `electron/memory-sessions.ts` | Función pura: cruza panes-con-memoria-inyectada contra sesiones-vistas-por-el-bridge y devuelve el veredicto por sesión (`writing` / `silent` / `disabled`). Sin IO, sin SQL. |
| `electron/memory-doctor.ts` | Función pura: agrupa `MutationLogRow[]` bloqueadas por `blocked_reason`, marca cuáles son reversibles. Sin IO. |
| `electron/__tests__/memory-sessions.test.ts` | Tests del reconciliador. |
| `electron/__tests__/memory-doctor.test.ts` | Tests del agrupador. |
| `electron/__tests__/memory-import-volume.test.ts` | Smoke local de volumen: 900 filas de engram → store → `mutation_log`. |
| `server/__tests__/import-volume.test.ts` | Smoke de punta a punta: 900 mutaciones en lotes de 200 contra el servidor real. |
| `src/hooks/useMemories.ts` | El hook único de la pantalla: junta `status` + `sessions` + `doctor` + `vault health` y expone el semáforo (`dotColor`, `summary`). |
| `src/components/MemoriesItem.tsx` | La fila de la sidebar: ícono + punto de color, y el texto corto cuando está expandida. |
| `src/components/MemoriesWorkspace.tsx` | El overlay: fila de estado arriba + `TeamThreadPanel` (grafo) al centro + `MemoryVaultCard`. |
| `src/components/MemoriesStatusRow.tsx` | La fila de estado de arriba del overlay: sync, quota, vault, conflictos, sesiones. |
| `src/__tests__/hooks/useMemories.test.tsx` | Tests del hook. |
| `src/__tests__/components/MemoriesItem.test.tsx` | Tests de la fila. |
| `src/__tests__/components/MemoriesWorkspace.test.tsx` | Tests del overlay. |

**Se modifican:**

| Archivo | Cambio |
|---|---|
| `electron/memory-store.ts` | `listOpenSessions()` nuevo (lectura de la tabla `sessions` que ya existe). |
| `electron/memory-daemon.ts` | Exportar `REVERSIBLE_REJECTIONS` (hoy es const de módulo, la necesita el doctor). |
| `electron/pty-manager.ts` | Registrar en un mapa qué panes recibieron `NEST_MEMORY_SOCKET`, y exponerlo con `panesWithMemory()`. |
| `electron/main.ts` | 3 handlers IPC nuevos: `memory:sessions`, `memory:doctor`, `memory:vault:health`. |
| `electron/preload.ts` | Exponer los 3. |
| `src/types.ts` | Tipar los 3 en `window.memory`. |
| `src/components/Sidebar.tsx` | Renderizar `<MemoriesItem>` debajo de `PersonalItem`. |
| `src/App.tsx` | Estado `memoriesOpen` + montar `<MemoriesWorkspace>`. |
| `src/components/SettingsPanel.tsx` | Sacar `MemoryVaultCard` y `TeamThreadPanel`; dejar un botón "Open Memories". |
| `src/styles/global.css` | Variables de z-index + estilos de `.memories-*`. |

---

### Task 1: El smoke de import con volumen real

Spec §8.2.3 lo pide textualmente como **primer ítem del plan**: *"el import engram → servidor de punta a punta no está entre los smokes cerrados"*. Es también el riesgo #3 de §11. Esta tarea no construye feature: **mide** si la cadena que la spec §8.1 declara cerrada aguanta 900 filas. Si falla, el hallazgo es el entregable.

**Files:**
- Create: `electron/__tests__/memory-import-volume.test.ts`
- Create: `server/__tests__/import-volume.test.ts`

**Interfaces:**
- Consumes: `importEngramDatabase(store, path, opts)` de `electron/memory-importers/engram.ts`; `MemoryStore` de `electron/memory-store.ts`; `handlePush`/`handlePull` de `server/src/push.ts` y `server/src/pull.ts`.
- Produces: nada que otras tareas consuman. Es una red de seguridad.

- [ ] **Step 1: Escribir el smoke local (engram → store → mutation_log)**

Crear `electron/__tests__/memory-import-volume.test.ts`:

```ts
// Spec §8.2.3: el camino engram -> store -> mutation_log esta testeado por unidad con 2-3
// filas, nunca con el volumen real (el vault de referencia tiene 866 notas). Esto lo corre
// con 900 y verifica las dos propiedades que el onboarding necesita: que entren todas, y
// que importar dos veces no duplique NI genere una segunda tanda de mutaciones para pushear.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import Database from 'better-sqlite3'
import { join } from 'path'
import { makeTmpDir, cleanupTmp } from './setup'
import { MemoryStore } from '../memory-store'
import { importEngramDatabase } from '../memory-importers/engram'

const ROW_COUNT = 900

/** Fixture: una engram.db sintetica con el esquema que el importer lee. */
function buildEngramDb(path: string, rows: number): void {
  const db = new Database(path)
  db.exec(
    'CREATE TABLE observations (' +
      'sync_id TEXT PRIMARY KEY, type TEXT, title TEXT, content TEXT, ' +
      'project TEXT, topic_key TEXT, revision_count INTEGER, duplicate_count INTEGER, ' +
      'last_seen_at TEXT, created_at TEXT, updated_at TEXT, deleted_at TEXT)'
  )
  const insert = db.prepare(
    'INSERT INTO observations (sync_id, type, title, content, project, topic_key, ' +
      'revision_count, duplicate_count, last_seen_at, created_at, updated_at, deleted_at) ' +
      'VALUES (?, ?, ?, ?, ?, ?, 1, 0, ?, ?, ?, NULL)'
  )
  const txn = db.transaction(() => {
    for (let i = 0; i < rows; i++) {
      // 9 proyectos, como el vault real medido en §2.1.
      const project = 'project-' + (i % 9)
      const stamp = '2026-09-01 10:00:00'
      insert.run('engram-' + i, 'decision', 'Title ' + i, 'Body ' + i, project, null, stamp, stamp, stamp)
    }
  })
  txn()
  db.close()
}

describe('import de engram con volumen real (spec §8.2.3)', () => {
  let dir: string
  let store: MemoryStore
  let engramPath: string

  beforeEach(() => {
    dir = makeTmpDir('raven-import-volume-')
    engramPath = join(dir, 'engram.db')
    buildEngramDb(engramPath, ROW_COUNT)
    store = new MemoryStore(join(dir, 'memory.db'))
  })

  afterEach(() => {
    store.close()
    cleanupTmp(dir)
  })

  it('importa las 900 filas y deja 900 mutaciones para pushear', () => {
    const result = importEngramDatabase(store, engramPath)

    expect(result.error).toBeUndefined()
    expect(result.imported).toBe(ROW_COUNT)
    expect(store.count()).toBe(ROW_COUNT)
    expect(store.pendingMutationCount()).toBe(ROW_COUNT)
  })

  it('importar dos veces no duplica ni genera una segunda tanda de mutaciones', () => {
    importEngramDatabase(store, engramPath)
    const afterFirst = store.pendingMutationCount()

    const second = importEngramDatabase(store, engramPath)

    expect(second.imported).toBe(ROW_COUNT)
    expect(store.count()).toBe(ROW_COUNT)
    // deriveImportSyncId es determinístico (§8.1): la segunda pasada resuelve por identidad
    // de contenido, no inserta filas nuevas. Si esto crece, el onboarding duplica en la nube.
    expect(store.pendingMutationCount()).toBe(afterFirst)
  })
})
```

- [ ] **Step 2: Correr el smoke local**

Run: `npx vitest run electron/__tests__/memory-import-volume.test.ts`
Expected: PASS los dos.

Si el segundo falla con `pendingMutationCount` creciendo, ese es el hallazgo: `store.save()` está generando una mutación de upsert por cada re-import y el onboarding sube todo dos veces. **Parar y reportar antes de seguir** — es un bug de datos, no algo que esta tarea deba parchear a ciegas.

- [ ] **Step 3: Escribir el smoke de punta a punta contra el servidor**

Crear `server/__tests__/import-volume.test.ts`:

```ts
// Spec §8.2.3: el import de volumen nunca llego al servidor. Esto empuja 900 mutaciones en
// los lotes de 200 que memory-daemon.ts usa de verdad (pendingMutations(limit = 200)) y
// verifica que llegan todas y que el upsert por sync_id no duplica.
import { describe, it, expect, beforeAll } from 'vitest'
import { randomUUID } from 'node:crypto'
import { getPool, migrate } from '../src/db'
import { handlePush } from '../src/push'
import { handlePull } from '../src/pull'

const pool = getPool()
const RUN = randomUUID().slice(0, 8)
const BATCH = 200
const TOTAL = 900

let auth: { deviceId: string; userId: string; plan: string }

beforeAll(async () => {
  await migrate(pool)
  const userId = randomUUID()
  const deviceId = randomUUID()
  await pool.query("insert into users (id, plan) values ($1, 'pro')", [userId])
  await pool.query(
    "insert into devices (id, user_id, name, token_hash) values ($1, $2, 'import-volume', $3)",
    [deviceId, userId, 'hash-' + deviceId]
  )
  auth = { deviceId, userId, plan: 'pro' }
})

const mut = (seq: number, syncId: string, p: string) => ({
  seq, sync_id: syncId, op: 'upsert' as const,
  payload: {
    sync_id: syncId, project_key: p, project_display_name: p, scope: 'personal',
    type: 'decision', topic_key: null, title: syncId, content: 'body', tags: ['import'],
    lamport: 1, updated_at: Date.now(), created_at: Date.now(),
  },
})

describe('import de volumen contra el servidor (spec §8.2.3)', () => {
  it('sube 900 observaciones en lotes de 200 y las devuelve todas por pull', async () => {
    const project = 'import-vol-' + RUN

    for (let offset = 0; offset < TOTAL; offset += BATCH) {
      const mutations = []
      for (let i = offset; i < Math.min(offset + BATCH, TOTAL); i++) {
        mutations.push(mut(1000 + i, RUN + '-obs-' + i, project))
      }
      const res = await handlePush(pool, auth, { mutations })
      const applied = res.results.filter((r) => r.outcome === 'applied').length
      expect(applied).toBe(mutations.length)
    }

    // El pull pagina: se acumula hasta que deja de devolver filas.
    let cursors: Record<string, number> = { [project]: 0 }
    const seen = new Set<string>()
    for (let page = 0; page < 20; page++) {
      const res = await handlePull(pool, auth, { cursors, limit: 500 })
      if (res.rows.length === 0) break
      for (const row of res.rows) seen.add(row.sync_id)
      cursors = res.cursors as Record<string, number>
    }

    expect(seen.size).toBe(TOTAL)
  })

  it('reimportar el mismo lote hace upsert por sync_id, no duplica', async () => {
    const project = 'import-dup-' + RUN
    const mutations = Array.from({ length: 50 }, (_, i) => mut(5000 + i, RUN + '-dup-' + i, project))

    await handlePush(pool, auth, { mutations })
    await handlePush(pool, auth, { mutations })

    const { rows } = await pool.query(
      'select count(*)::int as c from observations where project_key = $1',
      [project]
    )
    expect(rows[0].c).toBe(50)
  })
})
```

- [ ] **Step 4: Correr el smoke del servidor**

Levantar el Postgres local (el mismo que ya usan los tests de `server/`, vía `getPool()`/`migrate()`) y correr:

Run: `cd server && npx vitest run __tests__/import-volume.test.ts`
Expected: PASS los dos.

Si el push de 200 mutaciones rebota por tamaño de request, ese es el hallazgo de §7.3 (chunks con tope de bytes): anotarlo y reportarlo, **no** implementar el chunking acá — sería su propia tarea.

- [ ] **Step 5: Commit**

```bash
git add electron/__tests__/memory-import-volume.test.ts server/__tests__/import-volume.test.ts
git commit -m "test(memories): smoke de import con volumen real, local y contra el servidor

Spec 2026-09-09-nest-memories-plugin-design.md 8.2.3.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01FJpV3ahxg1zn55JS9sxByP"
```

---

### Task 2: El reconciliador de sesiones — hacer visible el fallo mudo

Spec §2.2 y §7.1. Hoy una sesión puede correr entera sin memoria y nadie se entera. El dato para detectarlo ya existe repartido en dos lados que nunca se cruzaron: `pty-manager.ts:231` sabe a qué panes les inyectó `NEST_MEMORY_SOCKET`, y la tabla `sessions` de `memory-store.ts:407` sabe qué sesiones llegaron de verdad al bridge (`hook.sessionStart` → `store.openSession`, `memory-ipc-server.ts:407`). Un pane con la memoria inyectada que **nunca** abrió sesión es exactamente el fallo mudo.

**Files:**
- Create: `electron/memory-sessions.ts`
- Create: `electron/__tests__/memory-sessions.test.ts`
- Modify: `electron/memory-store.ts` (agregar `listOpenSessions()` después de `closeSession`, línea 1344)
- Modify: `electron/pty-manager.ts` (registrar los panes con memoria, bloque `env.NEST_MEMORY_SOCKET`, líneas 221-236)

**Interfaces:**
- Consumes: nada de tareas anteriores.
- Produces:
  - `export interface PaneWithMemory { paneId: string; aiType: string; account: string; enabled: boolean; startedAt: number }`
  - `export interface OpenSessionRow { id: string; pane_id: string | null; project_key: string; ai_type: string | null; account: string | null; started_at: number }`
  - `export type SessionHealth = 'writing' | 'silent' | 'disabled'`
  - `export interface SessionVerdict { paneId: string; aiType: string; account: string; health: SessionHealth; sessionId: string | null; startedAt: number }`
  - `export const SESSION_GRACE_MS = 15_000`
  - `export function reconcileSessions(panes: PaneWithMemory[], sessions: OpenSessionRow[], now: number, graceMs?: number): SessionVerdict[]`
  - `MemoryStore.listOpenSessions(): OpenSessionRow[]`
  - `PtyManager.panesWithMemory(): PaneWithMemory[]`

- [ ] **Step 1: Escribir el test que falla**

Crear `electron/__tests__/memory-sessions.test.ts`:

```ts
// Spec §2.2 — el peor modo de falla del sistema, hoy completamente invisible: una terminal
// arrancada desde Nest, con NEST_MEMORY_SOCKET inyectado, cuya CLI nunca llego al bridge
// (el MCP murio con CONNECTION_CLOSED, o el hook no corrio). Este modulo es puro a
// proposito: el cruce se testea sin PTY, sin sockets y sin SQLite.
import { describe, it, expect } from 'vitest'
import { reconcileSessions, type PaneWithMemory, type OpenSessionRow } from '../memory-sessions'

const NOW = 1_757_000_000_000
const pane = (over: Partial<PaneWithMemory> = {}): PaneWithMemory => ({
  paneId: 'pane-1', aiType: 'claude', account: 'claude:Gero Personal',
  enabled: true, startedAt: NOW - 60_000, ...over,
})
const session = (over: Partial<OpenSessionRow> = {}): OpenSessionRow => ({
  id: 'sess-1', pane_id: 'pane-1', project_key: 'proj', ai_type: 'claude',
  account: 'claude:Gero Personal', started_at: NOW - 55_000, ...over,
})

describe('reconcileSessions', () => {
  it('un pane con memoria inyectada y sesion abierta esta escribiendo', () => {
    const [verdict] = reconcileSessions([pane()], [session()], NOW)
    expect(verdict.health).toBe('writing')
    expect(verdict.sessionId).toBe('sess-1')
  })

  it('un pane con memoria inyectada y SIN sesion, pasada la gracia, esta mudo', () => {
    const [verdict] = reconcileSessions([pane()], [], NOW)
    expect(verdict.health).toBe('silent')
    expect(verdict.sessionId).toBeNull()
  })

  it('un pane recien abierto no se reporta mudo todavia — la CLI esta arrancando', () => {
    const [verdict] = reconcileSessions([pane({ startedAt: NOW - 2_000 })], [], NOW)
    expect(verdict.health).toBe('writing')
  })

  it('un pane con la memoria apagada por config se reporta disabled, no mudo', () => {
    const [verdict] = reconcileSessions([pane({ enabled: false })], [], NOW)
    expect(verdict.health).toBe('disabled')
  })

  it('una sesion de otro pane no tapa el fallo de este', () => {
    const verdicts = reconcileSessions(
      [pane({ paneId: 'pane-a' }), pane({ paneId: 'pane-b' })],
      [session({ pane_id: 'pane-a' })],
      NOW
    )
    expect(verdicts.find((v) => v.paneId === 'pane-a')!.health).toBe('writing')
    expect(verdicts.find((v) => v.paneId === 'pane-b')!.health).toBe('silent')
  })

  it('una sesion sin pane_id no se le asigna a nadie', () => {
    const [verdict] = reconcileSessions([pane()], [session({ pane_id: null })], NOW)
    expect(verdict.health).toBe('silent')
  })
})
```

- [ ] **Step 2: Correr el test para verificar que falla**

Run: `npx vitest run electron/__tests__/memory-sessions.test.ts`
Expected: FAIL con `Failed to resolve import "../memory-sessions"`.

- [ ] **Step 3: Escribir el módulo**

Crear `electron/memory-sessions.ts`:

```ts
// Spec §2.2 / §7.1 ("fail loudly, no silent drops"). El cruce entre lo que Nest CREE que
// tiene memoria (los panes a los que pty-manager.ts:231 les inyecto NEST_MEMORY_SOCKET) y
// lo que el bridge VIO de verdad (la tabla `sessions`, que solo se escribe cuando
// hook.sessionStart llega). La diferencia entre esos dos conjuntos es el fallo mudo.
//
// Puro a proposito: sin PTY, sin socket, sin SQLite. main.ts junta los dos lados y llama.

/** Un pane que Nest lanzo con el bloque de memoria de pty-manager.ts activo. */
export interface PaneWithMemory {
  paneId: string
  aiType: string
  account: string
  /** `NEST_MEMORY_ENABLED === '1'` en el momento del spawn. */
  enabled: boolean
  startedAt: number
}

/** Una fila de `sessions` todavia abierta (ended_at IS NULL). */
export interface OpenSessionRow {
  id: string
  pane_id: string | null
  project_key: string
  ai_type: string | null
  account: string | null
  started_at: number
}

export type SessionHealth = 'writing' | 'silent' | 'disabled'

export interface SessionVerdict {
  paneId: string
  aiType: string
  account: string
  health: SessionHealth
  sessionId: string | null
  startedAt: number
}

/**
 * Cuanto se le da a una CLI recien lanzada para llegar al bridge antes de llamarla muda.
 * Claude Code corre SessionStart despues de resolver su config y sus MCP servers; 15s es
 * holgado para eso y sigue siendo corto para que el usuario lo note en la fila.
 */
export const SESSION_GRACE_MS = 15_000

export function reconcileSessions(
  panes: PaneWithMemory[],
  sessions: OpenSessionRow[],
  now: number,
  graceMs: number = SESSION_GRACE_MS
): SessionVerdict[] {
  // Una sesion sin pane_id no se le puede atribuir a ningun pane — un shim viejo, o una CLI
  // corriendo fuera de Nest. Se descarta del cruce en vez de asignarsela al primero.
  const byPane = new Map<string, OpenSessionRow>()
  for (const s of sessions) {
    if (s.pane_id) byPane.set(s.pane_id, s)
  }

  return panes.map((p) => {
    const session = byPane.get(p.paneId) ?? null
    let health: SessionHealth
    if (!p.enabled) {
      // Apagada a proposito: no es un fallo, y no tiene que gritar como uno.
      health = 'disabled'
    } else if (session) {
      health = 'writing'
    } else if (now - p.startedAt < graceMs) {
      // Todavia arrancando. Optimista a proposito: un falso "mudo" cada vez que se abre una
      // terminal entrenaria al usuario a ignorar el indicador.
      health = 'writing'
    } else {
      health = 'silent'
    }
    return {
      paneId: p.paneId,
      aiType: p.aiType,
      account: p.account,
      health,
      sessionId: session?.id ?? null,
      startedAt: p.startedAt,
    }
  })
}
```

- [ ] **Step 4: Correr el test para verificar que pasa**

Run: `npx vitest run electron/__tests__/memory-sessions.test.ts`
Expected: PASS los 6.

- [ ] **Step 5: Agregar `listOpenSessions()` al store**

En `electron/memory-store.ts`, justo después de `closeSession` (línea 1344), agregar:

```ts
  /**
   * Spec §2.2: las sesiones que el bridge vio abrirse y todavia no cerro. Es la mitad
   * "lo que paso de verdad" del cruce de memory-sessions.ts.
   */
  listOpenSessions(): Array<{
    id: string; pane_id: string | null; project_key: string
    ai_type: string | null; account: string | null; started_at: number
  }> {
    return this.db
      .prepare(
        'SELECT id, pane_id, project_key, ai_type, account, started_at ' +
          'FROM sessions WHERE ended_at IS NULL ORDER BY started_at DESC'
      )
      .all() as never
  }
```

- [ ] **Step 6: Registrar los panes con memoria en `pty-manager.ts`**

Tres cambios en `electron/pty-manager.ts`:

1. Import de tipo, arriba del archivo:

```ts
import type { PaneWithMemory } from './memory-sessions'
```

2. El mapa, junto a `private memory?: PtyMemoryIntegration` (línea 128):

```ts
  // Spec §2.2: lo que Nest CREE que tiene memoria. memory-sessions.ts cruza esto contra lo
  // que el bridge vio de verdad; la diferencia es el fallo mudo. Se limpia al matar el pane.
  private memoryPanes = new Map<string, PaneWithMemory>()

  /** Spec §2.2: los panes vivos a los que se les inyecto el bridge de memoria. */
  panesWithMemory(): PaneWithMemory[] {
    return [...this.memoryPanes.values()]
  }
```

3. El registro, dentro del `if (parsed) { ... }`, inmediatamente después de la línea `env.NEST_MEMORY_ENABLED = this.memory.isEnabled() ? '1' : '0'`:

```ts
        this.memoryPanes.set(paneId, {
          paneId,
          aiType: parsed.aiType,
          account: `${parsed.aiType}:${parsed.accountName}`,
          enabled: this.memory.isEnabled(),
          startedAt: Date.now(),
        })
```

4. Y en el método que destruye un pane (el mismo que ya hace `this.ptys.delete(paneId)`), agregar en la misma línea de limpieza:

```ts
    this.memoryPanes.delete(paneId)
```

- [ ] **Step 7: Correr las suites afectadas**

Run: `npx vitest run electron/__tests__/pty-manager.test.ts electron/__tests__/memory-store.test.ts electron/__tests__/memory-sessions.test.ts`
Expected: PASS todo. `pty-manager.test.ts:106` ya afirma que se inyecta `NEST_MEMORY_SOCKET`; el registro nuevo no toca el env, así que ese test sigue verde sin modificarlo.

- [ ] **Step 8: Commit**

```bash
git add electron/memory-sessions.ts electron/__tests__/memory-sessions.test.ts electron/memory-store.ts electron/pty-manager.ts
git commit -m "feat(memories): cruzar panes con memoria contra sesiones vistas por el bridge

El fallo mudo de la spec 2.2: un pane con NEST_MEMORY_SOCKET inyectado cuya CLI
nunca llego al bridge corre sin memoria y hoy nadie se entera.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01FJpV3ahxg1zn55JS9sxByP"
```

---

### Task 3: El doctor — las mutaciones bloqueadas, agrupadas por razón

Spec §7.1: *"un comando/panel que lista todo lo que está bloqueado, con código de razón. Ya tenemos la mitad: `mutation_log.blocked_reason` existe, y `REVERSIBLE_REJECTIONS` distingue terminal de reversible. Falta **mostrarlo**."* El caso concreto de §8.2.1: *"importé 866, subí 50, 816 esperando plan"*.

**Files:**
- Create: `electron/memory-doctor.ts`
- Create: `electron/__tests__/memory-doctor.test.ts`
- Modify: `electron/memory-daemon.ts:62` (exportar `REVERSIBLE_REJECTIONS`)

**Interfaces:**
- Consumes: `MutationLogRow` (campos `seq`, `sync_id`, `op`, `payload`, `created_at`, `pushed_at`, `last_error`, `blocked_reason`) de `electron/memory-store.ts`; `REVERSIBLE_REJECTIONS: Set<string>` de `electron/memory-daemon.ts`.
- Produces:
  - `export interface BlockedGroup { reason: string; count: number; oldestAt: number; reversible: boolean }`
  - `export interface DoctorReport { blockedTotal: number; groups: BlockedGroup[] }`
  - `export function buildDoctorReport(rows: MutationLogRow[]): DoctorReport`

- [ ] **Step 1: Escribir el test que falla**

Crear `electron/__tests__/memory-doctor.test.ts`:

```ts
// Spec §7.1 — "if sync is blocked, fail loudly and visibly. No silent drops." El dato ya se
// escribe (mutation_log.blocked_reason, memory-store.ts:1213) y nadie lo lee nunca.
import { describe, it, expect } from 'vitest'
import { buildDoctorReport } from '../memory-doctor'
import type { MutationLogRow } from '../memory-store'

const row = (seq: number, reason: string | null, createdAt: number): MutationLogRow => ({
  seq, sync_id: 's-' + seq, op: 'upsert', payload: '{}', created_at: createdAt,
  pushed_at: null, last_error: reason, blocked_reason: reason,
})

describe('buildDoctorReport', () => {
  it('sin filas bloqueadas el reporte esta vacio', () => {
    expect(buildDoctorReport([])).toEqual({ blockedTotal: 0, groups: [] })
  })

  it('agrupa por razon, cuenta, y se queda con la mas vieja', () => {
    const report = buildDoctorReport([
      row(1, 'quota_exceeded', 100),
      row(2, 'quota_exceeded', 200),
      row(3, 'project_limit_reached', 300),
    ])
    expect(report.blockedTotal).toBe(3)
    expect(report.groups).toHaveLength(2)
    expect(report.groups[0]).toEqual({
      reason: 'quota_exceeded', count: 2, oldestAt: 100, reversible: true,
    })
  })

  it('ordena de mas a menos, para que el titular sea el bloqueo mas grande', () => {
    const report = buildDoctorReport([
      row(1, 'project_limit_reached', 100),
      row(2, 'quota_exceeded', 200),
      row(3, 'quota_exceeded', 300),
    ])
    expect(report.groups[0].reason).toBe('quota_exceeded')
  })

  it('marca terminal lo que no es reversible — no se arregla subiendo el plan', () => {
    const report = buildDoctorReport([row(1, 'team_scope_not_allowed', 100)])
    expect(report.groups[0].reversible).toBe(false)
  })

  it('ignora las filas sin blocked_reason: son pendientes normales, no bloqueos', () => {
    expect(buildDoctorReport([row(1, null, 100)]).blockedTotal).toBe(0)
  })
})
```

- [ ] **Step 2: Correr el test para verificar que falla**

Run: `npx vitest run electron/__tests__/memory-doctor.test.ts`
Expected: FAIL con `Failed to resolve import "../memory-doctor"`.

- [ ] **Step 3: Exportar `REVERSIBLE_REJECTIONS` y escribir el módulo**

En `electron/memory-daemon.ts:62`, cambiar:

```ts
const REVERSIBLE_REJECTIONS = new Set(['project_limit_reached', 'quota_exceeded', 'project_not_shared_with_team'])
```

por:

```ts
export const REVERSIBLE_REJECTIONS = new Set(['project_limit_reached', 'quota_exceeded', 'project_not_shared_with_team'])
```

Crear `electron/memory-doctor.ts`:

```ts
// Spec §7.1, robado de engram: "if sync is blocked, fail loudly and visibly. No silent
// drops." Puro: agrupa lo que memory-store.ts ya escribio, sin tocar la base.
import type { MutationLogRow } from './memory-store'
import { REVERSIBLE_REJECTIONS } from './memory-daemon'

export interface BlockedGroup {
  reason: string
  count: number
  /** La mas vieja del grupo: cuanto hace que esto esta trabado. */
  oldestAt: number
  /**
   * Reversible = se destraba solo cuando cambia la condicion (subir el plan, compartir el
   * proyecto) y la mutacion se reintenta con el mismo payload. Terminal = no se destraba.
   * La distincion es de memory-daemon.ts, no se re-decide aca.
   */
  reversible: boolean
}

export interface DoctorReport {
  blockedTotal: number
  /** De mayor a menor, para que el titular de la UI sea el bloqueo mas grande. */
  groups: BlockedGroup[]
}

export function buildDoctorReport(rows: MutationLogRow[]): DoctorReport {
  const byReason = new Map<string, BlockedGroup>()

  for (const r of rows) {
    const reason = r.blocked_reason
    if (!reason) continue
    const existing = byReason.get(reason)
    if (existing) {
      existing.count += 1
      if (r.created_at < existing.oldestAt) existing.oldestAt = r.created_at
    } else {
      byReason.set(reason, {
        reason,
        count: 1,
        oldestAt: r.created_at,
        reversible: REVERSIBLE_REJECTIONS.has(reason),
      })
    }
  }

  const groups = [...byReason.values()].sort(
    (a, b) => b.count - a.count || a.reason.localeCompare(b.reason)
  )
  return { blockedTotal: groups.reduce((sum, g) => sum + g.count, 0), groups }
}
```

- [ ] **Step 4: Correr los tests para verificar que pasan**

Run: `npx vitest run electron/__tests__/memory-doctor.test.ts electron/__tests__/memory-daemon.test.ts`
Expected: PASS los 5 nuevos, y `memory-daemon.test.ts` sin regresiones (agregar `export` no cambia comportamiento).

- [ ] **Step 5: Commit**

```bash
git add electron/memory-doctor.ts electron/__tests__/memory-doctor.test.ts electron/memory-daemon.ts
git commit -m "feat(memories): agrupar las mutaciones bloqueadas por razon

Spec 7.1. blocked_reason se escribe desde la Task 8 de memory-bridge y nunca se
leyo: el caso de 8.2.1 es 'importe 866, subi 50, 816 esperando plan'.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01FJpV3ahxg1zn55JS9sxByP"
```

---

### Task 4: Los tres IPC nuevos

Spec §5.3: *"Hace falta IPC nuevo para: el estado de sesión activa/apagada (§2.2), el contador de conflictos y qué se inyectó en esta sesión."* Las dos primeras las alimentan las Tasks 2 y 3. La tercera (qué se inyectó) sale del vault: cuántas notas hay y qué tan atrasado está — el riesgo #2 de §11.

`main.ts` no tiene tests unitarios en este repo, así que la lógica que se puede equivocar vive en un módulo aparte (`memory-vault-health.ts`) y los handlers quedan como cableado de tres líneas.

**Files:**
- Create: `electron/memory-vault-health.ts`
- Create: `electron/__tests__/memory-vault-health.test.ts`
- Modify: `electron/main.ts` (3 handlers nuevos, junto a `memory:status` en la línea 3027 y a `memory:vault:reveal` en la 3259)
- Modify: `electron/preload.ts` (3 métodos nuevos, junto a los `memory:` de las líneas 86-110)
- Modify: `src/types.ts` (tipar los 3 en `window.memory`, bloque que arranca en la línea 822)

**Interfaces:**
- Consumes: `reconcileSessions`, `PaneWithMemory`, `SessionVerdict` (Task 2) · `MemoryStore.listOpenSessions()` (Task 2) · `PtyManager.panesWithMemory()` (Task 2) · `buildDoctorReport`, `DoctorReport` (Task 3) · `readManifest` y `DEFAULT_APPLY_PATHS` de `electron/integrations/vault-apply.ts` · `resolveVaultRootDir`, `loadVaultSettings`, `vaultSettingsPath` de `electron/integrations/vault-config.ts`.
- Produces:
  - `export interface VaultHealth { noteCount: number; conflictCount: number; lastGeneratedAt: number | null }`
  - `export function readVaultHealth(rootDir: string): VaultHealth`
  - `window.memory.sessions?(): Promise<{ ok: boolean; sessions: SessionVerdict[]; silentCount: number }>`
  - `window.memory.doctor?(): Promise<{ ok: boolean; blockedTotal: number; groups: BlockedGroup[] }>`
  - `window.memory.vaultHealth?(): Promise<{ ok: boolean; enabled: boolean; rootDir: string; noteCount: number; conflictCount: number; lastGeneratedAt: number | null }>`

- [ ] **Step 1: Escribir el test que falla**

Crear `electron/__tests__/memory-vault-health.test.ts`:

```ts
// Riesgo #2 de la spec §11: "el desfasaje del vault puede significar que la pantalla muestre
// datos viejos. Hay que resolverlo antes de que el grafo sea la cara del producto." Lo
// medido el 2026-09-09: DB escrita 22:19, vault regenerado 20:50 — 1,5 h atras y nadie lo
// dice. Esto lee esa marca de tiempo para poder mostrarla.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { join } from 'path'
import { mkdirSync, writeFileSync } from 'fs'
import { makeTmpDir, cleanupTmp } from './setup'
import { readVaultHealth } from '../memory-vault-health'

describe('readVaultHealth', () => {
  let dir: string

  beforeEach(() => { dir = makeTmpDir('raven-vault-health-') })
  afterEach(() => { cleanupTmp(dir) })

  it('un vault que no existe reporta cero, no explota', () => {
    expect(readVaultHealth(join(dir, 'no-such-vault'))).toEqual({
      noteCount: 0, conflictCount: 0, lastGeneratedAt: null,
    })
  })

  it('cuenta las entradas del manifiesto y toma su mtime como ultima generacion', () => {
    mkdirSync(join(dir, '.nest-vault'), { recursive: true })
    writeFileSync(
      join(dir, '.nest-vault', 'manifest.json'),
      JSON.stringify({ entries: { a: { filePath: 'a.md' }, b: { filePath: 'b.md' } } })
    )

    const health = readVaultHealth(dir)

    expect(health.noteCount).toBe(2)
    expect(health.lastGeneratedAt).toBeGreaterThan(0)
  })

  it('cuenta los .md de _conflicts/ — la spec §4.5 los quiere en la fila de estado', () => {
    mkdirSync(join(dir, '_conflicts'), { recursive: true })
    writeFileSync(join(dir, '_conflicts', 'nota-1.md'), 'mine')
    writeFileSync(join(dir, '_conflicts', 'nota-2.md'), 'mine')
    // Un archivo que no es nota no cuenta como conflicto.
    writeFileSync(join(dir, '_conflicts', '.DS_Store'), '')

    expect(readVaultHealth(dir).conflictCount).toBe(2)
  })

  it('un manifiesto corrupto reporta cero notas en vez de tirar la pantalla abajo', () => {
    mkdirSync(join(dir, '.nest-vault'), { recursive: true })
    writeFileSync(join(dir, '.nest-vault', 'manifest.json'), '{ no es json')

    expect(readVaultHealth(dir).noteCount).toBe(0)
  })
})
```

- [ ] **Step 2: Correr el test para verificar que falla**

Run: `npx vitest run electron/__tests__/memory-vault-health.test.ts`
Expected: FAIL con `Failed to resolve import "../memory-vault-health"`.

- [ ] **Step 3: Escribir el módulo**

Crear `electron/memory-vault-health.ts`:

```ts
// Spec §11 riesgo 2 + §4.5 (los conflictos van en la fila de estado, no escondidos en una
// carpeta). Lectura pura de disco: no regenera nada, no escribe nada.
import { readdirSync, statSync } from 'fs'
import { join } from 'path'
import { readManifest, DEFAULT_APPLY_PATHS } from './integrations/vault-apply'

/** El directorio donde applyVaultPlan preserva los bytes editados a mano (vault-hash.ts). */
const CONFLICTS_DIR = '_conflicts'

export interface VaultHealth {
  noteCount: number
  conflictCount: number
  /** mtime del manifiesto: la ultima vez que el vault se regenero de verdad. */
  lastGeneratedAt: number | null
}

export function readVaultHealth(rootDir: string): VaultHealth {
  // readManifest ya devuelve `{ entries: {} }` ante cualquier fallo de lectura o de parseo.
  const manifest = readManifest(rootDir, DEFAULT_APPLY_PATHS)
  const noteCount = Object.keys(manifest.entries).length

  let lastGeneratedAt: number | null = null
  try {
    lastGeneratedAt = statSync(join(rootDir, ...DEFAULT_APPLY_PATHS.manifest.split('/'))).mtimeMs
  } catch {
    lastGeneratedAt = null
  }

  let conflictCount = 0
  try {
    conflictCount = readdirSync(join(rootDir, CONFLICTS_DIR)).filter((f) => f.endsWith('.md')).length
  } catch {
    conflictCount = 0
  }

  return { noteCount, conflictCount, lastGeneratedAt }
}
```

- [ ] **Step 4: Correr el test para verificar que pasa**

Run: `npx vitest run electron/__tests__/memory-vault-health.test.ts`
Expected: PASS los 4.

- [ ] **Step 5: Cablear los tres handlers en `main.ts`**

Agregar los imports arriba, junto a los otros de memoria:

```ts
import { reconcileSessions } from './memory-sessions'
import { buildDoctorReport } from './memory-doctor'
import { readVaultHealth } from './memory-vault-health'
```

Y los handlers, inmediatamente después de `ipcMain.handle('memory:hub-stats', ...)` (termina en la línea 3050):

```ts
// Spec §2.2: el fallo mudo. Cruza los panes a los que pty-manager les inyecto el bridge
// contra las sesiones que el bridge vio de verdad. `silentCount > 0` es lo que pinta de
// rojo la fila de Memories.
ipcMain.handle('memory:sessions', () => {
  if (!memory) return { ok: false, sessions: [], silentCount: 0 }
  const sessions = reconcileSessions(
    ptyManager.panesWithMemory(),
    memory.store.listOpenSessions(),
    Date.now()
  )
  return { ok: true, sessions, silentCount: sessions.filter((s) => s.health === 'silent').length }
})

// Spec §7.1: "if sync is blocked, fail loudly and visibly."
ipcMain.handle('memory:doctor', () => {
  if (!memory) return { ok: false, blockedTotal: 0, groups: [] }
  return { ok: true, ...buildDoctorReport(memory.store.blockedMutations()) }
})
```

Y el tercero, después de `ipcMain.handle('memory:vault:reveal', ...)`:

```ts
// Spec §11 riesgo 2: cuantas notas hay, cuantos conflictos, y cuando se regenero por
// ultima vez. Sin esto la pantalla puede mostrar el vault de hace una hora y media sin
// avisar.
ipcMain.handle('memory:vault:health', () => {
  if (!memory) return { ok: false, enabled: false, rootDir: '', noteCount: 0, conflictCount: 0, lastGeneratedAt: null }
  const userId = memory.store.getOwnerUserId()
  const settings = loadVaultSettings(vaultSettingsPath(ravenHome(), userId))
  const rootDir = resolveVaultRootDir(ravenHome(), userId, settings)
  return { ok: true, enabled: settings.enabled, rootDir, ...readVaultHealth(rootDir) }
})
```

> Si el símbolo del PtyManager en `main.ts` no se llama `ptyManager`, usar el que exista — es la misma instancia a la que ya se le llama `setMemoryIntegration()`.

- [ ] **Step 6: Exponerlos en el preload**

En `electron/preload.ts`, junto a los otros `memory:` (después de la línea 110):

```ts
  sessions: () => ipcRenderer.invoke('memory:sessions'),
  doctor: () => ipcRenderer.invoke('memory:doctor'),
  vaultHealth: () => ipcRenderer.invoke('memory:vault:health'),
```

- [ ] **Step 7: Tiparlos en `src/types.ts`**

Dentro del bloque `memory: { ... }` que arranca en la línea 822, agregar. Los tres son **opcionales** (`?`) por la misma razón que `setUser?` y `checkPendingAdoption?` lo son: un preload viejo no los expone y el renderer tiene que seguir montando.

```ts
      /**
       * Spec §2.2 — el fallo mudo. Una sesion con `health: 'silent'` es una terminal que
       * Nest lanzo con memoria y que nunca llego al bridge: esta corriendo sin memoria.
       */
      sessions?: () => Promise<{
        ok: boolean
        sessions: Array<{
          paneId: string
          aiType: string
          account: string
          health: 'writing' | 'silent' | 'disabled'
          sessionId: string | null
          startedAt: number
        }>
        silentCount: number
      }>
      /** Spec §7.1 — lo que esta bloqueado y por que. */
      doctor?: () => Promise<{
        ok: boolean
        blockedTotal: number
        groups: Array<{ reason: string; count: number; oldestAt: number; reversible: boolean }>
      }>
      /** Spec §11 riesgo 2 — cuan atrasado esta el vault respecto de la base. */
      vaultHealth?: () => Promise<{
        ok: boolean
        enabled: boolean
        rootDir: string
        noteCount: number
        conflictCount: number
        lastGeneratedAt: number | null
      }>
```

- [ ] **Step 8: Typecheck y suite completa**

```bash
npx tsc -b
npm test
```
Expected: `tsc -b` sin errores nuevos (los ~15 preexistentes de pidusage/metrics-collector siguen ahí). Suite verde.

Antes de limpiar los `.js`/`.d.ts` emitidos: **`git add` de los archivos nuevos primero**.

```bash
git add electron/memory-vault-health.ts electron/__tests__/memory-vault-health.test.ts
git clean -fd
```

- [ ] **Step 9: Commit**

```bash
git add electron/main.ts electron/preload.ts src/types.ts
git commit -m "feat(memories): IPC de sesiones, doctor y salud del vault

Spec 5.3. Los tres datos que la pantalla necesita y hoy no existen.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01FJpV3ahxg1zn55JS9sxByP"
```

---

### Task 5: El semáforo — de todos esos números a un punto de color

Spec §5.1: *"Verde `synced` · ámbar `pending` o conflictos · gris desconectado · **rojo `memoria apagada en esta sesión`**"*, y el texto corto `142 items · synced`. La regla de prioridad es lo único que se puede equivocar, así que va en una función pura, separada del hook.

**Files:**
- Create: `src/lib/memories-status.ts`
- Create: `src/__tests__/memories-status.test.ts`

**Interfaces:**
- Consumes: nada.
- Produces:
  - `export type MemoriesDot = 'green' | 'amber' | 'red' | 'grey'`
  - `export interface MemoriesStatusInput { available: boolean; connected: boolean; itemCount: number; pendingCount: number; blockedTotal: number; vaultConflicts: number; silentSessions: number }`
  - `export interface MemoriesStatus { dot: MemoriesDot; text: string }`
  - `export function summarizeMemories(input: MemoriesStatusInput): MemoriesStatus`

- [ ] **Step 1: Escribir el test que falla**

Crear `src/__tests__/memories-status.test.ts`:

```ts
// Spec §5.1. El orden de prioridad es la decision de producto entera metida en una funcion:
// el fallo mudo (§2.2) gana sobre TODO lo demas, porque es el unico estado donde el usuario
// esta perdiendo trabajo sin saberlo.
import { describe, it, expect } from 'vitest'
import { summarizeMemories, type MemoriesStatusInput } from '../lib/memories-status'

const base: MemoriesStatusInput = {
  available: true, connected: true, itemCount: 142,
  pendingCount: 0, blockedTotal: 0, vaultConflicts: 0, silentSessions: 0,
}

describe('summarizeMemories', () => {
  it('todo en orden: verde, con el conteo', () => {
    expect(summarizeMemories(base)).toEqual({ dot: 'green', text: '142 items · synced' })
  })

  it('una sesion muda gana sobre todo lo demas', () => {
    const status = summarizeMemories({ ...base, silentSessions: 1, pendingCount: 5, blockedTotal: 9 })
    expect(status.dot).toBe('red')
    expect(status.text).toBe('1 session not writing')
  })

  it('pluraliza las sesiones mudas', () => {
    expect(summarizeMemories({ ...base, silentSessions: 3 }).text).toBe('3 sessions not writing')
  })

  it('mutaciones bloqueadas: ambar, y lo dice', () => {
    const status = summarizeMemories({ ...base, blockedTotal: 816 })
    expect(status).toEqual({ dot: 'amber', text: '816 blocked' })
  })

  it('conflictos del vault: ambar', () => {
    expect(summarizeMemories({ ...base, vaultConflicts: 2 })).toEqual({ dot: 'amber', text: '2 conflicts' })
  })

  it('bloqueadas gana sobre conflictos: es lo que no esta llegando a la nube', () => {
    expect(summarizeMemories({ ...base, blockedTotal: 3, vaultConflicts: 2 }).text).toBe('3 blocked')
  })

  it('pendientes normales: ambar, pero es transitorio', () => {
    expect(summarizeMemories({ ...base, pendingCount: 7 })).toEqual({ dot: 'amber', text: '7 pending' })
  })

  it('sin nube: gris y local only — no es un error, es un plan Free', () => {
    expect(summarizeMemories({ ...base, connected: false })).toEqual({ dot: 'grey', text: '142 items · local only' })
  })

  it('sin subsistema de memoria: gris y lo dice', () => {
    expect(summarizeMemories({ ...base, available: false })).toEqual({ dot: 'grey', text: 'unavailable' })
  })

  it('una sesion muda tambien gana estando sin nube', () => {
    expect(summarizeMemories({ ...base, connected: false, silentSessions: 1 }).dot).toBe('red')
  })
})
```

- [ ] **Step 2: Correr el test para verificar que falla**

Run: `npx vitest run src/__tests__/memories-status.test.ts`
Expected: FAIL con `Failed to resolve import "../lib/memories-status"`.

- [ ] **Step 3: Escribir el módulo**

Crear `src/lib/memories-status.ts`:

```ts
// Spec §5.1 — el punto de color de la fila Memories, y su texto corto.
//
// El orden de prioridad NO es arbitrario: un estado tapa al siguiente solo si le importa
// mas al usuario. `silent` va primero porque es el unico donde esta perdiendo trabajo sin
// enterarse (§2.2); `blocked` antes que `conflicts` porque es lo que no esta llegando a la
// nube; `disconnected` al final porque en un plan Free es lo normal, no una falla.

export type MemoriesDot = 'green' | 'amber' | 'red' | 'grey'

export interface MemoriesStatusInput {
  /** Hay subsistema de memoria (window.memory respondio). */
  available: boolean
  /** Hay nube: el device esta registrado contra el servicio de sync. */
  connected: boolean
  itemCount: number
  pendingCount: number
  blockedTotal: number
  vaultConflicts: number
  silentSessions: number
}

export interface MemoriesStatus {
  dot: MemoriesDot
  text: string
}

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`

export function summarizeMemories(input: MemoriesStatusInput): MemoriesStatus {
  if (!input.available) return { dot: 'grey', text: 'unavailable' }

  if (input.silentSessions > 0) {
    return { dot: 'red', text: `${plural(input.silentSessions, 'session', 'sessions')} not writing` }
  }
  if (input.blockedTotal > 0) return { dot: 'amber', text: `${input.blockedTotal} blocked` }
  if (input.vaultConflicts > 0) {
    return { dot: 'amber', text: plural(input.vaultConflicts, 'conflict', 'conflicts') }
  }
  if (input.pendingCount > 0) return { dot: 'amber', text: `${input.pendingCount} pending` }
  if (!input.connected) return { dot: 'grey', text: `${input.itemCount} items · local only` }

  return { dot: 'green', text: `${input.itemCount} items · synced` }
}
```

- [ ] **Step 4: Correr el test para verificar que pasa**

Run: `npx vitest run src/__tests__/memories-status.test.ts`
Expected: PASS los 10.

- [ ] **Step 5: Commit**

```bash
git add src/lib/memories-status.ts src/__tests__/memories-status.test.ts
git commit -m "feat(memories): el semaforo de la fila, con su orden de prioridad

Spec 5.1. Una sesion muda gana sobre todo: es el unico estado donde el usuario
pierde trabajo sin enterarse.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01FJpV3ahxg1zn55JS9sxByP"
```

---

### Task 6: El hook `useMemories`

Junta las tres lecturas nuevas con `memory:status`, las refresca, y devuelve el semáforo ya calculado. Un solo hook para la fila y para el overlay, así los dos muestran exactamente lo mismo.

**Files:**
- Create: `src/hooks/useMemories.ts`
- Create: `src/__tests__/hooks/useMemories.test.tsx`

**Interfaces:**
- Consumes: `summarizeMemories`, `MemoriesStatus` (Task 5) · `window.memory.status/sessions/doctor/vaultHealth` (Task 4).
- Produces:
  - `export interface SessionVerdictLite { paneId: string; aiType: string; account: string; health: 'writing' | 'silent' | 'disabled'; sessionId: string | null; startedAt: number }`
  - `export interface BlockedGroupLite { reason: string; count: number; oldestAt: number; reversible: boolean }`
  - `export interface VaultLite { enabled: boolean; rootDir: string; noteCount: number; conflictCount: number; lastGeneratedAt: number | null }`
  - `export interface MemoriesState { status: MemoriesStatus; itemCount: number; pendingCount: number; connected: boolean; sessions: SessionVerdictLite[]; silentSessions: SessionVerdictLite[]; blocked: BlockedGroupLite[]; blockedTotal: number; vault: VaultLite; refresh: () => Promise<void> }`
  - `export function useMemories(pollMs?: number): MemoriesState`

- [ ] **Step 1: Escribir el test que falla**

Crear `src/__tests__/hooks/useMemories.test.tsx`:

```tsx
// El hook tiene que sobrevivir a un preload viejo que no expone los metodos nuevos — mismo
// contrato que useMemory.ts ya respeta con setUser?/checkPendingAdoption? (ver el comentario
// de memoryApi() en src/hooks/useMemory.ts: montar sin la API tiraba el arbol entero abajo).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { useMemories } from '../../hooks/useMemories'

const setMemoryApi = (api: unknown): void => {
  ;(window as unknown as { memory?: unknown }).memory = api
}

describe('useMemories', () => {
  beforeEach(() => { vi.useRealTimers() })
  afterEach(() => { setMemoryApi(undefined) })

  it('sin window.memory devuelve unavailable y no rompe', async () => {
    setMemoryApi(undefined)
    const { result } = renderHook(() => useMemories(0))
    await waitFor(() => expect(result.current.status.dot).toBe('grey'))
    expect(result.current.status.text).toBe('unavailable')
  })

  it('junta status + sessions + doctor + vault en un solo semaforo', async () => {
    setMemoryApi({
      status: vi.fn().mockResolvedValue({
        connected: true, deviceId: 'd1', itemCount: 142, pendingCount: 0, daemonStatus: 'idle',
      }),
      sessions: vi.fn().mockResolvedValue({ ok: true, sessions: [], silentCount: 0 }),
      doctor: vi.fn().mockResolvedValue({ ok: true, blockedTotal: 0, groups: [] }),
      vaultHealth: vi.fn().mockResolvedValue({
        ok: true, enabled: true, rootDir: '/vault', noteCount: 866, conflictCount: 0, lastGeneratedAt: 1,
      }),
    })

    const { result } = renderHook(() => useMemories(0))

    await waitFor(() => expect(result.current.status.dot).toBe('green'))
    expect(result.current.status.text).toBe('142 items · synced')
    expect(result.current.vault.noteCount).toBe(866)
  })

  it('una sesion muda pone la fila en rojo y queda listada', async () => {
    setMemoryApi({
      status: vi.fn().mockResolvedValue({
        connected: true, deviceId: 'd1', itemCount: 10, pendingCount: 0, daemonStatus: 'idle',
      }),
      sessions: vi.fn().mockResolvedValue({
        ok: true,
        sessions: [{
          paneId: 'p1', aiType: 'claude', account: 'claude:Gero Personal',
          health: 'silent', sessionId: null, startedAt: 1,
        }],
        silentCount: 1,
      }),
      doctor: vi.fn().mockResolvedValue({ ok: true, blockedTotal: 0, groups: [] }),
      vaultHealth: vi.fn().mockResolvedValue({
        ok: true, enabled: false, rootDir: '', noteCount: 0, conflictCount: 0, lastGeneratedAt: null,
      }),
    })

    const { result } = renderHook(() => useMemories(0))

    await waitFor(() => expect(result.current.status.dot).toBe('red'))
    expect(result.current.silentSessions).toHaveLength(1)
    expect(result.current.silentSessions[0].paneId).toBe('p1')
  })

  it('un preload viejo sin los metodos nuevos sigue mostrando el conteo', async () => {
    setMemoryApi({
      status: vi.fn().mockResolvedValue({
        connected: true, deviceId: 'd1', itemCount: 5, pendingCount: 0, daemonStatus: 'idle',
      }),
    })

    const { result } = renderHook(() => useMemories(0))

    await waitFor(() => expect(result.current.itemCount).toBe(5))
    expect(result.current.status.dot).toBe('green')
    expect(result.current.blockedTotal).toBe(0)
  })
})
```

- [ ] **Step 2: Correr el test para verificar que falla**

Run: `npx vitest run src/__tests__/hooks/useMemories.test.tsx`
Expected: FAIL con `Failed to resolve import "../../hooks/useMemories"`.

- [ ] **Step 3: Escribir el hook**

Crear `src/hooks/useMemories.ts`:

```ts
// El unico origen de datos de la pantalla Memories y de su fila en la sidebar: los dos
// muestran lo mismo porque leen de aca.
//
// Todos los metodos nuevos son opcionales en window.memory (src/types.ts) — mismo contrato
// defensivo que useMemory.ts: un preload viejo no los expone y el arbol tiene que seguir
// montando igual, solo que sin esos datos.
import { useCallback, useEffect, useRef, useState } from 'react'
import { summarizeMemories, type MemoriesStatus } from '../lib/memories-status'

export interface SessionVerdictLite {
  paneId: string
  aiType: string
  account: string
  health: 'writing' | 'silent' | 'disabled'
  sessionId: string | null
  startedAt: number
}

export interface BlockedGroupLite {
  reason: string
  count: number
  oldestAt: number
  reversible: boolean
}

export interface VaultLite {
  enabled: boolean
  rootDir: string
  noteCount: number
  conflictCount: number
  lastGeneratedAt: number | null
}

export interface MemoriesState {
  status: MemoriesStatus
  itemCount: number
  pendingCount: number
  connected: boolean
  sessions: SessionVerdictLite[]
  silentSessions: SessionVerdictLite[]
  blocked: BlockedGroupLite[]
  blockedTotal: number
  vault: VaultLite
  refresh: () => Promise<void>
}

const EMPTY_VAULT: VaultLite = {
  enabled: false, rootDir: '', noteCount: 0, conflictCount: 0, lastGeneratedAt: null,
}

/** Cada cuanto se relee. El daemon empuja con debounce de 3s (spec §2.1), asi que 5s no
 *  pierde nada y no pone a la UI a interrogar la base sin parar. `0` desactiva el poll
 *  (los tests lo usan asi). */
const DEFAULT_POLL_MS = 5_000

export function useMemories(pollMs: number = DEFAULT_POLL_MS): MemoriesState {
  const [itemCount, setItemCount] = useState(0)
  const [pendingCount, setPendingCount] = useState(0)
  const [connected, setConnected] = useState(false)
  const [available, setAvailable] = useState(true)
  const [sessions, setSessions] = useState<SessionVerdictLite[]>([])
  const [blocked, setBlocked] = useState<BlockedGroupLite[]>([])
  const [blockedTotal, setBlockedTotal] = useState(0)
  const [vault, setVault] = useState<VaultLite>(EMPTY_VAULT)

  // Evita setState despues de desmontar: el overlay se cierra mientras las 4 promesas
  // todavia estan en vuelo.
  const alive = useRef(true)
  useEffect(() => {
    alive.current = true
    return () => { alive.current = false }
  }, [])

  const refresh = useCallback(async () => {
    const api = typeof window === 'undefined' ? undefined : window.memory
    if (!api) {
      if (alive.current) setAvailable(false)
      return
    }

    const [status, sess, doc, vh] = await Promise.all([
      api.status().catch(() => null),
      api.sessions?.().catch(() => null) ?? Promise.resolve(null),
      api.doctor?.().catch(() => null) ?? Promise.resolve(null),
      api.vaultHealth?.().catch(() => null) ?? Promise.resolve(null),
    ])
    if (!alive.current) return

    setAvailable(!!status)
    if (status) {
      setItemCount(status.itemCount)
      setPendingCount(status.pendingCount)
      setConnected(status.connected)
    }
    setSessions(sess?.ok ? sess.sessions : [])
    setBlocked(doc?.ok ? doc.groups : [])
    setBlockedTotal(doc?.ok ? doc.blockedTotal : 0)
    setVault(vh?.ok ? { enabled: vh.enabled, rootDir: vh.rootDir, noteCount: vh.noteCount, conflictCount: vh.conflictCount, lastGeneratedAt: vh.lastGeneratedAt } : EMPTY_VAULT)
  }, [])

  useEffect(() => {
    void refresh()
    if (pollMs <= 0) return
    const id = setInterval(() => { void refresh() }, pollMs)
    return () => clearInterval(id)
  }, [refresh, pollMs])

  const silentSessions = sessions.filter((s) => s.health === 'silent')

  const status = summarizeMemories({
    available,
    connected,
    itemCount,
    pendingCount,
    blockedTotal,
    vaultConflicts: vault.conflictCount,
    silentSessions: silentSessions.length,
  })

  return {
    status, itemCount, pendingCount, connected,
    sessions, silentSessions, blocked, blockedTotal, vault, refresh,
  }
}
```

- [ ] **Step 4: Correr el test para verificar que pasa**

Run: `npx vitest run src/__tests__/hooks/useMemories.test.tsx`
Expected: PASS los 4.

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useMemories.ts src/__tests__/hooks/useMemories.test.tsx
git commit -m "feat(memories): hook unico para la fila y la pantalla

Los dos leen del mismo lugar, asi que no pueden discrepar.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01FJpV3ahxg1zn55JS9sxByP"
```

---

### Task 7: La escala de z-index explícita

Spec §5.4: *"Con Memory como tercer overlay, el `1100` de `.teams-workspace--front` no alcanza. Escala explícita: 1000 base / 1100 front / 1200 lo que se abra encima. El test que hoy cubre el orden **modela el CSS a mano**, así que una regresión pasaría sin fallar — hay que mirarlo en la app real."*

Tarea chica y sola a propósito: es el cimiento de la Task 9 y un reviewer la puede aprobar o rechazar por sí misma.

**Files:**
- Modify: `src/styles/global.css` (bloque `TEAMS WORKSPACE`, líneas 5306-5327)

**Interfaces:**
- Consumes: nada.
- Produces: las custom properties `--z-overlay-base: 1000`, `--z-overlay-front: 1100`, `--z-overlay-top: 1200`, disponibles para la Task 9.

- [ ] **Step 1: Declarar la escala**

En `src/styles/global.css`, en el bloque `:root` que ya existe (el primero del archivo), agregar:

```css
  /* Escala de overlays a pantalla completa (spec 2026-09-09 §5.4). Explicita porque son
     tres y ya no alcanza con el orden de render: Personal queda montado debajo de Teams
     (cerrar Teams tiene que devolverte a Personal), y Memories se abre encima de los dos.
     Cualquier overlay nuevo elige uno de estos tres, nunca un numero suelto. */
  --z-overlay-base: 1000;
  --z-overlay-front: 1100;
  --z-overlay-top: 1200;
```

- [ ] **Step 2: Usarla en los dos overlays que ya existen**

Reemplazar `z-index: 1000;` en `.teams-workspace` (línea 5312) por:

```css
  z-index: var(--z-overlay-base);
```

Y `z-index: 1100;` en `.teams-workspace.teams-workspace--front` (línea 5325) por:

```css
  z-index: var(--z-overlay-front);
```

Dejar el comentario que ya está arriba de `--front` tal cual: sigue explicando por qué existe.

- [ ] **Step 3: Verificar que no hay regresión**

Run: `npm test`
Expected: verde. El test que cubre el orden modela el CSS a mano (spec §5.4), así que **no va a fallar aunque esto estuviera mal** — por eso el Step 4.

- [ ] **Step 4: Mirarlo en la app real**

```bash
npm run native:electron
npm run dev
```

Abrir Personal, y desde ahí "Open team workspace". El workspace de equipo tiene que quedar **encima** de Personal, no tapado. Es exactamente el CRITICAL que la review de rama encontró en `feat/sidebar-tabs` (memoria `sidebar-tabs-worktree-wip`), y el único chequeo que sirve acá.

- [ ] **Step 5: Commit**

```bash
git add src/styles/global.css
git commit -m "refactor(memories): escala de z-index explicita para los overlays

Spec 5.4: 1000 base / 1100 front / 1200 encima. Memories es el tercero y el
orden de render ya no alcanza.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01FJpV3ahxg1zn55JS9sxByP"
```

---

### Task 8: La fila Memories en la sidebar

Spec §4.1 y §4.2 y §5.1: hermana de `Personal`, justo debajo, mismo patrón visual (`sidebar-item sidebar-item-panel`). Colapsada: ícono + punto de color. Expandida: además el texto corto. Click abre el overlay.

**Nota de plan**: a diferencia de `PersonalItem`, la fila de Memories **no** manda a `onUpgrade` en plan Free. La memoria local es de todos los planes (spec §8.1: `runLocalMemoryImport` se sacó del handler de connect justo para que un usuario Free también importe), y esconderla detrás del paywall contradice el "local-first es la mitad de por qué esto le gana a lo hosteado" de §4.6.

**Files:**
- Create: `src/components/MemoriesItem.tsx`
- Create: `src/__tests__/components/MemoriesItem.test.tsx`
- Modify: `src/components/Sidebar.tsx` (prop `onMemoriesOpen?` junto a `onPersonalOpen?` en la línea 51, desestructurada en la 98; render después de `{PersonalItem}` en la línea 849)
- Modify: `src/App.tsx` (estado `memoriesOpen`, y `onMemoriesOpen` en el `<Sidebar>` de la línea ~1825)
- Modify: `src/styles/global.css` (`.memories-dot`)

**Interfaces:**
- Consumes: `useMemories` (Task 6) · `MemoriesDot` (Task 5).
- Produces: `export default function MemoriesItem({ expanded, onOpen }: { expanded: boolean; onOpen: () => void }): JSX.Element`

- [ ] **Step 1: Escribir el test que falla**

Crear `src/__tests__/components/MemoriesItem.test.tsx`:

```tsx
// Spec §4.2: "Cero clicks para el estado, un click para todo lo demas."
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import MemoriesItem from '../../components/MemoriesItem'

const setMemoryApi = (api: unknown): void => {
  ;(window as unknown as { memory?: unknown }).memory = api
}

const api = (over: Record<string, unknown> = {}) => ({
  status: vi.fn().mockResolvedValue({
    connected: true, deviceId: 'd1', itemCount: 142, pendingCount: 0, daemonStatus: 'idle',
  }),
  sessions: vi.fn().mockResolvedValue({ ok: true, sessions: [], silentCount: 0 }),
  doctor: vi.fn().mockResolvedValue({ ok: true, blockedTotal: 0, groups: [] }),
  vaultHealth: vi.fn().mockResolvedValue({
    ok: true, enabled: false, rootDir: '', noteCount: 0, conflictCount: 0, lastGeneratedAt: null,
  }),
  ...over,
})

afterEach(() => { setMemoryApi(undefined) })

describe('MemoriesItem', () => {
  it('expandida muestra el nombre y el texto corto de estado', async () => {
    setMemoryApi(api())
    render(<MemoriesItem expanded onOpen={() => {}} />)

    expect(screen.getByText('Memories')).toBeInTheDocument()
    await waitFor(() => expect(screen.getByText('142 items · synced')).toBeInTheDocument())
  })

  it('colapsada no muestra texto, pero el punto sigue estando', async () => {
    setMemoryApi(api())
    render(<MemoriesItem expanded={false} onOpen={() => {}} />)

    await waitFor(() => expect(screen.getByTestId('memories-dot')).toBeInTheDocument())
    expect(screen.queryByText('142 items · synced')).not.toBeInTheDocument()
  })

  it('una sesion muda pinta el punto de rojo y lo dice en el title', async () => {
    setMemoryApi(api({
      sessions: vi.fn().mockResolvedValue({
        ok: true,
        sessions: [{
          paneId: 'p1', aiType: 'claude', account: 'claude:Gero Personal',
          health: 'silent', sessionId: null, startedAt: 1,
        }],
        silentCount: 1,
      }),
    }))
    render(<MemoriesItem expanded onOpen={() => {}} />)

    await waitFor(() => {
      expect(screen.getByTestId('memories-dot')).toHaveAttribute('data-dot', 'red')
    })
    expect(screen.getByTitle('Memories — 1 session not writing')).toBeInTheDocument()
  })

  it('un click abre la pantalla', async () => {
    setMemoryApi(api())
    const onOpen = vi.fn()
    render(<MemoriesItem expanded onOpen={onOpen} />)

    await userEvent.click(screen.getByText('Memories'))

    expect(onOpen).toHaveBeenCalledTimes(1)
  })

  it('sin window.memory se sigue renderizando, en gris', async () => {
    setMemoryApi(undefined)
    render(<MemoriesItem expanded onOpen={() => {}} />)

    await waitFor(() => expect(screen.getByTestId('memories-dot')).toHaveAttribute('data-dot', 'grey'))
    expect(screen.getByText('Memories')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Correr el test para verificar que falla**

Run: `npx vitest run src/__tests__/components/MemoriesItem.test.tsx`
Expected: FAIL con `Failed to resolve import "../../components/MemoriesItem"`.

- [ ] **Step 3: Escribir el componente**

Crear `src/components/MemoriesItem.tsx`:

```tsx
// Spec §4.1/§4.2/§5.1 — la fila hermana de Personal. La "mini vista" pedida es la fila
// misma: el estado se lee sin abrir nada.
//
// A diferencia de PersonalItem, esta fila NO manda a onUpgrade en plan Free: la memoria
// local es de todos los planes (§8.1), y esconderla detras del paywall contradice el
// local-first de §4.6.
import { useMemories } from '../hooks/useMemories'

interface Props {
  expanded: boolean
  onOpen: () => void
}

export default function MemoriesItem({ expanded, onOpen }: Props) {
  const { status } = useMemories()

  return (
    <div
      className="sidebar-item sidebar-item-panel sidebar-item-team"
      style={{ cursor: 'pointer', position: 'relative' }}
      onClick={onOpen}
      title={`Memories — ${status.text}`}
    >
      <span className="sidebar-icon" style={{ position: 'relative' }}>
        {/* Nodo con dos aristas: el grafo, que es lo que hay del otro lado. */}
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
          <circle cx="8" cy="4" r="2" stroke="currentColor" strokeWidth="1.3" />
          <circle cx="3.5" cy="12" r="2" stroke="currentColor" strokeWidth="1.3" />
          <circle cx="12.5" cy="12" r="2" stroke="currentColor" strokeWidth="1.3" />
          <path d="M6.7 5.7 4.8 10.2M9.3 5.7l1.9 4.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
        </svg>
        <span
          data-testid="memories-dot"
          data-dot={status.dot}
          className="memories-dot"
          aria-label={status.text}
        />
      </span>
      <span className="sidebar-label">Memories</span>
      {expanded && <span className="memories-status-text">{status.text}</span>}
    </div>
  )
}
```

- [ ] **Step 4: Los estilos**

En `src/styles/global.css`, al final del bloque de la sidebar:

```css
/* Spec §5.1 — el punto de estado de la fila Memories. Vive sobre el icono para que la
   sidebar colapsada siga diciendo el estado sin una sola palabra. */
.memories-dot {
  position: absolute;
  bottom: -1px;
  right: -3px;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  box-shadow: 0 0 0 1.5px var(--bg-primary, #0a0a0a);
}
.memories-dot[data-dot='green'] { background: #22C55E; }
.memories-dot[data-dot='amber'] { background: #F59E0B; }
.memories-dot[data-dot='red']   { background: #EF4444; }
.memories-dot[data-dot='grey']  { background: #6B7280; }

.memories-status-text {
  margin-left: auto;
  font-size: 10px;
  opacity: .6;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 96px;
}
```

- [ ] **Step 5: Correr el test para verificar que pasa**

Run: `npx vitest run src/__tests__/components/MemoriesItem.test.tsx`
Expected: PASS los 5.

- [ ] **Step 6: Cablear la fila en la sidebar**

En `src/components/Sidebar.tsx`:

1. Import: `import MemoriesItem from './MemoriesItem'`
2. Prop, junto a `onPersonalOpen?` (línea 51):

```ts
  /** Spec §4.1: Memories es hermana de Personal, no una seccion adentro ni una 4a pestana. */
  onMemoriesOpen?: () => void
```

3. Agregar `onMemoriesOpen` a la desestructuración de la línea 98.
4. Render, inmediatamente después de `{PersonalItem}` (línea 849) y antes del `<UserMenu>`:

```tsx
      {/* Memories — hermana de Personal (spec §4.1). Fuera del scroll y de las pestanas
          por la misma razon que Personal: las 3 pestanas son del repo abierto, y esto es
          de la cuenta. */}
      {onMemoriesOpen && <MemoriesItem expanded={expanded} onOpen={onMemoriesOpen} />}
```

En `src/App.tsx`:

5. Estado, junto a `personalOpen` (línea 255):

```ts
  const [memoriesOpen, setMemoriesOpen] = useState(false)
```

6. Prop en el `<Sidebar>`, después del bloque `onPersonalOpen`:

```tsx
        onMemoriesOpen={() => setMemoriesOpen(true)}
```

- [ ] **Step 7: Suite completa**

Run: `npm test`
Expected: verde. Ojo con `src/__tests__/components/App.personal-section.test.tsx`, que monta el árbol con la sidebar: si falla por `window.memory` ausente, el bug es del hook (tiene que degradar a gris), no del test — arreglar el hook.

- [ ] **Step 8: Commit**

```bash
git add src/components/MemoriesItem.tsx src/__tests__/components/MemoriesItem.test.tsx src/components/Sidebar.tsx src/App.tsx src/styles/global.css
git commit -m "feat(memories): la fila Memories en la sidebar, con estado inline

Spec 4.1/4.2/5.1: hermana de Personal, punto de color colapsada y texto corto
expandida. Cero clicks para el estado.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01FJpV3ahxg1zn55JS9sxByP"
```

---

### Task 9: El overlay — fila de estado arriba, grafo al centro

Spec §4.4 y §5.2, dirección C: *"el hilo es la pantalla"*. Reusa lo que ya existe (`TeamThreadPanel`, que a su vez monta `TeamThreadGraph`, y `MemoryVaultCard`) mudándolo fuera de Settings. **Sin chips de scope** (§4.3): esta pantalla nunca llama a `switchTeam`.

**Files:**
- Create: `src/components/MemoriesStatusRow.tsx`
- Create: `src/components/MemoriesWorkspace.tsx`
- Create: `src/__tests__/components/MemoriesWorkspace.test.tsx`
- Modify: `src/App.tsx` (montar el overlay junto a los otros, línea ~2107)
- Modify: `src/styles/global.css` (`.memories-workspace`)

**Interfaces:**
- Consumes: `useMemories` (Task 6) · `TeamThreadPanel` (`{ activeRepoPath, onOpenFile }`) · `MemoryVaultCard` (sin props) · `--z-overlay-top` (Task 7).
- Produces:
  - `export default function MemoriesStatusRow(props: { state: MemoriesState }): JSX.Element`
  - `export default function MemoriesWorkspace(props: { onClose: () => void; activeRepoPath: string | null; onOpenFile: (relPath: string) => void }): JSX.Element`

- [ ] **Step 1: Escribir el test que falla**

Crear `src/__tests__/components/MemoriesWorkspace.test.tsx`:

```tsx
// Spec §5.2: fila de estado arriba, grafo al centro, sin chips de scope.
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import MemoriesWorkspace from '../../components/MemoriesWorkspace'

const setMemoryApi = (api: unknown): void => {
  ;(window as unknown as { memory?: unknown }).memory = api
}

const api = (over: Record<string, unknown> = {}) => ({
  status: vi.fn().mockResolvedValue({
    connected: true, deviceId: 'd1', itemCount: 142, pendingCount: 0, daemonStatus: 'idle',
  }),
  sessions: vi.fn().mockResolvedValue({ ok: true, sessions: [], silentCount: 0 }),
  doctor: vi.fn().mockResolvedValue({ ok: true, blockedTotal: 0, groups: [] }),
  vaultHealth: vi.fn().mockResolvedValue({
    ok: true, enabled: true, rootDir: '/vault', noteCount: 866, conflictCount: 0, lastGeneratedAt: 1_757_000_000_000,
  }),
  vaultGetSettings: vi.fn().mockResolvedValue({ ok: false, error: 'memory_unavailable' }),
  teamThreadProjectKeyForWorktree: vi.fn().mockResolvedValue({ ok: false }),
  ...over,
})

afterEach(() => { setMemoryApi(undefined) })

const renderWorkspace = (props: Partial<React.ComponentProps<typeof MemoriesWorkspace>> = {}) =>
  render(
    <MemoriesWorkspace
      onClose={props.onClose ?? (() => {})}
      activeRepoPath={props.activeRepoPath ?? null}
      onOpenFile={props.onOpenFile ?? (() => {})}
    />
  )

describe('MemoriesWorkspace', () => {
  it('muestra el conteo, la nube y el vault en la fila de estado', async () => {
    setMemoryApi(api())
    renderWorkspace()

    await waitFor(() => expect(screen.getByText('142 items · synced')).toBeInTheDocument())
    expect(screen.getByText('866 notes')).toBeInTheDocument()
  })

  it('NO renderiza chips de scope — decision 3 de la spec', async () => {
    setMemoryApi(api())
    renderWorkspace()

    await waitFor(() => expect(screen.getByText('142 items · synced')).toBeInTheDocument())
    expect(screen.queryByTestId('scope-selector')).not.toBeInTheDocument()
  })

  it('lista lo bloqueado con su razon — el caso "importe 866, subi 50"', async () => {
    setMemoryApi(api({
      doctor: vi.fn().mockResolvedValue({
        ok: true,
        blockedTotal: 816,
        groups: [{ reason: 'quota_exceeded', count: 816, oldestAt: 1, reversible: true }],
      }),
    }))
    renderWorkspace()

    await waitFor(() => expect(screen.getByText(/816/)).toBeInTheDocument())
    expect(screen.getByText(/quota_exceeded/)).toBeInTheDocument()
    expect(screen.getByText(/waiting/i)).toBeInTheDocument()
  })

  it('nombra la sesion muda: pane y CLI, no un numero suelto', async () => {
    setMemoryApi(api({
      sessions: vi.fn().mockResolvedValue({
        ok: true,
        sessions: [{
          paneId: 'pane-7', aiType: 'claude', account: 'claude:Gero Personal',
          health: 'silent', sessionId: null, startedAt: 1,
        }],
        silentCount: 1,
      }),
    }))
    renderWorkspace()

    await waitFor(() => expect(screen.getByText(/not writing to memory/i)).toBeInTheDocument())
    expect(screen.getByText(/claude/)).toBeInTheDocument()
  })

  it('sin repo abierto explica por que no hay grafo, en vez de quedar en blanco', async () => {
    setMemoryApi(api())
    renderWorkspace({ activeRepoPath: null })

    await waitFor(() => expect(screen.getByText(/open a repo/i)).toBeInTheDocument())
  })

  it('el boton de cerrar cierra', async () => {
    setMemoryApi(api())
    const onClose = vi.fn()
    renderWorkspace({ onClose })

    await userEvent.click(screen.getByRole('button', { name: /close/i }))

    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
```

- [ ] **Step 2: Correr el test para verificar que falla**

Run: `npx vitest run src/__tests__/components/MemoriesWorkspace.test.tsx`
Expected: FAIL con `Failed to resolve import "../../components/MemoriesWorkspace"`.

- [ ] **Step 3: Escribir la fila de estado**

Crear `src/components/MemoriesStatusRow.tsx`:

```tsx
// Spec §5.2 — "el sync y el vault se corren a una fila de estado chiquita arriba, porque son
// cosas que se tocan una vez". Y §4.5: los conflictos y lo bloqueado van ACA, no escondidos
// en una carpeta.
import type { MemoriesState } from '../hooks/useMemories'

interface Props {
  state: MemoriesState
}

function ago(at: number | null): string {
  if (!at) return 'never'
  const mins = Math.round((Date.now() - at) / 60_000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  return `${Math.round(mins / 60)}h ago`
}

export default function MemoriesStatusRow({ state }: Props) {
  const { status, vault, blocked, blockedTotal, silentSessions } = state

  return (
    <div className="memories-status-row">
      <div className="memories-status-cell">
        <span className="memories-dot" data-dot={status.dot} data-testid="memories-dot" />
        <span>{status.text}</span>
      </div>

      <div className="memories-status-cell">
        <span>{vault.noteCount} notes</span>
        {vault.enabled && <span className="memories-muted">vault {ago(vault.lastGeneratedAt)}</span>}
      </div>

      {vault.conflictCount > 0 && (
        <div className="memories-status-cell memories-warn">
          {vault.conflictCount} conflict{vault.conflictCount === 1 ? '' : 's'} kept in _conflicts/
        </div>
      )}

      {/* Spec §7.1 — "if sync is blocked, fail loudly and visibly. No silent drops." */}
      {blockedTotal > 0 && (
        <div className="memories-status-cell memories-warn">
          <span>{blockedTotal} blocked</span>
          {blocked.map((g) => (
            <span key={g.reason} className="memories-muted">
              {g.count} · {g.reason} · {g.reversible ? 'waiting, will retry' : 'terminal'}
            </span>
          ))}
        </div>
      )}

      {/* Spec §2.2 — el unico fallo hoy invisible. Se nombra el pane y la CLI: un contador
          suelto no le dice al usuario cual de sus terminales apagar y volver a abrir. */}
      {silentSessions.length > 0 && (
        <div className="memories-status-cell memories-danger">
          <span>
            {silentSessions.length} terminal{silentSessions.length === 1 ? '' : 's'} not writing to memory
          </span>
          {silentSessions.map((s) => (
            <span key={s.paneId} className="memories-muted">{s.aiType} · {s.paneId}</span>
          ))}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 4: Escribir el overlay**

Crear `src/components/MemoriesWorkspace.tsx`:

```tsx
// Spec §4.4 (direccion C, "el hilo es la pantalla") y §5.2. Reusa `teams-workspace` como
// cascara visual — es la misma forma de overlay a pantalla completa que Personal y Teams —
// y suma `.memories-workspace` para el z-index de arriba de todo (§5.4).
//
// SIN chips de scope (decision 3): el grafo ya dibuja las ramas con autor y fecha, asi que
// "tuyo vs del equipo" se ve por color. Ademas evita heredar el acoplamiento de
// PersonalWorkspace.tsx:306, donde elegir un equipo llama a switchTeam y cambia chat,
// presencia y stats de TODA la app.
import { useMemories } from '../hooks/useMemories'
import MemoriesStatusRow from './MemoriesStatusRow'
import MemoryVaultCard from './MemoryVaultCard'
import TeamThreadPanel from './TeamThreadPanel'

interface Props {
  onClose: () => void
  activeRepoPath: string | null
  onOpenFile: (relPath: string) => void
}

export default function MemoriesWorkspace({ onClose, activeRepoPath, onOpenFile }: Props) {
  const state = useMemories()

  return (
    <div className="teams-workspace memories-workspace">
      <div className="teams-workspace-header">
        <span className="teams-workspace-title">Memories</span>
        <button className="teams-workspace-close" onClick={onClose} aria-label="Close">×</button>
      </div>

      <MemoriesStatusRow state={state} />

      <div className="teams-workspace-body memories-body">
        {activeRepoPath ? (
          // El grafo es SIEMPRE por proyecto, nunca global: con 866 notas en 9 proyectos un
          // grafo global se degrada mucho antes de los 200 nodos que aguanta (§5.2).
          <TeamThreadPanel activeRepoPath={activeRepoPath} onOpenFile={onOpenFile} />
        ) : (
          <p className="memories-empty">
            Open a repo to see its memory graph. Memories are captured per project.
          </p>
        )}

        <MemoryVaultCard />
      </div>
    </div>
  )
}
```

- [ ] **Step 5: Los estilos**

En `src/styles/global.css`, después del bloque `TEAMS WORKSPACE`:

```css
/* Spec §5.4 — Memories es el tercer overlay y se abre encima de Personal y de Teams. */
.memories-workspace { z-index: var(--z-overlay-top); }

.memories-status-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 20px;
  align-items: center;
  padding: 8px 16px;
  border-bottom: 1px solid var(--border);
  font-size: 12px;
}
.memories-status-cell { display: flex; align-items: center; gap: 8px; }
.memories-status-cell .memories-dot { position: static; box-shadow: none; }
.memories-muted { opacity: .6; }
.memories-warn { color: #F59E0B; }
.memories-danger { color: #EF4444; }
.memories-body { flex-direction: column; gap: 16px; padding: 16px; overflow-y: auto; }
.memories-empty { opacity: .6; font-size: 13px; }
```

- [ ] **Step 6: Correr el test para verificar que pasa**

Run: `npx vitest run src/__tests__/components/MemoriesWorkspace.test.tsx`
Expected: PASS los 6.

- [ ] **Step 7: Montar el overlay en `App.tsx`**

Import junto a los otros componentes (línea ~54):

```tsx
import MemoriesWorkspace from './components/MemoriesWorkspace'
```

Y el render, inmediatamente después del bloque `{personalOpen && (<PersonalWorkspace ... />)}` (termina en la línea ~2122):

```tsx
      {memoriesOpen && (
        <MemoriesWorkspace
          onClose={() => setMemoriesOpen(false)}
          activeRepoPath={activeCellRepoPath ?? null}
          onOpenFile={openFileInEditor}
        />
      )}
```

> `openFileInEditor` es el mismo callback que Settings ya le pasa a `TeamThreadPanel` vía `onFileOpen`. Si en `App.tsx` tiene otro nombre, usar ese — es el que abre un archivo en el editor.

- [ ] **Step 8: Suite completa y typecheck**

```bash
npm test
git add src/components/MemoriesStatusRow.tsx src/components/MemoriesWorkspace.tsx src/__tests__/components/MemoriesWorkspace.test.tsx
npx tsc -b
git clean -fd
```
Expected: suite verde, `tsc -b` sin errores nuevos.

- [ ] **Step 9: Commit**

```bash
git add src/App.tsx src/styles/global.css
git commit -m "feat(memories): el overlay Memories — fila de estado y grafo por proyecto

Spec 4.4/5.2, direccion C. Sin chips de scope: no hereda el switchTeam de
PersonalWorkspace.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01FJpV3ahxg1zn55JS9sxByP"
```

---

### Task 10: Sacar la memoria de Settings

Spec §4 y §10: *"Mudanza de `MemoryHub`, `MemoryVaultCard`, `TeamThreadPanel` y `TeamThreadGraph` fuera de Settings."* La queja que arrancó todo esto fue mirando ese panel: *"siento que queda feo así"*.

`MemoryHub` **no** se muda: es el onboarding de primera corrida (`App.tsx:2089`, gobernado por `settings.hasSeenMemoryHub`), no una tarjeta de Settings. Se queda donde está.

**Files:**
- Modify: `src/components/SettingsPanel.tsx` (sacar `MemoryVaultCard` de la línea 580 y `TeamThreadPanel` de la 583, más sus imports de las líneas 22-23; poner un botón)
- Modify: `src/__tests__/hooks/useSettings.test.tsx` si afirma que esas tarjetas están montadas

**Interfaces:**
- Consumes: `onOpenMemories` nueva prop de `SettingsPanel`, provista por `App.tsx` con el mismo `setMemoriesOpen(true)` de la Task 8.
- Produces: nada nuevo.

- [ ] **Step 1: Ver qué tests dependen de las tarjetas en Settings**

Run: `npx vitest run src/__tests__/hooks/useSettings.test.tsx src/__tests__/components/MemoryVaultCard.test.tsx src/__tests__/components/TeamThreadPanel.test.tsx`
Expected: PASS (estado actual). Anotar cuáles montan `SettingsPanel` esperando ver las tarjetas: esos son los que hay que actualizar, y los que montan el componente directo (`MemoryVaultCard.test.tsx`, `TeamThreadPanel.test.tsx`) **no se tocan** — esos componentes siguen existiendo, sólo cambian de padre.

- [ ] **Step 2: Reemplazar las tarjetas por la puerta**

En `src/components/SettingsPanel.tsx`, borrar los imports de las líneas 22-23 y reemplazar el bloque de las líneas 580-583 por:

```tsx
                  {/* Spec 2026-09-09 §4: la memoria dejo de vivir en Settings. Queda la
                      puerta para que quien la busque aca la encuentre. */}
                  <button
                    className="settings-link-button"
                    onClick={onOpenMemories}
                  >
                    Open Memories
                  </button>
```

Agregar la prop al `interface Props` de `SettingsPanel`:

```ts
  /** Spec §4: abre el overlay de Memories. Settings ya no monta las tarjetas de memoria. */
  onOpenMemories: () => void
```

Y pasarla desde donde `App.tsx`/`Sidebar.tsx` monta `<SettingsPanel>`:

```tsx
                onOpenMemories={() => setMemoriesOpen(true)}
```

> `SettingsPanel` se monta dentro de `Sidebar.tsx` (bloque `.sidebar-item-settings`). Si la prop tiene que atravesar `Sidebar`, enhebrarla igual que `onPersonalOpen`: prop opcional en `SidebarProps`, provista por `App.tsx`.

- [ ] **Step 3: Correr los tests y arreglar los que asumían las tarjetas**

Run: `npm test`
Expected: si algún test monta `SettingsPanel` y busca la tarjeta del vault o el panel del hilo, actualizarlo para que espere el botón "Open Memories". **No** borrar la aserción: cambiarla, así sigue cubriendo que la puerta existe.

- [ ] **Step 4: Verificación manual en la app real**

Es el riesgo #1 de la spec §11: *"el código del rediseño nunca corrió en la app real — sólo en jsdom"*.

```bash
npm run native:electron
npm run dev
```

Mirar, en este orden:
1. La fila `Memories` aparece debajo de `Personal` y encima del usuario, en los dos modos (expandida y colapsada) y en las dos sidebars (repo y Hub).
2. El punto de color se ve colapsada.
3. Un click abre el overlay, y el overlay queda **encima** de Personal si Personal estaba abierto.
4. Con un repo abierto, el grafo se dibuja.
5. Settings ya no muestra las tarjetas de memoria y el botón "Open Memories" abre lo mismo.
6. **El caso del §2.2**: abrir una terminal con `claude`, esperar >15s, y confirmar que si esa sesión no llegó al bridge la fila se pone roja y el overlay nombra el pane.

- [ ] **Step 5: Commit**

```bash
git add src/components/SettingsPanel.tsx src/components/Sidebar.tsx src/App.tsx src/__tests__
git commit -m "refactor(memories): sacar las tarjetas de memoria de Settings

Spec 4/10. Queda un boton 'Open Memories' para quien la busque ahi. MemoryHub no
se muda: es el onboarding de primera corrida, no una tarjeta de Settings.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01FJpV3ahxg1zn55JS9sxByP"
```

---

### Task 11: La pantalla de compartir un proyecto con el equipo

Agregada el 2026-09-09 por la respuesta de Bauti a D6: *"entra en la fase 1, con lo demás"*. El endpoint (`POST /v1/projects/share`) y el IPC (`memory:shareProjectWithTeam`, `main.ts:3070`) existen y andan desde Layer 1; **nadie los llama desde la UI**. Sin esta pantalla, el caso "plan Teams, proyecto sin compartir" retiene memorias en silencio, que es el mismo pecado del §2.2.

**Files:**
- Create: `src/components/ShareProjectCard.tsx`
- Create: `src/__tests__/components/ShareProjectCard.test.tsx`
- Modify: `src/components/MemoriesWorkspace.tsx` (montar la tarjeta debajo del grafo)

**Interfaces:**
- Consumes: `useTeam()` de `src/hooks/useTeam.ts` (**sólo el campo `teams: Team[]`**) · `window.memory.shareProjectWithTeam?(projectKey, teamId)` · `window.memory.teamThreadProjectKeyForWorktree?(worktreePath)`.
- Produces: `export default function ShareProjectCard({ activeRepoPath }: { activeRepoPath: string | null }): JSX.Element | null`

⚠️ **Regla de esta tarea**: se lee `teams` de `useTeam()` y **NUNCA** se llama a `switchTeam`. Elegir un equipo acá es elegir un destino para compartir, no cambiar el equipo activo de la app. Es la decisión 3 de la spec, y el acoplamiento que se evita está en `PersonalWorkspace.tsx:306`.

- [ ] **Step 1: Escribir el test que falla**

Crear `src/__tests__/components/ShareProjectCard.test.tsx`:

```tsx
// Spec §4 (D6 de las respuestas de Bauti). El endpoint existe desde Layer 1 y nunca tuvo UI:
// sin esto, un equipo que paga por memoria compartida no comparte nada y no puede notarlo.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ShareProjectCard from '../../components/ShareProjectCard'

// El mock lee una variable mutable para poder probar tambien el caso "sin equipos":
// vi.mock se hoistea, asi que la lista no puede ser un valor fijo por test.
const state = { teams: [{ id: 't1', name: 'Nest' }, { id: 't2', name: 'STI-PROJECTS' }] }

vi.mock('../../hooks/useTeam', () => ({
  useTeam: () => ({ teams: state.teams }),
}))

beforeEach(() => {
  state.teams = [{ id: 't1', name: 'Nest' }, { id: 't2', name: 'STI-PROJECTS' }]
})

const setMemoryApi = (api: unknown): void => {
  ;(window as unknown as { memory?: unknown }).memory = api
}

const api = (over: Record<string, unknown> = {}) => ({
  teamThreadProjectKeyForWorktree: vi.fn().mockResolvedValue({ ok: true, projectKey: 'abc123' }),
  shareProjectWithTeam: vi.fn().mockResolvedValue({ ok: true }),
  ...over,
})

afterEach(() => { setMemoryApi(undefined) })

describe('ShareProjectCard', () => {
  it('sin repo abierto no se muestra: no hay proyecto que compartir', () => {
    setMemoryApi(api())
    const { container } = render(<ShareProjectCard activeRepoPath={null} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('lista los equipos del usuario como destino', async () => {
    setMemoryApi(api())
    render(<ShareProjectCard activeRepoPath="/repo" />)

    await waitFor(() => expect(screen.getByRole('combobox')).toBeInTheDocument())
    expect(screen.getByRole('option', { name: 'Nest' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'STI-PROJECTS' })).toBeInTheDocument()
  })

  it('comparte con el equipo elegido, no con el primero de la lista', async () => {
    const memoryApi = api()
    setMemoryApi(memoryApi)
    render(<ShareProjectCard activeRepoPath="/repo" />)

    await waitFor(() => expect(screen.getByRole('combobox')).toBeInTheDocument())
    await userEvent.selectOptions(screen.getByRole('combobox'), 't2')
    await userEvent.click(screen.getByRole('button', { name: /share/i }))

    await waitFor(() => {
      expect(memoryApi.shareProjectWithTeam).toHaveBeenCalledWith('abc123', 't2')
    })
    expect(await screen.findByText(/shared with STI-PROJECTS/i)).toBeInTheDocument()
  })

  it('un fallo del servidor se muestra, no se traga', async () => {
    setMemoryApi(api({
      shareProjectWithTeam: vi.fn().mockResolvedValue({ ok: false, error: 'plan_required' }),
    }))
    render(<ShareProjectCard activeRepoPath="/repo" />)

    await waitFor(() => expect(screen.getByRole('combobox')).toBeInTheDocument())
    await userEvent.click(screen.getByRole('button', { name: /share/i }))

    expect(await screen.findByText(/plan_required/)).toBeInTheDocument()
  })

  it('sin equipos explica por que, en vez de dejar un selector vacio', async () => {
    state.teams = []
    setMemoryApi(api())
    render(<ShareProjectCard activeRepoPath="/repo" />)

    expect(await screen.findByText(/not in a team yet/i)).toBeInTheDocument()
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Correr el test para verificar que falla**

Run: `npx vitest run src/__tests__/components/ShareProjectCard.test.tsx`
Expected: FAIL con `Failed to resolve import "../../components/ShareProjectCard"`.

- [ ] **Step 3: Escribir el componente**

Crear `src/components/ShareProjectCard.tsx`:

```tsx
// D6 de las respuestas de Bauti (2026-09-09): el endpoint POST /v1/projects/share existe desde
// Layer 1 y nunca tuvo UI. Sin ella, `scope: 'team'` se retiene en silencio del lado del servidor
// con `project_not_shared_with_team`, que es reversible: se destraba compartiendo el proyecto.
//
// ⚠️ Lee `teams` de useTeam() y NUNCA llama a switchTeam. Elegir un equipo aca es elegir un
// destino, no cambiar el equipo activo de la app (decision 3 de la spec).
import { useEffect, useState } from 'react'
import { useTeam } from '../hooks/useTeam'

interface Props {
  activeRepoPath: string | null
}

export default function ShareProjectCard({ activeRepoPath }: Props) {
  const { teams } = useTeam()
  const [projectKey, setProjectKey] = useState<string | null>(null)
  const [teamId, setTeamId] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null)

  useEffect(() => {
    if (!activeRepoPath) { setProjectKey(null); return }
    let alive = true
    window.memory?.teamThreadProjectKeyForWorktree?.(activeRepoPath)
      .then((res) => { if (alive) setProjectKey(res?.ok ? res.projectKey ?? null : null) })
      .catch(() => { if (alive) setProjectKey(null) })
    return () => { alive = false }
  }, [activeRepoPath])

  useEffect(() => {
    if (!teamId && teams.length > 0) setTeamId(teams[0].id)
  }, [teams, teamId])

  // Sin repo abierto no hay proyecto que compartir. Self-contained como MemoryVaultCard:
  // no se inventa un estado vacio.
  if (!activeRepoPath) return null

  const share = async (): Promise<void> => {
    if (!projectKey || !teamId) return
    setBusy(true)
    setResult(null)
    try {
      const res = await window.memory?.shareProjectWithTeam?.(projectKey, teamId)
      const team = teams.find((t) => t.id === teamId)
      if (res?.ok) {
        setResult({ ok: true, text: `Shared with ${team?.name ?? 'the team'}. Team memories will sync from now on.` })
      } else {
        setResult({ ok: false, text: `Couldn't share this project: ${res?.error ?? 'unknown error'}` })
      }
    } catch (err) {
      setResult({ ok: false, text: `Couldn't share this project: ${err instanceof Error ? err.message : String(err)}` })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="memories-share">
      <h4>Share this project with a team</h4>
      {teams.length === 0 ? (
        <p className="memories-muted">
          You are not in a team yet. Team memories need one.
        </p>
      ) : (
        <>
          <div className="memories-share-row">
            <select
              aria-label="Team"
              value={teamId}
              onChange={(e) => setTeamId(e.target.value)}
              disabled={busy}
            >
              {teams.map((t) => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
            <button onClick={share} disabled={busy || !projectKey}>
              {busy ? 'Sharing...' : 'Share'}
            </button>
          </div>
          {result && (
            <p className={result.ok ? 'memories-ok' : 'memories-warn'}>{result.text}</p>
          )}
        </>
      )}
    </div>
  )
}
```

- [ ] **Step 4: Correr el test para verificar que pasa**

Run: `npx vitest run src/__tests__/components/ShareProjectCard.test.tsx`
Expected: PASS.

- [ ] **Step 5: Montarla en el overlay**

En `src/components/MemoriesWorkspace.tsx`, importar y montar debajo del grafo, antes de `<MemoryVaultCard />`:

```tsx
import ShareProjectCard from './ShareProjectCard'
```

```tsx
        <ShareProjectCard activeRepoPath={activeRepoPath} />
```

Y los estilos en `src/styles/global.css`:

```css
.memories-share { border: 1px solid var(--line); border-radius: 3px; padding: 14px 16px; }
.memories-share h4 { margin: 0 0 10px; font-size: 14px; }
.memories-share-row { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
.memories-ok { color: #22C55E; font-size: 13px; margin: 10px 0 0; }
```

- [ ] **Step 6: Suite completa y commit**

```bash
npm test
git add src/components/ShareProjectCard.tsx src/__tests__/components/ShareProjectCard.test.tsx
git add src/components/MemoriesWorkspace.tsx src/styles/global.css
git commit -m "feat(memories): pantalla para compartir un proyecto con el equipo

D6 de las respuestas de Bauti. El endpoint existe desde Layer 1 y nunca tuvo UI:
sin esto, scope team se retiene en silencio con project_not_shared_with_team.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01FJpV3ahxg1zn55JS9sxByP"
```

---

### Task 12: Blindar el importer contra engram v2

Agregada el 2026-09-09. Bauti se comprometió a mirar el esquema de v2 cuando salga (D4), pero eso no cubre el caso en que salga y él no lo vea a tiempo. Hoy, si v2 renombra la tabla `observations` o dropea una columna, `importEngramDatabase` devuelve `{ imported: 0, error: <mensaje de SQLite> }` y el usuario ve **cero importadas sin saber por qué**. Es el mismo fallo mudo del §2.2 en otra parte del sistema, y del lado del activo comercial de §8 ("traete tu engram").

**Files:**
- Modify: `electron/memory-importers/engram.ts`
- Modify: `electron/__tests__/memory-importers.test.ts`

**Interfaces:**
- Consumes: nada nuevo.
- Produces: `EngramImportResult.error` pasa a poder valer el código estable `'engram_schema_unknown'`, distinguible de un fallo de IO o de un mensaje crudo de SQLite.

- [ ] **Step 1: Escribir el test que falla**

Agregar a `electron/__tests__/memory-importers.test.ts`:

```ts
describe('importer de engram — esquema desconocido (v2)', () => {
  let dir: string
  let store: MemoryStore

  beforeEach(() => {
    dir = makeTmpDir('raven-engram-v2-')
    store = new MemoryStore(join(dir, 'memory.db'))
  })

  afterEach(() => {
    store.close()
    cleanupTmp(dir)
  })

  it('una base sin la tabla observations reporta engram_schema_unknown, no un error crudo', () => {
    const path = join(dir, 'engram.db')
    const db = new Database(path)
    db.exec('CREATE TABLE memories (id TEXT PRIMARY KEY, body TEXT);')
    db.close()

    const result = importEngramDatabase(store, path)

    expect(result.imported).toBe(0)
    expect(result.error).toBe('engram_schema_unknown')
  })

  it('una tabla observations sin las columnas que leemos tambien reporta el codigo', () => {
    const path = join(dir, 'engram.db')
    const db = new Database(path)
    db.exec('CREATE TABLE observations (id TEXT PRIMARY KEY, body TEXT);')
    db.close()

    const result = importEngramDatabase(store, path)

    expect(result.error).toBe('engram_schema_unknown')
  })

  it('columnas NUEVAS que no conocemos no son un problema: se ignoran y el import sigue', () => {
    const path = join(dir, 'engram.db')
    const db = new Database(path)
    db.exec(`
      CREATE TABLE observations (
        sync_id TEXT PRIMARY KEY, type TEXT, title TEXT, content TEXT,
        project TEXT, topic_key TEXT, revision_count INTEGER, duplicate_count INTEGER,
        last_seen_at TEXT, created_at TEXT, updated_at TEXT, deleted_at TEXT,
        embedding BLOB, v2_confidence REAL
      );
    `)
    db.prepare(
      `INSERT INTO observations (sync_id, type, title, content, project, topic_key,
         revision_count, duplicate_count, last_seen_at, created_at, updated_at, deleted_at,
         embedding, v2_confidence)
       VALUES ('e1','decision','T','C','p',NULL,1,0,'2026-09-01 10:00:00','2026-09-01 10:00:00','2026-09-01 10:00:00',NULL,NULL,0.9)`
    ).run()
    db.close()

    const result = importEngramDatabase(store, path)

    expect(result.error).toBeUndefined()
    expect(result.imported).toBe(1)
  })
})
```

- [ ] **Step 2: Correr el test para verificar que falla**

Run: `npx vitest run electron/__tests__/memory-importers.test.ts`
Expected: FAIL en los dos primeros: hoy `result.error` trae el mensaje de SQLite (`no such table: observations` / `no such column: ...`), no el código.

- [ ] **Step 3: Agregar el chequeo de esquema**

En `electron/memory-importers/engram.ts`, agregar la constante y la función arriba de `importEngramDatabase`:

```ts
/**
 * Las columnas que este adapter LEE. No es el esquema entero de engram: una base con columnas
 * de mas importa igual (ese es el punto de §5.2 "Schema drift"), una con menos no.
 */
const REQUIRED_COLUMNS = [
  'sync_id', 'type', 'title', 'content', 'project', 'topic_key',
  'revision_count', 'duplicate_count', 'last_seen_at', 'created_at', 'updated_at', 'deleted_at',
] as const

/**
 * Codigo estable, no un mensaje: engram v2 sale la semana del 2026-09-08 y puede renombrar la
 * tabla o dropear columnas. Sin esto el import devuelve `{imported: 0}` con un mensaje crudo de
 * SQLite y el usuario ve cero importadas sin saber por que — el mismo fallo mudo del §2.2, y
 * justo en la puerta de entrada de los usuarios que vienen de engram.
 */
export const ENGRAM_SCHEMA_UNKNOWN = 'engram_schema_unknown'

function hasReadableSchema(db: Database.Database): boolean {
  const table = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'observations'")
    .get()
  if (!table) return false

  const columns = new Set(
    (db.prepare('PRAGMA table_info(observations)').all() as Array<{ name: string }>)
      .map((c) => c.name)
  )
  return REQUIRED_COLUMNS.every((c) => columns.has(c))
}
```

Y dentro de `importEngramDatabase`, inmediatamente después de `copy = openReadOnlyCopy(engramDbPath)` y antes del `SELECT`:

```ts
    if (!hasReadableSchema(copy.db)) {
      store.updateImportRun(runId, { imported: 0, skipped: 0, state: 'failed', error: ENGRAM_SCHEMA_UNKNOWN })
      return { imported: 0, skipped: 0, error: ENGRAM_SCHEMA_UNKNOWN }
    }
```

- [ ] **Step 4: Correr el test para verificar que pasa**

Run: `npx vitest run electron/__tests__/memory-importers.test.ts electron/__tests__/memory-local-import.test.ts`
Expected: PASS todo, incluidos los tests viejos del importer.

- [ ] **Step 5: Commit**

```bash
git add electron/memory-importers/engram.ts electron/__tests__/memory-importers.test.ts
git commit -m "fix(memories): el import de engram deja de fallar mudo con un esquema desconocido

engram v2 sale esta semana. Si renombra observations o dropea una columna, hoy
el usuario ve cero importadas sin razon, justo en la puerta de entrada de los
que vienen de engram.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01FJpV3ahxg1zn55JS9sxByP"
```

---

## Cobertura de la spec

| Requisito (§) | Tarea |
|---|---|
| §2.2 el fallo mudo | 2, 4, 5, 8, 9 |
| §4.1 hermana de Personal | 8 |
| §4.2 fila con estado inline | 5, 8 |
| §4.3 vista única sin chips | 9 (test explícito) |
| §4.4 dirección C, grafo al centro | 9 |
| §4.5 conflictos en la fila de estado | 4, 9 |
| §5.1 semáforo y texto corto | 5, 8 |
| §5.2 mudanza de los componentes | 9, 10 |
| §5.3 IPC nuevo | 4 |
| §5.4 z-index explícito | 7 |
| §7.1 fail loudly / doctor | 3, 4, 9 |
| §8.2.3 smoke de volumen | 1 |
| §10 alcance de la v1 | todas |
| §11 riesgo 1 (nunca corrió en la app) | 7 step 4, 10 step 4 |
| §11 riesgo 2 (desfasaje del vault) | 4, 9 (se muestra el "vault Xh ago") |
| §11 riesgo 5 (choque de nombre) | Global Constraints: la superficie se llama **Memories** |
| §12.1 el nombre | cerrado: **Memories** |
| D6 de Bauti (compartir proyecto) | 11 |
| D4 de Bauti (engram v2) | 12 |

**Fuera de alcance a propósito** (§10 "No entra"): el daemon headless y el plugin suelto (§6), el pricing del plugin (§6.3), el anexo de compatibilidad (§9), embeddings o re-ranking. §7.2 (el lease en SQLite) es de la fase 2 aunque §7 lo liste en la 1 — ver la nota de discrepancias abajo. §7.3 (chunks con tope de bytes) sólo entra si la Task 1 Step 4 lo levanta como hallazgo real.

## Discrepancias encontradas en la spec al escribir este plan

1. **§7 dice "las tres entran en la fase 1"**, pero §7.2 (el lease en SQLite) existe *"para la convivencia daemon-app / daemon-plugin de §6.2"*, que es la fase 2 — y §10 "Alcance de la v1" no lo lista. Este plan lo trata como fase 2. §7.3 (chunks con tope de bytes) tampoco está en §10: acá queda condicionado a que la Task 1 lo levante como problema real, no antes.
2. **§3.5.3 subestima lo que ya tenemos.** Dice que engram corre en 8 agentes y lo nuestro necesita Electron. Medido: `electron/memory-cli-adapters.ts` tiene adapters para **claude, gemini, codex, qwen y opencode** — 5 de esos 8. La brecha real no es "cuántos agentes", es "con Nest abierta o sin ella". No cambia ninguna tarea de este plan, pero cambia el pitch.
