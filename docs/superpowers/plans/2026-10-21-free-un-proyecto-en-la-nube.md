# Free con un proyecto en la nube (2b-1) — plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que un usuario Free pueda conectar la nube de memoria (como promete el pricing: un proyecto), y que la app diga cuál repo ocupa ese lugar, cuáles quedaron sólo en esta máquina y cómo pasar a Cloud, sin leer el tope del plan como una falla.

**Architecture:** El servidor ya aplica el tope (`server/src/limits.ts`, `push.ts`); sólo suma `limits.max_projects` a `GET /v1/sync/status`. El daemon guarda ese tope y las keys del roster; el store agrupa las mutaciones retenidas por `project_limit_reached` por proyecto y resuelve nombres locales. Todo llega al renderer por los dos canales que ya existen: `memory:status` (tope + roster, al lado de `quota`) y `memory:doctor` (repos afuera, al lado de `blocked`). En el renderer, `PLAN_LIMITS.free.memoryCloud` pasa a `true`, Settings › Sync suma la fila pura «Projects in the cloud» y la fila de estado de Memories trata el tope como plan funcionando (gris + Upgrade), no como bloqueo.

**Tech Stack:** Servidor Node + `pg` + Vitest contra Postgres real. App Electron + Vite + React 18.3 + TypeScript, better-sqlite3, Tailwind v4 sin preflight + shadcn, Vitest + Testing Library (jsdom), Playwright contra `dist/` (headless).

**Spec:** `docs/superpowers/specs/2026-10-21-free-un-proyecto-en-la-nube-design.md` (commit `209a8a2`). Manda el spec; donde es ambiguo, manda la lista **Decisiones** de abajo.

## Decisiones (donde el spec no alcanza)

- **D1 — Los nombres del roster son LOCALES.** El `display_name` de `status.projects` viaja cifrado (`nmc1:`) y el daemon ya no lo usa. El nombre sale del store: `display_name` local si no es el marcador (igual a la `project_key`); si no, el basename de `root_path`; si tampoco, los 8 primeros caracteres de la key. Misma regla para los repos afuera.
- **D2 — Por dónde viaja cada dato (sin canal nuevo).** `memory:status` suma `limits` (de `daemon.getLimits()`) y `cloudProjects: Array<{ projectKey; name }>` (keys del roster resueltas por `store.nombresDeProyectos`). `memory:doctor` suma `localOnlyProjects: Array<{ projectKey; name; count }>` (`store.proyectosRetenidosPor('project_limit_reached')`). `useMemory` lee además `doctor?.()` (opcional, con su propio `catch`) para la fila de Sync; `useMemories` ya lo lee para la fila de estado.
- **D3 — "Con tope" = `max_projects < 100`** (`TOPE_SIN_LIMITE`, el de Cloud en `server/src/limits.ts`). Tope desconocido (servicio viejo sin `limits`) se muestra como "sin tope": `N projects`.
- **D4 — La línea `Local only…` y su Upgrade sólo con tope**, y sin los proyectos que el roster ya tiene (por `projectKey`). Un Cloud con retenidas viejas —antes del destrabe por cambio de plan— no ve Upgrade.
- **D5 — Roster vacío con tope:** `0 of 1`, sin ` · `.
- **D6 — Fila de estado sin tope conocido:** sólo `{n} memories stay on this machine` (el prefijo del copy del spec), sin inventar cuántos proyectos sincroniza el plan.
- **D7 — Semáforo.** `memories-status.ts` exporta `bloqueadasPorFalla(groups)` (todas menos `project_limit_reached`) y `useMemories` se lo pasa a `summarizeMemories` como `blockedTotal`. `MemoriesState.blockedTotal` sigue siendo el total del doctor; la celda de desglose se dibuja con `blocked.length > 0`.
- **D8 — Plan desconocido.** `planIncluyeNube(plan)` (en `stripe.ts`) devuelve `false` para un plan que `PLAN_LIMITS` no conoce: es el único caso donde queda «Local memory active — cloud sync is a Cloud feature». `nubeDeMemoriaDisponible` no cambia.
- **D9 — Un solo modal de planes.** `PlanesModal` sale de `MemorySettingsTab.tsx` a `src/components/PlanesModal.tsx` y lo usan «See plans» y el Upgrade de la fila de estado. El Upgrade de «Projects in the cloud» reusa el portal de `UpgradeModal` que `CloudMemoryCard` ya tiene (`setMemoryUpgradeOpen`): mismo componente.
- **D10 — El daemon vacía tope y roster en `setStore`** (cambio de cuenta). Un status sin `limits` conserva el último conocido (como `quota`); un status con `projects` reemplaza el roster.
- **D11 — Lugar de la fila:** justo debajo de «Cloud sync», antes de «Cloud space».
- **D12 — El contrato del servidor se prueba sin base:** `statusLimitsFor(plan)` puro en `limits.ts`; el test de `handleStatus` (Postgres) lo confirma de punta a punta.
- **D13 — El literal del motivo vive dos veces:** `MOTIVO_TOPE_DE_PROYECTOS` en `electron/memory-daemon.ts` y `MOTIVO_TOPE_DE_PLAN` en `src/lib/memories-status.ts` (el renderer no importa de `electron/`).
- **D14 — e2e:** el test de `e2e/03` «Upgrade desde la pestaña Settings…» dependía de que Free viera Upgrade en Cloud sync; con este cambio se saltearía siempre. Se reescribe fingiendo `memory:status`/`memory:doctor` desde el proceso main (`ipcMain.removeHandler` + `handle`) y mide el Upgrade de «Projects in the cloud».

**Gaps del spec (avisarle a Gero):**
1. §4.4 dice que el roster sale de `status.projects`, pero ahí el nombre viaja cifrado. Se usan nombres locales (D1); un proyecto que sólo existe en la nube (subido desde otra máquina, nunca clonado acá) se ve con la key corta (`a3f9c2e8`).
2. §4.1 deja «cloud sync is a Cloud feature» para planes desconocidos, pero `useProfile` normaliza todo plan desconocido a `free`: en la práctica ese texto ya no aparece (D8).
3. §4.5 no dice qué mostrar si el servidor no informa `max_projects` (servicio viejo): D6.
4. §4.5: con sólo memorias retenidas por el tope, el semáforo queda verde «N items · synced» aunque esas memorias no estén en la nube. Es lo que pide el spec ("es el plan funcionando"); el badge gris de al lado lo aclara.
5. §5 pide "e2e: sólo los existentes", pero el existente fijaba el comportamiento viejo (D14).

## Global Constraints

- Copy de la UI **en inglés**, exactamente el de spec §4.7 (tabla de abajo). Ningún literal de string de 4–200 caracteres en `src/**` (fuera de `__tests__` y `src/tutorial/`) puede tener `áéíóúñ¿¡` (`src/__tests__/la-app-es-en-ingles.test.ts`). Los comentarios pueden ir en español.
- **Sin canal IPC nuevo** (spec §4.2/§4.3): todo va por `memory:status` y `memory:doctor`. **Sin migración de esquema** (ni en SQLite ni en Postgres).
- **Componentes nuevos con shadcn + utilidades Tailwind**, nunca clases nuevas en `global.css`. Colores sólo por tokens (`text-muted-foreground`, `text-warn`, `text-destructive`…). Ningún `sp-*` ni estilo inline en lo nuevo.
- Tailwind **sin preflight**: no importar `"tailwindcss"` entero.
- Nada en `src/components/memories/` (incluida `memories/settings/`) importa `window.memory`, `window.settings`, `electron` ni hooks que lo hagan: entra todo por props.
- `nubeDeMemoriaDisponible` y la beta cerrada no cambian: una cuenta fuera de la allowlist sigue recibiendo `not_in_beta` y se muestra con `textoDeErrorDeMemoria`.
- **Sin dependencias nuevas.** Si por algo hay que correr `npm install`, después correr `node .superpowers/sdd/2026-10-20-memories-estilo-obsidian/tools/restaurar-libc.mjs`.
- Typecheck real (los dos de CI): `npx tsc -p tsconfig.node.json --noEmit --composite false` y `npx tsc -p tsconfig.web.json --noEmit --composite false`. Baseline: 0 errores. **No usar `tsc -b`.** Servidor: `cd server && npx tsc --noEmit`.
- Tests de componentes y lógica: `npx vitest run <archivo>`. Tests que tocan SQLite (o cualquier `electron/__tests__`): `npx vitest run --config node_modules/.bs3-node/vitest.bs3.config.ts <archivo>`. **Suite completa al cierre de cada tarea:** `npx vitest run --config node_modules/.bs3-node/vitest.bs3.config.ts` (incluye los de SQLite sin swapear el binding). No usar `npm test`: su `pretest` corre `native:node`.
- **Tests del servidor:** van contra Postgres REAL (nunca mocks), salvo `server/__tests__/limits.test.ts`, que es puro. Al planificar (21-10) Docker Desktop **no estaba corriendo** (`failed to connect to the docker API`). Para correrlos: abrir Docker Desktop, `docker start nest-memory-pg` (si no existe, el `docker run -d --name nest-memory-pg -e POSTGRES_PASSWORD=nestmem -e POSTGRES_DB=nest_memory -p 55432:5432 postgres:16-alpine` de `server/README.md`), y desde `server/`: `npx vitest run __tests__/<archivo>`. `DATABASE_URL` ya tiene default a `127.0.0.1:55432` (`server/src/db.ts`). Las migraciones corren solas. Si Docker no levanta: avisar, dejar corrido el test puro y el `tsc` del servidor, y seguir.
- **Hay `electron.exe` vivos de este worktree** que tienen tomado el binding de better-sqlite3: `npm run native:*` puede dar `EBUSY`. **No matarlos**: avisar y seguir con lo que no lo necesita.
- **e2e SIEMPRE headless** (Gero lo pidió): nunca setear `RAVEN_E2E_SHOW=1`. Corre contra `dist/`: `npm run build` antes y el binding de Electron puesto (`npm run native:electron`).
- Commits locales en `feat/memories-settings`, sin push. Mensaje terminado en `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`. `git add` **sólo los archivos de la tarea**: el árbol tiene cambios ajenos sin commitear (`.superpowers/sdd/.gitignore`, PNGs de `.superpowers/sdd/shots/`, `docs/HANDOFF-2026-10-20-memories-obsidian.md`) que no se tocan.

### Copy (spec §4.7, verbatim)

| Lugar | Texto |
|---|---|
| Fila | `Projects in the cloud` |
| Con tope | `{n} of {max} · {nombres}` (nombres con `, `) |
| Sin tope | `{n} projects` (`1 project` en singular) |
| Afuera | `Local only: {nombres} — Cloud syncs all your projects.` |
| Botón | `Upgrade` |
| Estado | `{n} memories stay on this machine — your plan syncs {max === 1 ? 'one project' : max + ' projects'}` (`1 memory stays…` en singular) |

## Review Focus

1. **Cambio de cuenta en la misma máquina.** El daemon retiene tope y roster; sin vaciarlos en `setStore`, la cuenta nueva vería «1 of 1 · <repo de la otra cuenta>» hasta el próximo status. La persona espera ver sólo lo suyo. Test en Task 3.
2. **Un Cloud con retenidas viejas.** Entre que el plan cambia y el daemon destraba, el doctor todavía trae `project_limit_reached`: la persona que ya paga no tiene que ver «Local only… Upgrade». Test en Task 5 (D4).
3. **Un proyecto que está en el roster y también retenido** (p. ej. bajó de plan después de subir varios): no puede figurar a la vez arriba y en `Local only`. Test en Task 5.
4. **Un proyecto sin nombre local** (vino del roster de otra máquina y nunca se clonó acá): nunca se muestra `nmc1:…` ni el hash entero. Test en Task 2.
5. **Un payload de `mutation_log` ilegible o una retenida de `__global__`:** el agrupado no explota ni muestra "Global" como repo afuera. Test en Task 2.

---

## Mapa de archivos

**Nuevos**
- `src/lib/proyectos-en-la-nube.ts` — copy y reglas puras de la fila «Projects in the cloud».
- `src/components/memories/settings/CloudProjectsRow.tsx` — la fila, pura.
- `src/components/PlanesModal.tsx` — el `UpgradeModal` montado sólo abierto (sale de `MemorySettingsTab.tsx`).
- Tests: `electron/__tests__/memory-store-tope-de-proyectos.test.ts`, `electron/__tests__/memory-daemon-tope-de-proyectos.test.ts`, `src/__tests__/lib/proyectos-en-la-nube.test.ts`, `src/__tests__/components/CloudProjectsRow.test.tsx`, `src/__tests__/components/CloudMemoryCard-plan-desconocido.test.tsx`.

**Modificados**
- Servidor: `server/src/limits.ts`, `server/src/status.ts`, `server/README.md`, `server/__tests__/limits.test.ts`, `server/__tests__/limits-status.test.ts`.
- Main: `electron/memory-store.ts`, `electron/memory-daemon.ts`, `electron/main.ts`, `src/types.ts`.
- Renderer: `src/lib/stripe.ts`, `src/components/CloudMemoryCard.tsx`, `src/components/SyncTokenRow.tsx`, `src/hooks/useMemory.ts`, `src/lib/memories-status.ts`, `src/hooks/useMemories.ts`, `src/components/MemoriesStatusRow.tsx`, `src/components/MemorySettingsTab.tsx`.
- Tests: `src/__tests__/lib/planes.test.ts`, `src/__tests__/components/CloudMemoryCard.test.tsx`, `src/__tests__/components/SyncTokenRow.test.tsx`, `src/__tests__/hooks/useMemory.test.tsx`, `src/__tests__/memories-status.test.ts`, `src/__tests__/hooks/useMemories.test.tsx`, `src/__tests__/components/MemoriesStatusRow.test.tsx`, `e2e/03-memories-in-app.spec.ts`.

---

### Task 1: El servidor informa el tope de proyectos en `GET /v1/sync/status`

**Files:**
- Modify: `server/src/limits.ts` (al final), `server/src/status.ts` (import, `StatusResponse`, el `return` de `handleStatus`), `server/README.md:14`
- Test: `server/__tests__/limits.test.ts` (puro), `server/__tests__/limits-status.test.ts` (Postgres)

**Interfaces:**
- Produces (`server/src/limits.ts`): `statusLimitsFor(plan: string): { max_projects: number }`.
- Produces (wire): `StatusResponse.limits: { max_projects: number }` — Free 1, Cloud/pro 100, team/enterprise el de Teams (100). Aditivo.

- [ ] **Step 1: Test puro que falla.** En `server/__tests__/limits.test.ts`, cambiar el import a `import { limitsFor, maxBytesFor, resolveMaxBytes, statusLimitsFor } from '../src/limits'` y sumar al final:

```ts
// Spec 2b-1 §4.2: lo que `status` le informa al cliente del tope de proyectos. Puro, para que
// el contrato se pruebe sin Postgres.
describe('statusLimitsFor — el tope que status le informa a la app', () => {
  it('Free: un proyecto', () => {
    expect(statusLimitsFor('free')).toEqual({ max_projects: 1 })
  })

  it('Cloud y pro: 100', () => {
    expect(statusLimitsFor('cloud')).toEqual({ max_projects: 100 })
    expect(statusLimitsFor('pro')).toEqual({ max_projects: 100 })
  })

  it('team y enterprise: el de Teams', () => {
    expect(statusLimitsFor('team')).toEqual({ max_projects: limitsFor('team').maxProjects })
    expect(statusLimitsFor('enterprise')).toEqual({ max_projects: limitsFor('team').maxProjects })
  })

  it('un plan desconocido cae a Free: fallar cerrado', () => {
    expect(statusLimitsFor('legacy')).toEqual({ max_projects: 1 })
  })
})
```

- [ ] **Step 2:** `cd server && npx vitest run __tests__/limits.test.ts` → FAIL (`statusLimitsFor` no existe). No necesita Postgres.

- [ ] **Step 3: La función.** Al final de `server/src/limits.ts`:

```ts
/**
 * Lo que `GET /v1/sync/status` le informa a la app de los topes del plan (spec 2b-1 §4.2).
 * Sólo el de proyectos: es el único que la app necesita para decir "1 of 1" y por qué un repo
 * quedó sólo en la máquina. Sale de `limitsFor`, la misma fuente que aplica el rechazo
 * `project_limit_reached` en `push.ts`: lo informado y lo aplicado no pueden divergir.
 */
export function statusLimitsFor(plan: string): { max_projects: number } {
  return { max_projects: limitsFor(plan).maxProjects }
}
```

- [ ] **Step 4:** `cd server && npx vitest run __tests__/limits.test.ts` → PASS.

- [ ] **Step 5: Test de punta a punta que falla (Postgres).** Levantar la base (ver Global Constraints). Al final de `server/__tests__/limits-status.test.ts`:

```ts
describe('status — informa el tope de proyectos del plan (spec 2b-1 §4.2)', () => {
  // team/enterprise = el de Teams, que hoy hereda el de Cloud (TEAM = { ...CLOUD } en limits.ts).
  it.each([
    ['free', 1],
    ['cloud', 100],
    ['pro', 100],
    ['team', 100],
    ['enterprise', 100],
  ])('%s → max_projects %i', async (plan, max) => {
    const res = await handleStatus(pool, await seed(plan))
    expect(res.limits).toEqual({ max_projects: max })
  })
})
```

- [ ] **Step 6:** `cd server && npx vitest run __tests__/limits-status.test.ts` → FAIL (`res.limits` undefined; en TS, error de tipos en el test).

- [ ] **Step 7: `handleStatus`.** En `server/src/status.ts`: import `import { limitsFor, maxBytesFor, statusLimitsFor } from './limits'`. En `interface StatusResponse`, después de `quota`:

```ts
  /**
   * Spec 2b-1 §4.2: el tope de proyectos del plan, para que la app muestre "1 of 1" y explique
   * por qué un repo quedó sólo en la máquina. Aditivo: un cliente viejo lo ignora.
   */
  limits: { max_projects: number }
```

y en el `return` de `handleStatus`, después de la línea de `quota`:

```ts
    limits: statusLimitsFor(auth.plan),
```

En `server/README.md`, la fila de la tabla de rutas:

```
| `GET /v1/sync/status` | — | §5.3 — identidad del device, plan, cuota, `next_poll_ms` y el tope de proyectos del plan (`limits.max_projects`, spec 2b-1). |
```

- [ ] **Step 8:** `cd server && npx vitest run __tests__/limits.test.ts __tests__/limits-status.test.ts __tests__/status.test.ts __tests__/status-team-keys.test.ts` → PASS. `cd server && npx tsc --noEmit` → 0.

- [ ] **Step 9: Commit.**

```bash
git add server/src/limits.ts server/src/status.ts server/README.md server/__tests__/limits.test.ts server/__tests__/limits-status.test.ts
git commit -m "feat(sync): status informa el tope de proyectos del plan

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: El store agrupa lo retenido por proyecto y resuelve nombres locales

**Files:**
- Modify: `electron/memory-store.ts` (métodos nuevos, justo después de `heldTeamMutationCount`, ~línea 2347)
- Test: `electron/__tests__/memory-store-tope-de-proyectos.test.ts` (nuevo, SQLite)

**Interfaces:**
- Produces (`MemoryStore`):
  - `nombresDeProyectos(keys: readonly string[]): Array<{ projectKey: string; name: string }>` — mismo orden que `keys`.
  - `proyectosRetenidosPor(reason: string): Array<{ projectKey: string; name: string; count: number }>` — sin `__global__`, más retenidas primero, empate por nombre.

- [ ] **Step 1: Tests que fallan.** Crear `electron/__tests__/memory-store-tope-de-proyectos.test.ts`:

```ts
// Spec 2b-1 §4.3: qué repos quedaron sólo en esta máquina por el tope del plan, y con qué
// nombre se los muestra. Lectura nueva sobre datos que ya existen: sin migración.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { join } from 'path'
import { makeTmpDir, cleanupTmp } from './setup'
import { MemoryStore } from '../memory-store'

let dir: string
let store: MemoryStore

beforeEach(() => {
  dir = makeTmpDir('ms-tope-')
  store = new MemoryStore(join(dir, 'memory.db'))
})
afterEach(() => {
  store.close()
  cleanupTmp(dir)
})

/** Guarda `n` memorias en el proyecto y retiene sus mutaciones con `reason`. */
function guardarYRetener(projectKey: string, n: number, reason = 'project_limit_reached'): void {
  for (let i = 0; i < n; i++) {
    store.save({ projectKey, type: 'decision', title: `${projectKey} ${i}`, content: `content for ${projectKey} number ${i}`, source: 'mcp' })
  }
  const propias = store.pendingMutations(10_000).filter((m) => JSON.parse(m.payload).project_key === projectKey)
  store.blockMutations(propias.map((m) => ({ seq: m.seq, reason })))
}

const db = () => (store as unknown as { db: { prepare(sql: string): { run(...a: unknown[]): unknown } } }).db

describe('proyectosRetenidosPor', () => {
  it('agrupa por proyecto, más retenidas primero, con el nombre local', () => {
    store.ensureProject({ projectKey: 'k-api', displayName: 'api' })
    store.ensureProject({ projectKey: 'k-web', displayName: 'web' })
    guardarYRetener('k-api', 2)
    guardarYRetener('k-web', 5)

    expect(store.proyectosRetenidosPor('project_limit_reached')).toEqual([
      { projectKey: 'k-web', name: 'web', count: 5 },
      { projectKey: 'k-api', name: 'api', count: 2 },
    ])
  })

  it('__global__ nunca aparece: no ocupa lugar en la nube', () => {
    guardarYRetener('__global__', 3)
    expect(store.proyectosRetenidosPor('project_limit_reached')).toEqual([])
  })

  it('sólo cuenta el motivo pedido', () => {
    store.ensureProject({ projectKey: 'k-api', displayName: 'api' })
    guardarYRetener('k-api', 2, 'quota_exceeded')
    expect(store.proyectosRetenidosPor('project_limit_reached')).toEqual([])
  })

  it('una desbloqueada ya no cuenta', () => {
    store.ensureProject({ projectKey: 'k-api', displayName: 'api' })
    guardarYRetener('k-api', 2)
    store.unblockMutations(['project_limit_reached'])
    expect(store.proyectosRetenidosPor('project_limit_reached')).toEqual([])
  })

  it('un payload ilegible se saltea sin romper el resto (Review Focus 5)', () => {
    store.ensureProject({ projectKey: 'k-api', displayName: 'api' })
    guardarYRetener('k-api', 1)
    db().prepare(
      "INSERT INTO mutation_log (sync_id, op, payload, created_at, blocked_reason) VALUES ('roto', 'upsert', '{roto', 1, 'project_limit_reached')",
    ).run()
    db().prepare(
      "INSERT INTO mutation_log (sync_id, op, payload, created_at, blocked_reason) VALUES ('nulo', 'upsert', 'null', 1, 'project_limit_reached')",
    ).run()
    expect(store.proyectosRetenidosPor('project_limit_reached')).toEqual([{ projectKey: 'k-api', name: 'api', count: 1 }])
  })
})

describe('nombresDeProyectos (Review Focus 4)', () => {
  it('respeta el orden pedido y usa el display_name local', () => {
    store.ensureProject({ projectKey: 'k-b', displayName: 'b' })
    store.ensureProject({ projectKey: 'k-a', displayName: 'a' })
    expect(store.nombresDeProyectos(['k-b', 'k-a'])).toEqual([
      { projectKey: 'k-b', name: 'b' },
      { projectKey: 'k-a', name: 'a' },
    ])
    expect(store.nombresDeProyectos([])).toEqual([])
  })

  it('con el marcador (vino del roster cifrado) cae a la carpeta del repo', () => {
    store.ensureProject({ projectKey: 'abcdef0123456789', displayName: 'abcdef0123456789', rootPath: 'C:\\repos\\api' })
    store.ensureProject({ projectKey: '0123456789abcdef', displayName: '0123456789abcdef', rootPath: '/home/gero/web/' })
    expect(store.nombresDeProyectos(['abcdef0123456789', '0123456789abcdef']).map((p) => p.name)).toEqual(['api', 'web'])
  })

  it('sin nombre ni carpeta, la key corta — nunca el hash entero', () => {
    store.ensureProject({ projectKey: 'fedcba9876543210', displayName: 'fedcba9876543210' })
    expect(store.nombresDeProyectos(['fedcba9876543210', 'no-registrado-123'])).toEqual([
      { projectKey: 'fedcba9876543210', name: 'fedcba98' },
      { projectKey: 'no-registrado-123', name: 'no-regis' },
    ])
  })
})
```

- [ ] **Step 2:** `npx vitest run --config node_modules/.bs3-node/vitest.bs3.config.ts electron/__tests__/memory-store-tope-de-proyectos.test.ts` → FAIL (`proyectosRetenidosPor is not a function`).

- [ ] **Step 3: Los métodos.** En `electron/memory-store.ts`, después de `heldTeamMutationCount(...)`:

```ts
  /**
   * El nombre de un proyecto como lo reconoce la persona (spec 2b-1 §4.3, decisión D1): el
   * `display_name` local; si es el marcador (la propia `project_key`, lo que deja el roster
   * cifrado en una máquina que no clonó el repo) o falta, el nombre de la carpeta del repo; si
   * tampoco hay, los 8 primeros caracteres de la key. Nunca el `nmc1:` del roster.
   */
  private nombreParaMostrar(projectKey: string, fila: { display_name: string | null; root_path: string | null } | undefined): string {
    const nombre = fila?.display_name
    if (nombre && nombre !== projectKey) return nombre
    const carpeta = fila?.root_path?.split(/[\\/]/).filter(Boolean).pop()
    return carpeta || projectKey.slice(0, 8)
  }

  private filasDeProyectos(keys: readonly string[]): Map<string, { display_name: string | null; root_path: string | null }> {
    const filas = new Map<string, { display_name: string | null; root_path: string | null }>()
    if (keys.length === 0) return filas
    const placeholders = keys.map(() => '?').join(',')
    const rows = this.db
      .prepare(`SELECT project_key, display_name, root_path FROM projects WHERE project_key IN (${placeholders})`)
      .all(...keys) as Array<{ project_key: string; display_name: string | null; root_path: string | null }>
    for (const r of rows) filas.set(r.project_key, r)
    return filas
  }

  /** Los nombres para mostrar de estas keys, en el mismo orden (el roster de la nube, D1). */
  nombresDeProyectos(keys: readonly string[]): Array<{ projectKey: string; name: string }> {
    const filas = this.filasDeProyectos(keys)
    return keys.map((projectKey) => ({ projectKey, name: this.nombreParaMostrar(projectKey, filas.get(projectKey)) }))
  }

  /**
   * Spec 2b-1 §4.3: las mutaciones retenidas por `reason` (hoy `project_limit_reached`, que el
   * store no importa del daemon — mismo criterio que `heldTeamMutationCount`), agrupadas por
   * proyecto. `__global__` nunca aparece: no ocupa lugar en la nube (server/src/push.ts). Un
   * payload ilegible se saltea. Más retenidas primero.
   */
  proyectosRetenidosPor(reason: string): Array<{ projectKey: string; name: string; count: number }> {
    const filas = this.db
      .prepare('SELECT payload FROM mutation_log WHERE pushed_at IS NULL AND blocked_reason = ?')
      .all(reason) as Array<{ payload: string }>
    const porProyecto = new Map<string, number>()
    for (const { payload } of filas) {
      let p: unknown
      try { p = JSON.parse(payload) } catch { continue }
      if (typeof p !== 'object' || p === null) continue
      const pk = (p as Record<string, unknown>).project_key
      const key = typeof pk === 'string' && pk !== '' ? pk : GLOBAL_PROJECT_KEY
      if (key === GLOBAL_PROJECT_KEY) continue
      porProyecto.set(key, (porProyecto.get(key) ?? 0) + 1)
    }
    const nombres = this.filasDeProyectos([...porProyecto.keys()])
    return [...porProyecto]
      .map(([projectKey, count]) => ({ projectKey, name: this.nombreParaMostrar(projectKey, nombres.get(projectKey)), count }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
  }
```

- [ ] **Step 4:** `npx vitest run --config node_modules/.bs3-node/vitest.bs3.config.ts electron/__tests__/memory-store-tope-de-proyectos.test.ts electron/__tests__/memory-store.test.ts` → PASS. `npx tsc -p tsconfig.node.json --noEmit --composite false` → 0.

- [ ] **Step 5: Commit.**

```bash
git add electron/memory-store.ts electron/__tests__/memory-store-tope-de-proyectos.test.ts
git commit -m "feat(memory): el store agrupa lo retenido por el tope por proyecto

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: El daemon guarda tope y roster, y main los expone por `memory:status` y `memory:doctor`

**Files:**
- Modify: `electron/memory-daemon.ts` (constante, `StatusResponseBody`, campos privados ~línea 355, `setStore` ~línea 486, getters junto a `getQuota` ~línea 569, `doStatus` ~líneas 1239-1250), `electron/main.ts` (import línea 143; handlers `memory:status` ~3768 y `memory:doctor` ~4020), `src/types.ts` (tipo de `status` ~1037 y de `doctor` ~1213)
- Test: `electron/__tests__/memory-daemon-tope-de-proyectos.test.ts` (nuevo; usa un store falso y uno real)

**Interfaces:**
- Consumes: `MemoryStore.nombresDeProyectos`, `MemoryStore.proyectosRetenidosPor` (Task 2).
- Produces (`memory-daemon.ts`): `export const MOTIVO_TOPE_DE_PROYECTOS = 'project_limit_reached'`; `MemoryDaemon.getLimits(): { max_projects: number } | null`; `MemoryDaemon.getCloudProjectKeys(): string[] | null`.
- Produces (IPC, ver `src/types.ts`): `memory:status` suma `limits?: { max_projects: number }` y `cloudProjects?: Array<{ projectKey: string; name: string }>`; `memory:doctor` suma `localOnlyProjects?: Array<{ projectKey: string; name: string; count: number }>`.

- [ ] **Step 1: Tests que fallan.** Crear `electron/__tests__/memory-daemon-tope-de-proyectos.test.ts`:

```ts
// Spec 2b-1 §4.2/§4.6: el daemon guarda el tope de proyectos y el roster que informa el
// servidor, y un cambio de plan devuelve a la cola lo retenido por el tope.
import { describe, it, expect, vi } from 'vitest'
import { join } from 'path'
import { MemoryDaemon } from '../memory-daemon'
import { MemoryStore } from '../memory-store'
import { makeTmpDir, cleanupTmp } from './setup'

function fakeStore(overrides: Partial<MemoryStore> = {}): MemoryStore {
  return {
    pendingMutations: vi.fn(() => []),
    markPushed: vi.fn(),
    blockMutations: vi.fn(),
    blockedMutations: vi.fn(() => []),
    unblockMutations: vi.fn(),
    listProjects: vi.fn(() => []),
    ensureProject: vi.fn(),
    teamIdForProjectKey: vi.fn(() => null),
    setLocalTeamId: vi.fn(),
    knownKeyEpoch: vi.fn(() => 0),
    rememberKeyEpoch: vi.fn(),
    ...overrides,
  } as unknown as MemoryStore
}

const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body })

function daemonCon(store: MemoryStore, fetchImpl: ReturnType<typeof vi.fn>): MemoryDaemon {
  return new MemoryDaemon({
    store,
    getSyncBaseUrl: () => 'https://example.test',
    getToken: () => 'nmk_test',
    getDeviceId: () => 'device-1',
    isOnline: () => true,
    fetchImpl,
  } as unknown as ConstructorParameters<typeof MemoryDaemon>[0])
}

describe('MemoryDaemon — el tope de proyectos (2b-1 §4.2)', () => {
  it('guarda limits.max_projects y lo expone; null mientras no hubo status', async () => {
    const daemon = daemonCon(fakeStore(), vi.fn().mockResolvedValue(ok({ plan: 'free', limits: { max_projects: 1 } })))
    expect(daemon.getLimits()).toBeNull()
    await daemon.status()
    expect(daemon.getLimits()).toEqual({ max_projects: 1 })
  })

  it('un status sin limits (servicio viejo) conserva el último conocido', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(ok({ plan: 'free', limits: { max_projects: 1 } }))
      .mockResolvedValueOnce(ok({ plan: 'free' }))
    const daemon = daemonCon(fakeStore(), fetchImpl)
    await daemon.status()
    await daemon.status()
    expect(daemon.getLimits()).toEqual({ max_projects: 1 })
  })

  it('un limits roto se ignora', async () => {
    const daemon = daemonCon(fakeStore(), vi.fn().mockResolvedValue(ok({ plan: 'free', limits: { max_projects: '1' } })))
    await daemon.status()
    expect(daemon.getLimits()).toBeNull()
  })

  it('guarda las keys del roster, sin __global__ ni keys vacías', async () => {
    const daemon = daemonCon(fakeStore(), vi.fn().mockResolvedValue(ok({
      plan: 'free',
      projects: [{ project_key: 'k1', display_name: 'nmc1:xyz' }, { project_key: '__global__' }, { project_key: '' }],
    })))
    expect(daemon.getCloudProjectKeys()).toBeNull()
    await daemon.status()
    expect(daemon.getCloudProjectKeys()).toEqual(['k1'])
  })

  it('cambiar de cuenta vacía tope y roster (Review Focus 1)', async () => {
    const daemon = daemonCon(fakeStore(), vi.fn().mockResolvedValue(ok({
      plan: 'free', limits: { max_projects: 1 }, projects: [{ project_key: 'k1' }],
    })))
    await daemon.status()
    daemon.setStore(fakeStore())
    expect(daemon.getLimits()).toBeNull()
    expect(daemon.getCloudProjectKeys()).toBeNull()
  })
})

describe('MemoryDaemon — al pasar a Cloud, lo retenido por el tope vuelve a la cola (2b-1 §4.6)', () => {
  it('con plan cloud en el status siguiente, la mutación retenida vuelve a pendingMutations', async () => {
    const dir = makeTmpDir('md-tope-')
    const store = new MemoryStore(join(dir, 'memory.db'))
    try {
      store.save({ projectKey: 'k-web', type: 'decision', title: 'web', content: 'retained by the project cap', source: 'mcp' })
      const [m] = store.pendingMutations()
      store.blockMutations([{ seq: m.seq, reason: 'project_limit_reached' }])
      expect(store.pendingMutations()).toHaveLength(0)

      const fetchImpl = vi.fn()
        .mockResolvedValueOnce(ok({ plan: 'free', limits: { max_projects: 1 } }))
        .mockResolvedValueOnce(ok({ plan: 'cloud', limits: { max_projects: 100 } }))
      const daemon = daemonCon(store, fetchImpl)

      await daemon.status() // el primero sólo fija el plan: nada que destrabar
      expect(store.pendingMutations()).toHaveLength(0)

      await daemon.status() // free -> cloud
      expect(store.pendingMutations().map((x) => x.seq)).toEqual([m.seq])
      expect(store.proyectosRetenidosPor('project_limit_reached')).toEqual([])
      expect(daemon.getLimits()).toEqual({ max_projects: 100 })
    } finally {
      store.close()
      cleanupTmp(dir)
    }
  })
})
```

- [ ] **Step 2:** `npx vitest run --config node_modules/.bs3-node/vitest.bs3.config.ts electron/__tests__/memory-daemon-tope-de-proyectos.test.ts` → FAIL (`getLimits is not a function`). El último test puede pasar ya (el destrabe existe): es el que fija §4.6.

- [ ] **Step 3: El daemon.** En `electron/memory-daemon.ts`:

Debajo de `export const REVERSIBLE_REJECTIONS = …` (línea 69):

```ts
/** Spec 2b-1: el motivo con el que el servidor rechaza un proyecto por encima del tope del plan. */
export const MOTIVO_TOPE_DE_PROYECTOS = 'project_limit_reached'
```

En `interface StatusResponseBody`, después de `quota?`:

```ts
  /** Spec 2b-1 §4.2: el tope de proyectos del plan. Ausente en un servicio viejo: "no sé". */
  limits?: { max_projects?: unknown }
```

Después de `private lastQuota … = null` (línea 355):

```ts
  // Spec 2b-1 §4.2: el tope de proyectos que informó el servidor y las keys del roster (sin
  // __global__). Los dos son de la cuenta del store actual: `setStore` los vacía (D10).
  private lastLimits: { max_projects: number } | null = null
  private lastCloudProjectKeys: string[] | null = null
```

En `setStore`, después de `this.primerStatusOk = false`:

```ts
    // El tope y el roster son de la cuenta anterior: mostrarlos con la nueva sería mostrarle
    // repos ajenos hasta el próximo status.
    this.lastLimits = null
    this.lastCloudProjectKeys = null
```

Después de `getQuota()`:

```ts
  /** El último tope de proyectos que informó el servidor, o null si todavía no informó ninguno. */
  getLimits(): { max_projects: number } | null {
    return this.lastLimits
  }

  /** Las keys del último roster de la nube, sin `__global__`; null si todavía no llegó ninguno. */
  getCloudProjectKeys(): string[] | null {
    return this.lastCloudProjectKeys
  }
```

En `doStatus`, después del bloque `if (body.quota) { … }`:

```ts
      // Spec 2b-1 §4.2. Un campo ausente o roto es "no vino": se conserva el último conocido.
      const maxProjects = body.limits?.max_projects
      if (typeof maxProjects === 'number' && Number.isFinite(maxProjects) && maxProjects >= 0) {
        this.lastLimits = { max_projects: maxProjects }
      }
```

Y como primera línea adentro de `if (Array.isArray(body.projects)) {`:

```ts
        // Spec 2b-1 §4.4: qué proyectos ocupan lugar en la nube. `__global__` no cuenta contra el
        // tope (server/src/push.ts), así que tampoco se muestra.
        this.lastCloudProjectKeys = body.projects
          .map((p) => p?.project_key)
          .filter((k): k is string => typeof k === 'string' && k !== '' && k !== GLOBAL_PROJECT_KEY)
```

- [ ] **Step 4:** `npx vitest run --config node_modules/.bs3-node/vitest.bs3.config.ts electron/__tests__/memory-daemon-tope-de-proyectos.test.ts electron/__tests__/memory-daemon.test.ts` → PASS.

- [ ] **Step 5: main.** En `electron/main.ts` línea 143: `import { MemoryDaemon, TEAM_KEY_HOLD_REASONS, MOTIVO_TOPE_DE_PROYECTOS } from './memory-daemon'`. En `ipcMain.handle('memory:status', …)`, reemplazar `return {` (el segundo, el que sigue al `if (!memory)`) por:

```ts
  // Spec 2b-1 §4.4: el roster con nombres LOCALES — el del servidor viaja cifrado (D1).
  const clavesEnLaNube = memory.daemon.getCloudProjectKeys()
  return {
```

y después de la línea `quota: memory.daemon.getQuota() ?? undefined,`:

```ts
    /** Spec 2b-1 §4.2: el tope de proyectos del plan, tal como lo informó el servidor. */
    limits: memory.daemon.getLimits() ?? undefined,
    /** Spec 2b-1 §4.4: lo que ocupa lugar en la nube (sin __global__). Undefined hasta el
     *  primer status: "sin roster todavía", y la fila no se muestra. */
    cloudProjects: clavesEnLaNube ? memory.store.nombresDeProyectos(clavesEnLaNube) : undefined,
```

Reemplazar el handler `memory:doctor` entero:

```ts
// Spec §7.1: "if sync is blocked, fail loudly and visibly."
ipcMain.handle('memory:doctor', () => {
  if (!memory) return { ok: false, blockedTotal: 0, groups: [], localOnlyProjects: [] }
  return {
    ok: true,
    ...buildDoctorReport(memory.store.blockedMutations(), {
      undecryptable: memory.store.undecryptableCount(),
    }),
    // Spec 2b-1 §4.3: qué repos quedaron sólo en esta máquina por el tope del plan, y cuánto.
    localOnlyProjects: memory.store.proyectosRetenidosPor(MOTIVO_TOPE_DE_PROYECTOS),
  }
})
```

- [ ] **Step 6: Tipos del renderer.** En `src/types.ts`, en el tipo de retorno de `status` (después de `quota?: …`):

```ts
        /** Spec 2b-1 §4.2: el tope de proyectos del plan. Ausente hasta el primer status. */
        limits?: { max_projects: number }
        /** Spec 2b-1 §4.4: los proyectos que ocupan lugar en la nube, con nombre local. */
        cloudProjects?: Array<{ projectKey: string; name: string }>
```

y en el de `doctor`, después de `groups: …`:

```ts
        /** Spec 2b-1 §4.3: los repos que quedaron sólo en esta máquina por el tope del plan. */
        localOnlyProjects?: Array<{ projectKey: string; name: string; count: number }>
```

- [ ] **Step 7:** Los dos `tsc` de CI → 0. Suite completa (`npx vitest run --config node_modules/.bs3-node/vitest.bs3.config.ts`) → PASS.

- [ ] **Step 8: Commit.**

```bash
git add electron/memory-daemon.ts electron/main.ts src/types.ts electron/__tests__/memory-daemon-tope-de-proyectos.test.ts
git commit -m "feat(memory): el tope de proyectos y el roster llegan al renderer

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Free puede conectar la nube

**Files:**
- Modify: `src/lib/stripe.ts:57` y helper nuevo debajo de `PLAN_LIMITS`, `src/components/CloudMemoryCard.tsx:6,38`, `src/components/SyncTokenRow.tsx:7,16`
- Test: `src/__tests__/lib/planes.test.ts`, `src/__tests__/components/CloudMemoryCard.test.tsx` (dos tests cambian, un `describe` se muda), `src/__tests__/components/CloudMemoryCard-plan-desconocido.test.tsx` (nuevo), `src/__tests__/components/SyncTokenRow.test.tsx`

**Interfaces:**
- Produces (`src/lib/stripe.ts`): `PLAN_LIMITS.free.memoryCloud === true`; `planIncluyeNube(plan: string): boolean`.

- [ ] **Step 1: Tests que fallan.** En `src/__tests__/lib/planes.test.ts`, cambiar el import a `import { PLAN_LIMITS, planIncluyeNube, type Plan } from '../../lib/stripe'` y sumar al final:

```ts
// Spec 2b-1 §4.1: Free conecta la nube con UN proyecto. El tope lo aplica el servidor
// (server/src/limits.ts); `memoryCloud` sólo dice si el plan ofrece Connect.
describe('el plan Free (2b-1)', () => {
  it('ofrece conectar la nube', () => {
    expect(PLAN_LIMITS.free.memoryCloud).toBe(true)
  })

  it('planIncluyeNube: todo plan conocido sí, uno que esta versión no conoce no', () => {
    for (const p of ['free', 'cloud', 'pro', 'team', 'enterprise']) expect(planIncluyeNube(p)).toBe(true)
    expect(planIncluyeNube('legacy')).toBe(false)
  })
})
```

En `src/__tests__/components/CloudMemoryCard.test.tsx`, reemplazar el test `'disconnected on a free plan still shows only Upgrade, no Turn off'` por:

```tsx
  // Spec 2b-1 §4.1: Free ve «Connect» como Cloud. La beta (not_in_beta) la sigue decidiendo el servidor.
  it('disconnected on a free plan shows Connect, no Upgrade, no Turn off', async () => {
    mockMemoryBridge({ connected: false, deviceId: null, itemCount: 0, pendingCount: 0, daemonStatus: 'idle' })
    render(<CloudMemoryCard />)

    await waitFor(() => expect(screen.getByRole('button', { name: 'Connect' })).toBeInTheDocument())
    expect(screen.queryByText('Upgrade')).not.toBeInTheDocument()
    expect(screen.queryByText('Turn off')).not.toBeInTheDocument()
    expect(screen.queryByText(/cloud sync is a Cloud feature/)).not.toBeInTheDocument()
  })
```

Borrar entero el `describe('CloudMemoryCard — el plan pago se llama Cloud, no Pro', …)` (con su comentario de encabezado): con Free conectando, ese texto sólo existe para un plan desconocido y se prueba en el archivo nuevo. Crear `src/__tests__/components/CloudMemoryCard-plan-desconocido.test.tsx`:

```tsx
// Spec 2b-1 §4.1: con Free conectando, «Local memory active — cloud sync is a Cloud feature»
// queda sólo para un plan que esta versión no conoce (decisión D8). useProfile normaliza a los
// planes conocidos, así que se fuerza con un mock — por eso va en su propio archivo.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import CloudMemoryCard from '../../components/CloudMemoryCard'

const supabaseMock = vi.hoisted(() => {
  const query = {
    select: vi.fn(() => query),
    order: vi.fn(() => Promise.resolve({ data: [], error: null })),
  }
  return {
    auth: { getUser: vi.fn(() => Promise.resolve({ data: { user: null } })), signOut: vi.fn(), getSession: vi.fn() },
    from: vi.fn(() => query),
  }
})
vi.mock('../../lib/supabase', () => ({ supabase: supabaseMock }))
vi.mock('../../hooks/useProfile', () => ({
  useProfile: () => ({ plan: 'legacy', loading: false, isTrialActive: false, trialDaysLeft: 0 }),
}))

afterEach(() => { delete (window as unknown as { memory?: unknown }).memory })

describe('CloudMemoryCard — un plan que esta versión no conoce', () => {
  it('no ofrece Connect y dice que la nube es de Cloud', async () => {
    ;(window as unknown as { localPaths: { getAll: () => Promise<Record<string, string>> } }).localPaths = { getAll: async () => ({}) }
    ;(window as unknown as { memory: unknown }).memory = {
      ensureDeviceId: vi.fn().mockResolvedValue('dev-1'),
      status: vi.fn().mockResolvedValue({ connected: false, deviceId: null, itemCount: 0, pendingCount: 0, daemonStatus: 'idle' }),
      hubStats: vi.fn().mockResolvedValue({ itemCount: 0, projectCount: 0 }),
      onStatus: vi.fn(),
      removeStatusListener: vi.fn(),
    }
    render(<CloudMemoryCard />)

    expect(await screen.findByText('Local memory active — cloud sync is a Cloud feature')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Upgrade' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Connect' })).toBeNull()
  })
})
```

En `src/__tests__/components/SyncTokenRow.test.tsx`, dentro del `describe('SyncTokenRow (Advanced)')`:

```tsx
  // Spec 2b-1 §4.1: Free conecta, así que también puede conectar con un token.
  it('Free desconectado ve el campo', async () => {
    mockMemoryBridge({ connected: false, deviceId: null, itemCount: 0, pendingCount: 0, daemonStatus: 'idle' })
    render(<SyncTokenRow />)
    expect(await screen.findByPlaceholderText('Paste a sync token')).toBeInTheDocument()
  })
```

- [ ] **Step 2:** `npx vitest run src/__tests__/lib/planes.test.ts src/__tests__/components/CloudMemoryCard.test.tsx src/__tests__/components/CloudMemoryCard-plan-desconocido.test.tsx src/__tests__/components/SyncTokenRow.test.tsx` → FAIL (`planIncluyeNube` no existe; Free ve Upgrade; el token no se muestra).

- [ ] **Step 3: El plan y el helper.** En `src/lib/stripe.ts`, la fila de Free:

```ts
  // Spec 2b-1 §4.1: Free conecta la nube con UN proyecto. El tope lo aplica el servidor
  // (server/src/limits.ts, `project_limit_reached`); acá sólo se dice si se ofrece Connect.
  free:       { memoryLocal: true, memoryCloud: true,  memoryTeamShare: false, isEnterprise: false },
```

y debajo de `PLAN_LIMITS`:

```ts
/**
 * Si el plan ofrece conectar la nube. Un plan que esta versión no conoce, no: es el único caso
 * que queda para «cloud sync is a Cloud feature» (spec 2b-1 §4.1, D8). Sin esto,
 * `PLAN_LIMITS[plan].memoryCloud` con un plan desconocido rompía el render.
 */
export function planIncluyeNube(plan: string): boolean {
  return (PLAN_LIMITS as Record<string, PlanLimits | undefined>)[plan]?.memoryCloud === true
}
```

En `CloudMemoryCard.tsx` y `SyncTokenRow.tsx`: el import `import { PLAN_LIMITS } from '../lib/stripe'` pasa a `import { planIncluyeNube } from '../lib/stripe'`, y la línea de `nubeDisponible` a:

```ts
  const nubeDisponible = nubeDeMemoriaDisponible(planIncluyeNube(plan))
```

- [ ] **Step 4:** Los mismos cuatro archivos → PASS. `grep -rn "memoryCloud" src electron --include=*.ts --include=*.tsx` (fuera de `__tests__`): sólo `stripe.ts` y el comentario histórico de `App.tsx:1891` — ningún gate vuelve a bloquear a Free (spec §4.1). Los dos `tsc` → 0. Suite completa → PASS.

- [ ] **Step 5: Commit.**

```bash
git add src/lib/stripe.ts src/components/CloudMemoryCard.tsx src/components/SyncTokenRow.tsx src/__tests__/lib/planes.test.ts src/__tests__/components/CloudMemoryCard.test.tsx src/__tests__/components/CloudMemoryCard-plan-desconocido.test.tsx src/__tests__/components/SyncTokenRow.test.tsx
git commit -m "feat(memories): Free puede conectar la nube (un proyecto)

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: La fila «Projects in the cloud» en Settings › Sync

**Files:**
- Create: `src/lib/proyectos-en-la-nube.ts`, `src/components/memories/settings/CloudProjectsRow.tsx`
- Modify: `src/hooks/useMemory.ts` (`MemoryHookState`, estado inicial, `refresh`), `src/components/CloudMemoryCard.tsx` (import y la fila después de «Cloud sync»)
- Test: `src/__tests__/lib/proyectos-en-la-nube.test.ts`, `src/__tests__/components/CloudProjectsRow.test.tsx`, `src/__tests__/hooks/useMemory.test.tsx`, `src/__tests__/components/CloudMemoryCard.test.tsx`

**Interfaces:**
- Consumes: `memory:status.limits`, `memory:status.cloudProjects`, `memory:doctor.localOnlyProjects` (Task 3).
- Produces (`src/lib/proyectos-en-la-nube.ts`): `TOPE_SIN_LIMITE = 100`; `interface ProyectoEnLaNube { projectKey: string; name: string }`; `tieneTope(max: number | null): max is number`; `descripcionDeProyectosEnLaNube(enLaNube: readonly ProyectoEnLaNube[], max: number | null): string`; `soloLocales(fuera: readonly ProyectoEnLaNube[], enLaNube: readonly ProyectoEnLaNube[]): string[]`; `lineaSoloLocales(nombres: readonly string[]): string`.
- Produces (`CloudProjectsRow`, default export): props `{ enLaNube: readonly ProyectoEnLaNube[]; maxProyectos: number | null; fuera: readonly ProyectoEnLaNube[]; onUpgrade: () => void }`.
- Produces (`useMemory()`): suma `limits: { max_projects: number } | null`, `cloudProjects: Array<{ projectKey: string; name: string }> | null`, `localOnlyProjects: Array<{ projectKey: string; name: string; count: number }>`.

- [ ] **Step 1: Tests que fallan — el copy.** Crear `src/__tests__/lib/proyectos-en-la-nube.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import {
  descripcionDeProyectosEnLaNube as desc, lineaSoloLocales, soloLocales, tieneTope,
} from '../../lib/proyectos-en-la-nube'

const p = (projectKey: string, name = projectKey) => ({ projectKey, name })

describe('tieneTope', () => {
  it('un tope chico y conocido sí; Cloud (100), desconocido o infinito no', () => {
    expect(tieneTope(1)).toBe(true)
    expect(tieneTope(99)).toBe(true)
    expect(tieneTope(100)).toBe(false)
    expect(tieneTope(null)).toBe(false)
    expect(tieneTope(Number.POSITIVE_INFINITY)).toBe(false)
  })
})

describe('descripcionDeProyectosEnLaNube (spec 2b-1 §4.7)', () => {
  it('con tope: «N of M · nombres»', () => {
    expect(desc([p('k', 'raven-nest')], 1)).toBe('1 of 1 · raven-nest')
    expect(desc([p('a'), p('b')], 3)).toBe('2 of 3 · a, b')
  })
  it('con tope y nada arriba todavía: «0 of 1», sin el punto (D5)', () => {
    expect(desc([], 1)).toBe('0 of 1')
  })
  it('sin tope: «N projects», con singular', () => {
    expect(desc([p('a'), p('b')], 100)).toBe('2 projects')
    expect(desc([p('a')], 100)).toBe('1 project')
    expect(desc([], 100)).toBe('0 projects')
  })
  it('tope desconocido (servicio viejo): como sin tope (D3)', () => {
    expect(desc([p('a')], null)).toBe('1 project')
  })
})

describe('soloLocales', () => {
  it('saca los que la nube ya tiene, por key (Review Focus 3)', () => {
    expect(soloLocales([p('k1', 'api'), p('k2', 'web')], [p('k2', 'web')])).toEqual(['api'])
  })
})

describe('lineaSoloLocales', () => {
  it('el copy del spec', () => {
    expect(lineaSoloLocales(['api', 'web'])).toBe('Local only: api, web — Cloud syncs all your projects.')
  })
})
```

- [ ] **Step 2:** `npx vitest run src/__tests__/lib/proyectos-en-la-nube.test.ts` → FAIL (no existe el módulo).

- [ ] **Step 3: El copy.** Crear `src/lib/proyectos-en-la-nube.ts`:

```ts
// Spec 2b-1 §4.4/§4.7: el copy y las reglas de la fila «Projects in the cloud» de Settings ›
// Sync. Puro: lo usa CloudProjectsRow, que recibe todo por props.

/** Desde este tope el plan se lee como "sin tope": el de Cloud (server/src/limits.ts). */
export const TOPE_SIN_LIMITE = 100

export interface ProyectoEnLaNube {
  projectKey: string
  name: string
}

/** Un `max_projects` chico y conocido: un plan con tope (hoy sólo Free = 1). D3. */
export function tieneTope(max: number | null): max is number {
  return max !== null && Number.isFinite(max) && max < TOPE_SIN_LIMITE
}

export function descripcionDeProyectosEnLaNube(enLaNube: readonly ProyectoEnLaNube[], max: number | null): string {
  const n = enLaNube.length
  if (!tieneTope(max)) return `${n} ${n === 1 ? 'project' : 'projects'}`
  const nombres = enLaNube.map((p) => p.name).join(', ')
  // D5: sin nada arriba todavía no queda un " · " colgando.
  return nombres ? `${n} of ${max} · ${nombres}` : `${n} of ${max}`
}

/** Los repos que quedaron afuera, sin los que el roster ya tiene (D4). */
export function soloLocales(fuera: readonly ProyectoEnLaNube[], enLaNube: readonly ProyectoEnLaNube[]): string[] {
  const enNube = new Set(enLaNube.map((p) => p.projectKey))
  return fuera.filter((p) => !enNube.has(p.projectKey)).map((p) => p.name)
}

export function lineaSoloLocales(nombres: readonly string[]): string {
  return `Local only: ${nombres.join(', ')} — Cloud syncs all your projects.`
}
```

- [ ] **Step 4:** `npx vitest run src/__tests__/lib/proyectos-en-la-nube.test.ts` → PASS.

- [ ] **Step 5: Tests que fallan — la fila pura.** Crear `src/__tests__/components/CloudProjectsRow.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import CloudProjectsRow from '../../components/memories/settings/CloudProjectsRow'

const nest = [{ projectKey: 'k-nest', name: 'raven-nest' }]
const afuera = [{ projectKey: 'k-api', name: 'api' }, { projectKey: 'k-web', name: 'web' }]

describe('CloudProjectsRow (spec 2b-1 §4.4)', () => {
  it('con tope y nada afuera: nombre, «1 of 1 · raven-nest» y sin Upgrade', () => {
    render(<CloudProjectsRow enLaNube={nest} maxProyectos={1} fuera={[]} onUpgrade={vi.fn()} />)
    expect(screen.getByText('Projects in the cloud')).toBeInTheDocument()
    expect(screen.getByText('1 of 1 · raven-nest')).toBeInTheDocument()
    expect(screen.queryByText(/Local only/)).toBeNull()
    expect(screen.queryByRole('button', { name: 'Upgrade' })).toBeNull()
  })

  it('con repos afuera: la línea y Upgrade', () => {
    const onUpgrade = vi.fn()
    render(<CloudProjectsRow enLaNube={nest} maxProyectos={1} fuera={afuera} onUpgrade={onUpgrade} />)
    expect(screen.getByText('Local only: api, web — Cloud syncs all your projects.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Upgrade' }))
    expect(onUpgrade).toHaveBeenCalledTimes(1)
  })

  it('sin tope (Cloud) no ofrece Upgrade aunque el doctor traiga retenidas viejas (Review Focus 2)', () => {
    render(<CloudProjectsRow enLaNube={nest} maxProyectos={100} fuera={afuera} onUpgrade={vi.fn()} />)
    expect(screen.getByText('1 project')).toBeInTheDocument()
    expect(screen.queryByText(/Local only/)).toBeNull()
    expect(screen.queryByRole('button', { name: 'Upgrade' })).toBeNull()
  })

  it('un repo que ya está en la nube no figura afuera (Review Focus 3)', () => {
    render(<CloudProjectsRow enLaNube={nest} maxProyectos={1} fuera={[...nest, afuera[0]]} onUpgrade={vi.fn()} />)
    expect(screen.getByText('Local only: api — Cloud syncs all your projects.')).toBeInTheDocument()
  })
})
```

- [ ] **Step 6:** `npx vitest run src/__tests__/components/CloudProjectsRow.test.tsx` → FAIL (no existe el componente).

- [ ] **Step 7: La fila.** Crear `src/components/memories/settings/CloudProjectsRow.tsx`:

```tsx
// Spec 2b-1 §4.4: la fila «Projects in the cloud» de Settings › Sync. Presentación pura: el
// roster, el tope y lo que quedó afuera entran por props (nada de window.memory acá).
import SettingRow from './SettingRow'
import { Button } from '@/components/ui/button'
import {
  descripcionDeProyectosEnLaNube, lineaSoloLocales, soloLocales, tieneTope, type ProyectoEnLaNube,
} from '@/lib/proyectos-en-la-nube'

export interface CloudProjectsRowProps {
  /** El roster de la nube, sin `__global__`, con nombres locales. */
  enLaNube: readonly ProyectoEnLaNube[]
  /** `limits.max_projects` del servidor; null = todavía no lo informó. */
  maxProyectos: number | null
  /** Los repos retenidos por el tope (`memory:doctor`). */
  fuera: readonly ProyectoEnLaNube[]
  onUpgrade: () => void
}

export default function CloudProjectsRow({ enLaNube, maxProyectos, fuera, onUpgrade }: CloudProjectsRowProps) {
  // D4: sólo con tope. A un Cloud con retenidas viejas (antes de que el daemon destrabe por el
  // cambio de plan) no se le ofrece pasar a Cloud.
  const afuera = tieneTope(maxProyectos) ? soloLocales(fuera, enLaNube) : []
  return (
    <SettingRow
      nombre="Projects in the cloud"
      descripcion={descripcionDeProyectosEnLaNube(enLaNube, maxProyectos)}
      control={afuera.length > 0 && <Button size="sm" onClick={onUpgrade}>Upgrade</Button>}
    >
      {afuera.length > 0 && <p className="m-0 text-fs-sm text-muted-foreground">{lineaSoloLocales(afuera)}</p>}
    </SettingRow>
  )
}
```

- [ ] **Step 8:** `npx vitest run src/__tests__/components/CloudProjectsRow.test.tsx` → PASS.

- [ ] **Step 9: Tests que fallan — `useMemory` y la tarjeta.** Al final de `src/__tests__/hooks/useMemory.test.tsx`:

```tsx
describe('useMemory — tope de proyectos (2b-1)', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('expone el tope, el roster y los repos que quedaron afuera', async () => {
    const doctor = vi.fn().mockResolvedValue({
      ok: true, blockedTotal: 5, groups: [],
      localOnlyProjects: [{ projectKey: 'k-api', name: 'api', count: 5 }],
    })
    ;(globalThis as unknown as { window: Window }).window.memory = { ...memoryMock, doctor } as never
    memoryMock.status.mockResolvedValue({
      connected: true, deviceId: 'd', itemCount: 3, pendingCount: 0, daemonStatus: 'idle',
      limits: { max_projects: 1 }, cloudProjects: [{ projectKey: 'k-nest', name: 'raven-nest' }],
    })

    const { result } = renderHook(() => useMemory())

    await waitFor(() => expect(result.current.limits).toEqual({ max_projects: 1 }))
    expect(result.current.cloudProjects).toEqual([{ projectKey: 'k-nest', name: 'raven-nest' }])
    expect(result.current.localOnlyProjects).toEqual([{ projectKey: 'k-api', name: 'api', count: 5 }])
  })

  it('con el doctor roto el estado sigue, sin roster ni tope inventados', async () => {
    const doctor = vi.fn().mockRejectedValue(new Error('boom'))
    ;(globalThis as unknown as { window: Window }).window.memory = { ...memoryMock, doctor } as never
    memoryMock.status.mockResolvedValue({ connected: true, deviceId: 'd', itemCount: 3, pendingCount: 0, daemonStatus: 'idle' })

    const { result } = renderHook(() => useMemory())

    await waitFor(() => expect(result.current.state).toBe('connected'))
    expect(result.current.localOnlyProjects).toEqual([])
    expect(result.current.cloudProjects).toBeNull()
    expect(result.current.limits).toBeNull()
  })
})
```

En `src/__tests__/components/CloudMemoryCard.test.tsx`, `mockMemoryBridge` suma al tipo de `status` los campos `limits?: { max_projects: number }` y `cloudProjects?: Array<{ projectKey: string; name: string }>`, un segundo parámetro y el método `doctor`:

```tsx
function mockMemoryBridge(status: { /* …los campos de hoy…, */ limits?: { max_projects: number }; cloudProjects?: Array<{ projectKey: string; name: string }> },
  doctor: { ok: boolean; blockedTotal: number; groups: unknown[]; localOnlyProjects?: Array<{ projectKey: string; name: string; count: number }> } =
    { ok: true, blockedTotal: 0, groups: [], localOnlyProjects: [] }) {
  const memory = {
    // …los de hoy…
    doctor: vi.fn().mockResolvedValue(doctor),
  }
```

y al final del archivo:

```tsx
describe('CloudMemoryCard — Projects in the cloud (spec 2b-1 §4.4)', () => {
  beforeEach(() => {
    supabaseMock.auth.getUser.mockResolvedValue({ data: { user: null } })
    mockLocalPaths()
  })
  afterEach(() => { delete (window as unknown as { memory?: unknown }).memory })

  const freeConectado = {
    connected: true, deviceId: 'd', itemCount: 3, pendingCount: 0, daemonStatus: 'idle' as const,
    limits: { max_projects: 1 }, cloudProjects: [{ projectKey: 'k-nest', name: 'raven-nest' }],
  }

  it('Free conectado: «1 of 1 · raven-nest», sin línea de afuera ni Upgrade', async () => {
    mockMemoryBridge(freeConectado)
    render(<CloudMemoryCard />)
    expect(await screen.findByText('1 of 1 · raven-nest')).toBeInTheDocument()
    expect(screen.getByText('Projects in the cloud')).toBeInTheDocument()
    expect(screen.queryByText(/Local only/)).toBeNull()
    expect(screen.queryByRole('button', { name: 'Upgrade' })).toBeNull()
  })

  it('con repos afuera: la línea, y Upgrade abre el modal de planes', async () => {
    mockMemoryBridge(freeConectado, {
      ok: true, blockedTotal: 7, groups: [],
      localOnlyProjects: [{ projectKey: 'k-api', name: 'api', count: 5 }, { projectKey: 'k-web', name: 'web', count: 2 }],
    })
    render(<CloudMemoryCard />)
    expect(await screen.findByText('Local only: api, web — Cloud syncs all your projects.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Upgrade' }))
    // El UpgradeModal de siempre: lista los planes ("Free" entre ellos).
    await waitFor(() => expect(screen.getByText('Free')).toBeInTheDocument())
  })

  it('Cloud ve «N projects»', async () => {
    mockMemoryBridge({ ...freeConectado, limits: { max_projects: 100 }, cloudProjects: [{ projectKey: 'a', name: 'a' }, { projectKey: 'b', name: 'b' }] })
    render(<CloudMemoryCard />)
    expect(await screen.findByText('2 projects')).toBeInTheDocument()
  })

  it('sin conectar no hay fila', async () => {
    mockMemoryBridge({ connected: false, deviceId: null, itemCount: 0, pendingCount: 0, daemonStatus: 'idle', limits: { max_projects: 1 }, cloudProjects: [] })
    render(<CloudMemoryCard />)
    await screen.findByText(/Keeps a copy in the cloud/)
    expect(screen.queryByText('Projects in the cloud')).toBeNull()
  })

  it('sin roster todavía (status sin cargar) no hay fila', async () => {
    mockMemoryBridge({ connected: true, deviceId: 'd', itemCount: 3, pendingCount: 0, daemonStatus: 'idle' })
    render(<CloudMemoryCard />)
    await screen.findByText('Up to date · 3 memories')
    expect(screen.queryByText('Projects in the cloud')).toBeNull()
  })
})
```

- [ ] **Step 10:** `npx vitest run src/__tests__/hooks/useMemory.test.tsx src/__tests__/components/CloudMemoryCard.test.tsx` → FAIL (los campos no existen; no hay fila).

- [ ] **Step 11: `useMemory`.** En `src/hooks/useMemory.ts`, en `interface MemoryHookState` después de `quota`:

```ts
  /** Spec 2b-1 §4.2: el tope de proyectos que informó el servidor. `null` mientras no informó. */
  limits: { max_projects: number } | null
  /** Spec 2b-1 §4.4: el roster de la nube (sin __global__), con nombres locales. `null` = el
   *  daemon todavía no recibió un status: la fila no se muestra. */
  cloudProjects: Array<{ projectKey: string; name: string }> | null
  /** Spec 2b-1 §4.3: los repos que quedaron sólo en esta máquina por el tope (del doctor). */
  localOnlyProjects: Array<{ projectKey: string; name: string; count: number }>
```

En el `useState` inicial sumar `limits: null, cloudProjects: null, localOnlyProjects: [],`. En `refresh`, reemplazar `const status = await api.status()` por:

```ts
    const [status, doc] = await Promise.all([
      api.status(),
      // Opcional (preload viejo) y con su propio catch: que el doctor falle no puede tapar el
      // estado de la nube.
      api.doctor?.().catch(() => null) ?? Promise.resolve(null),
    ])
```

y en el objeto del `setState`, después de `quota: status.quota ?? s.quota,`:

```ts
      // Como la cuota: un status sin `limits` es "no vino", no "sin tope".
      limits: status.limits ?? s.limits,
      // El roster NO se conserva: main lo manda siempre que el daemon lo tiene, y tras un cambio
      // de cuenta vuelve a undefined a propósito (D10).
      cloudProjects: status.cloudProjects ?? null,
      localOnlyProjects: doc?.ok ? doc.localOnlyProjects ?? [] : [],
```

- [ ] **Step 12: La tarjeta.** En `src/components/CloudMemoryCard.tsx`: `import CloudProjectsRow from './memories/settings/CloudProjectsRow'`, y entre el `</SettingRow>` de «Cloud sync» y el bloque de «Cloud space» (D11):

```tsx
      {/* Spec 2b-1 §4.4: sólo conectada y con roster. Upgrade abre el mismo UpgradeModal (D9). */}
      {conectada && memory.cloudProjects && (
        <CloudProjectsRow
          enLaNube={memory.cloudProjects}
          maxProyectos={memory.limits?.max_projects ?? null}
          fuera={memory.localOnlyProjects}
          onUpgrade={() => setMemoryUpgradeOpen(true)}
        />
      )}
```

- [ ] **Step 13:** `npx vitest run src/__tests__/lib/proyectos-en-la-nube.test.ts src/__tests__/components/CloudProjectsRow.test.tsx src/__tests__/hooks/useMemory.test.tsx src/__tests__/components/CloudMemoryCard.test.tsx src/__tests__/components/MemoriesWorkspace-tokens.test.tsx src/__tests__/components/memory-settings-sin-sp.test.ts src/__tests__/la-app-es-en-ingles.test.ts` → PASS. Los dos `tsc` → 0. Suite completa → PASS.

- [ ] **Step 14: Commit.**

```bash
git add src/lib/proyectos-en-la-nube.ts src/components/memories/settings/CloudProjectsRow.tsx src/hooks/useMemory.ts src/components/CloudMemoryCard.tsx src/__tests__/lib/proyectos-en-la-nube.test.ts src/__tests__/components/CloudProjectsRow.test.tsx src/__tests__/hooks/useMemory.test.tsx src/__tests__/components/CloudMemoryCard.test.tsx
git commit -m "feat(memories): fila Projects in the cloud en Settings > Sync

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: La fila de estado y el semáforo tratan el tope como plan, no como falla

**Files:**
- Create: `src/components/PlanesModal.tsx`
- Modify: `src/lib/memories-status.ts` (al final), `src/hooks/useMemories.ts`, `src/components/MemoriesStatusRow.tsx`, `src/components/MemorySettingsTab.tsx:4-8,43-48`
- Test: `src/__tests__/memories-status.test.ts`, `src/__tests__/hooks/useMemories.test.tsx`, `src/__tests__/components/MemoriesStatusRow.test.tsx`

**Interfaces:**
- Consumes: `memory:status.limits` (Task 3), `memory:doctor.groups` (ya existe).
- Produces (`src/lib/memories-status.ts`): `MOTIVO_TOPE_DE_PLAN = 'project_limit_reached'`; `bloqueadasPorFalla(groups: ReadonlyArray<{ reason: string; count: number }>): number`; `textoDeTopeDePlan(n: number, max: number | null): string`.
- Produces (`MemoriesState`): suma `maxProjects: number | null`.
- Produces (`src/components/PlanesModal.tsx`, default export): `PlanesModal({ onClose }: { onClose: () => void })`.

- [ ] **Step 1: Tests que fallan — lo puro.** En `src/__tests__/memories-status.test.ts`, sumar `bloqueadasPorFalla, textoDeTopeDePlan` al import y al final:

```ts
// Spec 2b-1 §4.5: lo retenido por el tope de proyectos es el plan funcionando, no una falla.
describe('bloqueadasPorFalla', () => {
  it('no cuenta project_limit_reached; los demás motivos sí', () => {
    expect(bloqueadasPorFalla([{ reason: 'project_limit_reached', count: 7 }])).toBe(0)
    expect(bloqueadasPorFalla([
      { reason: 'project_limit_reached', count: 7 },
      { reason: 'quota_exceeded', count: 3 },
      { reason: 'undecryptable', count: 1 },
    ])).toBe(4)
  })
})

describe('textoDeTopeDePlan (spec 2b-1 §4.7)', () => {
  it('el copy del spec, con «one project» para Free', () => {
    expect(textoDeTopeDePlan(7, 1)).toBe('7 memories stay on this machine — your plan syncs one project')
  })
  it('singular, y el número del plan si no es uno', () => {
    expect(textoDeTopeDePlan(1, 3)).toBe('1 memory stays on this machine — your plan syncs 3 projects')
  })
  it('sin tope informado (servicio viejo) no inventa cuántos (D6)', () => {
    expect(textoDeTopeDePlan(2, null)).toBe('2 memories stay on this machine')
  })
})
```

- [ ] **Step 2:** `npx vitest run src/__tests__/memories-status.test.ts` → FAIL.

- [ ] **Step 3: Lo puro.** Al final de `src/lib/memories-status.ts`:

```ts
/**
 * Spec 2b-1 §4.5: el motivo con el que el servidor retiene lo que pasa el tope de proyectos del
 * plan. Mismo literal que `MOTIVO_TOPE_DE_PROYECTOS` de electron/memory-daemon.ts (el renderer
 * no importa de electron/, D13).
 */
export const MOTIVO_TOPE_DE_PLAN = 'project_limit_reached'

/** Las bloqueadas que son una FALLA: todas menos las del tope del plan (D7). Es lo que va al
 *  punto ámbar y al «N blocked» de `summarizeMemories`. */
export function bloqueadasPorFalla(groups: ReadonlyArray<{ reason: string; count: number }>): number {
  return groups.reduce((total, g) => (g.reason === MOTIVO_TOPE_DE_PLAN ? total : total + g.count), 0)
}

/** El badge de la fila de estado para lo retenido por el tope (spec 2b-1 §4.7). */
export function textoDeTopeDePlan(n: number, max: number | null): string {
  const queda = `${n} ${n === 1 ? 'memory stays' : 'memories stay'} on this machine`
  // D6: sin tope informado no se inventa cuántos proyectos sincroniza el plan.
  if (max === null) return queda
  return `${queda} — your plan syncs ${max === 1 ? 'one project' : `${max} projects`}`
}
```

- [ ] **Step 4:** `npx vitest run src/__tests__/memories-status.test.ts` → PASS.

- [ ] **Step 5: Tests que fallan — el hook y la fila.** En `src/__tests__/hooks/useMemories.test.tsx`, dentro del `describe('useMemories')`:

```tsx
  it('2b-1: el tope del plan no prende el ámbar y trae max_projects', async () => {
    setMemoryApi({
      status: vi.fn().mockResolvedValue({
        connected: true, deviceId: 'd1', itemCount: 9, pendingCount: 0, daemonStatus: 'idle', limits: { max_projects: 1 },
      }),
      doctor: vi.fn().mockResolvedValue({
        ok: true, blockedTotal: 7, groups: [{ reason: 'project_limit_reached', count: 7, oldestAt: 1, reversible: true }],
      }),
    })

    const { result } = renderHook(() => useMemories(0))

    await waitFor(() => expect(result.current.maxProjects).toBe(1))
    expect(result.current.status).toEqual({ dot: 'green', text: '9 items · synced' })
    expect(result.current.blocked).toHaveLength(1)
  })

  it('2b-1: con otro motivo al lado, «N blocked» cuenta sólo ese', async () => {
    setMemoryApi({
      status: vi.fn().mockResolvedValue({ connected: true, deviceId: 'd1', itemCount: 9, pendingCount: 0, daemonStatus: 'idle' }),
      doctor: vi.fn().mockResolvedValue({
        ok: true, blockedTotal: 10,
        groups: [
          { reason: 'project_limit_reached', count: 7, oldestAt: 1, reversible: true },
          { reason: 'quota_exceeded', count: 3, oldestAt: 1, reversible: true },
        ],
      }),
    })

    const { result } = renderHook(() => useMemories(0))

    await waitFor(() => expect(result.current.status).toEqual({ dot: 'amber', text: '3 blocked' }))
    expect(result.current.maxProjects).toBeNull()
  })
```

En `src/__tests__/components/MemoriesStatusRow.test.tsx`: cambiar el import a `import { render, screen, fireEvent } from '@testing-library/react'`, sumar `maxProjects: null,` al literal `state`, y debajo de los imports:

```tsx
vi.mock('../../components/UpgradeModal', () => ({ default: () => <div>upgrade-modal</div> }))
vi.mock('../../hooks/useProfile', () => ({ useProfile: () => ({ plan: 'free' }) }))
```

Al final del archivo:

```tsx
describe('MemoriesStatusRow — el tope del plan no es una falla (spec 2b-1 §4.5)', () => {
  const conTope = (count: number, maxProjects: number | null): MemoriesState => ({
    ...state,
    maxProjects,
    blocked: [{ reason: 'project_limit_reached', count, oldestAt: 1, reversible: true }],
    blockedTotal: count,
  })

  it('dice que se quedan en esta máquina, en gris y sin el código crudo', () => {
    render(<MemoriesStatusRow state={conTope(7, 1)} />)
    const badge = screen.getByText('7 memories stay on this machine — your plan syncs one project')
    expect(badge.className).toContain('text-muted-foreground')
    expect(badge.className).not.toContain('text-warn')
    expect(screen.queryByText(/project_limit_reached/)).toBeNull()
  })

  it('singular, y el número que diga el plan', () => {
    render(<MemoriesStatusRow state={conTope(1, 3)} />)
    expect(screen.getByText('1 memory stays on this machine — your plan syncs 3 projects')).toBeInTheDocument()
  })

  it('Upgrade abre el modal de planes', () => {
    render(<MemoriesStatusRow state={conTope(7, 1)} />)
    fireEvent.click(screen.getByRole('button', { name: 'Upgrade' }))
    expect(screen.getByText('upgrade-modal')).toBeInTheDocument()
  })

  it('los demás motivos siguen como antes, sin Upgrade', () => {
    render(<MemoriesStatusRow state={{ ...state, blocked: [{ reason: 'quota_exceeded', count: 3, oldestAt: 1, reversible: true }], blockedTotal: 3 }} />)
    expect(screen.getByText(/quota_exceeded · waiting, will retry/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Upgrade' })).toBeNull()
  })
})
```

- [ ] **Step 6:** `npx vitest run src/__tests__/hooks/useMemories.test.tsx src/__tests__/components/MemoriesStatusRow.test.tsx` → FAIL (`maxProjects` no existe; el badge dice `project_limit_reached · waiting, will retry`).

- [ ] **Step 7: `PlanesModal` a su archivo.** Crear `src/components/PlanesModal.tsx`:

```tsx
// El UpgradeModal de siempre, montado sólo abierto: así la lectura del perfil no corre en cada
// render. Lo comparten «See plans» de This project y el Upgrade de la fila de estado de
// Memories (spec 2b-1 §4.5, D9).
import { createPortal } from 'react-dom'
import UpgradeModal from './UpgradeModal'
import { useProfile } from '../hooks/useProfile'

export default function PlanesModal({ onClose }: { onClose: () => void }) {
  const { plan } = useProfile()
  return createPortal(<UpgradeModal currentPlan={plan} onClose={onClose} />, document.body)
}
```

En `src/components/MemorySettingsTab.tsx`: borrar los imports de `createPortal`, `UpgradeModal` y `useProfile` y la función `PlanesModal` local (con su comentario), y sumar `import PlanesModal from './PlanesModal'`. El uso (`{planes && <PlanesModal onClose={() => setPlanes(false)} />}`) no cambia.

- [ ] **Step 8: `useMemories`.** En `src/hooks/useMemories.ts`: import `import { bloqueadasPorFalla, summarizeMemories, type MemoriesStatus } from '../lib/memories-status'`; en `interface MemoriesState` después de `blockedTotal: number`:

```ts
  /** Spec 2b-1 §4.5: `limits.max_projects` del servidor; null = todavía no lo informó. */
  maxProjects: number | null
```

Estado: `const [maxProjects, setMaxProjects] = useState<number | null>(null)`. En `refresh`, adentro de `if (status) { … }`:

```ts
      // Como la cuota: un status sin `limits` es "no vino", no "sin tope".
      const max = status.limits?.max_projects
      if (typeof max === 'number') setMaxProjects(max)
```

En la llamada a `summarizeMemories`, `blockedTotal,` pasa a:

```ts
    // D7: lo retenido por el tope del plan no es una falla — no prende el ámbar ni el «N blocked».
    blockedTotal: bloqueadasPorFalla(blocked),
```

y el `return` suma `maxProjects` (después de `blockedTotal`).

- [ ] **Step 9: La fila de estado.** En `src/components/MemoriesStatusRow.tsx`, los imports:

```tsx
import { useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { MemoriesState } from '../hooks/useMemories'
import { MOTIVO_TOPE_DE_PLAN, paneDisplayLabel, relativeTime, textoDeTopeDePlan } from '../lib/memories-status'
import PlanesModal from './PlanesModal'
```

La primera línea del componente:

```tsx
  const { status, vault, blocked, maxProjects, silentSessions } = state
  const [planes, setPlanes] = useState(false)
```

Reemplazar el bloque `{blockedTotal > 0 && ( … )}` entero (comentario incluido) por:

```tsx
      {/* Spec §7.1 — "if sync is blocked, fail loudly and visibly. No silent drops."
          El total ya lo dice el semaforo de la izquierda, asi que aca va SOLO el desglose.
          Spec 2b-1 §4.5: lo retenido por el tope del plan NO es una falla — va en gris, dicho
          en palabras y con el camino a Cloud; los demas motivos, como siempre. */}
      {blocked.length > 0 && (
        <div className="memories-status-cell">
          {blocked.map((g) => g.reason === MOTIVO_TOPE_DE_PLAN ? (
            <span key={g.reason} className="flex items-center gap-1.5">
              <Badge variant="outline" className="gap-1.5 text-muted-foreground">
                {textoDeTopeDePlan(g.count, maxProjects)}
              </Badge>
              <Button size="xs" variant="outline" onClick={() => setPlanes(true)}>Upgrade</Button>
            </span>
          ) : (
            <Badge key={g.reason} variant="outline" className="gap-1.5 text-warn">
              <span className="font-mono tabular-nums">{g.count}</span>
              {g.reason} · {g.reversible ? 'waiting, will retry' : 'terminal'}
            </Badge>
          ))}
        </div>
      )}
```

y antes del `</div>` final del componente:

```tsx
      {planes && <PlanesModal onClose={() => setPlanes(false)} />}
```

- [ ] **Step 10:** `npx vitest run src/__tests__/memories-status.test.ts src/__tests__/hooks/useMemories.test.tsx src/__tests__/components/MemoriesStatusRow.test.tsx src/__tests__/components/MemoriesWorkspace.test.tsx src/__tests__/components/MemorySettingsTab.test.tsx src/__tests__/components/MemoriesItem.test.tsx src/__tests__/la-app-es-en-ingles.test.ts` → PASS. Los dos `tsc` → 0. Suite completa → PASS.

- [ ] **Step 11: Commit.**

```bash
git add src/components/PlanesModal.tsx src/lib/memories-status.ts src/hooks/useMemories.ts src/components/MemoriesStatusRow.tsx src/components/MemorySettingsTab.tsx src/__tests__/memories-status.test.ts src/__tests__/hooks/useMemories.test.tsx src/__tests__/components/MemoriesStatusRow.test.tsx
git commit -m "feat(memories): el tope del plan en la fila de estado, sin ambar

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: e2e headless y cierre

**Files:**
- Modify: `e2e/03-memories-in-app.spec.ts` (import de la línea 27; el test `'Upgrade desde la pestaña Settings abre el modal ENCIMA del overlay'`, ~líneas 429-461)

**Interfaces:**
- Consumes: todo lo anterior, a través de la app buildeada.

- [ ] **Step 1: Reescribir el e2e que fijaba el comportamiento viejo (D14).** En `e2e/03-memories-in-app.spec.ts`, el import pasa a `import { launchHarness, teardown, type Harness } from './helpers/harness'`. Reemplazar el test `'Upgrade desde la pestaña Settings abre el modal ENCIMA del overlay'` (y su comentario de encabezado) por:

```ts
// Spec 2b-1 (D14): Free ya no ve «Upgrade» en Cloud sync —ve Connect—, así que el Upgrade que
// se mide es el de «Projects in the cloud». Sin servicio de sync en el e2e, main contesta un
// estado FINGIDO: se reemplazan los handlers de `memory:status` y `memory:doctor` desde el
// proceso main. Lo demás de la app corre de verdad.
async function fingirFreeConUnProyecto(h: Harness): Promise<void> {
  await h.app.evaluate(({ ipcMain }) => {
    ipcMain.removeHandler('memory:status')
    ipcMain.handle('memory:status', () => ({
      connected: true, deviceId: 'e2e-device', itemCount: 12, pendingCount: 0, daemonStatus: 'idle',
      quota: { used_bytes: 1024 * 1024, max_bytes: 100 * 1024 * 1024 },
      limits: { max_projects: 1 },
      cloudProjects: [{ projectKey: 'k-nest', name: 'raven-nest' }],
    }))
    ipcMain.removeHandler('memory:doctor')
    ipcMain.handle('memory:doctor', () => ({
      ok: true, blockedTotal: 7,
      groups: [{ reason: 'project_limit_reached', count: 7, oldestAt: 1, reversible: true }],
      localOnlyProjects: [{ projectKey: 'k-api', name: 'api', count: 5 }, { projectKey: 'k-web', name: 'web', count: 2 }],
    }))
  })
}

// Review final de rama, CRITICAL #1 (19-10): lo que se abre desde ADENTRO de
// `.memories-workspace` y porta a `document.body` (`.modal-backdrop`) tiene que quedar encima.
test('Free con un proyecto: «Projects in the cloud» y su Upgrade abren el modal ENCIMA del overlay', async () => {
  const h = await launchHarness({ withRepo: false })
  const { page } = h
  try {
    await fingirFreeConUnProyecto(h)
    await page.locator('.sidebar-item-settings').first().click()
    const puerta = page.getByRole('button', { name: 'Memory settings' })
    await expect(puerta).toBeVisible({ timeout: 10_000 })
    await puerta.click()

    const overlay = page.locator('.memories-workspace')
    await expect(overlay.getByRole('heading', { name: 'Sync' })).toBeVisible({ timeout: 10_000 })
    const fila = overlay.locator('[data-slot="setting-row"]', { hasText: 'Projects in the cloud' })
    await expect(fila.getByText('1 of 1 · raven-nest')).toBeVisible({ timeout: 10_000 })
    await expect(fila.getByText('Local only: api, web — Cloud syncs all your projects.')).toBeVisible()

    // La fila de estado: el tope en palabras, y el semáforo sin «7 blocked».
    await expect(overlay.getByText('7 memories stay on this machine — your plan syncs one project')).toBeVisible({ timeout: 10_000 })
    await expect(overlay.getByText('7 blocked')).toHaveCount(0)

    await fila.getByRole('button', { name: 'Upgrade', exact: true }).click()
    const modal = page.locator('.upgrade-modal')
    await expect(modal).toBeVisible({ timeout: 10_000 })
    const arriba = await page.evaluate(() =>
      Boolean(document.elementFromPoint(window.innerWidth / 2, window.innerHeight / 2)?.closest('.modal-backdrop')))
    expect(arriba).toBe(true)
    expect(await modal.evaluate((el) => Number(getComputedStyle(el.parentElement!).zIndex)))
      .toBeGreaterThan(await overlay.evaluate((el) => Number(getComputedStyle(el).zIndex)))

    await page.screenshot({ path: join(SHOTS, '12-upgrade-sobre-settings.png') })
  } finally {
    await teardown(h)
  }
})
```

- [ ] **Step 2: Build y binding.** `npm run build`. Después `npm run native:electron`; si da `EBUSY` (electron.exe vivos de este worktree), **no matarlos**: si la app viva ya corre con el binding de Electron, seguir; si no, avisar a Gero y saltear el Step 3.

- [ ] **Step 3: e2e headless** (sin `RAVEN_E2E_SHOW`): `npx playwright test e2e/03-memories-in-app.spec.ts -g "Projects in the cloud"` → PASS. Después `npx playwright test e2e/04-contraste.spec.ts` → PASS (regla de CLAUDE.md para todo cambio de UI). Mirar `test-results/memories-in-app/12-upgrade-sobre-settings.png`.

- [ ] **Step 4: Cierre.** Los dos `tsc` de CI → 0. `cd server && npx tsc --noEmit` → 0. `npx vitest run --config node_modules/.bs3-node/vitest.bs3.config.ts` (suite completa, incluye `la-app-es-en-ingles`) → PASS. Si Postgres está arriba: `cd server && npx vitest run` → PASS.

- [ ] **Step 5: Commit.**

```bash
git add e2e/03-memories-in-app.spec.ts
git commit -m "test(e2e): Upgrade de Projects in the cloud encima del overlay (headless)

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

## Cobertura del spec (self-review)

| Spec | Tarea |
|---|---|
| §4.1 Free conecta; `nubeDeMemoriaDisponible` igual; copy de planes desconocidos; audit de `memoryCloud` | Task 4 |
| §4.2 `limits.max_projects` en status; el daemon lo guarda y lo expone como `quota` | Tasks 1, 3, 5 |
| §4.3 agrupado por `project_key` con nombre y cantidad; por el snapshot de `blocked` | Tasks 2, 3 |
| §4.4 fila «Projects in the cloud» (con/sin tope, afuera + Upgrade, sólo conectada, sin roster no) | Task 5 |
| §4.5 badge gris + Upgrade; semáforo sin ámbar ni «N blocked» | Task 6 |
| §4.6 test de destrabe con plan nuevo | Task 3 |
| §4.7 copy verbatim | Tasks 5, 6 |
| §5 tests de servidor, store, daemon, renderer, `la-app-es-en-ingles`, los dos `tsc`, e2e headless | Tasks 1-7 |
