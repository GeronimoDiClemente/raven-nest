# Nest Memory — el servicio de sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** El servicio que reemplaza a Supabase como backend de sincronización de Nest Memory: dos handlers HTTP, un status, y un Postgres.

**Architecture:** Deliberadamente chico y sin estado propio. Todo lo difícil (el merge LWW, el contador lamport, la cola offline) ya está resuelto y testeado del lado del cliente en `electron/memory-merge.ts`; el servidor **guarda, ordena y devuelve**, y no vuelve a decidir nada de eso. La única regla que sí duplica es la resolución de colisión de topic, y se implementa **portando la del cliente** con los mismos casos de test, porque las dos puntas tienen que computar el mismo ganador independientemente o la convergencia deja de existir.

**Tech Stack:** Node 22 · TypeScript ejecutado con `tsx` (sin paso de build) · `pg` sobre Postgres 16 · vitest contra un Postgres real en Docker. Sin framework HTTP: `node:http` alcanza para tres rutas.

**Spec:** `docs/superpowers/specs/2026-08-31-memory-sync-backend-design.md` — §5 el contrato de wire, §6 el schema, §7 `project_seq`, §8 los dos arreglos que el servidor viejo no hacía, §9 tenancy y auth, §11 operación, §13 testing.

## Global Constraints

- **El modelo de sync no se rediseña.** No se adopta Turso, Electric, CR-SQLite ni Automerge. Cada uno trae su propio modelo de conflictos y todos son incompatibles con el nuestro; adoptarlos es tirar `electron/memory-merge.ts` y reescribir la parte de más riesgo por línea del sistema.
- **La regla LWW se implementa UNA vez y portada, no reinventada**: mayor `client_updated_at`, después mayor `lamport`, después mayor `sync_id` lexicográfico. Es la de `electron/memory-merge.ts`. Si el servidor y el cliente difieren en un solo caso, dejan de converger.
- **Un rechazo es terminal por contrato.** El cliente marca pushed lo aceptado Y lo rechazado, y sólo reintenta lo que no aparece en `results`. Omitir una mutación es la forma correcta de decir "no la procesé". `rejected` se usa **sólo** donde reintentar no puede funcionar nunca. El servidor viejo usaba el rechazo para todo y por eso perdía memorias.
- **`project_seq` nunca sale de un `bigserial` global.** Las secuencias se consumen fuera de transacción: dos concurrentes pueden commitear 105 antes que 104, y un cliente que pulea en el medio avanza el cursor y la 104 no se pulea nunca.
- **Multi-tenant desde la primera línea**: `user_id` en todas las tablas, aunque hoy haya una fila. Abrir a usuarios tiene que ser una fila en `allowlist`, no una reescritura.
- **El servicio nunca guarda un token, sólo su `sha256`.**
- **Código y comentarios en inglés.** Los docs de diseño y la conversación, en español.
- **Todo lo que toca SQL se testea contra Postgres real**, nunca contra un mock ni contra PGlite. PGlite es de una sola conexión y esconde justamente los bugs de concurrencia que este servicio puede tener.
- **Los tests corren contra una base que PERSISTE entre corridas, así que todo identificador que escriban tiene que ser único por corrida.** `observations.sync_id` es primary key **global**, no por proyecto: un test que escriba `'obs-1'` fijo choca con la fila que dejó la corrida anterior, y como el insert hace `on conflict (sync_id) do update` la fila vieja sobrevive con su `project_id` viejo y el assert falla por una razón que no tiene nada que ver con el código. Lo mismo con `push_receipts`, que es `(device_id, seq)`. **En cada archivo de test, generá un token por corrida y prefijá con él todos los `sync_id`**, así:

  ```ts
  const RUN = randomUUID().slice(0, 8)
  const id = (name: string) => `${RUN}-${name}`
  ```

  y usá `id('early')` donde el plan escribe `'obs-early'`. Los `user_id` y `device_id` de los tests ya son `randomUUID()`, así que ésos están cubiertos. Esto no es teórico: el contract check de `scripts/` reportó 11 propiedades rotas por exactamente este motivo antes de que se le pusieran ids por corrida.

## El Postgres de desarrollo

Ya está levantado. Si no, se levanta así:

```bash
docker run -d --name nest-memory-pg \
  -e POSTGRES_PASSWORD=nestmem -e POSTGRES_DB=nest_memory \
  -p 55432:5432 postgres:16-alpine
```

Cadena de conexión para los tests: `postgres://postgres:nestmem@127.0.0.1:55432/nest_memory`
Verificado el 2026-09-01: PostgreSQL 16.15.

## Lo que ya existe y hay que usar, no rehacer

- **`scripts/memory-sync-contract-check.mjs`** — 19 propiedades sobre el contrato §5, cada una un bug real del backend viejo. **No sabe contra qué habla.** El Task 10 lo apunta a este servicio y tiene que dar 19/19. No lo modifiques para que pase: si falla, el que está mal es el servicio.
- **`scripts/memory-sync-stub.mjs`** — la referencia ejecutable del contrato. Cuando dudes de la forma de una respuesta, mirá ahí. **No es el servicio**: no tiene tenancy, cuotas ni durabilidad, y se borra cuando este plan termine.
- **`electron/memory-merge.ts`** — la regla LWW a portar. Leela, no la inventes.

## Estructura de archivos

| Archivo | Responsabilidad | Tasks |
|---|---|---|
| `server/package.json` | Deps del servicio, aislado del Electron del repo | 1 |
| `server/migrations/001_init.sql` | El schema de §6, tal cual | 1 |
| `server/src/db.ts` | Pool y runner de migraciones con advisory lock | 1 |
| `server/src/seq.ts` | Asignación de `project_seq` por rango (§7) | 2 |
| `server/src/auth.ts` | `sha256` del token, device, allowlist, gate de plan (§9) | 3 |
| `server/src/lww.ts` | La regla LWW portada del cliente | 5 |
| `server/src/push.ts` | El handler de push (§5.1, §8.1, §8.2) | 4, 5, 6 |
| `server/src/pull.ts` | El handler de pull (§5.2) | 7 |
| `server/src/status.ts` | El handler de status (§5.3) | 8 |
| `server/src/http.ts` | Servidor, routing, alias de §5.4, límites | 9 |
| `server/src/index.ts` | Entry point | 9 |
| `server/Dockerfile` | El contenedor mudable (§11.1) | 10 |
| `server/README.md` | Cómo levantarlo y operarlo | 10 |

## Una desviación deliberada de la spec, con su razón

La §7 dice **"un solo `UPDATE` por push, no uno por observación"**, y este plan hace lo contrario:
una transacción y una asignación de rango **por mutación**.

El motivo es el contrato, no el gusto. La §5.1 define que omitir una mutación de `results` es
la forma de decir "no la procesé, mandámela de nuevo", y que un `rejected` es **terminal**. Con
una sola transacción por batch, una mutación mala hace rollback de las 199 buenas que venían con
ella: o se pierden todas hasta el próximo intento, o hay que rechazarlas, y rechazarlas es
mentir porque reintentarlas sí podría funcionar. Aislar cada mutación es lo que hace que la
regla de omisión signifique algo.

El costo es velocidad. El benchmark de la spec midió 1465 observaciones por segundo con batches
de 50 y una sola asignación; esto va a dar menos. **Para un beta de una cuenta no importa**, y la
optimización es puramente aditiva después: agrupar por proyecto, pedir el rango entero de una, y
mantener el aislamiento con savepoints en vez de transacciones separadas. Si alguna vez el push
se vuelve el cuello de botella, ese es el cambio, y hay que hacerlo con la prueba de concurrencia
del Task 2 corriendo.

## Orden

Los tasks 1 a 3 son cimiento y son secuenciales. Del 4 al 8 son los handlers, y cada uno depende del anterior sólo por los archivos que comparte. El 9 los junta y el 10 valida el conjunto contra el contract check.

---

### Task 1: Schema y runner de migraciones

**Files:**
- Create: `server/package.json`, `server/tsconfig.json`, `server/migrations/001_init.sql`, `server/src/db.ts`
- Test: `server/__tests__/db.test.ts`

**Interfaces:**
- Produces: `getPool(): Pool` y `migrate(pool: Pool): Promise<number>` desde `server/src/db.ts`. `migrate` devuelve cuántas migraciones aplicó, es idempotente, y toma un advisory lock para que dos instancias arrancando a la vez no la corran dos veces.

- [ ] **Step 1: Crear el paquete**

`server/package.json`:

```json
{
  "name": "nest-memory-sync",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "tsx src/index.ts",
    "start": "tsx src/index.ts",
    "test": "vitest run"
  },
  "dependencies": {
    "pg": "^8.13.1",
    "tsx": "^4.19.2"
  },
  "devDependencies": {
    "@types/pg": "^8.11.10",
    "vitest": "^4.1.5"
  }
}
```

`server/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "skipLibCheck": true,
    "types": ["node"]
  },
  "include": ["src/**/*.ts", "__tests__/**/*.ts"]
}
```

Después: `cd server && npm install`.

- [ ] **Step 2: Escribir el schema**

`server/migrations/001_init.sql` — el schema de §6 de la spec, sin desviarse:

```sql
create table if not exists users (
  id            uuid primary key,
  email         text,
  plan          text not null default 'free',
  created_at    timestamptz not null default now()
);

create table if not exists devices (
  id            uuid primary key,
  user_id       uuid not null references users(id) on delete cascade,
  name          text not null,
  platform      text,
  token_hash    text not null,
  created_at    timestamptz not null default now(),
  last_seen_at  timestamptz,
  revoked_at    timestamptz
);
create index if not exists devices_by_user on devices (user_id) where revoked_at is null;
create unique index if not exists devices_by_token on devices (token_hash);

create table if not exists projects (
  id            bigserial primary key,
  user_id       uuid not null references users(id) on delete cascade,
  project_key   text not null,
  display_name  text not null,
  seq_counter   bigint not null default 0,
  unique (user_id, project_key)
);

create table if not exists observations (
  sync_id           text primary key,
  project_id        bigint not null references projects(id) on delete cascade,
  project_seq       bigint not null,
  scope             text not null,
  type              text not null,
  topic_key         text,
  title             text not null,
  content           text,
  tags              jsonb,
  content_hash      text,
  origin_ai         text,
  origin_account    text,
  git_branch        text,
  author_id         uuid not null references users(id),
  author_display    text,
  lamport           bigint not null,
  client_updated_at timestamptz not null,
  client_created_at timestamptz not null,
  server_created_at timestamptz not null default now(),
  deleted           boolean not null default false,
  superseded_by     text,
  unique (project_id, project_seq)
);

create unique index if not exists obs_topic_uniq on observations (project_id, scope, topic_key)
  where topic_key is not null and superseded_by is null and deleted = false;

create index if not exists obs_pull on observations (project_id, project_seq);

create table if not exists push_receipts (
  device_id  uuid not null references devices(id) on delete cascade,
  seq        bigint not null,
  sync_id    text not null,
  outcome    text not null,
  project_seq bigint,
  created_at timestamptz not null default now(),
  primary key (device_id, seq)
);

create table if not exists allowlist (
  user_id    uuid primary key references users(id) on delete cascade,
  note       text,
  created_at timestamptz not null default now()
);
```

Dos desviaciones deliberadas de la spec, y por qué:
- `devices_by_token` único: el lookup de auth es por `token_hash`, y sin el único dos devices podrían compartir token sin que nada lo note.
- `push_receipts.project_seq`: §5.1 dice que un replay devuelve "el `outcome` que quedó guardado", y el `outcome` solo no alcanza — el cliente también recibe `project_seq` y tiene que ser el mismo número, no uno nuevo.

- [ ] **Step 3: Escribir el test que falla**

`server/__tests__/db.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { getPool, migrate } from '../src/db'

const pool = getPool()

describe('migrations', () => {
  afterAll(async () => { await pool.end() })

  it('creates every table on a fresh database', async () => {
    await migrate(pool)
    const { rows } = await pool.query(
      `select table_name from information_schema.tables where table_schema = 'public' order by table_name`
    )
    const names = rows.map((r) => r.table_name)
    for (const t of ['users', 'devices', 'projects', 'observations', 'push_receipts', 'allowlist', 'schema_migrations']) {
      expect(names).toContain(t)
    }
  })

  it('is idempotent — a second run applies nothing', async () => {
    await migrate(pool)
    const applied = await migrate(pool)
    expect(applied).toBe(0)
  })

  it('the topic index admits only one live row per (project, scope, topic)', async () => {
    await migrate(pool)
    const userId = '00000000-0000-0000-0000-0000000000aa'
    await pool.query(`insert into users (id) values ($1) on conflict do nothing`, [userId])
    const { rows: [project] } = await pool.query(
      `insert into projects (user_id, project_key, display_name) values ($1, $2, $2)
       on conflict (user_id, project_key) do update set display_name = excluded.display_name
       returning id`,
      [userId, `idx-test-${Date.now()}`]
    )
    const base = [project.id, 'personal', 'a-topic', 'title', 0, new Date(), new Date(), userId]
    await pool.query(
      `insert into observations (sync_id, project_id, project_seq, scope, topic_key, title, lamport,
        client_updated_at, client_created_at, author_id, type)
       values ('one', $1, 1, $2, $3, $4, $5, $6, $7, $8, 'decision')`,
      base
    )
    await expect(
      pool.query(
        `insert into observations (sync_id, project_id, project_seq, scope, topic_key, title, lamport,
          client_updated_at, client_created_at, author_id, type)
         values ('two', $1, 2, $2, $3, $4, $5, $6, $7, $8, 'decision')`,
        base
      )
    ).rejects.toThrow(/obs_topic_uniq/)
  })
})
```

- [ ] **Step 4: Correr y verificar que falla**

```bash
cd server && npx vitest run __tests__/db.test.ts
```

Esperado: FAIL, `src/db` no existe.

- [ ] **Step 5: Implementar**

`server/src/db.ts`:

```ts
import { Pool } from 'pg'
import { readdirSync, readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations')

// One arbitrary but stable key. Two instances booting at once must not both run the
// migrations: without the lock they race on CREATE TABLE and one of them dies on a
// duplicate-object error at startup, which reads as a crash loop rather than a race.
const MIGRATION_LOCK_KEY = 8127346512

export function getPool(): Pool {
  return new Pool({
    connectionString:
      process.env.DATABASE_URL ?? 'postgres://postgres:nestmem@127.0.0.1:55432/nest_memory',
    max: Number(process.env.PG_POOL_MAX ?? 10),
  })
}

/** Applies every unapplied migration inside one advisory lock. Returns how many ran. */
export async function migrate(pool: Pool): Promise<number> {
  const client = await pool.connect()
  try {
    await client.query('select pg_advisory_lock($1)', [MIGRATION_LOCK_KEY])
    await client.query(
      `create table if not exists schema_migrations (
         name text primary key,
         applied_at timestamptz not null default now()
       )`
    )
    const { rows } = await client.query('select name from schema_migrations')
    const done = new Set(rows.map((r) => r.name))
    const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort()

    let applied = 0
    for (const file of files) {
      if (done.has(file)) continue
      const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf8')
      // Each migration is its own transaction: a failure rolls that step back whole and
      // leaves schema_migrations untouched, so the next boot retries exactly it.
      await client.query('begin')
      try {
        await client.query(sql)
        await client.query('insert into schema_migrations (name) values ($1)', [file])
        await client.query('commit')
        applied++
      } catch (err) {
        await client.query('rollback')
        throw err
      }
    }
    return applied
  } finally {
    await client.query('select pg_advisory_unlock($1)', [MIGRATION_LOCK_KEY])
    client.release()
  }
}
```

- [ ] **Step 6: Correr y verificar que pasa**

```bash
cd server && npx vitest run __tests__/db.test.ts
```

Esperado: PASS (3 tests).

- [ ] **Step 7: Commit**

```bash
git add server/
git commit -m "feat(sync-service): schema y runner de migraciones con advisory lock"
```

---

### Task 2: `project_seq` por rango, y la prueba de concurrencia que la spec exige

**Files:**
- Create: `server/src/seq.ts`
- Test: `server/__tests__/seq.test.ts`

**Interfaces:**
- Consumes: `getPool`, `migrate` del Task 1.
- Produces: `allocateSeqRange(client: PoolClient, projectId: number, count: number): Promise<number>` — devuelve el **primer** número del rango `[start .. start + count - 1]`. Tiene que llamarse **dentro** de la misma transacción que el insert.

Este es el punto técnico más fino de la spec y su modo de falla es silencioso. El cursor del pull es `project_seq > n`, así que la secuencia tiene que ser monótona y sin agujeros visibles dentro del proyecto. Un `bigserial` global no sirve: las secuencias se consumen fuera de transacción, dos concurrentes pueden commitear 105 antes que 104, y un cliente que pulea justo en el medio ve 105, avanza el cursor, y **la 104 no se pulea nunca**.

- [ ] **Step 1: Escribir el test que falla, con conexiones peleando de verdad**

`server/__tests__/seq.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { getPool, migrate } from '../src/db'
import { allocateSeqRange } from '../src/seq'

const pool = getPool()
let userId: string
let projectId: number

beforeAll(async () => {
  await migrate(pool)
  userId = '00000000-0000-0000-0000-0000000000bb'
  await pool.query('insert into users (id) values ($1) on conflict do nothing', [userId])
  const { rows } = await pool.query(
    `insert into projects (user_id, project_key, display_name) values ($1, $2, $2) returning id`,
    [userId, `seq-test-${Date.now()}`]
  )
  projectId = rows[0].id
})

afterAll(async () => { await pool.end() })

describe('allocateSeqRange', () => {
  it('hands out a contiguous range and advances the counter', async () => {
    const client = await pool.connect()
    try {
      await client.query('begin')
      const first = await allocateSeqRange(client, projectId, 3)
      const second = await allocateSeqRange(client, projectId, 2)
      await client.query('commit')
      expect(second).toBe(first + 3)
    } finally {
      client.release()
    }
  })

  // This is the test the spec calls mandatory. The benchmark behind the design ran on
  // PGlite, which is single-connection, so it could not have caught a gap or a duplicate.
  it('produces no gap and no duplicate under 20 concurrent writers', async () => {
    const { rows } = await pool.query(
      `insert into projects (user_id, project_key, display_name) values ($1, $2, $2) returning id, seq_counter`,
      [userId, `seq-race-${Date.now()}`]
    )
    const raceProject = rows[0].id
    const WRITERS = 20
    const PER_WRITER = 5

    const allocated = await Promise.all(
      Array.from({ length: WRITERS }, async () => {
        const client = await pool.connect()
        try {
          await client.query('begin')
          const start = await allocateSeqRange(client, raceProject, PER_WRITER)
          await client.query('commit')
          return Array.from({ length: PER_WRITER }, (_, i) => start + i)
        } finally {
          client.release()
        }
      })
    )

    const seqs = allocated.flat().sort((a, b) => a - b)
    expect(seqs.length).toBe(WRITERS * PER_WRITER)
    expect(new Set(seqs).size).toBe(seqs.length) // no duplicates
    expect(seqs[0]).toBe(1)
    expect(seqs[seqs.length - 1]).toBe(WRITERS * PER_WRITER) // no gaps
    seqs.forEach((s, i) => expect(s).toBe(i + 1))
  })
})
```

- [ ] **Step 2: Correr y verificar que falla**

```bash
cd server && npx vitest run __tests__/seq.test.ts
```

Esperado: FAIL, `src/seq` no existe.

- [ ] **Step 3: Implementar**

`server/src/seq.ts`:

```ts
import type { PoolClient } from 'pg'

/**
 * Allocates a contiguous block of project_seq values and returns its first number.
 *
 * MUST be called inside the same transaction as the inserts that consume the range. The
 * UPDATE takes a row lock on the project for the rest of that transaction, which is what
 * serializes concurrent pushes to the same project — correct and cheap, because a project
 * has a handful of devices, not thousands.
 *
 * Deliberately NOT a global bigserial. Sequences are consumed outside the transaction, so
 * two concurrent writers can commit 105 before 104; a client polling in between sees 105,
 * advances its cursor past 104, and never pulls it. That loss is silent, which is why the
 * concurrency test around this function is not optional.
 */
export async function allocateSeqRange(
  client: PoolClient,
  projectId: number,
  count: number
): Promise<number> {
  if (count <= 0) throw new Error('allocateSeqRange: count must be positive')
  const { rows } = await client.query(
    'update projects set seq_counter = seq_counter + $2 where id = $1 returning seq_counter',
    [projectId, count]
  )
  if (rows.length === 0) throw new Error(`allocateSeqRange: no project ${projectId}`)
  return Number(rows[0].seq_counter) - count + 1
}
```

- [ ] **Step 4: Correr y verificar que pasa**

```bash
cd server && npx vitest run __tests__/seq.test.ts
```

Esperado: PASS (2 tests). Si el de concurrencia falla, el servicio perdería filas en producción: no lo marques como flaky, arreglá la asignación.

- [ ] **Step 5: Commit**

```bash
git add server/src/seq.ts server/__tests__/seq.test.ts
git commit -m "feat(sync-service): project_seq por rango, con la prueba de concurrencia real"
```

---

### Task 3: Auth, allowlist y gate de plan

**Files:**
- Create: `server/src/auth.ts`
- Test: `server/__tests__/auth.test.ts`

**Interfaces:**
- Consumes: `getPool`, `migrate`.
- Produces: `hashToken(token: string): string` (sha256 hex) y `authenticate(pool: Pool, header: string | undefined): Promise<AuthResult>`, con `type AuthResult = { ok: true; deviceId: string; userId: string; plan: string } | { ok: false; status: 401 | 403; error: string }`.

Los códigos de error son contrato: el cliente los distingue. `401 unauthorized` para token ausente, mal formado o revocado. `403 not_in_beta` para un usuario que no está en `allowlist` (§9.1). `403 plan_required` para un plan sin nube (§9.3).

- [ ] **Step 1: Escribir el test que falla**

`server/__tests__/auth.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { randomUUID } from 'node:crypto'
import { getPool, migrate } from '../src/db'
import { hashToken, authenticate } from '../src/auth'

const pool = getPool()
const TOKEN = 'nmk_auth_test_token'
let userId: string
let deviceId: string

beforeAll(async () => {
  await migrate(pool)
  userId = randomUUID()
  deviceId = randomUUID()
  await pool.query(`insert into users (id, plan) values ($1, 'pro')`, [userId])
  await pool.query(
    `insert into devices (id, user_id, name, token_hash) values ($1, $2, 'test-device', $3)`,
    [deviceId, userId, hashToken(TOKEN)]
  )
  await pool.query('insert into allowlist (user_id) values ($1)', [userId])
})

afterAll(async () => { await pool.end() })

describe('authenticate', () => {
  it('accepts a known token', async () => {
    const r = await authenticate(pool, `Bearer ${TOKEN}`)
    expect(r).toMatchObject({ ok: true, deviceId, userId, plan: 'pro' })
  })

  it('never stores the token itself', async () => {
    const { rows } = await pool.query('select token_hash from devices where id = $1', [deviceId])
    expect(rows[0].token_hash).not.toContain(TOKEN)
    expect(rows[0].token_hash).toBe(hashToken(TOKEN))
  })

  it('rejects a missing header with 401', async () => {
    expect(await authenticate(pool, undefined)).toMatchObject({ ok: false, status: 401 })
  })

  it('rejects an unknown token with 401', async () => {
    expect(await authenticate(pool, 'Bearer nope')).toMatchObject({ ok: false, status: 401 })
  })

  it('rejects a revoked device with 401', async () => {
    const revokedToken = 'nmk_revoked'
    const revokedId = randomUUID()
    await pool.query(
      `insert into devices (id, user_id, name, token_hash, revoked_at)
       values ($1, $2, 'revoked', $3, now())`,
      [revokedId, userId, hashToken(revokedToken)]
    )
    expect(await authenticate(pool, `Bearer ${revokedToken}`)).toMatchObject({ ok: false, status: 401 })
  })

  it('rejects a user outside the allowlist with 403 not_in_beta', async () => {
    const outsiderId = randomUUID()
    const outsiderDevice = randomUUID()
    const outsiderToken = 'nmk_outsider'
    await pool.query(`insert into users (id, plan) values ($1, 'pro')`, [outsiderId])
    await pool.query(
      `insert into devices (id, user_id, name, token_hash) values ($1, $2, 'outsider', $3)`,
      [outsiderDevice, outsiderId, hashToken(outsiderToken)]
    )
    expect(await authenticate(pool, `Bearer ${outsiderToken}`)).toMatchObject({
      ok: false, status: 403, error: 'not_in_beta',
    })
  })

  it('rejects a free plan with 403 plan_required', async () => {
    const freeId = randomUUID()
    const freeDevice = randomUUID()
    const freeToken = 'nmk_free'
    await pool.query(`insert into users (id, plan) values ($1, 'free')`, [freeId])
    await pool.query(
      `insert into devices (id, user_id, name, token_hash) values ($1, $2, 'free', $3)`,
      [freeDevice, freeId, hashToken(freeToken)]
    )
    await pool.query('insert into allowlist (user_id) values ($1)', [freeId])
    expect(await authenticate(pool, `Bearer ${freeToken}`)).toMatchObject({
      ok: false, status: 403, error: 'plan_required',
    })
  })
})
```

- [ ] **Step 2: Correr y verificar que falla**

```bash
cd server && npx vitest run __tests__/auth.test.ts
```

Esperado: FAIL, `src/auth` no existe.

- [ ] **Step 3: Implementar**

`server/src/auth.ts`:

```ts
import { createHash } from 'node:crypto'
import type { Pool } from 'pg'

export type AuthResult =
  | { ok: true; deviceId: string; userId: string; plan: string }
  | { ok: false; status: 401 | 403; error: string }

/** The service stores only this, never the token (§9.1). */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

// Plans that include cloud sync. Checked server-side because the renderer's own check is a
// release blocker: anything enforced only in the client is not enforced (§9.3).
const CLOUD_PLANS = new Set(['pro', 'team', 'enterprise'])

export async function authenticate(pool: Pool, header: string | undefined): Promise<AuthResult> {
  const token = (header ?? '').replace(/^Bearer\s+/i, '').trim()
  if (!token) return { ok: false, status: 401, error: 'unauthorized' }

  const { rows } = await pool.query(
    `select d.id as device_id, d.user_id, u.plan,
            (a.user_id is not null) as allowed
       from devices d
       join users u on u.id = d.user_id
       left join allowlist a on a.user_id = d.user_id
      where d.token_hash = $1 and d.revoked_at is null`,
    [hashToken(token)]
  )
  if (rows.length === 0) return { ok: false, status: 401, error: 'unauthorized' }

  const row = rows[0]
  if (!row.allowed) return { ok: false, status: 403, error: 'not_in_beta' }
  if (!CLOUD_PLANS.has(row.plan)) return { ok: false, status: 403, error: 'plan_required' }

  // Best-effort liveness stamp; never let it fail the request.
  pool
    .query('update devices set last_seen_at = now() where id = $1', [row.device_id])
    .catch(() => {})

  return { ok: true, deviceId: row.device_id, userId: row.user_id, plan: row.plan }
}
```

- [ ] **Step 4: Correr y verificar que pasa**

```bash
cd server && npx vitest run __tests__/auth.test.ts
```

Esperado: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add server/src/auth.ts server/__tests__/auth.test.ts
git commit -m "feat(sync-service): auth por sha256 del token, allowlist y gate de plan"
```

---

### Task 4: Push — el camino base y la idempotencia

**Files:**
- Create: `server/src/push.ts`
- Test: `server/__tests__/push.test.ts`

**Interfaces:**
- Consumes: `allocateSeqRange` (Task 2), `AuthResult` (Task 3).
- Produces: `handlePush(pool: Pool, auth: { deviceId: string; userId: string }, body: PushBody): Promise<PushResponse>`, con `PushBody = { device_id?: string; mutations: Mutation[] }` y `PushResponse = { results: Array<{ sync_id: string; outcome: 'applied' | 'superseded' | 'rejected'; project_seq: number; error?: string }> }`.

- [ ] **Step 1: Escribir el test que falla**

`server/__tests__/push.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { randomUUID } from 'node:crypto'
import { getPool, migrate } from '../src/db'
import { handlePush } from '../src/push'

const pool = getPool()
let auth: { deviceId: string; userId: string }
const PROJECT = () => `push-test-${randomUUID().slice(0, 8)}`

beforeAll(async () => {
  await migrate(pool)
  const userId = randomUUID()
  const deviceId = randomUUID()
  await pool.query(`insert into users (id, plan) values ($1, 'pro')`, [userId])
  await pool.query(
    `insert into devices (id, user_id, name, token_hash) values ($1, $2, 'push', $3)`,
    [deviceId, userId, `hash-${deviceId}`]
  )
  auth = { deviceId, userId }
})

afterAll(async () => { await pool.end() })

function mutation(seq: number, syncId: string, projectKey: string, extra: Record<string, unknown> = {}) {
  return {
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
      tags: ['x'],
      lamport: 1,
      updated_at: Date.now(),
      created_at: Date.now(),
      ...extra,
    },
  }
}

describe('handlePush', () => {
  it('applies a new observation and reports its project_seq', async () => {
    const p = PROJECT()
    const res = await handlePush(pool, auth, { mutations: [mutation(1, 'obs-1', p)] })
    expect(res.results).toHaveLength(1)
    expect(res.results[0]).toMatchObject({ sync_id: 'obs-1', outcome: 'applied' })
    expect(res.results[0].project_seq).toBeGreaterThan(0)
  })

  it('creates the project on first sight and keeps its display name', async () => {
    const p = PROJECT()
    await handlePush(pool, auth, { mutations: [mutation(10, 'obs-2', p)] })
    const { rows } = await pool.query(
      'select display_name from projects where user_id = $1 and project_key = $2',
      [auth.userId, p]
    )
    expect(rows[0].display_name).toBe(p)
  })

  it('replaying the same (device_id, seq) returns the stored result, not a new one', async () => {
    const p = PROJECT()
    const body = { mutations: [mutation(20, 'obs-3', p)] }
    const first = await handlePush(pool, auth, body)
    const replay = await handlePush(pool, auth, body)
    expect(replay.results[0].outcome).toBe(first.results[0].outcome)
    expect(replay.results[0].project_seq).toBe(first.results[0].project_seq)
    const { rows } = await pool.query('select count(*)::int as n from observations where sync_id = $1', ['obs-3'])
    expect(rows[0].n).toBe(1)
  })

  it('assigns sequential project_seq within one batch', async () => {
    const p = PROJECT()
    const res = await handlePush(pool, auth, {
      mutations: [mutation(30, 'obs-4', p), mutation(31, 'obs-5', p), mutation(32, 'obs-6', p)],
    })
    const seqs = res.results.map((r) => r.project_seq)
    expect(seqs[1]).toBe(seqs[0] + 1)
    expect(seqs[2]).toBe(seqs[1] + 1)
  })

  it('stores tags as a real jsonb array', async () => {
    const p = PROJECT()
    await handlePush(pool, auth, { mutations: [mutation(40, 'obs-7', p, { tags: ['alfa', 'beta'] })] })
    const { rows } = await pool.query('select tags from observations where sync_id = $1', ['obs-7'])
    expect(rows[0].tags).toEqual(['alfa', 'beta'])
  })

  it('keeps the client timestamp, not the server clock', async () => {
    const p = PROJECT()
    const stamp = Date.now() - 86_400_000
    await handlePush(pool, auth, { mutations: [mutation(50, 'obs-8', p, { updated_at: stamp })] })
    const { rows } = await pool.query('select client_updated_at from observations where sync_id = $1', ['obs-8'])
    expect(new Date(rows[0].client_updated_at).getTime()).toBe(stamp)
  })

  it('never stores source_ref even when the client sends it', async () => {
    const p = PROJECT()
    await handlePush(pool, auth, {
      mutations: [mutation(60, 'obs-9', p, { source_ref: 'markdown:C:\\Users\\real\\x.md#t' })],
    })
    const { rows } = await pool.query(
      `select column_name from information_schema.columns
        where table_name = 'observations' and column_name = 'source_ref'`
    )
    expect(rows).toHaveLength(0)
  })
})
```

- [ ] **Step 2: Correr y verificar que falla**

```bash
cd server && npx vitest run __tests__/push.test.ts
```

Esperado: FAIL, `src/push` no existe.

- [ ] **Step 3: Implementar**

`server/src/push.ts`:

```ts
import type { Pool, PoolClient } from 'pg'
import { allocateSeqRange } from './seq'

export interface Mutation {
  seq: number
  sync_id: string
  op: 'upsert' | 'delete' | 'promote'
  payload: Record<string, unknown>
}

export interface PushBody {
  device_id?: string
  mutations: Mutation[]
}

export interface PushResult {
  sync_id: string
  outcome: 'applied' | 'superseded' | 'rejected'
  project_seq: number
  error?: string
}

export interface PushResponse {
  results: PushResult[]
}

/** §5.2: tags travel as a real array. The client may still send a JSON string. */
export function normalizeTags(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((t): t is string => typeof t === 'string')
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value)
      if (Array.isArray(parsed)) return parsed.filter((t): t is string => typeof t === 'string')
    } catch { /* not JSON — treat as untagged */ }
  }
  return []
}

/** §5.2: the client may send epoch ms or ISO 8601, and the value is the CLIENT's clock. */
export function parseClientTimestamp(value: unknown, fallback: number): Date {
  if (typeof value === 'number') return new Date(value)
  if (typeof value === 'string') {
    const parsed = Date.parse(value)
    if (!Number.isNaN(parsed)) return new Date(parsed)
  }
  return new Date(fallback)
}

async function ensureProject(
  client: PoolClient,
  userId: string,
  projectKey: string,
  displayName: string
): Promise<number> {
  const { rows } = await client.query(
    `insert into projects (user_id, project_key, display_name) values ($1, $2, $3)
     on conflict (user_id, project_key) do update set display_name = excluded.display_name
     returning id`,
    [userId, projectKey, displayName]
  )
  return Number(rows[0].id)
}

export async function handlePush(
  pool: Pool,
  auth: { deviceId: string; userId: string },
  body: PushBody
): Promise<PushResponse> {
  const mutations = Array.isArray(body.mutations) ? body.mutations : []
  const results: PushResult[] = []

  const client = await pool.connect()
  try {
    for (const m of mutations) {
      // §5.1 idempotency. The client retries anything missing from `results`, and a
      // response lost on the wire is indistinguishable from a mutation never processed —
      // so a replay must return the stored receipt rather than applying anything twice.
      const prior = await client.query(
        'select sync_id, outcome, project_seq from push_receipts where device_id = $1 and seq = $2',
        [auth.deviceId, m.seq]
      )
      if (prior.rows.length > 0) {
        results.push({
          sync_id: prior.rows[0].sync_id,
          outcome: prior.rows[0].outcome,
          project_seq: Number(prior.rows[0].project_seq ?? 0),
        })
        continue
      }

      const p = m.payload ?? {}
      const syncId = m.sync_id ?? String(p.sync_id ?? '')
      const projectKey = String(p.project_key ?? '__global__')
      const displayName = String(p.project_display_name ?? projectKey)
      const now = Date.now()

      await client.query('begin')
      try {
        const projectId = await ensureProject(client, auth.userId, projectKey, displayName)
        const seq = await allocateSeqRange(client, projectId, 1)

        await client.query(
          `insert into observations (
             sync_id, project_id, project_seq, scope, type, topic_key, title, content, tags,
             content_hash, origin_ai, origin_account, git_branch, author_id, author_display,
             lamport, client_updated_at, client_created_at, deleted, superseded_by)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)
           on conflict (sync_id) do update set
             title = excluded.title, content = excluded.content, tags = excluded.tags,
             lamport = excluded.lamport, client_updated_at = excluded.client_updated_at,
             deleted = excluded.deleted, project_seq = excluded.project_seq`,
          [
            syncId,
            projectId,
            seq,
            String(p.scope ?? 'personal'),
            String(p.type ?? 'discovery'),
            (p.topic_key as string | null) ?? null,
            String(p.title ?? ''),
            (p.content as string | null) ?? null,
            JSON.stringify(normalizeTags(p.tags)),
            (p.content_hash as string | null) ?? null,
            (p.origin_ai as string | null) ?? null,
            (p.origin_account as string | null) ?? null,
            (p.git_branch as string | null) ?? null,
            auth.userId,
            (p.author_display as string | null) ?? null,
            Number(p.lamport ?? 0),
            parseClientTimestamp(p.updated_at ?? p.client_updated_at, now),
            parseClientTimestamp(p.created_at ?? p.client_created_at, now),
            Boolean(p.deleted),
            null,
          ]
        )

        const result: PushResult = { sync_id: syncId, outcome: 'applied', project_seq: seq }
        await client.query(
          `insert into push_receipts (device_id, seq, sync_id, outcome, project_seq)
           values ($1,$2,$3,$4,$5) on conflict do nothing`,
          [auth.deviceId, m.seq, syncId, result.outcome, seq]
        )
        await client.query('commit')
        results.push(result)
      } catch (err) {
        await client.query('rollback')
        // Omitted from `results` on purpose: per §5.1 that is how the server says "I did
        // not process this, send it again". A `rejected` here would be terminal and the
        // client would never retry a mutation that a later attempt could well apply.
        console.error('[push] mutation failed, leaving it for retry', m.sync_id, err)
      }
    }
    return { results }
  } finally {
    client.release()
  }
}
```

Nota sobre `source_ref`: no está en el schema y el insert no lo nombra, así que se descarta solo. El test lo verifica por ausencia de columna, que es la garantía real.

- [ ] **Step 4: Correr y verificar que pasa**

```bash
cd server && npx vitest run __tests__/push.test.ts
```

Esperado: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add server/src/push.ts server/__tests__/push.test.ts
git commit -m "feat(sync-service): push con idempotencia por (device_id, seq)"
```

---

### Task 5: Push — la colisión de topic se supersede, no se rechaza (§8.1)

**Files:**
- Create: `server/src/lww.ts`
- Modify: `server/src/push.ts`
- Test: `server/__tests__/lww.test.ts`, `server/__tests__/push-topic.test.ts`

**Interfaces:**
- Consumes: `handlePush` del Task 4.
- Produces: `resolveTopicCollision(a: Candidate, b: Candidate): { winner: Candidate; loser: Candidate }` desde `server/src/lww.ts`, con `type Candidate = { syncId: string; updatedAt: number; lamport: number }`.

Este es el arreglo que justifica reemplazar el backend viejo. El viejo hacía un INSERT plano contra `obs_topic_uniq`, la segunda memoria volvía `rejected`, el cliente la marcaba pushed y no la reintentaba nunca. Las dos máquinas quedaban mostrando memorias distintas para el mismo topic, para siempre, sin que nada reportara un error.

**Antes de implementar, leé `electron/memory-merge.ts`.** La regla se porta, no se inventa: mayor `updatedAt`, después mayor `lamport`, después mayor `syncId` lexicográfico. Si difiere en un caso, las dos puntas dejan de converger.

- [ ] **Step 1: Escribir el test de la regla**

`server/__tests__/lww.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { resolveTopicCollision } from '../src/lww'

const c = (syncId: string, updatedAt: number, lamport: number) => ({ syncId, updatedAt, lamport })

describe('resolveTopicCollision', () => {
  it('prefers the greater updatedAt', () => {
    expect(resolveTopicCollision(c('a', 1, 9), c('b', 2, 1)).winner.syncId).toBe('b')
  })

  it('breaks an updatedAt tie with the greater lamport', () => {
    expect(resolveTopicCollision(c('a', 5, 1), c('b', 5, 2)).winner.syncId).toBe('b')
  })

  it('breaks a full tie with the greater syncId, lexicographically', () => {
    expect(resolveTopicCollision(c('a', 5, 5), c('b', 5, 5)).winner.syncId).toBe('b')
    expect(resolveTopicCollision(c('z', 5, 5), c('b', 5, 5)).winner.syncId).toBe('z')
  })

  it('is symmetric — argument order never changes the winner', () => {
    const x = c('x', 7, 3)
    const y = c('y', 7, 4)
    expect(resolveTopicCollision(x, y).winner.syncId).toBe(resolveTopicCollision(y, x).winner.syncId)
  })

  it('always returns the other one as the loser', () => {
    const r = resolveTopicCollision(c('a', 1, 1), c('b', 2, 2))
    expect(r.loser.syncId).toBe('a')
  })
})
```

- [ ] **Step 2: Escribir el test de la colisión contra Postgres**

`server/__tests__/push-topic.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { randomUUID } from 'node:crypto'
import { getPool, migrate } from '../src/db'
import { handlePush } from '../src/push'

const pool = getPool()
let auth: { deviceId: string; userId: string }

beforeAll(async () => {
  await migrate(pool)
  const userId = randomUUID()
  const deviceId = randomUUID()
  await pool.query(`insert into users (id, plan) values ($1, 'pro')`, [userId])
  await pool.query(
    `insert into devices (id, user_id, name, token_hash) values ($1, $2, 'topic', $3)`,
    [deviceId, userId, `hash-${deviceId}`]
  )
  auth = { deviceId, userId }
})

afterAll(async () => { await pool.end() })

function topicMutation(seq: number, syncId: string, projectKey: string, updatedAt: number, lamport: number) {
  return {
    seq,
    sync_id: syncId,
    op: 'upsert' as const,
    payload: {
      sync_id: syncId, project_key: projectKey, project_display_name: projectKey,
      scope: 'personal', type: 'decision', topic_key: 'deploy-target',
      title: syncId, content: 'body', tags: [], lamport,
      updated_at: updatedAt, created_at: updatedAt,
    },
  }
}

describe('topic collision (§8.1)', () => {
  it('supersedes the loser instead of rejecting it, and keeps both rows', async () => {
    const p = `topic-${randomUUID().slice(0, 8)}`
    const now = Date.now()
    await handlePush(pool, auth, { mutations: [topicMutation(100, 'obs-early', p, now, 5)] })
    const late = await handlePush(pool, auth, {
      mutations: [topicMutation(101, 'obs-late', p, now + 60_000, 6)],
    })

    expect(late.results[0].outcome).not.toBe('rejected')

    const { rows } = await pool.query(
      `select sync_id, superseded_by from observations where sync_id in ('obs-early','obs-late')
       order by sync_id`
    )
    expect(rows).toHaveLength(2) // nothing discarded
    const early = rows.find((r) => r.sync_id === 'obs-early')
    const lateRow = rows.find((r) => r.sync_id === 'obs-late')
    expect(early.superseded_by).toBe('obs-late')
    expect(lateRow.superseded_by).toBeNull()
  })

  it('stores an incoming loser already superseded, and still accepts it', async () => {
    const p = `topic-${randomUUID().slice(0, 8)}`
    const now = Date.now()
    await handlePush(pool, auth, { mutations: [topicMutation(200, 'obs-winner', p, now + 60_000, 9)] })
    const loser = await handlePush(pool, auth, {
      mutations: [topicMutation(201, 'obs-loser', p, now, 1)],
    })

    expect(loser.results[0].outcome).toBe('superseded')
    const { rows } = await pool.query(
      `select superseded_by from observations where sync_id = 'obs-loser'`
    )
    expect(rows[0].superseded_by).toBe('obs-winner')
  })

  it('leaves exactly one live row for the topic', async () => {
    const p = `topic-${randomUUID().slice(0, 8)}`
    const now = Date.now()
    await handlePush(pool, auth, { mutations: [topicMutation(300, 'obs-x', p, now, 1)] })
    await handlePush(pool, auth, { mutations: [topicMutation(301, 'obs-y', p, now + 1000, 2)] })
    await handlePush(pool, auth, { mutations: [topicMutation(302, 'obs-z', p, now + 2000, 3)] })

    const { rows } = await pool.query(
      `select count(*)::int as n from observations o
        join projects pr on pr.id = o.project_id
       where pr.project_key = $1 and o.topic_key = 'deploy-target'
         and o.superseded_by is null and o.deleted = false`,
      [p]
    )
    expect(rows[0].n).toBe(1)
  })
})
```

- [ ] **Step 3: Correr y verificar que fallan**

```bash
cd server && npx vitest run __tests__/lww.test.ts __tests__/push-topic.test.ts
```

Esperado: FAIL — `src/lww` no existe, y el push todavía viola `obs_topic_uniq`.

- [ ] **Step 4: Implementar la regla**

`server/src/lww.ts`:

```ts
export interface Candidate {
  syncId: string
  updatedAt: number
  lamport: number
}

/**
 * The deterministic last-writer-wins rule, ported from electron/memory-merge.ts.
 *
 * Both ends compute this independently and must agree in every case: greater updatedAt,
 * then greater lamport, then greater syncId lexicographically. If the server's rule ever
 * drifts from the client's, replicas stop converging — which is silent, not loud, so the
 * ordering here is not a place to be clever.
 */
export function resolveTopicCollision(a: Candidate, b: Candidate): { winner: Candidate; loser: Candidate } {
  const winner = pick(a, b)
  return { winner, loser: winner === a ? b : a }
}

function pick(a: Candidate, b: Candidate): Candidate {
  if (a.updatedAt !== b.updatedAt) return a.updatedAt > b.updatedAt ? a : b
  if (a.lamport !== b.lamport) return a.lamport > b.lamport ? a : b
  return a.syncId > b.syncId ? a : b
}
```

- [ ] **Step 5: Aplicarla en el push**

En `server/src/push.ts`, importar `resolveTopicCollision` y, **dentro de la transacción**, entre `allocateSeqRange` y el insert, resolver la colisión:

```ts
        // §8.1: a topic collision supersedes the loser; it never rejects it. The old server
        // did a plain INSERT against obs_topic_uniq, the second memory came back `rejected`,
        // the client marked it pushed and never retried, and the two machines showed
        // different memories for the same topic forever. Nothing is discarded here.
        let supersededBy: string | null = null
        const topicKey = (p.topic_key as string | null) ?? null
        const incomingDeleted = m.op === 'delete' || Boolean(p.deleted)

        if (topicKey && !incomingDeleted) {
          const owner = await client.query(
            `select sync_id, lamport, client_updated_at from observations
              where project_id = $1 and scope = $2 and topic_key = $3
                and sync_id <> $4 and deleted = false and superseded_by is null
              for update`,
            [projectId, String(p.scope ?? 'personal'), topicKey, syncId]
          )
          if (owner.rows.length > 0) {
            const existing = {
              syncId: owner.rows[0].sync_id,
              updatedAt: new Date(owner.rows[0].client_updated_at).getTime(),
              lamport: Number(owner.rows[0].lamport),
            }
            const incoming = {
              syncId,
              updatedAt: parseClientTimestamp(p.updated_at ?? p.client_updated_at, now).getTime(),
              lamport: Number(p.lamport ?? 0),
            }
            const { winner } = resolveTopicCollision(existing, incoming)
            if (winner.syncId === syncId) {
              // The incoming wins: the existing row is superseded BEFORE the insert, because
              // obs_topic_uniq admits no second live row. Insert-then-supersede is not a
              // slower order, it is an impossible one.
              await client.query(
                `update observations set superseded_by = $1, project_seq = $2
                  where sync_id = $3`,
                [syncId, await allocateSeqRange(client, projectId, 1), existing.syncId]
              )
            } else {
              // The existing wins: the incoming is stored ALREADY superseded. It is still
              // accepted and still replicates, so the client learns who won from the pull.
              supersededBy = existing.syncId
            }
          }
        }
```

Y en el insert, reemplazar el último parámetro `null` por `supersededBy`, y el `outcome` por `supersededBy ? 'superseded' : 'applied'`. El `for update` del select es lo que serializa dos pushes concurrentes sobre el mismo topic.

**Ojo con el orden**: el `update` del perdedor consume un `project_seq` nuevo para que el cliente vuelva a puleárselo con el `superseded_by` puesto. Sin eso, la fila supersedida queda con un seq viejo que los devices ya pasaron y nunca se enteran de que perdió.

- [ ] **Step 6: Correr y verificar que pasan**

```bash
cd server && npx vitest run
```

Esperado: PASS, todos los archivos.

- [ ] **Step 7: Commit**

```bash
git add server/src/lww.ts server/src/push.ts server/__tests__/
git commit -m "feat(sync-service): la colision de topic supersede en vez de rechazar"
```

---

### Task 6: Push — tombstones (§8.2)

**Files:**
- Modify: `server/src/push.ts`
- Test: `server/__tests__/push-tombstone.test.ts`

**Interfaces:**
- Consumes: `handlePush` de los tasks 4 y 5.
- Produces: nada nuevo; `handlePush` pasa a leer `m.op`.

El servidor viejo **nunca leía `op`** y su columna `content` era NOT NULL, así que un borrado en una máquina no llegaba nunca a la otra. Acá `content` ya es nullable por el schema del Task 1; falta que el handler distinga un delete de un upsert.

- [ ] **Step 1: Escribir el test que falla**

`server/__tests__/push-tombstone.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { randomUUID } from 'node:crypto'
import { getPool, migrate } from '../src/db'
import { handlePush } from '../src/push'

const pool = getPool()
let auth: { deviceId: string; userId: string }

beforeAll(async () => {
  await migrate(pool)
  const userId = randomUUID()
  const deviceId = randomUUID()
  await pool.query(`insert into users (id, plan) values ($1, 'pro')`, [userId])
  await pool.query(
    `insert into devices (id, user_id, name, token_hash) values ($1, $2, 'tomb', $3)`,
    [deviceId, userId, `hash-${deviceId}`]
  )
  auth = { deviceId, userId }
})

afterAll(async () => { await pool.end() })

const base = (seq: number, syncId: string, projectKey: string, op: 'upsert' | 'delete', content: string | null) => ({
  seq, sync_id: syncId, op,
  payload: {
    sync_id: syncId, project_key: projectKey, project_display_name: projectKey,
    scope: 'personal', type: 'decision', topic_key: null, title: syncId,
    content, tags: [], lamport: 1, updated_at: Date.now(), created_at: Date.now(),
  },
})

describe('tombstones (§8.2)', () => {
  it('accepts a delete and marks the row deleted with null content', async () => {
    const p = `tomb-${randomUUID().slice(0, 8)}`
    await handlePush(pool, auth, { mutations: [base(400, 'obs-del', p, 'upsert', 'alive')] })
    const res = await handlePush(pool, auth, { mutations: [base(401, 'obs-del', p, 'delete', null)] })

    expect(res.results[0].outcome).not.toBe('rejected')
    const { rows } = await pool.query(
      'select deleted, content from observations where sync_id = $1', ['obs-del']
    )
    expect(rows[0].deleted).toBe(true)
    expect(rows[0].content).toBeNull()
  })

  it('a delete frees the topic slot for a later live row', async () => {
    const p = `tomb-${randomUUID().slice(0, 8)}`
    const withTopic = (seq: number, syncId: string, op: 'upsert' | 'delete') => ({
      seq, sync_id: syncId, op,
      payload: {
        sync_id: syncId, project_key: p, project_display_name: p, scope: 'personal',
        type: 'decision', topic_key: 'a-slot', title: syncId, content: op === 'delete' ? null : 'x',
        tags: [], lamport: 1, updated_at: Date.now(), created_at: Date.now(),
      },
    })
    await handlePush(pool, auth, { mutations: [withTopic(500, 'slot-1', 'upsert')] })
    await handlePush(pool, auth, { mutations: [withTopic(501, 'slot-1', 'delete')] })
    const after = await handlePush(pool, auth, { mutations: [withTopic(502, 'slot-2', 'upsert')] })

    expect(after.results[0].outcome).toBe('applied')
  })

  it('a delete never gives a tombstone the topic slot of a live row', async () => {
    const p = `tomb-${randomUUID().slice(0, 8)}`
    const live = {
      seq: 600, sync_id: 'live-row', op: 'upsert' as const,
      payload: {
        sync_id: 'live-row', project_key: p, project_display_name: p, scope: 'personal',
        type: 'decision', topic_key: 'contested', title: 'live', content: 'x', tags: [],
        lamport: 1, updated_at: Date.now(), created_at: Date.now(),
      },
    }
    const tombstone = {
      seq: 601, sync_id: 'dead-row', op: 'delete' as const,
      payload: {
        sync_id: 'dead-row', project_key: p, project_display_name: p, scope: 'personal',
        type: 'decision', topic_key: 'contested', title: 'dead', content: null, tags: [],
        lamport: 99, updated_at: Date.now() + 60_000, created_at: Date.now(),
      },
    }
    await handlePush(pool, auth, { mutations: [live] })
    await handlePush(pool, auth, { mutations: [tombstone] })

    const { rows } = await pool.query(
      'select superseded_by from observations where sync_id = $1', ['live-row']
    )
    expect(rows[0].superseded_by).toBeNull() // the live row keeps the slot
  })
})
```

- [ ] **Step 2: Correr y verificar que falla**

```bash
cd server && npx vitest run __tests__/push-tombstone.test.ts
```

Esperado: FAIL en el primero — `deleted` sigue en false porque nadie lee `op`.

- [ ] **Step 3: Implementar**

En `server/src/push.ts`, dentro del loop, antes del insert:

```ts
        // §8.2: the old server never read `op` at all and its content column was NOT NULL,
        // so a delete on one machine never reached the other. A delete nulls the content
        // and the row keeps travelling like any other.
        const isDelete = m.op === 'delete'
```

Y en los parámetros del insert, `content` pasa a `isDelete ? null : ((p.content as string | null) ?? null)` y `deleted` pasa a `isDelete || Boolean(p.deleted)`. La guarda `!incomingDeleted` del Task 5 ya usa la misma señal, así que un tombstone nunca entra al camino de colisión.

- [ ] **Step 4: Correr y verificar que pasa**

```bash
cd server && npx vitest run
```

Esperado: PASS, todo.

- [ ] **Step 5: Commit**

```bash
git add server/src/push.ts server/__tests__/push-tombstone.test.ts
git commit -m "feat(sync-service): tombstones — leer op y aceptar content nulo"
```

---

### Task 7: Pull

**Files:**
- Create: `server/src/pull.ts`
- Test: `server/__tests__/pull.test.ts`

**Interfaces:**
- Consumes: `handlePush`.
- Produces: `handlePull(pool: Pool, auth: { userId: string }, body: PullBody): Promise<PullResponse>`, con `PullBody = { cursors?: Record<string, number>; limit?: number }` y `PullResponse = { rows: PulledRow[]; cursors: Record<string, number>; next_poll_ms: number }`.

Tres cosas que el servidor viejo no cumplía y que el cliente necesita (§5.2): `project_key` en cada fila (el cliente mapea por clave y no hace lookup), `tags` como array de verdad, y `client_updated_at` como el timestamp del cliente.

Y una cuarta, aprendida del bug M25 del cliente: **sólo se devuelven proyectos cuyo cursor el device mandó.** El servidor viejo iteraba todos los proyectos de la cuenta y defaulteaba a 0 los no enviados, lo que hacía que un proyecto que el device no conocía volviera desde 0 en cada pull y el cliente entrara en un hot loop.

- [ ] **Step 1: Escribir el test que falla**

`server/__tests__/pull.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { randomUUID } from 'node:crypto'
import { getPool, migrate } from '../src/db'
import { handlePush } from '../src/push'
import { handlePull } from '../src/pull'

const pool = getPool()
let auth: { deviceId: string; userId: string }

beforeAll(async () => {
  await migrate(pool)
  const userId = randomUUID()
  const deviceId = randomUUID()
  await pool.query(`insert into users (id, plan) values ($1, 'pro')`, [userId])
  await pool.query(
    `insert into devices (id, user_id, name, token_hash) values ($1, $2, 'pull', $3)`,
    [deviceId, userId, `hash-${deviceId}`]
  )
  auth = { deviceId, userId }
})

afterAll(async () => { await pool.end() })

const mut = (seq: number, syncId: string, p: string, extra: Record<string, unknown> = {}) => ({
  seq, sync_id: syncId, op: 'upsert' as const,
  payload: {
    sync_id: syncId, project_key: p, project_display_name: p, scope: 'personal',
    type: 'decision', topic_key: null, title: syncId, content: 'body', tags: ['t'],
    lamport: 1, updated_at: Date.now(), created_at: Date.now(), ...extra,
  },
})

describe('handlePull', () => {
  it('returns project_key, a real tags array, and the client timestamp', async () => {
    const p = `pull-${randomUUID().slice(0, 8)}`
    const stamp = Date.now() - 3_600_000
    await handlePush(pool, auth, { mutations: [mut(700, 'pull-1', p, { tags: ['a', 'b'], updated_at: stamp })] })

    const res = await handlePull(pool, auth, { cursors: { [p]: 0 }, limit: 500 })
    const row = res.rows.find((r) => r.sync_id === 'pull-1')!
    expect(row.project_key).toBe(p)
    expect(Array.isArray(row.tags)).toBe(true)
    expect(row.tags).toEqual(['a', 'b'])
    expect(new Date(row.client_updated_at).getTime()).toBe(stamp)
  })

  it('advances the cursor and a second pull returns nothing', async () => {
    const p = `pull-${randomUUID().slice(0, 8)}`
    await handlePush(pool, auth, { mutations: [mut(710, 'pull-2', p)] })
    const first = await handlePull(pool, auth, { cursors: { [p]: 0 }, limit: 500 })
    expect(first.rows.length).toBeGreaterThan(0)
    const second = await handlePull(pool, auth, { cursors: first.cursors, limit: 500 })
    expect(second.rows).toHaveLength(0)
  })

  it('never returns a project whose cursor the device did not send', async () => {
    const known = `pull-${randomUUID().slice(0, 8)}`
    const unknown = `pull-${randomUUID().slice(0, 8)}`
    await handlePush(pool, auth, { mutations: [mut(720, 'known-1', known)] })
    await handlePush(pool, auth, { mutations: [mut(721, 'unknown-1', unknown)] })

    const res = await handlePull(pool, auth, { cursors: { [known]: 0 }, limit: 500 })
    expect(res.rows.some((r) => r.project_key === known)).toBe(true)
    expect(res.rows.some((r) => r.project_key === unknown)).toBe(false)
  })

  it('honours the limit and orders by project_seq', async () => {
    const p = `pull-${randomUUID().slice(0, 8)}`
    await handlePush(pool, auth, {
      mutations: [mut(730, 'l-1', p), mut(731, 'l-2', p), mut(732, 'l-3', p)],
    })
    const res = await handlePull(pool, auth, { cursors: { [p]: 0 }, limit: 2 })
    expect(res.rows).toHaveLength(2)
    expect(res.rows[0].project_seq).toBeLessThan(res.rows[1].project_seq)
  })

  it('tells the client when to come back', async () => {
    const p = `pull-${randomUUID().slice(0, 8)}`
    const res = await handlePull(pool, auth, { cursors: { [p]: 0 }, limit: 10 })
    expect(typeof res.next_poll_ms).toBe('number')
  })

  it('never leaks another user rows', async () => {
    const otherUser = randomUUID()
    const otherDevice = randomUUID()
    await pool.query(`insert into users (id, plan) values ($1, 'pro')`, [otherUser])
    await pool.query(
      `insert into devices (id, user_id, name, token_hash) values ($1, $2, 'other', $3)`,
      [otherDevice, otherUser, `hash-${otherDevice}`]
    )
    const shared = `pull-shared-${randomUUID().slice(0, 8)}`
    await handlePush(pool, { deviceId: otherDevice, userId: otherUser }, { mutations: [mut(740, 'theirs', shared)] })
    await handlePush(pool, auth, { mutations: [mut(741, 'mine', shared)] })

    const res = await handlePull(pool, auth, { cursors: { [shared]: 0 }, limit: 500 })
    expect(res.rows.some((r) => r.sync_id === 'mine')).toBe(true)
    expect(res.rows.some((r) => r.sync_id === 'theirs')).toBe(false)
  })
})
```

- [ ] **Step 2: Correr y verificar que falla**

```bash
cd server && npx vitest run __tests__/pull.test.ts
```

Esperado: FAIL, `src/pull` no existe.

- [ ] **Step 3: Implementar**

`server/src/pull.ts`:

```ts
import type { Pool } from 'pg'

export interface PullBody {
  cursors?: Record<string, number>
  limit?: number
}

export interface PulledRow {
  sync_id: string
  project_key: string
  project_seq: number
  client_updated_at: string
  lamport: number
  scope: string
  type: string
  topic_key: string | null
  title: string
  content: string | null
  tags: string[]
  deleted: boolean
  superseded_by: string | null
  origin_ai: string | null
  origin_account: string | null
  git_branch: string | null
  author_display: string | null
  content_hash: string | null
}

export interface PullResponse {
  rows: PulledRow[]
  cursors: Record<string, number>
  next_poll_ms: number
}

const MAX_LIMIT = 500

// §11.4: the interval is the server's call, not the client's. It is the only real cost
// lever, because ~99% of pulls come back empty.
export const NEXT_POLL_MS = Number(process.env.NEXT_POLL_MS ?? 300_000)

export async function handlePull(
  pool: Pool,
  auth: { userId: string },
  body: PullBody
): Promise<PullResponse> {
  const cursors = body.cursors ?? {}
  const limit = Math.min(Number(body.limit ?? MAX_LIMIT), MAX_LIMIT)
  const keys = Object.keys(cursors)

  if (keys.length === 0) return { rows: [], cursors: {}, next_poll_ms: NEXT_POLL_MS }

  // Only projects whose cursor this device actually sent. Returning rows for unsent
  // cursors is what made the old client hot-loop: the server iterated every account
  // project and defaulted an unsent cursor to 0, so a project the device did not know
  // restarted from 0 on every pull, forever.
  const { rows } = await pool.query(
    `select o.sync_id, p.project_key, o.project_seq, o.client_updated_at, o.lamport, o.scope,
            o.type, o.topic_key, o.title, o.content, o.tags, o.deleted, o.superseded_by,
            o.origin_ai, o.origin_account, o.git_branch, o.author_display, o.content_hash
       from observations o
       join projects p on p.id = o.project_id
       join unnest($2::text[], $3::bigint[]) as c(project_key, cursor) on c.project_key = p.project_key
      where p.user_id = $1 and o.project_seq > c.cursor
      order by o.project_seq asc
      limit $4`,
    [auth.userId, keys, keys.map((k) => Number(cursors[k] ?? 0)), limit]
  )

  const next: Record<string, number> = { ...cursors }
  const mapped: PulledRow[] = rows.map((r) => {
    const seq = Number(r.project_seq)
    if (seq > (next[r.project_key] ?? 0)) next[r.project_key] = seq
    return {
      sync_id: r.sync_id,
      project_key: r.project_key,
      project_seq: seq,
      client_updated_at: new Date(r.client_updated_at).toISOString(),
      lamport: Number(r.lamport),
      scope: r.scope,
      type: r.type,
      topic_key: r.topic_key,
      title: r.title,
      content: r.content,
      tags: Array.isArray(r.tags) ? r.tags : [],
      deleted: r.deleted,
      superseded_by: r.superseded_by,
      origin_ai: r.origin_ai,
      origin_account: r.origin_account,
      git_branch: r.git_branch,
      author_display: r.author_display,
      content_hash: r.content_hash,
    }
  })

  return { rows: mapped, cursors: next, next_poll_ms: NEXT_POLL_MS }
}
```

- [ ] **Step 4: Correr y verificar que pasa**

```bash
cd server && npx vitest run
```

Esperado: PASS, todo.

- [ ] **Step 5: Commit**

```bash
git add server/src/pull.ts server/__tests__/pull.test.ts
git commit -m "feat(sync-service): pull por cursor, con project_key y tags array"
```

---

### Task 8: Status

**Files:**
- Create: `server/src/status.ts`
- Test: `server/__tests__/status.test.ts`

**Interfaces:**
- Consumes: `NEXT_POLL_MS` de `server/src/pull.ts`.
- Produces: `handleStatus(pool: Pool, auth: { deviceId: string; userId: string; plan: string }): Promise<StatusResponse>` con `{ device_id, user_id, plan, next_poll_ms, server_time, quota: { used_bytes, max_bytes } }`.

Existe por dos razones (§5.3): es el health check del device, que hoy la UI no tiene, y es donde el servidor le dice al cliente cada cuánto volver.

- [ ] **Step 1: Escribir el test que falla**

`server/__tests__/status.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { randomUUID } from 'node:crypto'
import { getPool, migrate } from '../src/db'
import { handlePush } from '../src/push'
import { handleStatus } from '../src/status'

const pool = getPool()
let auth: { deviceId: string; userId: string; plan: string }

beforeAll(async () => {
  await migrate(pool)
  const userId = randomUUID()
  const deviceId = randomUUID()
  await pool.query(`insert into users (id, plan) values ($1, 'pro')`, [userId])
  await pool.query(
    `insert into devices (id, user_id, name, token_hash) values ($1, $2, 'status', $3)`,
    [deviceId, userId, `hash-${deviceId}`]
  )
  auth = { deviceId, userId, plan: 'pro' }
})

afterAll(async () => { await pool.end() })

describe('handleStatus', () => {
  it('reports the device, the plan and when to poll again', async () => {
    const res = await handleStatus(pool, auth)
    expect(res.device_id).toBe(auth.deviceId)
    expect(res.user_id).toBe(auth.userId)
    expect(res.plan).toBe('pro')
    expect(typeof res.next_poll_ms).toBe('number')
    expect(Number.isNaN(Date.parse(res.server_time))).toBe(false)
  })

  it('counts only this user bytes', async () => {
    const p = `status-${randomUUID().slice(0, 8)}`
    const before = await handleStatus(pool, auth)
    await handlePush(pool, auth, {
      mutations: [{
        seq: 800, sync_id: 'status-1', op: 'upsert',
        payload: {
          sync_id: 'status-1', project_key: p, project_display_name: p, scope: 'personal',
          type: 'decision', topic_key: null, title: 't', content: 'x'.repeat(1000),
          tags: [], lamport: 1, updated_at: Date.now(), created_at: Date.now(),
        },
      }],
    })
    const after = await handleStatus(pool, auth)
    expect(after.quota.used_bytes).toBeGreaterThanOrEqual(before.quota.used_bytes + 1000)
  })
})
```

- [ ] **Step 2: Correr y verificar que falla**

```bash
cd server && npx vitest run __tests__/status.test.ts
```

Esperado: FAIL, `src/status` no existe.

- [ ] **Step 3: Implementar**

`server/src/status.ts`:

```ts
import type { Pool } from 'pg'
import { NEXT_POLL_MS } from './pull'

export interface StatusResponse {
  device_id: string
  user_id: string
  plan: string
  next_poll_ms: number
  server_time: string
  quota: { used_bytes: number; max_bytes: number }
}

const MAX_BYTES = Number(process.env.MAX_BYTES_PER_USER ?? 1024 * 1024 * 1024)

export async function handleStatus(
  pool: Pool,
  auth: { deviceId: string; userId: string; plan: string }
): Promise<StatusResponse> {
  const { rows } = await pool.query(
    `select coalesce(sum(octet_length(coalesce(o.content, ''))), 0)::bigint as used
       from observations o join projects p on p.id = o.project_id
      where p.user_id = $1`,
    [auth.userId]
  )
  return {
    device_id: auth.deviceId,
    user_id: auth.userId,
    plan: auth.plan,
    next_poll_ms: NEXT_POLL_MS,
    server_time: new Date().toISOString(),
    quota: { used_bytes: Number(rows[0].used), max_bytes: MAX_BYTES },
  }
}
```

- [ ] **Step 4: Correr y verificar que pasa**

```bash
cd server && npx vitest run
```

- [ ] **Step 5: Commit**

```bash
git add server/src/status.ts server/__tests__/status.test.ts
git commit -m "feat(sync-service): status con next_poll_ms y cuota usada"
```

---

### Task 9: La capa HTTP

**Files:**
- Create: `server/src/http.ts`, `server/src/index.ts`
- Test: `server/__tests__/http.test.ts`

**Interfaces:**
- Consumes: `authenticate`, `handlePush`, `handlePull`, `handleStatus`.
- Produces: `createApp(pool: Pool): http.Server` desde `server/src/http.ts`.

Rutas: `POST /v1/sync/push`, `POST /v1/sync/pull`, `GET /v1/sync/status`, `GET /health`. Y los alias de §5.4, `POST /functions/v1/memory-sync/{push,pull}`, para poder apuntarle un Nest que todavía no tenga el cambio de rutas.

- [ ] **Step 1: Escribir el test que falla**

`server/__tests__/http.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { randomUUID } from 'node:crypto'
import type { AddressInfo } from 'node:net'
import { getPool, migrate } from '../src/db'
import { hashToken } from '../src/auth'
import { createApp } from '../src/http'

const pool = getPool()
const TOKEN = `nmk_http_${randomUUID().slice(0, 8)}`
let base: string
let server: ReturnType<typeof createApp>

beforeAll(async () => {
  await migrate(pool)
  const userId = randomUUID()
  const deviceId = randomUUID()
  await pool.query(`insert into users (id, plan) values ($1, 'pro')`, [userId])
  await pool.query(
    `insert into devices (id, user_id, name, token_hash) values ($1, $2, 'http', $3)`,
    [deviceId, userId, hashToken(TOKEN)]
  )
  await pool.query('insert into allowlist (user_id) values ($1)', [userId])
  server = createApp(pool)
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})

afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()))
  await pool.end()
})

const post = (path: string, body: unknown, token = TOKEN) =>
  fetch(`${base}${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

describe('http', () => {
  it('serves /health without a token', async () => {
    const res = await fetch(`${base}/health`)
    expect(res.status).toBe(200)
  })

  it('rejects a push with no token', async () => {
    const res = await fetch(`${base}/v1/sync/push`, { method: 'POST', body: '{}' })
    expect(res.status).toBe(401)
  })

  it('accepts a push with a good token', async () => {
    const res = await post('/v1/sync/push', { mutations: [] })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ results: [] })
  })

  it('serves the Supabase-shaped aliases (§5.4)', async () => {
    const res = await post('/functions/v1/memory-sync/push', { mutations: [] })
    expect(res.status).toBe(200)
  })

  it('refuses a batch over 500 with 413', async () => {
    const mutations = Array.from({ length: 501 }, (_, i) => ({
      seq: 9000 + i, sync_id: `big-${i}`, op: 'upsert',
      payload: { sync_id: `big-${i}`, project_key: 'big', title: 't', lamport: 1, updated_at: Date.now() },
    }))
    const res = await post('/v1/sync/push', { mutations })
    expect(res.status).toBe(413)
  })

  it('serves status', async () => {
    const res = await fetch(`${base}/v1/sync/status`, { headers: { Authorization: `Bearer ${TOKEN}` } })
    expect(res.status).toBe(200)
    expect((await res.json()).plan).toBe('pro')
  })

  it('404s an unknown route', async () => {
    expect((await post('/v1/sync/nope', {})).status).toBe(404)
  })

  it('400s a malformed body instead of crashing', async () => {
    const res = await fetch(`${base}/v1/sync/push`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
      body: 'not json',
    })
    expect(res.status).toBe(400)
  })
})
```

- [ ] **Step 2: Correr y verificar que falla**

```bash
cd server && npx vitest run __tests__/http.test.ts
```

- [ ] **Step 3: Implementar**

`server/src/http.ts`:

```ts
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { Pool } from 'pg'
import { authenticate } from './auth'
import { handlePush } from './push'
import { handlePull } from './pull'
import { handleStatus } from './status'

const MAX_BATCH = 500
const MAX_BODY_BYTES = 20 * 1024 * 1024

function send(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body)
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload),
  })
  res.end(payload)
}

function readBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let data = ''
    req.on('data', (chunk) => {
      data += chunk
      if (data.length > MAX_BODY_BYTES) reject(Object.assign(new Error('too large'), { status: 413 }))
    })
    req.on('end', () => {
      if (!data) return resolve({})
      try {
        resolve(JSON.parse(data))
      } catch {
        reject(Object.assign(new Error('bad json'), { status: 400 }))
      }
    })
    req.on('error', reject)
  })
}

export function createApp(pool: Pool) {
  return createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', `http://${req.headers.host}`)
    const path = url.pathname

    if (path === '/health') return send(res, 200, { ok: true })

    // §5.4: the old Supabase-shaped routes are served as aliases so this can be pointed at
    // a Nest build from before the route change. Delete them when nothing needs them.
    const isPush = path === '/v1/sync/push' || path === '/functions/v1/memory-sync/push'
    const isPull = path === '/v1/sync/pull' || path === '/functions/v1/memory-sync/pull'
    const isStatus = path === '/v1/sync/status'

    if (!isPush && !isPull && !isStatus) return send(res, 404, { error: 'not_found' })

    const auth = await authenticate(pool, req.headers.authorization)
    if (!auth.ok) return send(res, auth.status, { error: auth.error })

    try {
      if (isStatus) return send(res, 200, await handleStatus(pool, auth))
      const body = (await readBody(req)) as Record<string, unknown>
      if (isPush) {
        const mutations = Array.isArray(body.mutations) ? body.mutations : []
        if (mutations.length > MAX_BATCH) return send(res, 413, { error: 'batch_too_large' })
        return send(res, 200, await handlePush(pool, auth, { mutations } as never))
      }
      return send(res, 200, await handlePull(pool, auth, body as never))
    } catch (err) {
      const status = (err as { status?: number }).status ?? 500
      if (status === 500) console.error('[http]', path, err)
      return send(res, status, { error: status === 500 ? 'internal_error' : (err as Error).message })
    }
  })
}
```

`server/src/index.ts`:

```ts
import { getPool, migrate } from './db'
import { createApp } from './http'

const PORT = Number(process.env.PORT ?? 8080)

const pool = getPool()
await migrate(pool)

createApp(pool).listen(PORT, () => {
  console.log(`[sync] listening on ${PORT}`)
})

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    void pool.end().then(() => process.exit(0))
  })
}
```

- [ ] **Step 4: Correr y verificar que pasa**

```bash
cd server && npx vitest run
```

- [ ] **Step 5: Commit**

```bash
git add server/src/http.ts server/src/index.ts server/__tests__/http.test.ts
git commit -m "feat(sync-service): capa HTTP con las rutas nuevas y los alias de Supabase"
```

---

### Task 10: El contract check contra el servicio real, Dockerfile y README

**Files:**
- Create: `server/Dockerfile`, `server/README.md`
- Test: el contract check que ya existe

**Interfaces:**
- Consumes: todo lo anterior.

Este task no escribe lógica nueva: prueba que el servicio cumple el mismo contrato que el stub, con el checker que ya existe y que **no sabe contra qué habla**.

- [ ] **Step 1: Levantar el servicio y sembrar una cuenta**

```bash
cd server && npx tsx src/index.ts &
```

En otra terminal, sembrar el usuario, el device y el allowlist con un token conocido:

```bash
docker exec -i nest-memory-pg psql -U postgres -d nest_memory <<'SQL'
insert into users (id, plan) values ('11111111-1111-1111-1111-111111111111', 'pro')
  on conflict do nothing;
insert into allowlist (user_id) values ('11111111-1111-1111-1111-111111111111')
  on conflict do nothing;
insert into devices (id, user_id, name, token_hash)
values ('22222222-2222-2222-2222-222222222222',
        '11111111-1111-1111-1111-111111111111',
        'contract-check',
        encode(digest('nmk_contract_token', 'sha256'), 'hex'))
  on conflict do nothing;
SQL
```

Si `digest` no existe, `create extension if not exists pgcrypto;` primero. Alternativa sin extensión: calcular el sha256 con `node -e "console.log(require('crypto').createHash('sha256').update('nmk_contract_token').digest('hex'))"` y pegarlo.

- [ ] **Step 2: Correr el contract check contra el servicio real**

```bash
node scripts/memory-sync-contract-check.mjs --base http://127.0.0.1:8080 --token nmk_contract_token
```

Esperado: **19 OK y exit 0**, lo mismo que da contra el stub.

**Si falla, el que está mal es el servicio, no el checker.** No toques `scripts/memory-sync-contract-check.mjs` para que pase.

- [ ] **Step 3: Correrlo dos veces seguidas**

```bash
node scripts/memory-sync-contract-check.mjs --base http://127.0.0.1:8080 --token nmk_contract_token
node scripts/memory-sync-contract-check.mjs --base http://127.0.0.1:8080 --token nmk_contract_token
```

Las dos tienen que dar 19/19. El checker genera identificadores únicos por corrida justamente para eso.

- [ ] **Step 4: El Dockerfile**

`server/Dockerfile`:

```dockerfile
FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev || npm install --omit=dev
COPY tsconfig.json ./
COPY src ./src
COPY migrations ./migrations
ENV NODE_ENV=production
EXPOSE 8080
CMD ["npx", "tsx", "src/index.ts"]
```

- [ ] **Step 5: El README**

`server/README.md` con: cómo levantarlo en local, las variables de entorno (`DATABASE_URL`, `PORT`, `NEXT_POLL_MS`, `MAX_BYTES_PER_USER`, `PG_POOL_MAX`), cómo dar de alta una cuenta y un device a mano (el SQL del Step 1), cómo correr el contract check contra él, y una advertencia de que las migraciones corren solas al arrancar dentro de un advisory lock.

- [ ] **Step 6: Commit**

```bash
git add server/Dockerfile server/README.md
git commit -m "feat(sync-service): Dockerfile, README y el contract check en verde contra el servicio real"
```

---

## Qué queda afuera de este plan

- **Backups y restore** (spec §11.3). Un backup que nunca se restauró no es un backup, y esto es obligatorio antes de abrir a usuarios.
- **Rate limits y purga de tombstones** (§11.6). Las cuotas se reportan en el status pero no se aplican todavía.
- **Observabilidad** (§11.5): log estructurado de cada rechazo, contadores por device, y la consulta que lista devices con mutaciones rechazadas.
- **`POST /v1/devices`** (§9.2), la emisión de token contra el login. Es aditiva y no bloquea el beta de una cuenta.
- **El endpoint de borrado de datos de nube** (§5.5). Es la única llamada del cliente sin ruta definida y es un release blocker con fecha: el día que `syncBaseUrl` apunte acá, el borrado se rompe en silencio. Hay que resolverlo antes de mover al cliente.
- **El deploy a Railway** (§11.1). El Dockerfile queda listo; apretar el botón es de Gero.
