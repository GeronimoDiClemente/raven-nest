# Límites del servicio de sync — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que el servicio de sync haga cumplir, del lado del servidor, los límites por plan que define la spec de pricing: proyectos, bytes, tamaño de observación, máquinas, ritmo de sync y rate limit.

**Architecture:** Una tabla de límites por plan en un módulo puro (`limits.ts`) que es la única fuente de verdad, y cinco puntos de aplicación que la consultan: `auth.ts` (máquinas), `push.ts` (proyectos y tamaño), `status.ts` y `pull.ts` (cuota e intervalo), y `http.ts` (rate limit). Ningún límite se aplica en el cliente: §9.3 de la spec del backend establece que lo que se verifica sólo en el renderer no se verifica.

**Tech Stack:** TypeScript corrido con `tsx` sin paso de build · `pg` sobre Postgres 16 · vitest contra Postgres real, nunca mocks ni PGlite.

**Spec:** `docs/superpowers/specs/2026-09-02-pricing-memoria-limites-design.md`

## Global Constraints

- **Los tests corren contra un Postgres real.** Levantarlo con `docker run -d --name nest-memory-pg -e POSTGRES_PASSWORD=nestmem -e POSTGRES_DB=nest_memory -p 55432:5432 postgres:16-alpine`. Sin eso, todo el suite falla en el `beforeAll`.
- **La barra es el código de salida, no el conteo de tests.** `npx vitest run` puede imprimir "81 passed" y salir 1 por una promesa rechazada sin manejar. Verificar siempre `echo EXIT=$?`.
- **El typecheck del server no está en el CI**: correr `npx tsc --noEmit -p tsconfig.json` desde `server/` a mano en cada tarea. Tiene que salir 0.
- **Los ids de test tienen que ser únicos por corrida.** La base de test persiste entre corridas y `observations.sync_id` es primary key global. Patrón de la casa: `const RUN = randomUUID().slice(0, 8)` y prefijar todo con eso.
- **Valores exactos de los límites**, copiados de la spec §4:

| | Free | Cloud | Teams |
|---|---|---|---|
| Proyectos en la nube | 1 | 100 | 100 |
| Máquinas | 3 | 10 | 10 |
| Bytes por usuario | 100 MB (`100 * 1024 * 1024`) | 1 GiB (`1024 ** 3`) | 5 GiB (`5 * 1024 ** 3`) |
| Tamaño por observación | 1 MB (`1024 * 1024`) | igual | igual |
| `next_poll_ms` | 900_000 | 300_000 | 300_000 |
| Rate limit | 60 push/min · 60 pull/min | igual | igual |
| `scope: 'team'` | no | no | sí |

- **`pro` sigue mapeando a los límites de Cloud** durante toda la ejecución de este plan. El rename `pro` → `cloud` es del plan siguiente (el corte comercial) y toca Stripe; romperlo acá dejaría sin nube al único usuario `pro` que existe.
- **Un plan desconocido cae a Free**, nunca a Cloud. Fallar cerrado.
- **Ningún límite borra datos.** Todos frenan una escritura y devuelven un motivo. Un producto de memoria que borra memoria para forzar un upgrade está muerto el día que se sepa.

---

### Task 1: La tabla de límites por plan

**Files:**
- Create: `server/src/limits.ts`
- Test: `server/__tests__/limits.test.ts`

**Interfaces:**
- Consumes: nada. Es un módulo puro, sin base de datos.
- Produces: `export interface PlanLimits { maxProjects: number; maxBytes: number; maxDevices: number; nextPollMs: number; teamScope: boolean }` y `export function limitsFor(plan: string): PlanLimits`. Todas las tareas siguientes consumen `limitsFor`.

- [ ] **Step 1: Escribir el test que falla**

```typescript
// server/__tests__/limits.test.ts
import { describe, it, expect } from 'vitest'
import { limitsFor } from '../src/limits'

describe('limitsFor', () => {
  it('da a Free un solo proyecto en la nube y el intervalo lento', () => {
    expect(limitsFor('free')).toMatchObject({
      maxProjects: 1,
      maxDevices: 3,
      maxBytes: 100 * 1024 * 1024,
      nextPollMs: 900_000,
      teamScope: false,
    })
  })

  it('da a Cloud proyectos de sobra, 1 GiB y el intervalo rápido', () => {
    expect(limitsFor('cloud')).toMatchObject({
      maxProjects: 100,
      maxDevices: 10,
      maxBytes: 1024 ** 3,
      nextPollMs: 300_000,
      teamScope: false,
    })
  })

  it('sólo Teams y Enterprise pueden escribir memoria compartida', () => {
    expect(limitsFor('team').teamScope).toBe(true)
    expect(limitsFor('enterprise').teamScope).toBe(true)
    expect(limitsFor('cloud').teamScope).toBe(false)
    expect(limitsFor('free').teamScope).toBe(false)
  })

  // El rename pro -> cloud es del plan siguiente. Hasta entonces el unico usuario `pro`
  // que existe tiene que seguir teniendo nube.
  it('trata a pro igual que a cloud mientras dure la transicion', () => {
    expect(limitsFor('pro')).toEqual(limitsFor('cloud'))
  })

  // Fallar cerrado: un plan que no conocemos no puede heredar los limites del plan pago.
  it('manda cualquier plan desconocido a los limites de Free', () => {
    expect(limitsFor('plan_que_no_existe')).toEqual(limitsFor('free'))
    expect(limitsFor('')).toEqual(limitsFor('free'))
  })
})
```

- [ ] **Step 2: Correrlo y verificar que falla**

Run: `cd server && npx vitest run __tests__/limits.test.ts`
Expected: FAIL — `Failed to resolve import "../src/limits"`, porque el módulo todavía no existe.

- [ ] **Step 3: Implementación mínima**

```typescript
// server/src/limits.ts
/**
 * La única fuente de verdad de qué puede hacer cada plan.
 *
 * Vive del lado del servidor por la misma razón que el gate de nube (§9.3 de la spec del
 * backend): un límite verificado sólo en el renderer no es un límite, es una sugerencia.
 */
export interface PlanLimits {
  /** Proyectos que pueden existir en la nube para este usuario. */
  maxProjects: number
  /** Suma de bytes de contenido del usuario, en todos sus proyectos. */
  maxBytes: number
  /** Devices activos que pueden sincronizar. */
  maxDevices: number
  /** §11.4: el ritmo de polleo lo manda el servidor. Es la única palanca de costo real. */
  nextPollMs: number
  /** Si puede escribir observaciones con `scope: 'team'`, visibles para otras personas. */
  teamScope: boolean
}

const FREE: PlanLimits = {
  maxProjects: 1,
  maxBytes: 100 * 1024 * 1024,
  maxDevices: 3,
  nextPollMs: 900_000,
  teamScope: false,
}

const CLOUD: PlanLimits = {
  maxProjects: 100,
  maxBytes: 1024 ** 3,
  maxDevices: 10,
  nextPollMs: 300_000,
  teamScope: false,
}

// 5 GiB es el número por asiento de la spec, pero el servicio todavía no modela asientos:
// hasta que los modele, es el techo de la cuenta entera.
const TEAM: PlanLimits = {
  ...CLOUD,
  maxBytes: 5 * 1024 ** 3,
  teamScope: true,
}

const BY_PLAN: Record<string, PlanLimits> = {
  free: FREE,
  cloud: CLOUD,
  // El rename pro -> cloud es del corte comercial. Mientras tanto conviven.
  pro: CLOUD,
  team: TEAM,
  enterprise: TEAM,
}

/** Un plan desconocido cae a Free a propósito: fallar cerrado, nunca regalar la nube. */
export function limitsFor(plan: string): PlanLimits {
  return BY_PLAN[plan] ?? FREE
}
```

- [ ] **Step 4: Correr y verificar que pasa**

Run: `cd server && npx vitest run __tests__/limits.test.ts; echo EXIT=$?`
Expected: PASS, 5 tests, `EXIT=0`.

- [ ] **Step 5: Typecheck y commit**

```bash
cd server && npx tsc --noEmit -p tsconfig.json
git add server/src/limits.ts server/__tests__/limits.test.ts
git commit -m "feat(sync-service): tabla de limites por plan"
```

---

### Task 2: La cuota y el intervalo salen del plan, no de una env var global

**Files:**
- Modify: `server/src/status.ts:41` (el `MAX_BYTES` de módulo) y `server/src/status.ts:72-74` (la respuesta)
- Modify: `server/src/pull.ts:39` (`NEXT_POLL_MS`) y la firma de `handlePull`
- Test: `server/__tests__/limits-status.test.ts`

**Interfaces:**
- Consumes: `limitsFor` de Task 1.
- Produces: `handlePull` pasa a recibir `auth: { userId: string; plan: string }` — todos los llamadores tienen que pasar el plan. `NEXT_POLL_MS` deja de exportarse desde `pull.ts`.

Hoy `MAX_BYTES_PER_USER` es una sola env var para todos los usuarios y `NEXT_POLL_MS` otra. Con la tabla de Task 1, ambos pasan a depender del plan. La env var **se conserva como override de instancia dedicada**: cuando un deploy sirve a un solo cliente (§10 de la spec), el techo por usuario no significa nada y el disco de la máquina es el límite real.

- [ ] **Step 1: Escribir el test que falla**

```typescript
// server/__tests__/limits-status.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { randomUUID } from 'node:crypto'
import { getPool, migrate } from '../src/db'
import { handleStatus } from '../src/status'

const pool = getPool()

async function seed(plan: string) {
  const userId = randomUUID()
  const deviceId = randomUUID()
  await pool.query(`insert into users (id, plan) values ($1, $2)`, [userId, plan])
  await pool.query(
    `insert into devices (id, user_id, name, token_hash) values ($1, $2, 'limits', $3)`,
    [deviceId, userId, `hash-${deviceId}`]
  )
  return { deviceId, userId, plan }
}

beforeAll(async () => { await migrate(pool) })
afterAll(async () => { await pool.end() })

describe('status — la cuota y el intervalo salen del plan', () => {
  it('le da a Free 100 MB y 15 minutos', async () => {
    const res = await handleStatus(pool, await seed('free'))
    expect(res.quota.max_bytes).toBe(100 * 1024 * 1024)
    expect(res.next_poll_ms).toBe(900_000)
  })

  it('le da a Cloud 1 GiB y 5 minutos', async () => {
    const res = await handleStatus(pool, await seed('cloud'))
    expect(res.quota.max_bytes).toBe(1024 ** 3)
    expect(res.next_poll_ms).toBe(300_000)
  })

  it('le da a Teams 5 GiB', async () => {
    const res = await handleStatus(pool, await seed('team'))
    expect(res.quota.max_bytes).toBe(5 * 1024 ** 3)
  })
})
```

- [ ] **Step 2: Correrlo y verificar que falla**

Run: `cd server && npx vitest run __tests__/limits-status.test.ts`
Expected: FAIL en el primer test — `expected 1073741824 to be 104857600`. O sea: hoy Free recibe la misma cuota de 1 GiB que todos, que es exactamente el bug.

- [ ] **Step 3: Implementación mínima**

En `server/src/status.ts`, reemplazar la constante de módulo y el armado de la respuesta:

```typescript
import { limitsFor } from './limits'

// Override de INSTANCIA DEDICADA (§10 de la spec de pricing): cuando un deploy sirve a un
// solo cliente, el techo por usuario de la tabla no significa nada y el disco de la máquina
// es el límite real. Sin setear — que es el caso del servicio compartido — manda el plan.
const MAX_BYTES_OVERRIDE = process.env.MAX_BYTES_PER_USER
  ? resolveMaxBytes(process.env.MAX_BYTES_PER_USER)
  : null
```

y dentro de `handleStatus`, antes del `return`:

```typescript
  const limits = limitsFor(auth.plan)
```

con la respuesta cambiando exactamente estas dos líneas:

```typescript
    next_poll_ms: limits.nextPollMs,
    quota: { used_bytes: Number(rows[0].used), max_bytes: MAX_BYTES_OVERRIDE ?? limits.maxBytes },
```

`resolveMaxBytes` se conserva tal cual y se sigue exportando: sus tests siguen valiendo y ahora describe el override.

En `server/src/pull.ts`, borrar la constante `NEXT_POLL_MS` y su export, cambiar la firma a `auth: { userId: string; plan: string }`, importar `limitsFor`, y en los dos `return` de la función usar `next_poll_ms: limitsFor(auth.plan).nextPollMs`.

- [ ] **Step 4: Arreglar los llamadores que el typecheck marque**

Run: `cd server && npx tsc --noEmit -p tsconfig.json`
Expected: errores en `src/status.ts` (import de `NEXT_POLL_MS` que ya no existe) y en los tests que llaman `handlePull` con un auth sin `plan`. Agregar `plan: 'pro'` a los helpers de esos tests, igual que ya lo hace `__tests__/status.test.ts:24`. Repetir hasta que salga 0.

- [ ] **Step 5: Correr todo y verificar**

Run: `cd server && npx vitest run; echo EXIT=$?`
Expected: todos verdes, `EXIT=0`. En particular `__tests__/status.test.ts` tiene que seguir pasando: su usuario es `pro`, que mapea a Cloud, o sea 1 GiB — el mismo valor que asertaba antes.

- [ ] **Step 6: Commit**

```bash
git add server/src/status.ts server/src/pull.ts server/__tests__/
git commit -m "feat(sync-service): la cuota y el intervalo salen del plan del usuario"
```

---

### Task 3: Tope de proyectos en la nube

**Files:**
- Modify: `server/src/push.ts` (el bloque que resuelve `projectIds`, y el loop de mutaciones)
- Test: `server/__tests__/push-project-limit.test.ts`

**Interfaces:**
- Consumes: `limitsFor` de Task 1.
- Produces: el código de error `project_limit_reached` en `results[].error`, que el cliente usa para mostrar el upsell.

El proyecto de más **no se rechaza para siempre ni se borra**: la mutación vuelve `rejected` con el motivo, el proyecto sigue existiendo y funcionando entero en la máquina del usuario, y la UI ofrece la nube. Terminal a propósito: el mismo payload con el mismo plan no puede funcionar nunca, y omitirlo haría que el device reintente para siempre.

- [ ] **Step 1: Escribir el test que falla**

```typescript
// server/__tests__/push-project-limit.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { randomUUID } from 'node:crypto'
import { getPool, migrate } from '../src/db'
import { handlePush } from '../src/push'

const pool = getPool()
const RUN = randomUUID().slice(0, 8)
const SYNC = (id: string) => `${RUN}-${id}`
const PROJECT = (label: string) => `plimit-${RUN}-${label}`

let free: { deviceId: string; userId: string; plan: string }

async function seed(plan: string) {
  const userId = randomUUID()
  const deviceId = randomUUID()
  await pool.query(`insert into users (id, plan) values ($1, $2)`, [userId, plan])
  await pool.query(
    `insert into devices (id, user_id, name, token_hash) values ($1, $2, 'plimit', $3)`,
    [deviceId, userId, `hash-${deviceId}`]
  )
  return { deviceId, userId, plan }
}

const mut = (seq: number, syncId: string, projectKey: string) => ({
  seq,
  sync_id: syncId,
  op: 'upsert' as const,
  payload: {
    sync_id: syncId,
    project_key: projectKey,
    project_display_name: projectKey,
    scope: 'personal',
    type: 'decision',
    topic_key: null,
    title: 'a title',
    content: 'a body',
    tags: [],
    lamport: 1,
    updated_at: Date.now(),
    created_at: Date.now(),
  },
})

beforeAll(async () => {
  await migrate(pool)
  free = await seed('free')
})
afterAll(async () => { await pool.end() })

describe('push — tope de proyectos por plan', () => {
  it('deja al primer proyecto de un plan Free y rechaza el segundo', async () => {
    const first = await handlePush(pool, free, {
      mutations: [mut(1, SYNC('p1'), PROJECT('uno'))],
    })
    expect(first.results[0].outcome).toBe('applied')

    const second = await handlePush(pool, free, {
      mutations: [mut(2, SYNC('p2'), PROJECT('dos'))],
    })
    expect(second.results[0]).toMatchObject({
      outcome: 'rejected',
      error: 'project_limit_reached',
    })

    // El proyecto de mas no se crea: la cuenta sigue teniendo uno solo.
    const { rows } = await pool.query('select count(*)::int as n from projects where user_id = $1', [
      free.userId,
    ])
    expect(rows[0].n).toBe(1)
  })

  it('sigue aceptando escrituras en el proyecto que ya esta en la nube', async () => {
    const res = await handlePush(pool, free, {
      mutations: [mut(3, SYNC('p3'), PROJECT('uno'))],
    })
    expect(res.results[0].outcome).toBe('applied')
  })

  it('no le pone el tope de Free a una cuenta Cloud', async () => {
    const cloud = await seed('cloud')
    await handlePush(pool, cloud, { mutations: [mut(1, SYNC('c1'), PROJECT('c-uno'))] })
    const res = await handlePush(pool, cloud, {
      mutations: [mut(2, SYNC('c2'), PROJECT('c-dos'))],
    })
    expect(res.results[0].outcome).toBe('applied')
  })
})
```

- [ ] **Step 2: Correrlo y verificar que falla**

Run: `cd server && npx vitest run __tests__/push-project-limit.test.ts`
Expected: FAIL en el primer test — el segundo proyecto vuelve `applied` en vez de `rejected`, porque hoy `ensureProject` (`push.ts:107`) hace un upsert incondicional sin mirar cuántos proyectos ya tiene el usuario.

- [ ] **Step 3: Implementación mínima**

En `server/src/push.ts`, importar `limitsFor` y reemplazar el bloque que llena `projectIds` por uno que primero mire cuántos proyectos ya existen:

```typescript
    // El tope se cuenta ANTES de crear nada, y sólo lo pagan las claves NUEVAS: un usuario
    // que ya tiene su proyecto en la nube sigue escribiendo en él aunque esté en el tope.
    const { rows: existing } = await client.query(
      'select project_key from projects where user_id = $1',
      [auth.userId]
    )
    const known = new Set(existing.map((r) => r.project_key as string))
    const maxProjects = limitsFor(auth.plan).maxProjects
    let slotsLeft = Math.max(0, maxProjects - known.size)

    const projectIds = new Map<string, number>()
    const projectErrors = new Map<string, unknown>()
    const overLimit = new Set<string>()
    for (const [key, displayName] of displayNames) {
      if (!known.has(key)) {
        if (slotsLeft <= 0) {
          overLimit.add(key)
          continue
        }
        slotsLeft--
      }
      try {
        projectIds.set(key, await ensureProject(client, auth.userId, key, displayName))
      } catch (err) {
        projectErrors.set(key, err)
      }
    }
```

y en el loop de mutaciones, junto a los otros rechazos tempranos (después del bloque de `missing_sync_id` y del de `team_scope_not_allowed`):

```typescript
      // El proyecto de más no se rechaza para siempre ni se borra: sigue vivo y completo en
      // la máquina del usuario. Esto sólo dice "en la nube, no". Terminal porque el mismo
      // payload con el mismo plan no puede funcionar nunca.
      if (overLimit.has(projectKey)) {
        results.push({
          sync_id: syncId,
          outcome: 'rejected',
          project_seq: 0,
          error: 'project_limit_reached',
        })
        continue
      }
```

- [ ] **Step 4: Correr y verificar que pasa**

Run: `cd server && npx vitest run __tests__/push-project-limit.test.ts; echo EXIT=$?`
Expected: PASS, 3 tests, `EXIT=0`.

- [ ] **Step 5: Correr todo el suite**

Run: `cd server && npx vitest run; echo EXIT=$?` y `npx tsc --noEmit -p tsconfig.json`
Expected: todo verde, `EXIT=0`, typecheck 0. Prestar atención a `push-tenancy` y `pull`, que crean varios proyectos por usuario: sus usuarios son `pro` (tope 100), así que no los toca.

- [ ] **Step 6: Commit**

```bash
git add server/src/push.ts server/__tests__/push-project-limit.test.ts
git commit -m "feat(sync-service): tope de proyectos en la nube por plan"
```

---

### Task 4: Tope de tamaño por observación

**Files:**
- Modify: `server/src/push.ts` (loop de mutaciones, junto a los otros rechazos tempranos)
- Test: `server/__tests__/push-size-limit.test.ts`

**Interfaces:**
- Consumes: nada de tareas anteriores. El tope es el mismo para todos los planes, así que es una constante de módulo, no entra en `PlanLimits`.
- Produces: el código de error `observation_too_large`.

El tope es 1 MB de contenido, 17 veces la memoria más grande jamás escrita en el corpus real (59,4 KB). Existe contra abuso, no para apretar: por eso es holgado.

- [ ] **Step 1: Escribir el test que falla**

```typescript
// server/__tests__/push-size-limit.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { randomUUID } from 'node:crypto'
import { getPool, migrate } from '../src/db'
import { handlePush } from '../src/push'

const pool = getPool()
const RUN = randomUUID().slice(0, 8)
const SYNC = (id: string) => `${RUN}-${id}`
const PROJECT = `size-${RUN}`

let auth: { deviceId: string; userId: string; plan: string }

const mut = (seq: number, syncId: string, content: string) => ({
  seq,
  sync_id: syncId,
  op: 'upsert' as const,
  payload: {
    sync_id: syncId,
    project_key: PROJECT,
    project_display_name: PROJECT,
    scope: 'personal',
    type: 'decision',
    topic_key: null,
    title: 'a title',
    content,
    tags: [],
    lamport: 1,
    updated_at: Date.now(),
    created_at: Date.now(),
  },
})

beforeAll(async () => {
  await migrate(pool)
  const userId = randomUUID()
  const deviceId = randomUUID()
  await pool.query(`insert into users (id, plan) values ($1, 'pro')`, [userId])
  await pool.query(
    `insert into devices (id, user_id, name, token_hash) values ($1, $2, 'size', $3)`,
    [deviceId, userId, `hash-${deviceId}`]
  )
  auth = { deviceId, userId, plan: 'pro' }
})
afterAll(async () => { await pool.end() })

describe('push — tope de tamaño por observación', () => {
  it('rechaza una observacion de mas de 1 MB sin escribirla', async () => {
    const syncId = SYNC('gorda')
    const res = await handlePush(pool, auth, {
      mutations: [mut(1, syncId, 'x'.repeat(1024 * 1024 + 1))],
    })

    expect(res.results[0]).toMatchObject({ outcome: 'rejected', error: 'observation_too_large' })
    const { rows } = await pool.query('select 1 from observations where sync_id = $1', [syncId])
    expect(rows).toHaveLength(0)
  })

  it('acepta una observacion justo en el limite', async () => {
    const syncId = SYNC('justa')
    const res = await handlePush(pool, auth, {
      mutations: [mut(2, syncId, 'x'.repeat(1024 * 1024))],
    })
    expect(res.results[0].outcome).toBe('applied')
  })

  // El tope se mide en BYTES, no en caracteres: el mismo texto en espanol pesa mas.
  it('mide bytes utf-8, no unidades de utf-16', async () => {
    const syncId = SYNC('multibyte')
    // 'ñ' son 2 bytes en utf-8 y 1 unidad en utf-16: 600k caracteres = 1,2 MB.
    const res = await handlePush(pool, auth, {
      mutations: [mut(3, syncId, 'ñ'.repeat(600_000))],
    })
    expect(res.results[0]).toMatchObject({ outcome: 'rejected', error: 'observation_too_large' })
  })
})
```

- [ ] **Step 2: Correrlo y verificar que falla**

Run: `cd server && npx vitest run __tests__/push-size-limit.test.ts`
Expected: FAIL en el primero — vuelve `applied`, porque hoy no hay ninguna verificación de tamaño.

- [ ] **Step 3: Implementación mínima**

En `server/src/push.ts`, una constante de módulo junto a `TEAM_SCOPE_PLANS`:

```typescript
// §11.6. Igual para todos los planes: existe contra abuso, no como palanca de precio. Son
// 17 veces la memoria más grande del corpus real medido (59,4 KB), o sea que ningún uso
// legítimo lo toca.
const MAX_OBSERVATION_BYTES = 1024 * 1024
```

y en el loop de mutaciones, junto a los otros rechazos tempranos:

```typescript
      // Bytes utf-8, no `.length`: `.length` cuenta unidades utf-16 y subcuenta cualquier
      // texto no ASCII — el mismo error que ya había corrompido cuerpos enteros en readBody.
      if (Buffer.byteLength(String(p.content ?? ''), 'utf8') > MAX_OBSERVATION_BYTES) {
        results.push({
          sync_id: syncId,
          outcome: 'rejected',
          project_seq: 0,
          error: 'observation_too_large',
        })
        continue
      }
```

- [ ] **Step 4: Correr y verificar que pasa**

Run: `cd server && npx vitest run __tests__/push-size-limit.test.ts; echo EXIT=$?`
Expected: PASS, 3 tests, `EXIT=0`.

- [ ] **Step 5: Commit**

```bash
cd server && npx tsc --noEmit -p tsconfig.json
git add server/src/push.ts server/__tests__/push-size-limit.test.ts
git commit -m "feat(sync-service): tope de 1 MB por observacion, medido en bytes utf-8"
```

---

### Task 5: Rate limit por device

**Files:**
- Create: `server/src/rate-limit.ts`
- Modify: `server/src/http.ts` (la función `send`, y el bloque posterior a `authenticate`)
- Test: `server/__tests__/rate-limit.test.ts`

**Interfaces:**
- Consumes: nada de tareas anteriores.
- Produces: `export function createRateLimiter(opts: { limit: number; windowMs: number; now?: () => number }): { check(key: string): { ok: true } | { ok: false; retryAfterSeconds: number } }`.

El limitador es **en memoria y por proceso**: se reinicia en cada deploy y no se comparte entre réplicas. Para un beta de una instancia alcanza, y es lo que corresponde documentar; el día que haya más de una réplica esto pasa a Redis o a Postgres.

- [ ] **Step 1: Escribir el test que falla**

```typescript
// server/__tests__/rate-limit.test.ts
import { describe, it, expect } from 'vitest'
import { createRateLimiter } from '../src/rate-limit'

describe('createRateLimiter', () => {
  it('deja pasar hasta el limite y frena el siguiente', () => {
    let clock = 1_000_000
    const rl = createRateLimiter({ limit: 3, windowMs: 60_000, now: () => clock })

    expect(rl.check('device-a').ok).toBe(true)
    expect(rl.check('device-a').ok).toBe(true)
    expect(rl.check('device-a').ok).toBe(true)

    const blocked = rl.check('device-a')
    expect(blocked.ok).toBe(false)
    if (!blocked.ok) expect(blocked.retryAfterSeconds).toBe(60)
  })

  it('cuenta cada device por separado', () => {
    let clock = 1_000_000
    const rl = createRateLimiter({ limit: 1, windowMs: 60_000, now: () => clock })

    expect(rl.check('device-a').ok).toBe(true)
    expect(rl.check('device-b').ok).toBe(true)
    expect(rl.check('device-a').ok).toBe(false)
  })

  it('vuelve a dejar pasar cuando la ventana termina', () => {
    let clock = 1_000_000
    const rl = createRateLimiter({ limit: 1, windowMs: 60_000, now: () => clock })

    expect(rl.check('device-a').ok).toBe(true)
    expect(rl.check('device-a').ok).toBe(false)
    clock += 60_001
    expect(rl.check('device-a').ok).toBe(true)
  })
})
```

- [ ] **Step 2: Correrlo y verificar que falla**

Run: `cd server && npx vitest run __tests__/rate-limit.test.ts`
Expected: FAIL — `Failed to resolve import "../src/rate-limit"`.

- [ ] **Step 3: Implementación mínima**

```typescript
// server/src/rate-limit.ts
/**
 * Ventana fija por clave, en memoria.
 *
 * EN MEMORIA Y POR PROCESO a propósito: se reinicia en cada deploy y no se comparte entre
 * réplicas. Con una sola instancia — que es el beta — alcanza, y es honesto decir dónde
 * está el techo: el día que haya dos réplicas, cada una deja pasar el límite entero y esto
 * tiene que mudarse a Redis o a una tabla.
 *
 * El reloj se inyecta para que los tests no dependan de esperar de verdad.
 */
export interface RateLimiter {
  check(key: string): { ok: true } | { ok: false; retryAfterSeconds: number }
}

export function createRateLimiter(opts: {
  limit: number
  windowMs: number
  now?: () => number
}): RateLimiter {
  const now = opts.now ?? (() => Date.now())
  const windows = new Map<string, { start: number; count: number }>()

  return {
    check(key) {
      const t = now()
      const w = windows.get(key)
      if (!w || t - w.start >= opts.windowMs) {
        windows.set(key, { start: t, count: 1 })
        return { ok: true }
      }
      if (w.count < opts.limit) {
        w.count++
        return { ok: true }
      }
      return { ok: false, retryAfterSeconds: Math.ceil((w.start + opts.windowMs - t) / 1000) }
    },
  }
}
```

- [ ] **Step 4: Correr y verificar que pasa**

Run: `cd server && npx vitest run __tests__/rate-limit.test.ts; echo EXIT=$?`
Expected: PASS, 3 tests, `EXIT=0`.

- [ ] **Step 5: Cablearlo en http.ts**

`send` tiene que poder mandar `Retry-After`, así que suma un parámetro opcional:

```typescript
function send(
  res: ServerResponse,
  status: number,
  body: unknown,
  headers: Record<string, string> = {}
): void {
  const payload = JSON.stringify(body)
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload),
    ...headers,
  })
  res.end(payload)
}
```

y arriba del archivo, junto a `MAX_BATCH`:

```typescript
import { createRateLimiter } from './rate-limit'

// §11.6. 60 por minuto es ~300 veces el ritmo real del cliente (un pull cada 5 minutos), así
// que sólo lo toca un bug de loop o un ataque. Uno por verbo: un push agresivo no tiene por
// qué dejar al device sin poder leer.
const pushLimiter = createRateLimiter({ limit: 60, windowMs: 60_000 })
const pullLimiter = createRateLimiter({ limit: 60, windowMs: 60_000 })
```

y justo después de `if (!auth.ok) return send(...)`:

```typescript
    // Después de autenticar, no antes: la clave es el device, y el device sale del token.
    // Limitar por IP dejaría a una oficina entera detrás de un NAT compartiendo cuota.
    if (isPush || isPull) {
      const verdict = (isPush ? pushLimiter : pullLimiter).check(auth.deviceId)
      if (!verdict.ok) {
        return send(res, 429, { error: 'rate_limited' }, {
          'Retry-After': String(verdict.retryAfterSeconds),
        })
      }
    }
```

- [ ] **Step 6: Correr todo y commitear**

Run: `cd server && npx vitest run; echo EXIT=$?` y `npx tsc --noEmit -p tsconfig.json`
Expected: todo verde, `EXIT=0`, typecheck 0. `__tests__/http.test.ts` hace pocas requests por device, así que no toca el límite.

```bash
git add server/src/rate-limit.ts server/src/http.ts server/__tests__/rate-limit.test.ts
git commit -m "feat(sync-service): rate limit por device con 429 y Retry-After"
```

---

### Task 6: Tope de máquinas por plan

**Files:**
- Modify: `server/src/auth.ts` (la consulta y el retorno de `authenticate`)
- Test: `server/__tests__/auth-device-limit.test.ts`

**Interfaces:**
- Consumes: `limitsFor` de Task 1.
- Produces: el estado `403` con `error: 'device_limit_reached'` en `AuthResult`.

Cuál sobra se decide por antigüedad: las primeras N máquinas registradas sincronizan, la que vino después no. Es determinístico y no le saca la nube a una máquina que ya la tenía por registrar otra nueva. La máquina bloqueada **conserva y usa toda su memoria local**; lo único que pierde es el sync.

- [ ] **Step 1: Escribir el test que falla**

```typescript
// server/__tests__/auth-device-limit.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { randomUUID } from 'node:crypto'
import { getPool, migrate } from '../src/db'
import { authenticate, hashToken } from '../src/auth'

const pool = getPool()
const RUN = randomUUID().slice(0, 8)

beforeAll(async () => { await migrate(pool) })
afterAll(async () => { await pool.end() })

async function seedUser(plan: string) {
  const userId = randomUUID()
  await pool.query(`insert into users (id, plan) values ($1, $2)`, [userId, plan])
  await pool.query('insert into allowlist (user_id) values ($1)', [userId])
  return userId
}

async function addDevice(userId: string, label: string, createdAt: string) {
  const id = randomUUID()
  const token = `${RUN}-${label}`
  await pool.query(
    `insert into devices (id, user_id, name, token_hash, created_at) values ($1, $2, $3, $4, $5)`,
    [id, userId, label, hashToken(token), createdAt]
  )
  return token
}

describe('authenticate — tope de maquinas por plan', () => {
  it('deja sincronizar a las 3 primeras de un Free y bloquea la cuarta', async () => {
    const userId = await seedUser('free')
    const t1 = await addDevice(userId, 'd1', '2026-01-01')
    await addDevice(userId, 'd2', '2026-01-02')
    await addDevice(userId, 'd3', '2026-01-03')
    const t4 = await addDevice(userId, 'd4', '2026-01-04')

    expect((await authenticate(pool, `Bearer ${t1}`)).ok).toBe(true)

    const cuarta = await authenticate(pool, `Bearer ${t4}`)
    expect(cuarta).toMatchObject({ ok: false, status: 403, error: 'device_limit_reached' })
  })

  it('no le pone el tope de Free a una cuenta Cloud', async () => {
    const userId = await seedUser('cloud')
    await addDevice(userId, 'c1', '2026-01-01')
    await addDevice(userId, 'c2', '2026-01-02')
    await addDevice(userId, 'c3', '2026-01-03')
    const t4 = await addDevice(userId, 'c4', '2026-01-04')

    expect((await authenticate(pool, `Bearer ${t4}`)).ok).toBe(true)
  })

  // Una maquina revocada no puede seguir ocupando un lugar: si no, revocar y registrar de
  // nuevo deja al usuario permanentemente afuera de su propia cuenta.
  it('no cuenta las maquinas revocadas', async () => {
    const userId = await seedUser('free')
    await addDevice(userId, 'r1', '2026-01-01')
    await addDevice(userId, 'r2', '2026-01-02')
    const revocada = await addDevice(userId, 'r3', '2026-01-03')
    await pool.query('update devices set revoked_at = now() where token_hash = $1', [
      hashToken(revocada),
    ])
    const t4 = await addDevice(userId, 'r4', '2026-01-04')

    expect((await authenticate(pool, `Bearer ${t4}`)).ok).toBe(true)
  })
})
```

- [ ] **Step 2: Correrlo y verificar que falla**

Run: `cd server && npx vitest run __tests__/auth-device-limit.test.ts`
Expected: FAIL en el primero — la cuarta máquina autentica bien, porque hoy `authenticate` no mira cuántos devices tiene el usuario.

- [ ] **Step 3: Implementación mínima**

En `server/src/auth.ts`, importar `limitsFor` y agregar, después del chequeo de plan y antes del `return { ok: true, ... }`:

```typescript
  // El orden es por antigüedad: las primeras N máquinas registradas son las que sincronizan.
  // Determinístico, y no le saca la nube a una máquina que ya la tenía porque el usuario
  // registró otra. Las revocadas no ocupan lugar: si lo ocuparan, revocar y volver a
  // registrar dejaría al usuario afuera de su propia cuenta para siempre.
  const { rows: olderRows } = await pool.query(
    `select count(*)::int as n
       from devices
      where user_id = $1
        and revoked_at is null
        and created_at < (select created_at from devices where id = $2)`,
    [row.user_id, row.device_id]
  )
  if (olderRows[0].n >= limitsFor(row.plan).maxDevices) {
    return { ok: false, status: 403, error: 'device_limit_reached' }
  }
```

`AuthResult` no cambia de forma: `403` ya es uno de los status posibles.

- [ ] **Step 4: Correr y verificar que pasa**

Run: `cd server && npx vitest run __tests__/auth-device-limit.test.ts; echo EXIT=$?`
Expected: PASS, 3 tests, `EXIT=0`.

- [ ] **Step 5: Correr todo y commitear**

Run: `cd server && npx vitest run; echo EXIT=$?` y `npx tsc --noEmit -p tsconfig.json`
Expected: verde y `EXIT=0`. `__tests__/auth.test.ts` crea un device por usuario, así que no toca el tope.

```bash
git add server/src/auth.ts server/__tests__/auth-device-limit.test.ts
git commit -m "feat(sync-service): tope de maquinas por plan, por antiguedad"
```

---

### Task 7: Purga de tombstones

**Files:**
- Create: `server/src/purge.ts`
- Modify: `server/src/index.ts` (agendar la purga al arrancar)
- Test: `server/__tests__/purge.test.ts`

**Interfaces:**
- Consumes: nada de tareas anteriores.
- Produces: `export async function purgeTombstones(pool: Pool, olderThanDays?: number): Promise<number>` — devuelve cuántas filas borró.

Un tombstone es una fila marcada `deleted` que existe sólo para que el borrado viaje a las otras máquinas. Después de la ventana de retención no sirve más y ocupa lugar. **El riesgo real, que hay que dejar escrito**: una máquina que estuvo apagada más de 90 días y vuelve nunca se entera de esos borrados, y sus copias locales resucitan. 90 días es la ventana que hace ese caso poco probable sin acumular basura para siempre.

- [ ] **Step 1: Escribir el test que falla**

```typescript
// server/__tests__/purge.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { randomUUID } from 'node:crypto'
import { getPool, migrate } from '../src/db'
import { purgeTombstones } from '../src/purge'

const pool = getPool()
const RUN = randomUUID().slice(0, 8)

let userId: string
let projectId: number

beforeAll(async () => {
  await migrate(pool)
  userId = randomUUID()
  await pool.query(`insert into users (id, plan) values ($1, 'pro')`, [userId])
  const { rows } = await pool.query(
    `insert into projects (user_id, project_key, display_name) values ($1, $2, $2) returning id`,
    [userId, `purge-${RUN}`]
  )
  projectId = Number(rows[0].id)
})
afterAll(async () => { await pool.end() })

async function insertObservation(label: string, deleted: boolean, ageDays: number) {
  const syncId = `${RUN}-${label}`
  await pool.query(
    `insert into observations
       (sync_id, project_id, project_seq, scope, type, title, content, author_id,
        lamport, client_updated_at, client_created_at, server_created_at, deleted)
     values ($1, $2, $3, 'personal', 'decision', 't', 'c', $4, 1, now(), now(),
             now() - ($5 || ' days')::interval, $6)`,
    [syncId, projectId, Math.floor(Math.random() * 1e9), userId, String(ageDays), deleted]
  )
  return syncId
}

describe('purgeTombstones', () => {
  it('borra los tombstones mas viejos que la ventana', async () => {
    const viejo = await insertObservation('viejo', true, 120)
    const borradas = await purgeTombstones(pool, 90)
    expect(borradas).toBeGreaterThanOrEqual(1)

    const { rows } = await pool.query('select 1 from observations where sync_id = $1', [viejo])
    expect(rows).toHaveLength(0)
  })

  it('no toca un tombstone dentro de la ventana', async () => {
    const reciente = await insertObservation('reciente', true, 10)
    await purgeTombstones(pool, 90)
    const { rows } = await pool.query('select 1 from observations where sync_id = $1', [reciente])
    expect(rows).toHaveLength(1)
  })

  // Lo unico que importa de verdad: la purga no puede tocar memoria VIVA por vieja que sea.
  it('nunca borra una observacion viva, por mas antigua que sea', async () => {
    const viva = await insertObservation('viva', false, 5000)
    await purgeTombstones(pool, 90)
    const { rows } = await pool.query('select 1 from observations where sync_id = $1', [viva])
    expect(rows).toHaveLength(1)
  })
})
```

- [ ] **Step 2: Correrlo y verificar que falla**

Run: `cd server && npx vitest run __tests__/purge.test.ts`
Expected: FAIL — `Failed to resolve import "../src/purge"`.

- [ ] **Step 3: Implementación mínima**

```typescript
// server/src/purge.ts
import type { Pool } from 'pg'

/** §11.6. */
const DEFAULT_RETENTION_DAYS = 90

/**
 * Borra los tombstones más viejos que la ventana de retención y devuelve cuántos borró.
 *
 * Un tombstone existe sólo para que un borrado viaje a las otras máquinas. Pasada la
 * ventana ya no sirve y ocupa lugar. El costo conocido: una máquina apagada más tiempo que
 * la ventana nunca se entera de esos borrados y sus copias locales resucitan. 90 días hace
 * ese caso improbable sin acumular basura para siempre.
 *
 * El `and deleted = true` es lo único verdaderamente crítico de esta consulta: sin él, esta
 * función borra memoria viva por antigüedad, que es exactamente lo que el producto promete
 * no hacer nunca.
 */
export async function purgeTombstones(
  pool: Pool,
  olderThanDays: number = DEFAULT_RETENTION_DAYS
): Promise<number> {
  const { rowCount } = await pool.query(
    `delete from observations
      where deleted = true
        and server_created_at < now() - ($1 || ' days')::interval`,
    [String(olderThanDays)]
  )
  return rowCount ?? 0
}
```

- [ ] **Step 4: Correr y verificar que pasa**

Run: `cd server && npx vitest run __tests__/purge.test.ts; echo EXIT=$?`
Expected: PASS, 3 tests, `EXIT=0`.

- [ ] **Step 5: Agendarla al arrancar**

En `server/src/index.ts`, después del `createApp(pool).listen(...)`:

```typescript
import { purgeTombstones } from './purge'

// Una vez por día, y una al arrancar. `unref()` para que un contenedor que se está apagando
// no se quede esperando el timer. El catch es obligatorio: una purga fallida es un problema
// de higiene, no una razón para tumbar un servicio que está sirviendo tráfico.
const PURGE_EVERY_MS = 24 * 60 * 60 * 1000
const runPurge = () =>
  purgeTombstones(pool)
    .then((n) => n > 0 && console.log(`[purge] ${n} tombstones borrados`))
    .catch((err) => console.error('[purge]', err))

void runPurge()
setInterval(runPurge, PURGE_EVERY_MS).unref()
```

- [ ] **Step 6: Correr todo y commitear**

Run: `cd server && npx vitest run; echo EXIT=$?` y `npx tsc --noEmit -p tsconfig.json`
Expected: verde y `EXIT=0`.

```bash
git add server/src/purge.ts server/src/index.ts server/__tests__/purge.test.ts
git commit -m "feat(sync-service): purga de tombstones a los 90 dias"
```

---

### Task 8: La cuota de bytes frena el push

**Files:**
- Modify: `server/src/push.ts` (una lectura del uso al empezar el batch, y un rechazo en el loop)
- Test: `server/__tests__/push-quota.test.ts`

**Interfaces:**
- Consumes: `limitsFor` de Task 1.
- Produces: el código de error `quota_exceeded`.

Hasta acá la cuota sólo se **reportaba** en `status` (Task 2); nadie la hacía cumplir. Este es el punto de aplicación. **Nunca borra para hacer lugar**: frena la escritura nueva y deja intacto todo lo que el usuario ya tiene.

El uso se lee **una vez por batch**, no por mutación: la consulta suma `octet_length` sobre todas las observaciones del usuario y hacerla 200 veces por push sería un escaneo por cada memoria. Que un batch pueda pasarse un poco del techo antes de frenar es aceptable — el techo existe contra abuso, no para cortar al byte.

- [ ] **Step 1: Escribir el test que falla**

```typescript
// server/__tests__/push-quota.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { randomUUID } from 'node:crypto'
import { getPool, migrate } from '../src/db'
import { handlePush } from '../src/push'

const pool = getPool()
const RUN = randomUUID().slice(0, 8)
const SYNC = (id: string) => `${RUN}-${id}`
const PROJECT = `quota-${RUN}`

let auth: { deviceId: string; userId: string; plan: string }

const mut = (seq: number, syncId: string, content: string) => ({
  seq,
  sync_id: syncId,
  op: 'upsert' as const,
  payload: {
    sync_id: syncId,
    project_key: PROJECT,
    project_display_name: PROJECT,
    scope: 'personal',
    type: 'decision',
    topic_key: null,
    title: 'a title',
    content,
    tags: [],
    lamport: 1,
    updated_at: Date.now(),
    created_at: Date.now(),
  },
})

beforeAll(async () => {
  await migrate(pool)
  const userId = randomUUID()
  const deviceId = randomUUID()
  // `free` para que el techo sean 100 MB y no haga falta escribir un giga en un test.
  await pool.query(`insert into users (id, plan) values ($1, 'free')`, [userId])
  await pool.query(
    `insert into devices (id, user_id, name, token_hash) values ($1, $2, 'quota', $3)`,
    [deviceId, userId, `hash-${deviceId}`]
  )
  auth = { deviceId, userId, plan: 'free' }
})
afterAll(async () => { await pool.end() })

describe('push — la cuota de bytes frena la escritura', () => {
  it('acepta mientras haya lugar', async () => {
    const res = await handlePush(pool, auth, { mutations: [mut(1, SYNC('chica'), 'hola')] })
    expect(res.results[0].outcome).toBe('applied')
  })

  it('rechaza con quota_exceeded cuando el usuario ya paso su techo', async () => {
    // Llenar los 100 MB de Free con observaciones de 1 MB (el tope por observacion).
    const relleno = 'x'.repeat(1024 * 1024)
    for (let i = 0; i < 100; i++) {
      await handlePush(pool, auth, { mutations: [mut(100 + i, SYNC(`relleno-${i}`), relleno)] })
    }

    const res = await handlePush(pool, auth, { mutations: [mut(999, SYNC('tarde'), 'hola')] })
    expect(res.results[0]).toMatchObject({ outcome: 'rejected', error: 'quota_exceeded' })
  })

  // Lo que el producto promete: llegar al techo no le cuesta al usuario NADA de lo que ya
  // tenia guardado.
  it('no borra nada de lo que ya estaba para hacer lugar', async () => {
    const { rows } = await pool.query(
      `select count(*)::int as n from observations o
         join projects p on p.id = o.project_id
        where p.user_id = $1 and o.deleted = false`,
      [auth.userId]
    )
    expect(rows[0].n).toBeGreaterThanOrEqual(100)
  })
})
```

- [ ] **Step 2: Correrlo y verificar que falla**

Run: `cd server && npx vitest run __tests__/push-quota.test.ts`
Expected: FAIL en el segundo test — la mutación número 101 vuelve `applied`, porque hoy nadie mira la cuota al escribir. Tarda unos segundos: escribe 100 MB de verdad contra Postgres.

- [ ] **Step 3: Implementación mínima**

En `server/src/push.ts`, después de resolver los proyectos y antes del loop de mutaciones:

```typescript
    // Una sola lectura por batch, no una por mutación: esta suma escanea todas las
    // observaciones del usuario y hacerla 200 veces por push sería un escaneo por memoria.
    // El costo de leerla una vez es que un batch puede pasarse un poco antes de frenar, lo
    // que es aceptable: el techo existe contra abuso, no para cortar al byte exacto.
    const { rows: usedRows } = await client.query(
      `select coalesce(sum(octet_length(coalesce(o.content, ''))), 0)::bigint as used
         from observations o join projects p on p.id = o.project_id
        where p.user_id = $1`,
      [auth.userId]
    )
    const overQuota = Number(usedRows[0].used) >= limitsFor(auth.plan).maxBytes
```

y en el loop, junto a los otros rechazos tempranos:

```typescript
      // Frena lo nuevo y no toca nada de lo viejo: la cuota llena NUNCA borra para hacer
      // lugar. Un borrado (`op: 'delete'`) sí pasa — es lo único que puede bajar el uso, y
      // bloquearlo dejaría al usuario encerrado sin forma de recuperar espacio.
      if (overQuota && m.op !== 'delete') {
        results.push({
          sync_id: syncId,
          outcome: 'rejected',
          project_seq: 0,
          error: 'quota_exceeded',
        })
        continue
      }
```

- [ ] **Step 4: Correr y verificar que pasa**

Run: `cd server && npx vitest run __tests__/push-quota.test.ts; echo EXIT=$?`
Expected: PASS, 3 tests, `EXIT=0`.

- [ ] **Step 5: Correr todo y commitear**

Run: `cd server && npx vitest run; echo EXIT=$?` y `npx tsc --noEmit -p tsconfig.json`
Expected: verde y `EXIT=0`. Los otros tests escriben cuerpos de pocos bytes, muy por debajo de cualquier techo.

```bash
git add server/src/push.ts server/__tests__/push-quota.test.ts
git commit -m "feat(sync-service): la cuota de bytes frena el push, sin borrar nada"
```

---

### Task 9: Verificar los límites en producción

**Files:**
- Modify: `server/README.md` (una sección con los límites y los códigos de error)

**Interfaces:**
- Consumes: todo lo anterior.
- Produces: nada de código. Es la verificación de que lo construido funciona en el servicio real, no sólo en la máquina de quien lo escribió.

- [ ] **Step 1: Deployar**

```bash
cd server && railway up --service sync --ci
```
Expected: `Deploy complete`, y `railway logs --service sync` muestra `[sync] listening on 8080`.

- [ ] **Step 2: Verificar el tope de proyectos contra HTTPS real**

El token del device de smoke está fuera del repo. Provisionar uno nuevo si hace falta con `server/scripts/mint-device-token.mjs` (ver su cabecera: el modo `--token-hash` siembra por ssh sin que el token salga de la máquina).

Bajar el device de prueba a plan `free`. La base no tiene endpoint público a propósito, así que se corre adentro del contenedor con el mismo patrón que usa el minter: el script viaja por stdin y los argumentos por la línea de comandos.

```bash
cat > /tmp/set-plan.mjs <<'EOF'
import pg from 'pg'
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL })
const { rowCount } = await pool.query('update users set plan = $2 where email = $1', [
  process.argv[2],
  process.argv[3],
])
console.log(`filas actualizadas: ${rowCount}`)
await pool.end()
EOF
ssh railway-sync "cd /app && node --input-type=module - smoke-contract-check@nestmux.com free" < /tmp/set-plan.mjs
```

Expected: `filas actualizadas: 1`.

Después, con ese token, empujar dos `project_key` distintos por HTTPS.
Expected: el primero vuelve `applied` y el segundo vuelve `rejected` con `project_limit_reached`.

- [ ] **Step 3: Verificar el rate limit**

Mandar 61 pulls seguidos con el mismo token.
Expected: los primeros 60 dan 200 y el 61 da **429** con header `Retry-After`.

- [ ] **Step 4: Dejar el device de prueba como estaba y limpiar**

Volver el plan a `pro` y borrar los datos de prueba con `POST /v1/sync/delete-data`.
Expected: `{"ok":true,...}` y `status` con `used_bytes: 0`.

- [ ] **Step 5: Documentar y commitear**

Agregar a `server/README.md` una tabla con los límites por plan y una con los códigos de error que puede devolver un push (`missing_sync_id`, `team_scope_not_allowed`, `project_limit_reached`, `observation_too_large`) más los de HTTP (`429 rate_limited`, `403 device_limit_reached`, `413 batch_too_large`).

```bash
git add server/README.md
git commit -m "docs(sync-service): limites por plan y codigos de error"
```

---

## Lo que este plan NO hace

- **No renombra `pro` a `cloud`.** Eso toca Stripe, el webhook, `PlanLimits` del cliente y la web, y es el plan siguiente (el corte comercial). Acá `pro` mapea a los límites de Cloud a propósito.
- **No toca el cliente.** Ningún gate local se borra en este plan, ni se reescribe el `UpgradeModal`. El cliente hoy ni siquiera muestra los códigos de error nuevos: los va a recibir y a loguear.
- **No cierra §9.2** (la emisión de tokens sigue en Supabase), que es el bloqueante real para que un usuario de verdad pueda usar la nube.
- **No pone `server/` en el CI**, que sigue siendo un agujero de proceso: estos ocho commits se verifican sólo en la máquina de quien los escribe.
