# Nest Memory — cambios de cliente C1 a C8 · Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dejar el cliente de Nest Memory listo para hablar con el backend de sync propio, y de paso cerrar los bloqueantes de pérdida de datos silenciosa que hoy tiene el subsistema.

**Architecture:** Todo pasa en el proceso main de Electron y en la card de Settings. El motor de merge (`electron/memory-merge.ts`) y el write path del store (`electron/memory-store.ts:save`) **no se tocan**: son la parte testeada y correcta. Los cambios son en el borde: el pull-apply del daemon, el versionado del schema, el gate que decide si se captura, la capa HTTP y la UI de conexión.

**Tech Stack:** Electron 33 · TypeScript · better-sqlite3 ^12.11.1 (FTS5) · vitest 4 · React 18 en el renderer.

**Spec:** `docs/superpowers/specs/2026-08-31-memory-sync-backend-design.md` — en particular §5 (wire contract), §8 (los dos arreglos del servidor viejo) y §10 (la tabla de los ocho cambios). El plan discute contra esa spec; el ejecutor lee las dos cosas.

## Global Constraints

- **`better-sqlite3` queda pineado en `^12.11.1`.** Es la única versión publicada con prebuild para el Node 25 de la PC (ABI 141) y para el Electron 33 de la app al mismo tiempo. No bajar, no subir a v13 (pide `engines.node >=22` y Electron 33 trae 20.18).
- **Cero cambios a `electron/memory-merge.ts`.** La regla LWW se implementa una sola vez y ya está. Si un task parece necesitar tocarla, el task está mal planteado.
- **Cero cambios al write path de `save()`** (`memory-store.ts:421-620`). Los tasks que tocan el store agregan métodos o cambian `migrate()`, no la resolución de escritura local.
- **Todo lo que escribe en SQLite se testea contra SQLite real**, no contra mocks. El patrón está en `electron/__tests__/memory-store.test.ts`: `makeTmpDir` de `./setup`, `new MemoryStore(join(dir,'memory.db'))`, `cleanupTmp` en el `afterEach`.
- **Todo lo que habla HTTP se testea con `fetchImpl` inyectado**, nunca con red real. El patrón está en `electron/__tests__/memory-daemon.test.ts`: `fakeStore()` + `baseDaemonDeps()`.
- **La UI, el código y el copy van en inglés.** La conversación y estos docs, en español.
- **Baseline verde antes de empezar:** `npm run native:node && npx vitest run electron/__tests__/memory-*.test.ts` da **176 passed (12 files)**, medido el 2026-09-01. Cualquier task que lo baje está roto.
- **`docs/superpowers/` está gitignored.** Este plan y la spec se commitean con `git add -f`.

## Cómo correr los tests en esta máquina

`better-sqlite3` necesita dos binarios distintos en el mismo path: el ABI de Node para vitest y el de Electron para la app. Con el bump a 12.11.1 los dos son descargas, no compilaciones:

```bash
npm run native:node       # antes de correr vitest
npx vitest run electron/__tests__/memory-store.test.ts
npm run native:electron   # antes de volver a levantar la app
```

Olvidarse del segundo deja la app sin arrancar con un `NODE_MODULE_VERSION` mismatch. No es un bug, es el swap.

## Estructura de archivos

| Archivo | Responsabilidad | Tasks |
|---|---|---|
| `electron/memory-daemon.ts` | Scheduler, capa HTTP y pull-apply | 1, 4, 5, 7 |
| `electron/memory-store.ts` | SQLite: schema, write path, cola de mutaciones | 1, 2 |
| `electron/memory-connection-state.ts` | `connection.json`: flags locales, deviceId, base del sync | 3, 7 |
| `electron/main.ts` | Wiring del subsistema y los tres gates de captura | 3, 7, 8 |
| `electron/preload.ts` | Superficie `window.memory` | 8 |
| `src/hooks/useMemory.ts` | Máquina de estados de la card | 8, 9 |
| `src/components/SettingsPanel.tsx` | La card de memoria en Settings | 9 |
| `package.json` | Scripts nativos y el `pretest` del CI | 6 |

## Orden y dependencias

**Etapa A — no necesita el servidor, se hace y se testea hoy:** tasks 1 a 6.
**Etapa B — el código se escribe contra el contrato de la spec, pero el round trip real espera al servidor:** tasks 7 a 9.

Dentro de cada etapa los tasks son independientes salvo donde se dice.

---

### Task 1: C2 — la colisión de topic en el pull-apply

El peor bug del subsistema. `MemoryDaemon.applyPulledRow` (`electron/memory-daemon.ts:513-545`) sólo maneja la mitad de la colisión: cuando la fila que llega **pierde**, la marca `supersededBy` y todo bien. Cuando la fila que llega **gana**, no hace nada con la local. Entonces `applyIncomingObservation` inserta la entrante con `superseded_by = NULL` mientras la local sigue con `superseded_by = NULL`, las dos activas sobre el mismo `(project_key, scope, topic_key)`, y el índice único `idx_obs_topic` (`memory-store.ts:247-249`) tira una excepción. La excepción sube hasta el `try/catch` de `doPull` (`:499-503`), el cursor no se escribe, y **el sync de ese device muere para siempre**: cada pull siguiente vuelve a traer la misma fila y vuelve a explotar.

El arreglo es aplicar del lado del cliente la misma regla que la spec §8.1 le pide al servidor: supersedir al perdedor en vez de dejar dos vivos, y hacerlo en la misma transacción que el insert.

**Files:**
- Modify: `electron/memory-store.ts:705-770` (`applyIncomingObservation`)
- Modify: `electron/memory-daemon.ts:513-545` (`applyPulledRow`)
- Test: `electron/__tests__/memory-store.test.ts`, `electron/__tests__/memory-daemon.test.ts`

**Interfaces:**
- Consumes: `resolveTopicCollision` de `memory-merge.ts`, sin cambios.
- Produces: `MemoryStore.applyIncomingObservation(row)` acepta un campo nuevo `supersedeLocal?: string | null` — el `sync_id` de una fila local que hay que marcar `superseded_by = <row.syncId>` **antes** de escribir la entrante, en una sola transacción.

- [ ] **Step 1: Escribir el test que falla, contra SQLite real**

En `electron/__tests__/memory-store.test.ts`, un `describe` nuevo:

```ts
describe('MemoryStore — supersede local en la colisión de topic (C2)', () => {
  let dir: string
  let store: MemoryStore

  beforeEach(() => {
    dir = makeTmpDir('raven-memory-c2-')
    store = new MemoryStore(join(dir, 'memory.db'))
  })

  afterEach(() => {
    store.close()
    cleanupTmp(dir)
  })

  it('supersede la local y aplica la entrante sin violar idx_obs_topic', () => {
    store.ensureProject({ projectKey: 'proj-a', displayName: 'proj-a' })
    store.save({
      projectKey: 'proj-a',
      scope: 'personal',
      type: 'decision',
      topicKey: 'deploy-target',
      title: 'local gana por ahora',
      content: 'escrita en esta maquina',
      source: 'mcp',
    })
    const local = store.context('proj-a', 10)[0]

    expect(() =>
      store.applyIncomingObservation({
        syncId: 'obs_remota',
        projectKey: 'proj-a',
        scope: 'personal',
        topicKey: 'deploy-target',
        type: 'decision',
        title: 'la remota gana',
        content: 'escrita en la otra maquina',
        updatedAt: Date.now() + 60_000,
        lamport: 99,
        deleted: false,
        supersedeLocal: local.syncId,
      })
    ).not.toThrow()

    const activos = store.context('proj-a', 10)
    expect(activos).toHaveLength(1)
    expect(activos[0].syncId).toBe('obs_remota')
    expect(store.get(local.syncId)?.superseded_by).toBe('obs_remota')
  })

  it('no deja la local supersedida si la entrante falla', () => {
    store.ensureProject({ projectKey: 'proj-a', displayName: 'proj-a' })
    store.save({
      projectKey: 'proj-a',
      scope: 'personal',
      type: 'decision',
      topicKey: 'deploy-target',
      title: 'local',
      content: 'x',
      source: 'mcp',
    })
    const local = store.context('proj-a', 10)[0]

    expect(() =>
      store.applyIncomingObservation({
        syncId: 'obs_rota',
        projectKey: 'proj-a',
        scope: 'no-pasa-el-CHECK',
        topicKey: 'deploy-target',
        type: 'decision',
        title: 'rompe el CHECK de scope',
        content: 'x',
        updatedAt: Date.now(),
        lamport: 1,
        deleted: false,
        supersedeLocal: local.syncId,
      })
    ).toThrow()

    expect(store.get(local.syncId)?.superseded_by).toBeNull()
  })
})
```

- [ ] **Step 2: Correr y verificar que falla**

```bash
npm run native:node
npx vitest run electron/__tests__/memory-store.test.ts -t 'colisión de topic (C2)'
```

Esperado: el primer test falla con `UNIQUE constraint failed: observations.project_key, observations.scope, observations.topic_key`.

- [ ] **Step 3: Implementar en el store**

En `electron/memory-store.ts`, sumar el campo al tipo del parámetro de `applyIncomingObservation`, después de `serverSeq`:

```ts
    serverSeq?: number | null
    /**
     * C2: el `sync_id` de una fila LOCAL que perdió la colisión de topic contra esta
     * entrante. Se marca `superseded_by = row.syncId` ANTES de escribir la entrante y en
     * la MISMA transacción, porque `idx_obs_topic` no admite dos filas activas sobre el
     * mismo (project_key, scope, topic_key): escribir primero y supersedir después no es
     * un orden más lento, es un orden imposible.
     *
     * No se encola mutación por este supersede. El servidor aplica la misma regla del
     * lado suyo (spec §8.1) y la fila supersedida vuelve en el pull, así que esto es
     * convergencia sobre un hecho que el servidor ya conoce, no un hecho nuevo de este
     * device. Encolarlo haría que las dos puntas se manden el mismo supersede para
     * siempre.
     */
    supersedeLocal?: string | null
```

Envolver el cuerpo que escribe (desde `const existing = this.get(row.syncId)` hasta el final del método) en una transacción, con el supersede adentro:

```ts
    const applyAll = this.db.transaction(() => {
      if (row.supersedeLocal && row.supersedeLocal !== row.syncId) {
        this.db
          .prepare('UPDATE observations SET superseded_by = ? WHERE sync_id = ? AND superseded_by IS NULL')
          .run(row.syncId, row.supersedeLocal)
      }
      // ... el cuerpo existente, sin un cambio ...
    })
    applyAll()
```

- [ ] **Step 4: Correr y verificar que pasa**

```bash
npx vitest run electron/__tests__/memory-store.test.ts
```

Esperado: PASS, y el resto del archivo sigue verde.

- [ ] **Step 5: Escribir el test del daemon**

En `electron/__tests__/memory-daemon.test.ts`:

```ts
describe('applyPulledRow — colisión de topic cuando la entrante gana (C2)', () => {
  it('pide supersedir la local antes de aplicar la entrante', () => {
    const applyIncomingObservation = vi.fn()
    const store = fakeStore({
      get: vi.fn(() => null),
      findActiveTopicOwner: vi.fn(() => ({ sync_id: 'obs_local', updated_at: 1_000, lamport: 1 })),
      applyIncomingObservation,
    })
    const daemon = new MemoryDaemon(baseDaemonDeps(store))

    daemon.applyPulledRow({
      syncId: 'obs_remota',
      updatedAt: 2_000,
      lamport: 5,
      deleted: false,
      topicKey: 'deploy-target',
      scope: 'personal',
      projectKey: 'proj-1',
      supersededBy: null,
    })

    expect(applyIncomingObservation).toHaveBeenCalledWith(
      expect.objectContaining({ syncId: 'obs_remota', supersedeLocal: 'obs_local', supersededBy: null })
    )
  })

  it('cuando la entrante pierde, la marca supersedida y no toca la local', () => {
    const applyIncomingObservation = vi.fn()
    const store = fakeStore({
      get: vi.fn(() => null),
      findActiveTopicOwner: vi.fn(() => ({ sync_id: 'obs_local', updated_at: 9_000, lamport: 20 })),
      applyIncomingObservation,
    })
    const daemon = new MemoryDaemon(baseDaemonDeps(store))

    daemon.applyPulledRow({
      syncId: 'obs_remota',
      updatedAt: 2_000,
      lamport: 5,
      deleted: false,
      topicKey: 'deploy-target',
      scope: 'personal',
      projectKey: 'proj-1',
      supersededBy: null,
    })

    expect(applyIncomingObservation).toHaveBeenCalledWith(
      expect.objectContaining({ supersededBy: 'obs_local', supersedeLocal: null })
    )
  })
})
```

- [ ] **Step 6: Correr y verificar que falla**

```bash
npx vitest run electron/__tests__/memory-daemon.test.ts -t 'colisión de topic cuando la entrante gana'
```

Esperado: FAIL — hoy `supersedeLocal` nunca se manda.

- [ ] **Step 7: Implementar en el daemon**

En `electron/memory-daemon.ts`, dentro de `applyPulledRow`, reemplazar el bloque de colisión:

```ts
    // Topic collision check against a DIFFERENT sync_id sharing the same topic slot.
    let supersededBy: string | null = null
    // C2: el caso que faltaba. Si la entrante GANA, la local tiene que quedar
    // supersedida en la misma transacción del insert; si no, las dos quedan activas
    // sobre el mismo slot, idx_obs_topic explota, la excepción sube hasta el catch de
    // doPull(), el cursor no avanza y el device no vuelve a sincronizar nunca.
    let supersedeLocal: string | null = null
    if (incoming.topicKey) {
      const existingTopicOwner = this.deps.store.findActiveTopicOwner(
        incoming.projectKey || '__global__',
        incoming.scope,
        incoming.topicKey,
        incoming.syncId
      )
      if (existingTopicOwner) {
        const { winner, loser } = resolveTopicCollision(
          { syncId: existingTopicOwner.sync_id, updatedAt: existingTopicOwner.updated_at, lamport: existingTopicOwner.lamport },
          { syncId: incoming.syncId, updatedAt: incoming.updatedAt, lamport: incoming.lamport }
        )
        if (loser.syncId === incoming.syncId) supersededBy = winner.syncId
        else supersedeLocal = loser.syncId
      }
    }
```

Y pasar el campo en la llamada a `applyIncomingObservation`, junto a `supersededBy`:

```ts
      supersededBy,
      supersedeLocal,
```

- [ ] **Step 8: Correr toda la suite de memoria**

```bash
npx vitest run electron/__tests__/memory-*.test.ts
```

Esperado: 180 passed (176 del baseline más los 4 nuevos).

- [ ] **Step 9: Commit**

```bash
git add electron/memory-store.ts electron/memory-daemon.ts electron/__tests__/memory-store.test.ts electron/__tests__/memory-daemon.test.ts
git commit -m "fix(memory): la colision de topic mataba el sync del device para siempre"
```

---

### Task 2: C3 — versionado de `migrate()`

`MemoryStore.migrate()` (`electron/memory-store.ts:217-347`) es un solo `db.exec()` con `CREATE TABLE IF NOT EXISTS` y nada más. No hay `PRAGMA user_version`, no hay `ALTER TABLE`, no hay forma de expresar el paso 1→2. El schema **ya cambió dos veces adentro de la rama** y se resolvió borrando la base. Después de la release eso no se puede hacer: la base tiene las memorias del usuario.

El punto fino: las bases que ya existen en disco fueron creadas sin `user_version`, así que reportan 0 igual que una base vacía. Como todo el schema base es `IF NOT EXISTS`, correrlo sobre una base ya poblada es un no-op. Entonces "versión 0 significa: corré el schema base y marcá 1" es correcto para los dos casos, y es lo que hace que este task no necesite migrar un solo dato.

**Files:**
- Modify: `electron/memory-store.ts:217-347`
- Test: `electron/__tests__/memory-store.test.ts`

**Interfaces:**
- Consumes: nada de tasks anteriores.
- Produces: `export const SCHEMA_VERSION: number` y `MemoryStore.schemaVersion: number`, legible después del constructor.

- [ ] **Step 1: Escribir el test que falla**

```ts
describe('MemoryStore — versionado del schema (C3)', () => {
  let dir: string

  beforeEach(() => { dir = makeTmpDir('raven-memory-c3-') })
  afterEach(() => { cleanupTmp(dir) })

  it('una base nueva queda en la versión actual', () => {
    const store = new MemoryStore(join(dir, 'memory.db'))
    expect(store.schemaVersion).toBe(SCHEMA_VERSION)
    store.close()
  })

  it('reabrir una base existente no pierde datos', () => {
    const first = new MemoryStore(join(dir, 'memory.db'))
    first.ensureProject({ projectKey: 'proj-a', displayName: 'proj-a' })
    first.save({
      projectKey: 'proj-a',
      scope: 'personal',
      type: 'decision',
      title: 'sobrevive al reopen',
      content: 'x',
      source: 'mcp',
    })
    first.close()

    const second = new MemoryStore(join(dir, 'memory.db'))
    expect(second.schemaVersion).toBe(SCHEMA_VERSION)
    expect(second.count()).toBe(1)
    second.close()
  })

  it('una base vieja sin user_version se adopta sin borrar nada', () => {
    const legacy = new MemoryStore(join(dir, 'memory.db'))
    legacy.ensureProject({ projectKey: 'proj-a', displayName: 'proj-a' })
    legacy.save({
      projectKey: 'proj-a',
      scope: 'personal',
      type: 'decision',
      title: 'escrita antes del versionado',
      content: 'x',
      source: 'mcp',
    })
    // simula el estado de campo: tablas creadas, user_version nunca seteado
    ;(legacy as unknown as { db: { pragma(s: string): unknown } }).db.pragma('user_version = 0')
    legacy.close()

    const migrated = new MemoryStore(join(dir, 'memory.db'))
    expect(migrated.schemaVersion).toBe(SCHEMA_VERSION)
    expect(migrated.count()).toBe(1)
    migrated.close()
  })
})
```

Sumar `SCHEMA_VERSION` al import del archivo de test:

```ts
import { MemoryStore, SCHEMA_VERSION, deriveImportSyncId, computeContentIdentity } from '../memory-store'
```

- [ ] **Step 2: Correr y verificar que falla**

```bash
npx vitest run electron/__tests__/memory-store.test.ts -t 'versionado del schema (C3)'
```

Esperado: FAIL — `SCHEMA_VERSION` no está exportado y `store.schemaVersion` es `undefined`.

- [ ] **Step 3: Implementar**

En `electron/memory-store.ts`, a nivel de módulo, extraer el string que hoy está inline en `migrate()` a una constante `BASE_SCHEMA` (el mismo texto, sin un carácter de diferencia) y agregar arriba de la clase:

```ts
/**
 * C3: versión del schema local, persistida en `PRAGMA user_version`.
 *
 * Para agregar un paso: subir esta constante, agregar la entrada en MIGRATIONS con el
 * número NUEVO como clave, y no tocar nunca un paso ya publicado. Cada paso corre dentro
 * de una transacción y aun así conviene que sea idempotente: SQLite no revierte un ALTER
 * TABLE si el proceso muere en el medio de un `exec` multi-statement.
 *
 * La versión 1 es el schema base tal como salió de Phase 1. Una base creada antes de este
 * cambio reporta user_version = 0 igual que una base vacía, y adoptarla es correcto
 * justamente porque todo el paso 1 es CREATE ... IF NOT EXISTS: correrlo sobre una base ya
 * poblada no escribe nada y no toca una sola fila.
 */
export const SCHEMA_VERSION = 1

const MIGRATIONS: Record<number, string> = {
  1: BASE_SCHEMA,
}
```

Y reescribir `migrate()`:

```ts
  readonly schemaVersion: number = 0

  private migrate(): void {
    let current = this.db.pragma('user_version', { simple: true }) as number
    for (let next = current + 1; next <= SCHEMA_VERSION; next++) {
      const step = MIGRATIONS[next]
      if (!step) throw new Error(`memory-store: falta la migración ${next}`)
      this.db.transaction(() => {
        this.db.exec(step)
        this.db.pragma(`user_version = ${next}`)
      })()
      current = next
    }
    ;(this as { schemaVersion: number }).schemaVersion = current
  }
```

- [ ] **Step 4: Correr y verificar que pasa**

```bash
npx vitest run electron/__tests__/memory-*.test.ts
```

Esperado: 183 passed.

- [ ] **Step 5: Commit**

```bash
git add electron/memory-store.ts electron/__tests__/memory-store.test.ts
git commit -m "feat(memory): versionar el schema local con user_version"
```

---

### Task 3: C1 — la memoria local no puede depender de la nube

El bloqueante de premisa. Los tres puntos de captura cuelgan del mismo flag:

- `electron/main.ts:287` — `accountStore.configureMemory({ ..., isEnabled: () => memoryConnectionState.connected })`
- `electron/main.ts:291` — `ptyManager.setMemoryIntegration({ ..., isEnabled: () => memoryConnectionState.connected })`
- `electron/main.ts:358` — `if (!memory || !memoryConnectionState.connected) return` en `memorySink.save`

`connected` significa "hay token de nube y el usuario apretó Connect". Con eso, un usuario del plan free **no captura una sola memoria**, ni siquiera en su propia máquina, mientras la card de su plan dice "Local memory active" (`src/lib/stripe.ts:80`). El sink descarta en silencio: no hay log, no hay contador, no hay forma de notarlo desde la UI.

Separar los dos conceptos: `localEnabled` (default **true**, es lo que hace que la memoria exista para todos) y `connected` (sigue gateando **sólo** el daemon de sync).

**Files:**
- Modify: `electron/memory-connection-state.ts`
- Modify: `electron/main.ts:287`, `:291`, `:358`, `:2591`, `:2719`
- Test: `electron/__tests__/memory-connection-state.test.ts` (crear)

**Interfaces:**
- Consumes: nada de tasks anteriores.
- Produces: `MemoryConnectionState` gana `localEnabled: boolean`, con `DEFAULT_STATE.localEnabled === true`. Una `connection.json` vieja sin el campo se lee como `localEnabled: true` gracias al spread sobre `DEFAULT_STATE` que ya hace `getMemoryConnectionState`.

- [ ] **Step 1: Escribir el test que falla**

Crear `electron/__tests__/memory-connection-state.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'
import { makeTmpDir, cleanupTmp } from './setup'
import { getMemoryConnectionState, setMemoryConnectionState } from '../memory-connection-state'

describe('MemoryConnectionState — local vs nube (C1)', () => {
  let home: string

  beforeEach(() => { home = makeTmpDir('raven-conn-') })
  afterEach(() => { cleanupTmp(home) })

  it('una casa sin connection.json arranca capturando y sin nube', () => {
    const state = getMemoryConnectionState(home)
    expect(state.localEnabled).toBe(true)
    expect(state.connected).toBe(false)
  })

  it('una connection.json vieja sin el campo se adopta capturando', () => {
    mkdirSync(join(home, '.raven-nest', 'memory'), { recursive: true })
    writeFileSync(
      join(home, '.raven-nest', 'memory', 'connection.json'),
      JSON.stringify({ connected: true, deviceId: 'dev-1', connectedAt: 123 })
    )
    const state = getMemoryConnectionState(home)
    expect(state.localEnabled).toBe(true)
    expect(state.connected).toBe(true)
  })

  it('apagar la captura local persiste y no toca el estado de nube', () => {
    setMemoryConnectionState(home, { connected: true, localEnabled: false, deviceId: 'dev-1', connectedAt: 123 })
    const state = getMemoryConnectionState(home)
    expect(state.localEnabled).toBe(false)
    expect(state.connected).toBe(true)
  })
})
```

- [ ] **Step 2: Correr y verificar que falla**

```bash
npx vitest run electron/__tests__/memory-connection-state.test.ts
```

Esperado: FAIL — `localEnabled` es `undefined`.

- [ ] **Step 3: Implementar el estado**

En `electron/memory-connection-state.ts`:

```ts
export interface MemoryConnectionState {
  connected: boolean
  /**
   * C1: la captura local, independiente de la nube. Arranca en true porque es la promesa
   * que la card del plan free ya hace ("Local memory active") y que hasta ahora era falsa:
   * los tres puntos de captura de main.ts colgaban de `connected`, así que sin apretar
   * Connect no se guardaba absolutamente nada, en silencio. `connected` sigue gateando el
   * daemon de sync y nada más.
   */
  localEnabled: boolean
  deviceId: string | null
  connectedAt: number | null
}

const DEFAULT_STATE: MemoryConnectionState = {
  connected: false,
  localEnabled: true,
  deviceId: null,
  connectedAt: null,
}
```

- [ ] **Step 4: Correr y verificar que pasa**

```bash
npx vitest run electron/__tests__/memory-connection-state.test.ts
```

Esperado: PASS (3 tests).

- [ ] **Step 5: Cambiar los tres gates de main.ts**

`:287` → `isEnabled: () => memoryConnectionState.localEnabled`
`:291` → `isEnabled: () => memoryConnectionState.localEnabled`
`:358`:

```ts
      // C1: la captura local no depende de la nube. `connected` sigue gateando el daemon
      // de sync (getToken/getDeviceId), no el hecho de guardar una memoria.
      if (!memory || !memoryConnectionState.localEnabled) return
```

Los dos sitios que reescriben el estado entero tienen que preservar el campo:

`:2591`:

```ts
  memoryConnectionState = { ...memoryConnectionState, connected: true, deviceId, connectedAt: Date.now() }
```

`:2719`:

```ts
  memoryConnectionState = { ...memoryConnectionState, connected: false, connectedAt: null }
```

- [ ] **Step 6: Verificar a mano que ningún gate de red quedó colgado del flag local**

```bash
grep -n "localEnabled\|memoryConnectionState.connected" electron/main.ts
```

Esperado: `localEnabled` aparece exactamente en los 3 gates de captura; `connected` sigue en el status IPC y en connect/disconnect, y en nada que decida si se guarda una memoria. El daemon nunca pega a la red sin token porque `doPush`/`doPull` cortan en `if (!url || !token) return`.

- [ ] **Step 7: Correr la suite entera**

```bash
npx vitest run
```

Esperado: sin rojos nuevos respecto del baseline de la rama.

- [ ] **Step 8: Commit**

```bash
git add electron/memory-connection-state.ts electron/main.ts electron/__tests__/memory-connection-state.test.ts
git commit -m "fix(memory): sin nube no se capturaba nada, y la card del free decia lo contrario"
```

---

### Task 4: C5 — `tags` como array y dejar de mandar `source_ref`

Dos fugas distintas en el mismo payload.

**Tags.** El store guarda `tags` como string JSON (columna `TEXT`, `memory-store.ts:630`). `appendMutation` serializa la fila entera, así que el push manda `tags: "[\"a\",\"b\"]"`, un string. El servidor lo mete en una columna `jsonb`, vuelve como string, y `mapRawPulledRow` (`memory-daemon.ts:340`) hace `Array.isArray(raw.tags) ? ... : undefined`. O sea que **los tags se pierden en cada round trip**, en las dos direcciones y sin un solo error.

**`source_ref`.** `memory-importers/markdown.ts:51` lo arma con el path **absoluto**, y viaja entero en el POST. No queda guardado (no existe como columna del lado servidor), así que es una fuga de transmisión: termina en logs de proxies y de la function. La spec §6 lo descarta del lado del servidor; acá se deja de mandar.

**Files:**
- Modify: `electron/memory-daemon.ts:301-315` (payload de push), `:333-345` (`mapRawPulledRow`)
- Test: `electron/__tests__/memory-daemon.test.ts`

**Interfaces:**
- Consumes: nada de tasks anteriores.
- Produces: `normalizeTags(value: unknown): string[] | undefined` a nivel de módulo en `memory-daemon.ts`. `mapRawPulledRow` acepta `tags` como array o como string JSON y siempre devuelve `string[] | undefined`; el payload de push manda `tags` como array y sin la clave `source_ref`.

- [ ] **Step 1: Escribir el test que falla**

```ts
describe('wire de tags y source_ref (C5)', () => {
  it('mapRawPulledRow acepta tags como string JSON', () => {
    expect(mapRawPulledRow({ sync_id: 'a', tags: '["uno","dos"]' }).tags).toEqual(['uno', 'dos'])
  })

  it('mapRawPulledRow sigue aceptando tags como array', () => {
    expect(mapRawPulledRow({ sync_id: 'a', tags: ['uno'] }).tags).toEqual(['uno'])
  })

  it('mapRawPulledRow no explota con tags basura', () => {
    expect(mapRawPulledRow({ sync_id: 'a', tags: 'no soy json' }).tags).toBeUndefined()
    expect(mapRawPulledRow({ sync_id: 'a', tags: 7 }).tags).toBeUndefined()
  })

  it('el push manda tags como array y no manda source_ref', async () => {
    const pending: MutationLogRow[] = [
      {
        seq: 1,
        sync_id: 'a',
        op: 'upsert',
        payload: JSON.stringify({
          sync_id: 'a',
          project_key: 'proj-1',
          tags: '["uno","dos"]',
          source_ref: 'markdown:C:\\Users\\real\\notas.md#topic',
        }),
        created_at: 1,
        pushed_at: null,
        last_error: null,
      },
    ]
    const store = fakeStore({ pendingMutations: vi.fn(() => pending) })
    let sent: Record<string, unknown> | null = null
    const fetchImpl = vi.fn(async (_url: string, init: RequestInit) => {
      sent = JSON.parse(init.body as string)
      return new Response(JSON.stringify({ results: [{ sync_id: 'a', outcome: 'applied', project_seq: 1 }] }), { status: 200 })
    }) as unknown as typeof fetch

    const daemon = new MemoryDaemon(baseDaemonDeps(store, { fetchImpl }))
    await daemon.push()

    const payload = (sent!.mutations as Array<{ payload: Record<string, unknown> }>)[0].payload
    expect(payload.tags).toEqual(['uno', 'dos'])
    expect(payload).not.toHaveProperty('source_ref')
  })
})
```

- [ ] **Step 2: Correr y verificar que falla**

```bash
npx vitest run electron/__tests__/memory-daemon.test.ts -t 'tags y source_ref (C5)'
```

Esperado: FAIL — hoy `tags` sale como string y `source_ref` viaja.

- [ ] **Step 3: Implementar**

En `electron/memory-daemon.ts`, arriba de `export class MemoryDaemon`:

```ts
/**
 * C5: el store guarda `tags` como string JSON en una columna TEXT y el payload de la
 * mutación es un snapshot crudo de esa fila, así que sin esto el push manda un string
 * donde el contrato pide un array (spec §5.2) y el pull descarta todo lo que no sea
 * Array. Los tags se perdían en las dos direcciones sin un solo error.
 */
function normalizeTags(value: unknown): string[] | undefined {
  if (Array.isArray(value)) return value.filter((t): t is string => typeof t === 'string')
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value)
      if (Array.isArray(parsed)) return parsed.filter((t): t is string => typeof t === 'string')
    } catch { /* no era JSON — tratar como sin tags */ }
  }
  return undefined
}
```

En `mapRawPulledRow`, la línea de tags:

```ts
    tags: normalizeTags(raw.tags),
```

Y en el `.map()` que arma el payload de push:

```ts
            // C5: `source_ref` lleva paths absolutos con el nombre real del usuario
            // (memory-importers/markdown.ts:51) y el servidor ni siquiera lo guarda —
            // viajaba sólo para terminar en los logs de cualquier proxy. Se poda acá, que
            // es la punta que controla el wire.
            const { source_ref: _dropped, ...rest } = payload
            return {
              seq: m.seq,
              sync_id: m.sync_id,
              op: m.op,
              payload: {
                ...rest,
                tags: normalizeTags(payload.tags) ?? null,
                project_display_name: displayNameByProjectKey.get(projectKey) ?? projectKey,
              },
            }
```

- [ ] **Step 4: Correr y verificar que pasa**

```bash
npx vitest run electron/__tests__/memory-daemon.test.ts
```

Esperado: PASS.

- [ ] **Step 5: Commit**

```bash
git add electron/memory-daemon.ts electron/__tests__/memory-daemon.test.ts
git commit -m "fix(memory): los tags se perdian en cada round trip y source_ref filtraba paths"
```

---

### Task 5: C6 — timeout y `AbortSignal` en los dos fetch

`MemoryDaemon.fetch` (`electron/memory-daemon.ts:256-259`) llama a `fetch` sin timeout y sin señal. Combinado con el dedupe de in-flight (M19: `pull()`/`push()` cachean la promesa), un backend colgado deja **el daemon trabado hasta reiniciar la app**: la promesa nunca resuelve, el `.finally` que limpia `pullInFlight` nunca corre, y cada llamada siguiente devuelve la misma promesa muerta. No hay backoff que ayude, porque el backoff nunca llega a dispararse.

**Files:**
- Modify: `electron/memory-daemon.ts:12-22` (constantes), `:256-259` (`fetch`)
- Test: `electron/__tests__/memory-daemon.test.ts`

**Interfaces:**
- Consumes: nada de tasks anteriores.
- Produces: `FETCH_TIMEOUT_MS = 30_000` a nivel de módulo. `MemoryDaemon.fetch` aborta el request al vencer y limpia su timer en el `.finally`.

- [ ] **Step 1: Escribir el test que falla**

```ts
describe('timeout de red (C6)', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('aborta un fetch colgado y libera el dedupe de in-flight', async () => {
    const store = fakeStore()
    let abortado = false
    const fetchImpl = vi.fn((_url: string, init: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => {
          abortado = true
          reject(new DOMException('Aborted', 'AbortError'))
        })
      })
    ) as unknown as typeof fetch

    const daemon = new MemoryDaemon(baseDaemonDeps(store, { fetchImpl }))
    const primera = daemon.pull()
    await vi.advanceTimersByTimeAsync(31_000)
    await primera

    expect(abortado).toBe(true)

    // el dedupe quedó liberado: una segunda llamada dispara un request nuevo
    void daemon.pull()
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })
})
```

- [ ] **Step 2: Correr y verificar que falla**

```bash
npx vitest run electron/__tests__/memory-daemon.test.ts -t 'timeout de red (C6)'
```

Esperado: el test se cuelga hasta el timeout de vitest, o falla con `abortado === false`.

- [ ] **Step 3: Implementar**

En `electron/memory-daemon.ts`, junto a las otras constantes:

```ts
// C6: sin esto un backend colgado traba el daemon hasta reiniciar la app. El dedupe de
// in-flight (M19) cachea la promesa del request, y una promesa que nunca resuelve nunca
// corre su `.finally`, así que pullInFlight/pushInFlight quedan seteados para siempre y
// toda llamada posterior devuelve la misma promesa muerta. 30 s es holgado para un push
// de 200 mutaciones sobre una conexión mala y sigue siendo un corte, no una espera.
const FETCH_TIMEOUT_MS = 30_000
```

Y el método:

```ts
  private fetch(input: string, init: RequestInit): Promise<Response> {
    const impl = this.deps.fetchImpl ?? fetch
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
    return impl(input, { ...init, signal: controller.signal }).finally(() => clearTimeout(timer))
  }
```

- [ ] **Step 4: Correr y verificar que pasa**

```bash
npx vitest run electron/__tests__/memory-daemon.test.ts
```

Esperado: PASS.

- [ ] **Step 5: Commit**

```bash
git add electron/memory-daemon.ts electron/__tests__/memory-daemon.test.ts
git commit -m "fix(memory): un backend colgado trababa el daemon hasta reiniciar la app"
```

---

### Task 6: El CI se va a romper cuando memoria llegue a main

Hoy el job `test` está verde sólo porque `main` no tiene una línea de memoria y el CI **nunca corrió sobre una rama de memoria**. Al mergear, el runner (ubuntu, Node 20) va a levantar el binding que dejó el `postinstall` (`electron-rebuild`, o sea el ABI de Electron) y los 12 archivos de tests de memoria explotan con `NODE_MODULE_VERSION` mismatch.

El arreglo es un `pretest` que baje el prebuild de Node antes de vitest. **Tiene un costo local que hay que aceptar a ojos abiertos**: después de correr los tests, la app no arranca hasta correr `npm run native:electron`. Es exactamente el swap que ya se hace a mano; el `pretest` sólo automatiza un lado.

**Files:**
- Modify: `package.json` (scripts)

**No hace falta tocar el workflow.** `.github/workflows/ci.yml:34` corre `npm test`, y npm dispara `pretest` solo antes de ese script. Verificado el 2026-09-01: es la única invocación de tests en todo `.github/workflows/`. Si en el futuro alguien lo cambia a `npx vitest run`, el `pretest` deja de correr y este task hay que rehacerlo agregando un paso explícito al workflow.

**Interfaces:**
- Consumes: los scripts `native:node` / `native:electron` que ya están en `package.json`.
- Produces: `pretest` en `package.json`.

- [ ] **Step 1: Confirmar que el CI sigue entrando por `npm test`**

```bash
grep -rn "npm test\|npm run test\|vitest" .github/workflows/
```

Esperado: una sola línea, `.github/workflows/ci.yml:34:      - run: npm test`. Si aparece otra invocación, sumarle el `native:node` a mano ahí también.

- [ ] **Step 2: Agregar el `pretest`**

En `package.json`, junto a los scripts nativos:

```json
    "pretest": "npm run native:node",
```

- [ ] **Step 3: Verificar en local que se arregla solo**

```bash
npm run native:electron   # dejar el binario "mal" a propósito
npm test -- electron/__tests__/memory-store.test.ts
```

Esperado: pasa igual, porque `pretest` bajó el binding de Node solo.

- [ ] **Step 4: Dejar la app usable de nuevo**

```bash
npm run native:electron
```

- [ ] **Step 5: Commit**

```bash
git add package.json
git commit -m "ci(memory): bajar el binding de Node antes de vitest, o el job test se rompe al mergear"
```

---

## Etapa B — necesita el backend nuevo

Los tres tasks que siguen se escriben contra el contrato de la spec §5. El código y sus unit tests se hacen ya; el round trip real (dos instancias de Nest contra el mismo servicio, spec §13) espera al plan del servidor.

### Task 7: C4 — URL configurable y las rutas nuevas

Hoy la base sale de `import.meta.env.MAIN_VITE_SUPABASE_URL` (`electron/main.ts:210-212`), o sea **build time**: apuntar a otro backend exige recompilar. Y las rutas tienen forma de Supabase (`${url}/functions/v1/memory-sync/push`).

La spec §5.4 hace que el servicio nuevo sirva las rutas viejas como alias justamente para poder levantarlo contra un Nest sin recompilar, así que este task **no bloquea el bring up**. Lo que resuelve es dejar de depender de ese alias.

**Files:**
- Modify: `electron/memory-connection-state.ts`
- Modify: `electron/main.ts:210-212` y la construcción del daemon
- Modify: `electron/memory-daemon.ts:56` (`MemoryDaemonDeps`), `:301`, `:421`
- Test: `electron/__tests__/memory-daemon.test.ts`, `electron/__tests__/memory-connection-state.test.ts`

**Interfaces:**
- Consumes: `MemoryConnectionState` del Task 3 (con `localEnabled` ya presente).
- Produces: `MemoryConnectionState` gana `syncBaseUrl: string | null` (default `null`). `MemoryDaemonDeps.getSupabaseUrl` se renombra a `getSyncBaseUrl: () => string | null`. Las rutas pasan a `${base}/v1/sync/push` y `${base}/v1/sync/pull`.

- [ ] **Step 1: Escribir los tests que fallan**

En `electron/__tests__/memory-daemon.test.ts`:

```ts
it('pega contra /v1/sync/push con la base configurada', async () => {
  const pending: MutationLogRow[] = [
    { seq: 1, sync_id: 'a', op: 'upsert', payload: JSON.stringify({ sync_id: 'a', project_key: 'proj-1' }), created_at: 1, pushed_at: null, last_error: null },
  ]
  const store = fakeStore({ pendingMutations: vi.fn(() => pending) })
  const urls: string[] = []
  const fetchImpl = vi.fn(async (url: string) => {
    urls.push(url)
    return new Response(JSON.stringify({ results: [] }), { status: 200 })
  }) as unknown as typeof fetch

  const daemon = new MemoryDaemon({
    store,
    getSyncBaseUrl: () => 'https://memory.nestmux.com',
    getToken: () => 'nmk_test',
    getDeviceId: () => 'device-1',
    isOnline: () => true,
    fetchImpl,
  })
  await daemon.push()

  expect(urls[0]).toBe('https://memory.nestmux.com/v1/sync/push')
})
```

En `electron/__tests__/memory-connection-state.test.ts`:

```ts
it('syncBaseUrl arranca en null y persiste cuando se setea', () => {
  expect(getMemoryConnectionState(home).syncBaseUrl).toBeNull()
  setMemoryConnectionState(home, {
    connected: false,
    localEnabled: true,
    deviceId: null,
    connectedAt: null,
    syncBaseUrl: 'https://memory.nestmux.com',
  })
  expect(getMemoryConnectionState(home).syncBaseUrl).toBe('https://memory.nestmux.com')
})
```

- [ ] **Step 2: Correr y verificar que fallan**

```bash
npx vitest run electron/__tests__/memory-daemon.test.ts electron/__tests__/memory-connection-state.test.ts
```

Esperado: FAIL — `getSyncBaseUrl` no existe y la URL tiene la forma vieja.

- [ ] **Step 3: Implementar el estado**

En `electron/memory-connection-state.ts`, al interface y al default:

```ts
  /**
   * C4: base del servicio de sync. `null` significa "usá la del build" (el env
   * MAIN_VITE_SUPABASE_URL), que es lo que hace que una instalación existente siga
   * andando sin tocar nada. Vive acá y no en settings-store.ts porque es estado del
   * subsistema de memoria, igual que deviceId, y porque apuntar a otro backend no debería
   * exigir recompilar la app.
   */
  syncBaseUrl: string | null
```

```ts
const DEFAULT_STATE: MemoryConnectionState = {
  connected: false,
  localEnabled: true,
  deviceId: null,
  connectedAt: null,
  syncBaseUrl: null,
}
```

- [ ] **Step 4: Implementar en main.ts**

Reemplazar `getMemorySupabaseUrl`:

```ts
function getMemorySyncBaseUrl(): string | null {
  return (
    memoryConnectionState.syncBaseUrl ??
    (import.meta.env.MAIN_VITE_SUPABASE_URL as string | undefined) ??
    null
  )
}
```

Y en la construcción del daemon, `getSupabaseUrl: getMemorySupabaseUrl` pasa a `getSyncBaseUrl: getMemorySyncBaseUrl`.

- [ ] **Step 5: Implementar en el daemon**

En `MemoryDaemonDeps`:

```ts
  /** C4: base del servicio de sync, no necesariamente Supabase. Ver spec §5.4. */
  getSyncBaseUrl: () => string | null
```

Las dos URLs:

```ts
      const response = await this.fetch(`${url}/v1/sync/push`, {
```

```ts
      const response = await this.fetch(`${url}/v1/sync/pull`, {
```

Y actualizar las lecturas de `getSupabaseUrl` dentro de `doPush`/`doPull` al nombre nuevo, más el `baseDaemonDeps` del archivo de tests (es un solo lugar).

- [ ] **Step 6: Correr y verificar que pasa**

```bash
npx vitest run electron/__tests__/memory-*.test.ts
```

Esperado: PASS.

- [ ] **Step 7: Commit**

```bash
git add electron/memory-connection-state.ts electron/main.ts electron/memory-daemon.ts electron/__tests__/
git commit -m "feat(memory): la base del sync es configurable y usa las rutas /v1/sync/*"
```

---

### Task 8: C8 — nombre de device real

`src/hooks/useMemory.ts:83` manda `navigator.platform` como nombre del device. En las dos PCs de Windows eso da `Win32`, así que el servidor las colapsa en una: dos máquinas compartiendo un `device_id` significa cursores pisados y una cola de push que se cree de otro. El renderer no tiene forma de saber el hostname; sale del main.

**Files:**
- Modify: `electron/main.ts` (handler IPC nuevo)
- Modify: `electron/preload.ts`
- Modify: `src/hooks/useMemory.ts:83`

**Interfaces:**
- Consumes: nada de tasks anteriores.
- Produces: `window.memory.deviceInfo(): Promise<{ name: string; platform: string }>`, con `name = os.hostname()` y `platform = process.platform`.

- [ ] **Step 1: Agregar el handler en main.ts**

Junto a los otros `ipcMain.handle('memory:...')`, con `import { hostname } from 'os'` arriba:

```ts
// C8: el renderer sólo tiene navigator.platform, que da 'Win32' en cualquier Windows —
// las dos PCs del mismo usuario llegaban al servidor con el mismo nombre y se colapsaban
// en un device. El hostname sólo existe en el main.
ipcMain.handle('memory:deviceInfo', () => ({ name: hostname(), platform: process.platform }))
```

- [ ] **Step 2: Exponerlo en el preload**

En `electron/preload.ts`, dentro del objeto `memory`:

```ts
  deviceInfo: () => ipcRenderer.invoke('memory:deviceInfo'),
```

Y sumar la firma al tipo de `window.memory` donde esté declarado.

- [ ] **Step 3: Usarlo en el hook**

`src/hooks/useMemory.ts`, reemplazar la línea 83:

```ts
      const device = await api.deviceInfo()
      const { data, error } = await supabase.functions.invoke('memory-token', {
        body: { action: 'issue', device },
      })
```

- [ ] **Step 4: Verificar a mano**

```bash
npm run native:electron
npm run dev
```

En DevTools: `await window.memory.deviceInfo()`. Esperado: el hostname real de la máquina, no `Win32`.

- [ ] **Step 5: Commit**

```bash
git add electron/main.ts electron/preload.ts src/hooks/useMemory.ts
git commit -m "fix(memory): las dos PCs llegaban al servidor con el mismo nombre de device"
```

---

### Task 9: C7 — token pegado a mano y el estado `unavailable`

Dos cosas en la misma card.

**El token.** En el beta de una cuenta no hay emisión de credenciales (spec §9.1): se genera con `openssl rand`, se pega a mano en Settings, y el servicio guarda sólo el sha256. Eso reemplaza el `supabase.functions.invoke('memory-token')` del hook, que pega contra una edge function que **nunca se deployó a producción**: apretar Connect hoy da un 404 disfrazado de "Couldn't sync".

**El estado `unavailable`.** `useMemory` ya sabe que `window.memory` puede no existir (fix `bc647ee`), pero cuando no está se queda en `disconnected`, que es indistinguible de "todo bien, no conectaste". Con el subsistema caído la card se disfraza de sana.

**Files:**
- Modify: `src/hooks/useMemory.ts`
- Modify: `src/components/SettingsPanel.tsx:400-440`
- Test: `src/__tests__/hooks/useMemory.test.tsx` (crear)

**Interfaces:**
- Consumes: `window.memory.connect(token, deviceId)` y `window.memory.ensureDeviceId()`, que ya existen; `deviceInfo()` del Task 8.
- Produces: `MemoryCardState` gana `'unavailable'`. `useMemory` devuelve `connectWithToken(token: string): Promise<void>` en lugar de `connect()`.

- [ ] **Step 1: Escribir el test que falla**

Crear `src/__tests__/hooks/useMemory.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { useMemory } from '../../hooks/useMemory'

describe('useMemory — estado unavailable y token a mano (C7)', () => {
  beforeEach(() => { (window as { memory?: unknown }).memory = undefined })

  it('reporta unavailable cuando el subsistema no levantó', async () => {
    const { result } = renderHook(() => useMemory())
    await waitFor(() => expect(result.current.state).toBe('unavailable'))
  })

  it('conecta con un token pegado a mano', async () => {
    const connect = vi.fn(async () => ({ ok: true }))
    ;(window as { memory?: unknown }).memory = {
      status: vi.fn(async () => ({ connected: true, daemonStatus: 'idle', itemCount: 3, pendingCount: 0, deviceId: 'dev-1' })),
      onStatus: vi.fn(),
      removeStatusListener: vi.fn(),
      ensureDeviceId: vi.fn(async () => 'dev-1'),
      deviceInfo: vi.fn(async () => ({ name: 'PC-GERO', platform: 'win32' })),
      connect,
    }

    const { result } = renderHook(() => useMemory())
    await result.current.connectWithToken('  nmk_pegado_a_mano  ')

    expect(connect).toHaveBeenCalledWith('nmk_pegado_a_mano', 'dev-1')
    await waitFor(() => expect(result.current.state).toBe('connected'))
  })
})
```

- [ ] **Step 2: Correr y verificar que falla**

```bash
npx vitest run src/__tests__/hooks/useMemory.test.tsx
```

Esperado: FAIL — `unavailable` no existe y `connectWithToken` tampoco.

- [ ] **Step 3: Implementar el hook**

En `src/hooks/useMemory.ts`:

```ts
export type MemoryCardState =
  | 'unavailable'
  | 'disconnected'
  | 'connecting'
  | 'migrating'
  | 'connected'
  | 'paused'
  | 'error'
```

El `useEffect` de montaje tiene que decirlo en vez de callarse:

```ts
  useEffect(() => {
    const api = memoryApi()
    if (!api) {
      // C7: sin esto la card se queda en 'disconnected', que es indistinguible de "todo
      // bien, no conectaste" — con el subsistema caído la UI se disfrazaba de sana.
      setState((s) => ({ ...s, state: 'unavailable' }))
      return
    }
    refresh()
    api.onStatus(() => { void refresh() })
    return () => api.removeStatusListener()
  }, [refresh])
```

Y reemplazar `connect` por `connectWithToken`:

```ts
  /**
   * C7: el beta de una cuenta no emite credenciales (spec §9.1) — el token se genera con
   * `openssl rand`, se pega acá, y el servicio guarda sólo el sha256. Esto reemplaza el
   * `supabase.functions.invoke('memory-token')` anterior, que además pegaba contra una
   * edge function que nunca se deployó a producción.
   */
  const connectWithToken = useCallback(async (token: string) => {
    connectingRef.current = true
    setState((s) => ({ ...s, state: 'connecting', error: null }))
    try {
      const api = memoryApi()
      if (!api) throw new Error('Memory is not available in this build')
      const deviceId = await api.ensureDeviceId()
      setState((s) => ({ ...s, state: 'migrating' }))
      const result = await api.connect(token.trim(), deviceId)
      if (!result.ok) throw new Error(result.error ?? 'Connect failed')
      connectingRef.current = false
      await refresh()
    } catch (err) {
      connectingRef.current = false
      setState((s) => ({ ...s, state: 'error', error: err instanceof Error ? err.message : String(err) }))
    }
  }, [refresh])
```

Devolver `connectWithToken` en lugar de `connect` al final del hook.

- [ ] **Step 4: Correr y verificar que pasa**

```bash
npx vitest run src/__tests__/hooks/useMemory.test.tsx
```

Esperado: PASS.

- [ ] **Step 5: Actualizar la card**

En `src/components/SettingsPanel.tsx` (alrededor de `:400-440`), con `const [token, setToken] = useState('')` en el componente. Copy en inglés:

```tsx
{memory.state === 'unavailable' ? (
  <p className="settings-hint settings-hint--warn">
    Memory didn&apos;t start on this machine. Restart Nest; if it keeps failing, check the logs.
  </p>
) : memory.state === 'disconnected' ? (
  <div className="memory-connect-row">
    <input
      type="password"
      className="settings-input"
      placeholder="Paste your sync token"
      value={token}
      onChange={(e) => setToken(e.target.value)}
      aria-label="Memory sync token"
    />
    <button className="btn" disabled={!token.trim()} onClick={() => void memory.connectWithToken(token)}>
      Connect
    </button>
  </div>
) : null}
```

- [ ] **Step 6: Verificar a mano**

```bash
npm run native:electron
npm run dev
```

Settings → Account. Esperado: con el subsistema sano aparece el input; rompiendo a propósito el `new MemoryStore(...)` de main.ts, aparece el mensaje de `unavailable` y **no** el input.

- [ ] **Step 7: Correr la suite entera y commitear**

```bash
npx vitest run
git add src/hooks/useMemory.ts src/components/SettingsPanel.tsx src/__tests__/hooks/useMemory.test.tsx
git commit -m "feat(memory): token pegado a mano y la card deja de disfrazarse de sana"
```

---

## Qué queda afuera de este plan

- **El servicio de sync** (spec §5 a §9, §11, §13). Es el otro plan: dos handlers, un Postgres, el `project_seq` por rango y la resolución de colisión del lado servidor. Sin él, los tasks 7 a 9 quedan escritos pero sin round trip real.
- **Los tombstones** (spec §8.2). El arreglo es del lado servidor (`content` nullable y leer `op`); del lado cliente no hay cambio. Además hoy está latente: `deleteObservation` casi no tiene callers.
- **Layer B**, la captura por hooks que casi no captura: `SessionStart` sólo lee, `Stop` no escribe y `PreCompact` deja un placeholder que nadie resuelve. Es la deuda más grande del subsistema después de esto, y no es un cambio de wire.
- **El importer de markdown apuntando a la carpeta equivocada** (`{accountDir}/.claude/memory/` en vez de `{accountDir}/.claude/projects/<slug>/memory/`), que en esta máquina importaría 0 sobre 530 archivos reales.
- **`search()` de frase exacta**, sin bm25 ni prefijo ni OR ni stemming.
- **El gate de plan en el renderer** (spec §9.3): pasa a ser server-side cuando exista el servidor.
