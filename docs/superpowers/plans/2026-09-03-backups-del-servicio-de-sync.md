# Backups del servicio de sync — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que la base de Nest Memory tenga un dump diario en almacenamiento externo y una restauración **probada**, que es el último requisito duro de §11.3 antes de abrir el servicio a usuarios.

**Architecture:** El backup lo corre el propio servicio, no un servicio nuevo ni un cron del dashboard: un timer diario con el mismo patrón que la purga (`index.ts`). El camino es `pg_dump -Fc` a memoria → subida a Cloudflare R2 firmando con `aws4fetch` → una fila en la tabla `backups` que dice qué pasó. La retención de 30 días la hace la **regla de ciclo de vida del bucket**, no el código: que el borrado lo haga R2 es una cosa menos que puede fallar y una cosa menos que puede borrar de más. La restauración es un script aparte, re-corrible, con dos modos: `--file` (un dump local, no necesita R2) y `--from-r2` (el dump real de producción). Es la mitad que convierte esto en un backup de verdad.

**Tech Stack:** Node 22 · TypeScript con `tsx`, sin paso de build · `pg` sobre Postgres 16 · `aws4fetch` 1.0.20 (cero dependencias, 65 KB) · vitest contra Postgres real · Alpine `postgresql16-client` en el contenedor.

**Estado (2026-09-03):** Tasks 1 a 6 **HECHAS y verificadas** — 159 tests verdes, typecheck en 0,
restauración probada de punta a punta contra la base local (y probada también fallando: archivo
que no es un dump, y dump truncado). **La Task 7 —la corrida real contra producción— sigue
bloqueada por el bucket de R2 y sus cuatro variables.**

**Spec:** `docs/superpowers/specs/2026-08-31-memory-sync-backend-design.md` §11.3

**Memoria relacionada:** `nest-memory/raven-nest/nest-memory-sync-service.md`, sección "Backups — diseño aprobado el 2026-09-02". Este plan implementa ese diseño; no lo redecide.

## Global Constraints

- **Todo el trabajo es dentro de `server/`.** El cliente Electron no se toca en este plan.
- **Los tests van contra Postgres real, nunca mocks ni PGlite.** Es la regla del paquete: los 127 tests existentes son todos así. Lo único que se inyecta son las fronteras que no son la base: la red (R2) y el proceso hijo (`pg_dump`).
- **Levantar la base de test antes de correr nada:**
  ```bash
  docker run -d --name nest-memory-pg -e POSTGRES_PASSWORD=nestmem \
    -e POSTGRES_DB=nest_memory -p 55432:5432 postgres:16-alpine
  ```
  Si el contenedor ya existe pero está parado: `docker start nest-memory-pg`. `DATABASE_URL` por defecto es `postgres://postgres:nestmem@127.0.0.1:55432/nest_memory` (`src/db.ts:22`).
- **En Windows NO hay `pg_dump` ni `pg_restore` en el PATH** — viven adentro del contenedor `postgres:16-alpine`. Por eso todo binario de Postgres se invoca por una lista de argumentos configurable (`PG_DUMP_CMD` / `PG_RESTORE_CMD`), y en local se apunta al contenedor:
  ```bash
  export PG_DUMP_CMD="docker exec -i nest-memory-pg pg_dump"
  export PG_RESTORE_CMD="docker exec -i nest-memory-pg pg_restore"
  ```
  En producción no se setea ninguna y caen a `pg_dump` / `pg_restore` pelados, que es como corren adentro del contenedor del servicio.
- **Tests:** `cd server && npx vitest run; echo EXIT=$?`. **La barra es el código de salida**, no el conteo de tests.
- 🔴 **`npx tsx -e "..."` NO SIRVE si el código tiene un `import` o un `await` de nivel superior.** No falla: **no ejecuta nada, no imprime nada y sale con código 0** (medido el 2026-09-03, tsx 4.23.13 sobre Node 25.4.0). Con un `console.log` pelado anda, y por eso parece que funciona. Es la misma trampa que el `ts-node` roto de Render. **Todo snippet suelto de este plan va a un archivo bajo `server/tmp/` y se corre con `npx tsx tmp/loquesea.ts`**, nunca con `-e`.
- **Typecheck del paquete:** `cd server && npx tsc --noEmit -p tsconfig.json; echo EXIT=$?`. Este `tsconfig.json` **sí** chequea (tiene `include`, no es solution-style como el de la raíz). Tiene que quedar en 0.
- **Comentarios y documentos en español**, código y nombres de identificadores en inglés, como el resto de `server/`.
- **Nada de secretos en el repo ni en el chat.** Las cuatro variables `R2_*` las carga Gero desde el dashboard de Railway.
- **El backup nunca puede tumbar el servicio.** Un dump fallido es un problema de higiene; el servicio sigue sirviendo tráfico. Mismo criterio que la purga (`index.ts:20`).
- **Pero tampoco puede fallar callado.** A diferencia de la purga, cada intento deja una fila en `backups`: un backup que falla en silencio es el peor caso de todos.

## Estado de las dependencias externas

Las cuatro variables (`R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`) están **pendientes de Gero** (crear el bucket, un API token acotado a ese bucket, y la regla de ciclo de vida a 30 días). **Las Tasks 1 a 6 no dependen de eso**: el mecanismo se construye y se verifica entero con `--file`. Lo único bloqueado es la Task 7, que es la corrida real contra producción.

## File Structure

| Archivo | Responsabilidad |
|---|---|
| `server/migrations/003_backups.sql` | La tabla `backups`. Nueva migración numerada, mismo patrón que 001 y 002. |
| `server/src/r2.ts` | Hablar con R2 por la API S3: firmar, `put`, `get`, `list`. Lo único que toca un tercero por red. |
| `server/src/pg-dump.ts` | Correr `pg_dump` y `pg_restore` como proceso hijo. Lo único que hace `spawn`. |
| `server/src/backup.ts` | La orquestación: contar filas, dumpear, subir, dejar rastro. No sabe de red ni de procesos: los recibe inyectados. |
| `server/scripts/restore-check.mjs` | La restauración probada. Script de operador, no código de servicio. |
| `server/src/index.ts` | El timer diario (modificar). |
| `server/Dockerfile` | `postgresql16-client` (modificar). |
| `server/package.json` | La dependencia `aws4fetch` (modificar). |
| `server/README.md` | Las variables nuevas y cómo operar (modificar). |

---

### Task 1: La tabla `backups`

**Files:**
- Create: `server/migrations/003_backups.sql`
- Test: `server/__tests__/backups-schema.test.ts`

**Interfaces:**
- Consumes: `migrate` y `getPool` de `src/db.ts`.
- Produces: la tabla `backups` con las columnas `id`, `started_at`, `finished_at`, `ok`, `object_key`, `bytes`, `sha256`, `row_counts`, `error`. Las Tasks 4 y 6 escriben y leen exactamente esos nombres.

`row_counts` es la columna que hace posible una restauración *verificable*: guarda cuántas filas tenía cada tabla cuando se tomó ese dump, así el script de restore no tiene que compararse contra una base viva que ya se movió.

- [x] **Step 1: Escribir el test que falla**

```typescript
// server/__tests__/backups-schema.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { getPool, migrate } from '../src/db'

const pool = getPool()

beforeAll(async () => { await migrate(pool) })
afterAll(async () => { await pool.end() })

describe('la tabla backups', () => {
  it('existe con las columnas que el resto del plan escribe', async () => {
    const { rows } = await pool.query(
      `select column_name, data_type, is_nullable
         from information_schema.columns
        where table_name = 'backups'`
    )
    const byName = new Map(rows.map((r) => [r.column_name, r]))
    for (const c of ['id', 'started_at', 'finished_at', 'ok', 'object_key', 'bytes', 'sha256', 'row_counts', 'error']) {
      expect(byName.has(c), `falta la columna ${c}`).toBe(true)
    }
    expect(byName.get('row_counts')!.data_type).toBe('jsonb')
    expect(byName.get('bytes')!.data_type).toBe('bigint')
  })

  // Un intento que arranca y muere a la mitad tiene que quedar VISIBLE como fallado, no
  // desaparecer. Por eso la fila se inserta al empezar y `ok` arranca en false.
  it('ok arranca en false y finished_at admite nulo', async () => {
    const { rows } = await pool.query(
      `insert into backups (object_key) values ('probe/x.dump') returning ok, finished_at, started_at`
    )
    expect(rows[0].ok).toBe(false)
    expect(rows[0].finished_at).toBeNull()
    expect(rows[0].started_at).toBeInstanceOf(Date)
    await pool.query(`delete from backups where object_key = 'probe/x.dump'`)
  })
})
```

- [x] **Step 2: Correrlo y verificar que falla**

Run: `cd server && npx vitest run __tests__/backups-schema.test.ts; echo EXIT=$?`
Expected: FAIL — el primer test falla en `falta la columna id` (la consulta devuelve cero filas porque la tabla no existe), `EXIT=1`.

- [x] **Step 3: Escribir la migración**

```sql
-- server/migrations/003_backups.sql
-- §11.3. La retención de 30 días NO vive acá: la hace la regla de ciclo de vida del bucket
-- de R2. Esta tabla es sólo el rastro de qué pasó, para que "¿cuándo fue el último backup
-- bueno?" tenga una respuesta que no dependa de ir a mirar el bucket.
--
-- La fila se inserta cuando el intento EMPIEZA, no cuando termina. Un proceso que muere a la
-- mitad del dump deja entonces una fila con ok=false y finished_at nulo, que es exactamente
-- lo que hay que poder ver. Si la fila se insertara al final, ese intento no habría existido
-- nunca para nadie, y un backup que falla callado es el peor caso de todos.
create table if not exists backups (
  id            bigserial primary key,
  started_at    timestamptz not null default now(),
  finished_at   timestamptz,
  ok            boolean not null default false,
  object_key    text,
  bytes         bigint,
  sha256        text,
  -- Cuántas filas tenía cada tabla cuando se tomó ESTE dump. Es lo que le permite a
  -- `restore-check.mjs` verificar una restauración sin compararse contra la base viva, que
  -- para cuando el script corre ya se movió.
  row_counts    jsonb,
  error         text
);

-- La consulta que más se va a correr es "el último backup bueno" y "los últimos N intentos".
create index if not exists backups_recent on backups (started_at desc);
```

- [x] **Step 4: Correr y verificar que pasa**

Run: `cd server && npx vitest run __tests__/backups-schema.test.ts; echo EXIT=$?`
Expected: PASS, 2 tests, `EXIT=0`.

- [x] **Step 5: Verificar que no rompió el resto**

Run: `cd server && npx vitest run; echo EXIT=$?`
Expected: PASS, `EXIT=0`. La suite era de 127 tests; ahora son 129.

- [x] **Step 6: Commit**

```bash
git add server/migrations/003_backups.sql server/__tests__/backups-schema.test.ts
git commit -m "feat(sync-service): tabla backups, el rastro de cada intento de dump"
```

---

### Task 2: El cliente de R2

**Files:**
- Create: `server/src/r2.ts`
- Modify: `server/package.json` (dependencia `aws4fetch`)
- Test: `server/__tests__/r2.test.ts`

**Interfaces:**
- Consumes: `aws4fetch` (`AwsClient`).
- Produces:
  - `type R2Config = { accountId: string; accessKeyId: string; secretAccessKey: string; bucket: string }`
  - `r2ConfigFromEnv(env?: NodeJS.ProcessEnv): R2Config | null` — `null` si falta cualquiera de las cuatro.
  - `putObject(cfg: R2Config, key: string, body: Uint8Array, opts?: { fetchImpl?: typeof fetch }): Promise<void>`
  - `getObject(cfg: R2Config, key: string, opts?: { fetchImpl?: typeof fetch }): Promise<Uint8Array>`
  - `listKeys(cfg: R2Config, prefix: string, opts?: { fetchImpl?: typeof fetch }): Promise<string[]>` — ordenadas lexicográficamente.
  - Las Tasks 4, 5 y 6 usan exactamente estas firmas.

La costura para testear es `AwsClient.sign()`, que devuelve un `Request` **firmado sin mandarlo**. Así el test verifica la URL, el método y que la firma se haya puesto, sin salir a la red y sin mockear la librería de firma.

- [x] **Step 1: Instalar la dependencia**

```bash
cd server && npm install aws4fetch@1.0.20
```

Verificar que quedó una sola dependencia nueva y que no arrastró nada:

Run: `cd server && npm ls aws4fetch`
Expected: `aws4fetch@1.0.20` sin hijos.

- [x] **Step 2: Escribir el test que falla**

```typescript
// server/__tests__/r2.test.ts
import { describe, it, expect } from 'vitest'
import { r2ConfigFromEnv, putObject, getObject, listKeys, type R2Config } from '../src/r2'

const CFG: R2Config = {
  accountId: 'acct123',
  accessKeyId: 'AKIAFAKE',
  secretAccessKey: 'secretofake',
  bucket: 'nest-memory-backups',
}

/** Un `fetch` falso que guarda el Request firmado y devuelve lo que le digan. */
function spyFetch(response: Response) {
  const seen: Request[] = []
  const impl = (async (input: Request | string, init?: RequestInit) => {
    seen.push(input instanceof Request ? input : new Request(input, init))
    return response
  }) as unknown as typeof fetch
  return { impl, seen }
}

describe('r2ConfigFromEnv', () => {
  it('devuelve null si falta cualquiera de las cuatro variables', () => {
    const completo = {
      R2_ACCOUNT_ID: 'a', R2_ACCESS_KEY_ID: 'b',
      R2_SECRET_ACCESS_KEY: 'c', R2_BUCKET: 'd',
    }
    expect(r2ConfigFromEnv(completo as NodeJS.ProcessEnv)).not.toBeNull()
    for (const falta of Object.keys(completo)) {
      const parcial = { ...completo, [falta]: '' }
      expect(r2ConfigFromEnv(parcial as NodeJS.ProcessEnv), `sin ${falta}`).toBeNull()
    }
  })
})

describe('putObject', () => {
  it('pega un PUT firmado a la URL S3 del bucket', async () => {
    const { impl, seen } = spyFetch(new Response(null, { status: 200 }))
    await putObject(CFG, 'nest-memory/x.dump', new Uint8Array([1, 2, 3]), { fetchImpl: impl })

    expect(seen).toHaveLength(1)
    const req = seen[0]
    expect(req.method).toBe('PUT')
    expect(req.url).toBe('https://acct123.r2.cloudflarestorage.com/nest-memory-backups/nest-memory/x.dump')
    // Que la firma exista es la mitad del contrato con R2; la otra mitad es el hash del
    // cuerpo, que S3 exige y que aws4fetch calcula solo para el servicio s3.
    expect(req.headers.get('authorization')).toMatch(/^AWS4-HMAC-SHA256 /)
    expect(req.headers.get('x-amz-content-sha256')).toBeTruthy()
  })

  // Un 200 falso no existe: si R2 rechaza, el backup NO fue. Tragarse esto es exactamente el
  // "backup que falla callado" que la tabla `backups` existe para evitar.
  it('tira si R2 responde con error, incluyendo el cuerpo en el mensaje', async () => {
    const { impl } = spyFetch(new Response('<Error><Code>AccessDenied</Code></Error>', { status: 403 }))
    await expect(
      putObject(CFG, 'k', new Uint8Array([1]), { fetchImpl: impl })
    ).rejects.toThrow(/403[\s\S]*AccessDenied/)
  })
})

describe('getObject', () => {
  it('devuelve los bytes tal cual', async () => {
    const { impl, seen } = spyFetch(new Response(new Uint8Array([9, 8, 7])))
    const bytes = await getObject(CFG, 'nest-memory/x.dump', { fetchImpl: impl })
    expect(Array.from(bytes)).toEqual([9, 8, 7])
    expect(seen[0].method).toBe('GET')
  })

  it('tira si el objeto no existe', async () => {
    const { impl } = spyFetch(new Response('<Error><Code>NoSuchKey</Code></Error>', { status: 404 }))
    await expect(getObject(CFG, 'no-existe', { fetchImpl: impl })).rejects.toThrow(/404/)
  })
})

describe('listKeys', () => {
  const xml = (keys: string[], truncated = false) =>
    `<?xml version="1.0"?><ListBucketResult>` +
    keys.map((k) => `<Contents><Key>${k}</Key></Contents>`).join('') +
    `<IsTruncated>${truncated}</IsTruncated></ListBucketResult>`

  it('devuelve las claves ordenadas', async () => {
    const { impl, seen } = spyFetch(new Response(xml([
      'nest-memory/2026-09-03T00-00-00-000Z.dump',
      'nest-memory/2026-09-01T00-00-00-000Z.dump',
    ])))
    const keys = await listKeys(CFG, 'nest-memory/', { fetchImpl: impl })
    expect(keys).toEqual([
      'nest-memory/2026-09-01T00-00-00-000Z.dump',
      'nest-memory/2026-09-03T00-00-00-000Z.dump',
    ])
    expect(seen[0].url).toContain('list-type=2')
    expect(seen[0].url).toContain('prefix=nest-memory%2F')
  })

  // Las claves llevan el timestamp adelante, así que orden lexicográfico = orden cronológico
  // y "la última" es la del final. Con una lista truncada, "la última" sería la última de la
  // PRIMERA página: se restauraría un backup viejo creyendo que es el de anoche. Preferimos
  // romper a mentir.
  it('tira si la respuesta viene truncada, en vez de devolver media lista', async () => {
    const { impl } = spyFetch(new Response(xml(['a'], true)))
    await expect(listKeys(CFG, 'nest-memory/', { fetchImpl: impl })).rejects.toThrow(/truncada/i)
  })
})
```

- [x] **Step 3: Correrlo y verificar que falla**

Run: `cd server && npx vitest run __tests__/r2.test.ts; echo EXIT=$?`
Expected: FAIL — `Cannot find module '../src/r2'`, `EXIT=1`.

- [x] **Step 4: Implementación**

```typescript
// server/src/r2.ts
import { AwsClient } from 'aws4fetch'

/**
 * Cloudflare R2 por su API compatible con S3. Elegido sobre Supabase Storage por radio de
 * daño: el token de R2 se acota a un solo bucket, mientras que la `service_role` de Supabase
 * —la única credencial que sirve para subir ahí— abre todo Supabase, y meterla en un
 * contenedor es regalar las llaves.
 *
 * Se firma con `aws4fetch` (65 KB, cero dependencias) en vez del SDK de AWS, en un contenedor
 * que hoy tiene dos dependencias en total.
 */
export type R2Config = {
  accountId: string
  accessKeyId: string
  secretAccessKey: string
  bucket: string
}

/** `null` —no una excepción— cuando R2 no está configurado: no tenerlo es un estado válido. */
export function r2ConfigFromEnv(env: NodeJS.ProcessEnv = process.env): R2Config | null {
  const accountId = env.R2_ACCOUNT_ID
  const accessKeyId = env.R2_ACCESS_KEY_ID
  const secretAccessKey = env.R2_SECRET_ACCESS_KEY
  const bucket = env.R2_BUCKET
  if (!accountId || !accessKeyId || !secretAccessKey || !bucket) return null
  return { accountId, accessKeyId, secretAccessKey, bucket }
}

function clientFor(cfg: R2Config): AwsClient {
  // `region: 'auto'` es lo que R2 espera; el servicio tiene que ser 's3' para que aws4fetch
  // calcule y mande `x-amz-content-sha256`, que R2 exige en toda request con cuerpo.
  return new AwsClient({
    accessKeyId: cfg.accessKeyId,
    secretAccessKey: cfg.secretAccessKey,
    service: 's3',
    region: 'auto',
  })
}

function bucketUrl(cfg: R2Config): string {
  return `https://${cfg.accountId}.r2.cloudflarestorage.com/${cfg.bucket}`
}

/** El cuerpo del error viaja en el mensaje: sin él, un 403 de R2 no dice si es el token, el bucket o la firma. */
async function ensureOk(res: Response, que: string): Promise<void> {
  if (res.ok) return
  const cuerpo = await res.text().catch(() => '')
  throw new Error(`R2 ${que} falló: ${res.status} ${res.statusText} ${cuerpo}`.trim())
}

export async function putObject(
  cfg: R2Config,
  key: string,
  body: Uint8Array,
  opts: { fetchImpl?: typeof fetch } = {}
): Promise<void> {
  const doFetch = opts.fetchImpl ?? fetch
  const req = await clientFor(cfg).sign(`${bucketUrl(cfg)}/${key}`, {
    method: 'PUT',
    body,
    headers: { 'content-type': 'application/octet-stream' },
  })
  await ensureOk(await doFetch(req), `PUT ${key}`)
}

export async function getObject(
  cfg: R2Config,
  key: string,
  opts: { fetchImpl?: typeof fetch } = {}
): Promise<Uint8Array> {
  const doFetch = opts.fetchImpl ?? fetch
  const req = await clientFor(cfg).sign(`${bucketUrl(cfg)}/${key}`, { method: 'GET' })
  const res = await doFetch(req)
  await ensureOk(res, `GET ${key}`)
  return new Uint8Array(await res.arrayBuffer())
}

/**
 * Las claves ordenadas lexicográficamente, que —por cómo se nombran, con el timestamp
 * adelante— es lo mismo que ordenadas por fecha.
 *
 * Una respuesta truncada TIRA en vez de devolver la primera página. Con 30 días de retención
 * nunca deberíamos acercarnos a las 1000 claves de un page, pero si algún día pasa, devolver
 * media lista significa que "el último backup" sería el último de la primera página: se
 * restauraría un dump viejo creyendo que es el de anoche. Ese error es peor que un fallo.
 */
export async function listKeys(
  cfg: R2Config,
  prefix: string,
  opts: { fetchImpl?: typeof fetch } = {}
): Promise<string[]> {
  const doFetch = opts.fetchImpl ?? fetch
  const url = `${bucketUrl(cfg)}?list-type=2&prefix=${encodeURIComponent(prefix)}`
  const req = await clientFor(cfg).sign(url, { method: 'GET' })
  const res = await doFetch(req)
  await ensureOk(res, `LIST ${prefix}`)
  const xml = await res.text()
  if (/<IsTruncated>\s*true\s*<\/IsTruncated>/i.test(xml)) {
    throw new Error(`R2 LIST ${prefix}: la respuesta vino truncada; "el último backup" sería incorrecto`)
  }
  return [...xml.matchAll(/<Key>([^<]*)<\/Key>/g)].map((m) => m[1]).sort()
}
```

- [x] **Step 5: Correr y verificar que pasa**

Run: `cd server && npx vitest run __tests__/r2.test.ts; echo EXIT=$?`
Expected: PASS, 7 tests, `EXIT=0`.

- [x] **Step 6: Typecheck**

Run: `cd server && npx tsc --noEmit -p tsconfig.json; echo EXIT=$?`
Expected: `EXIT=0`.

- [x] **Step 7: Commit**

```bash
git add server/src/r2.ts server/__tests__/r2.test.ts server/package.json server/package-lock.json
git commit -m "feat(sync-service): cliente de R2 firmado con aws4fetch"
```

---

### Task 3: Correr `pg_dump` y `pg_restore`

**Files:**
- Create: `server/src/pg-dump.ts`
- Test: `server/__tests__/pg-dump.test.ts`

**Interfaces:**
- Consumes: `node:child_process`.
- Produces:
  - `resolveCommand(envVar: string, fallback: string, env?: NodeJS.ProcessEnv): string[]`
  - `connectionEnv(databaseUrl: string): { args: string[]; env: Record<string, string> }`
  - `pgDump(databaseUrl: string, opts?: { env?: NodeJS.ProcessEnv }): Promise<Uint8Array>`
  - `pgRestore(databaseUrl: string, dump: Uint8Array, opts?: { env?: NodeJS.ProcessEnv }): Promise<void>`
  - Las Tasks 4 y 6 usan `pgDump` y `pgRestore`.

Dos decisiones que este módulo encapsula. **La contraseña no viaja en `argv`**: se saca de la URL y se pasa por `PGPASSWORD` en el ambiente del hijo, porque `argv` es legible por cualquier proceso de la máquina. Y **el binario es una lista de argumentos configurable**, no un nombre fijo, porque en la máquina de desarrollo (Windows) no hay cliente de Postgres instalado y hay que entrar por `docker exec`.

- [x] **Step 1: Escribir el test que falla**

```typescript
// server/__tests__/pg-dump.test.ts
import { describe, it, expect } from 'vitest'
import { resolveCommand, connectionEnv, pgDump } from '../src/pg-dump'

describe('resolveCommand', () => {
  it('cae al binario pelado cuando la variable no está', () => {
    expect(resolveCommand('PG_DUMP_CMD', 'pg_dump', {} as NodeJS.ProcessEnv)).toEqual(['pg_dump'])
  })

  // Es lo que permite correr los tests en Windows, donde no hay cliente de Postgres y el
  // binario vive adentro del contenedor de la base.
  it('parte la variable en palabras para poder envolver el binario', () => {
    const env = { PG_DUMP_CMD: 'docker exec -i nest-memory-pg pg_dump' } as NodeJS.ProcessEnv
    expect(resolveCommand('PG_DUMP_CMD', 'pg_dump', env)).toEqual(
      ['docker', 'exec', '-i', 'nest-memory-pg', 'pg_dump']
    )
  })

  it('ignora una variable vacía o de puro espacio', () => {
    expect(resolveCommand('PG_DUMP_CMD', 'pg_dump', { PG_DUMP_CMD: '   ' } as NodeJS.ProcessEnv))
      .toEqual(['pg_dump'])
  })
})

describe('connectionEnv', () => {
  // `argv` lo lee cualquier proceso de la máquina. La contraseña sale de ahí y va al ambiente
  // del hijo, que es privado del proceso.
  it('saca la contraseña de los argumentos y la manda por PGPASSWORD', () => {
    const { args, env } = connectionEnv('postgres://usuario:secreta@db.interno:5432/nest_memory')
    expect(env.PGPASSWORD).toBe('secreta')
    expect(args.join(' ')).not.toContain('secreta')
    expect(args.join(' ')).toContain('db.interno')
    expect(args.join(' ')).toContain('nest_memory')
  })

  it('desescapa una contraseña con caracteres codificados', () => {
    const { env } = connectionEnv('postgres://u:a%40b%2Fc@h:5432/d')
    expect(env.PGPASSWORD).toBe('a@b/c')
  })
})

describe('pgDump', () => {
  // El caso que importa: si el binario no está o la base rechaza, tiene que TIRAR con el
  // stderr adentro. Un dump vacío tratado como éxito es un backup que no existe.
  it('rechaza cuando el comando no existe', async () => {
    await expect(
      pgDump('postgres://u:p@127.0.0.1:1/x', {
        env: { PG_DUMP_CMD: 'este-binario-no-existe-nunca' } as NodeJS.ProcessEnv,
      })
    ).rejects.toThrow(/este-binario-no-existe-nunca|ENOENT/i)
  })
})
```

- [x] **Step 2: Correrlo y verificar que falla**

Run: `cd server && npx vitest run __tests__/pg-dump.test.ts; echo EXIT=$?`
Expected: FAIL — `Cannot find module '../src/pg-dump'`, `EXIT=1`.

- [x] **Step 3: Implementación**

```typescript
// server/src/pg-dump.ts
import { spawn } from 'node:child_process'

/**
 * El binario a correr, como lista de argumentos. Una env var lo puede envolver entero:
 *
 *   PG_DUMP_CMD="docker exec -i nest-memory-pg pg_dump"
 *
 * Existe porque en la máquina de desarrollo (Windows) no hay cliente de Postgres instalado —
 * `pg_dump` vive adentro del contenedor de la base. En el contenedor del servicio la variable
 * no está seteada y esto cae a `pg_dump` pelado, que es lo que instala el Dockerfile.
 */
export function resolveCommand(
  envVar: string,
  fallback: string,
  env: NodeJS.ProcessEnv = process.env
): string[] {
  const raw = (env[envVar] ?? '').trim()
  return raw ? raw.split(/\s+/) : [fallback]
}

/**
 * Parte una connection string en los argumentos que ve `argv` y el ambiente privado del hijo.
 *
 * La contraseña NO puede ir en `argv`: es legible por cualquier proceso de la máquina (en
 * Linux, `/proc/<pid>/cmdline`). Va por `PGPASSWORD`, que es lo que los binarios de Postgres
 * leen para exactamente este motivo.
 */
export function connectionEnv(databaseUrl: string): { args: string[]; env: Record<string, string> } {
  const u = new URL(databaseUrl)
  const password = decodeURIComponent(u.password)
  u.password = ''
  return { args: [u.toString()], env: password ? { PGPASSWORD: password } : {} }
}

function run(
  cmd: string[],
  extraArgs: string[],
  childEnv: Record<string, string>,
  stdin: Uint8Array | null,
  collectStdout: boolean
): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const [bin, ...prefix] = cmd
    const child = spawn(bin, [...prefix, ...extraArgs], {
      env: { ...process.env, ...childEnv },
      stdio: ['pipe', 'pipe', 'pipe'],
    })

    const out: Buffer[] = []
    const err: Buffer[] = []
    if (collectStdout) child.stdout.on('data', (c: Buffer) => out.push(c))
    else child.stdout.resume()
    child.stderr.on('data', (c: Buffer) => err.push(c))

    child.on('error', (e) => reject(new Error(`${bin}: ${e.message}`)))
    child.on('close', (code) => {
      if (code === 0) return resolve(new Uint8Array(Buffer.concat(out)))
      reject(new Error(`${bin} salió con código ${code}: ${Buffer.concat(err).toString().trim()}`))
    })

    // El stdin se cierra siempre: `pg_dump` no lee nada y se quedaría esperando el EOF.
    if (stdin) child.stdin.end(Buffer.from(stdin))
    else child.stdin.end()
  })
}

/**
 * Un dump en formato custom (`-Fc`, comprimido y restaurable selectivamente) por stdout.
 *
 * Por stdout y no a un archivo a propósito: es lo que hace que el mismo código funcione tanto
 * con `pg_dump` local como envuelto en `docker exec`, donde un `-f /tmp/x` escribiría adentro
 * del contenedor y no acá.
 *
 * `--no-owner` y `--no-privileges` son lo que hace que el dump se pueda restaurar en una base
 * limpia con OTRO rol, que es precisamente el escenario de un desastre: la cuenta de Railway
 * no está, y hay que levantar esto en cualquier Postgres a mano.
 *
 * El dump se junta entero en memoria. Con la base en 8 MB sobra; arriba de ~100 MB hay que
 * pasar a streaming y subida multipart a R2.
 */
export async function pgDump(
  databaseUrl: string,
  opts: { env?: NodeJS.ProcessEnv } = {}
): Promise<Uint8Array> {
  const { args, env } = connectionEnv(databaseUrl)
  const cmd = resolveCommand('PG_DUMP_CMD', 'pg_dump', opts.env ?? process.env)
  return run(cmd, ['-Fc', '--no-owner', '--no-privileges', ...args], env, null, true)
}

/** Restaura un dump `-Fc` en la base que apunte `databaseUrl`, leyéndolo por stdin. */
export async function pgRestore(
  databaseUrl: string,
  dump: Uint8Array,
  opts: { env?: NodeJS.ProcessEnv } = {}
): Promise<void> {
  const { args, env } = connectionEnv(databaseUrl)
  const cmd = resolveCommand('PG_RESTORE_CMD', 'pg_restore', opts.env ?? process.env)
  await run(cmd, ['--no-owner', '--no-privileges', '-d', ...args], env, dump, false)
}
```

- [x] **Step 4: Correr y verificar que pasa**

Run: `cd server && npx vitest run __tests__/pg-dump.test.ts; echo EXIT=$?`
Expected: PASS, 6 tests, `EXIT=0`.

- [x] **Step 5: Probar `pg_dump` de verdad, a mano, contra la base local**

Esto no es un test automatizado —depende de Docker— pero **no se puede saltear**: es la primera vez que el módulo habla con un `pg_dump` real.

```bash
cd server && mkdir -p tmp
cat > tmp/probe.ts <<'TS'
import { pgDump } from '../src/pg-dump.ts'
const b = await pgDump('postgres://postgres:nestmem@127.0.0.1:5432/nest_memory')
console.log('bytes:', b.length, 'magia:', Buffer.from(b.slice(0, 5)).toString())
TS
PG_DUMP_CMD="docker exec -i nest-memory-pg pg_dump" npx tsx tmp/probe.ts; echo EXIT=$?
```
Expected: cientos de miles de bytes y `magia: PGDMP`. Ese header es la firma del formato custom: si no está, no es un dump.

**Un archivo, no `npx tsx -e`**: con un `import` adentro, `-e` sale 0 sin ejecutar ni imprimir nada, o sea que este paso "pasaría" sin haber probado nada.

Ojo con el host: adentro del contenedor la base es `127.0.0.1:5432`, no el `:55432` que se ve desde Windows.

- [x] **Step 6: Commit**

```bash
git add server/src/pg-dump.ts server/__tests__/pg-dump.test.ts
git commit -m "feat(sync-service): correr pg_dump y pg_restore sin la password en argv"
```

---

### Task 4: La orquestación del backup

**Files:**
- Create: `server/src/backup.ts`
- Test: `server/__tests__/backup.test.ts`

**Interfaces:**
- Consumes: `Pool` de `pg`; `pgDump` de `src/pg-dump.ts`; `putObject`, `r2ConfigFromEnv` de `src/r2.ts`; la tabla `backups` de la Task 1.
- Produces:
  - `type BackupDeps = { dump: () => Promise<Uint8Array>; upload: (key: string, body: Uint8Array) => Promise<void>; now: () => Date }`
  - `type BackupResult = { id: number; key: string; bytes: number; sha256: string }`
  - `backupKey(at: Date): string`
  - `countRows(pool: Pool): Promise<Record<string, number>>`
  - `runBackup(pool: Pool, deps: BackupDeps): Promise<BackupResult>`
  - `hadRecentSuccess(pool: Pool, hours: number): Promise<boolean>`
  - `backupDepsFromEnv(env?: NodeJS.ProcessEnv): BackupDeps | null`
  - La Task 5 usa `runBackup`, `hadRecentSuccess` y `backupDepsFromEnv`, y le suma `shouldRunBackup`.

Este módulo no sabe de red ni de procesos hijos: los recibe inyectados. Por eso se puede testear entero contra Postgres real sin tocar R2 ni `pg_dump`, que es exactamente el reparto que pide la regla del paquete.

- [x] **Step 1: Escribir el test que falla**

```typescript
// server/__tests__/backup.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createHash } from 'node:crypto'
import { getPool, migrate } from '../src/db'
import {
  backupKey, countRows, runBackup, hadRecentSuccess, backupDepsFromEnv, type BackupDeps,
} from '../src/backup'

const pool = getPool()

beforeAll(async () => { await migrate(pool) })
afterAll(async () => { await pool.end() })

/** Cada test arranca de cero para poder afirmar sobre "el último backup". */
async function limpiarBackups() { await pool.query('delete from backups') }

const deps = (over: Partial<BackupDeps> = {}): BackupDeps => ({
  dump: async () => new Uint8Array([1, 2, 3, 4]),
  upload: async () => {},
  now: () => new Date('2026-09-03T04:05:06.007Z'),
  ...over,
})

describe('backupKey', () => {
  // Los dos puntos del ISO son legales en S3 pero un dolor de cabeza en cualquier shell y en
  // cualquier nombre de archivo de Windows al bajarlo. El prefijo y el orden lexicográfico
  // son lo que hace que "la última clave" sea "la más nueva".
  it('nombra con el timestamp adelante y sin dos puntos', () => {
    expect(backupKey(new Date('2026-09-03T04:05:06.007Z')))
      .toBe('nest-memory/2026-09-03T04-05-06-007Z.dump')
  })

  it('ordena cronologicamente al ordenar como texto', () => {
    const viejo = backupKey(new Date('2026-09-01T23:00:00.000Z'))
    const nuevo = backupKey(new Date('2026-09-03T04:05:06.007Z'))
    expect([nuevo, viejo].sort()).toEqual([viejo, nuevo])
  })
})

describe('countRows', () => {
  it('cuenta las tablas de datos del servicio', async () => {
    const counts = await countRows(pool)
    for (const t of ['users', 'devices', 'projects', 'observations', 'push_receipts', 'allowlist']) {
      expect(typeof counts[t], `falta ${t}`).toBe('number')
    }
    // `backups` no se cuenta: la escribe el propio backup y el número cambiaría entre que se
    // mide y que se dumpea, haciendo fallar toda restauración verificada para siempre.
    expect(counts.backups).toBeUndefined()
  })
})

describe('runBackup', () => {
  it('deja una fila ok con los bytes, el sha256 y los conteos', async () => {
    await limpiarBackups()
    const res = await runBackup(pool, deps())

    expect(res.key).toBe('nest-memory/2026-09-03T04-05-06-007Z.dump')
    expect(res.bytes).toBe(4)
    expect(res.sha256).toBe(createHash('sha256').update(Buffer.from([1, 2, 3, 4])).digest('hex'))

    const { rows } = await pool.query('select * from backups where id = $1', [res.id])
    expect(rows[0].ok).toBe(true)
    expect(rows[0].finished_at).toBeInstanceOf(Date)
    expect(Number(rows[0].bytes)).toBe(4)
    expect(rows[0].sha256).toBe(res.sha256)
    expect(rows[0].error).toBeNull()
    expect(typeof rows[0].row_counts.observations).toBe('number')
  })

  it('sube exactamente los bytes del dump, con la clave de la fila', async () => {
    await limpiarBackups()
    const subido: Array<{ key: string; body: Uint8Array }> = []
    const res = await runBackup(pool, deps({
      upload: async (key, body) => { subido.push({ key, body }) },
    }))
    expect(subido).toHaveLength(1)
    expect(subido[0].key).toBe(res.key)
    expect(Array.from(subido[0].body)).toEqual([1, 2, 3, 4])
  })

  // Lo central de la tabla: el intento fallido tiene que quedar VISIBLE. Que además re-tire es
  // lo que le permite a index.ts loguearlo y a un operador correrlo a mano y enterarse.
  it('cuando la subida falla deja la fila en ok=false con el error, y re-tira', async () => {
    await limpiarBackups()
    await expect(runBackup(pool, deps({
      upload: async () => { throw new Error('AccessDenied del bucket') },
    }))).rejects.toThrow(/AccessDenied/)

    const { rows } = await pool.query('select * from backups order by id desc limit 1')
    expect(rows[0].ok).toBe(false)
    expect(rows[0].error).toMatch(/AccessDenied/)
    expect(rows[0].finished_at).toBeInstanceOf(Date)
  })

  it('cuando el dump falla tambien deja rastro', async () => {
    await limpiarBackups()
    await expect(runBackup(pool, deps({
      dump: async () => { throw new Error('pg_dump salió con código 1') },
    }))).rejects.toThrow(/pg_dump/)

    const { rows } = await pool.query('select * from backups order by id desc limit 1')
    expect(rows[0].ok).toBe(false)
    expect(rows[0].error).toMatch(/pg_dump/)
    expect(rows[0].bytes).toBeNull()
  })

  // Un dump vacío que se sube sin quejarse es el peor backup posible: parece que está.
  it('rechaza un dump vacio antes de subirlo', async () => {
    await limpiarBackups()
    let subio = false
    await expect(runBackup(pool, deps({
      dump: async () => new Uint8Array(0),
      upload: async () => { subio = true },
    }))).rejects.toThrow(/vacío/i)
    expect(subio).toBe(false)
  })
})

describe('hadRecentSuccess', () => {
  it('es false sin backups', async () => {
    await limpiarBackups()
    expect(await hadRecentSuccess(pool, 20)).toBe(false)
  })

  it('es true despues de uno bueno', async () => {
    await limpiarBackups()
    await runBackup(pool, deps())
    expect(await hadRecentSuccess(pool, 20)).toBe(true)
  })

  // Un redeploy no debería saltear el backup del día por un intento que FALLÓ.
  it('un intento fallido no cuenta', async () => {
    await limpiarBackups()
    await expect(runBackup(pool, deps({ upload: async () => { throw new Error('x') } }))).rejects.toThrow()
    expect(await hadRecentSuccess(pool, 20)).toBe(false)
  })

  it('uno viejo no cuenta', async () => {
    await limpiarBackups()
    const res = await runBackup(pool, deps())
    await pool.query(`update backups set finished_at = now() - interval '30 hours' where id = $1`, [res.id])
    expect(await hadRecentSuccess(pool, 20)).toBe(false)
  })
})

describe('backupDepsFromEnv', () => {
  it('devuelve null sin configuracion de R2, en vez de romper', () => {
    expect(backupDepsFromEnv({ DATABASE_URL: 'postgres://u:p@h:5432/d' } as NodeJS.ProcessEnv)).toBeNull()
  })

  it('arma las deps cuando estan las cuatro variables', () => {
    expect(backupDepsFromEnv({
      DATABASE_URL: 'postgres://u:p@h:5432/d',
      R2_ACCOUNT_ID: 'a', R2_ACCESS_KEY_ID: 'b', R2_SECRET_ACCESS_KEY: 'c', R2_BUCKET: 'd',
    } as NodeJS.ProcessEnv)).not.toBeNull()
  })
})
```

- [x] **Step 2: Correrlo y verificar que falla**

Run: `cd server && npx vitest run __tests__/backup.test.ts; echo EXIT=$?`
Expected: FAIL — `Cannot find module '../src/backup'`, `EXIT=1`.

- [x] **Step 3: Implementación**

```typescript
// server/src/backup.ts
import { createHash } from 'node:crypto'
import type { Pool } from 'pg'
import { pgDump } from './pg-dump'
import { putObject, r2ConfigFromEnv } from './r2'

/** §11.3. El prefijo agrupa; el timestamp adelante hace que ordenar como texto sea ordenar por fecha. */
const KEY_PREFIX = 'nest-memory/'

/**
 * Las tablas cuyo conteo se guarda con el dump para poder verificar la restauración.
 *
 * `schema_migrations` y `backups` quedan afuera a propósito. `backups` la escribe el propio
 * backup, así que su conteo cambia entre que se mide y que `pg_dump` toma su snapshot:
 * incluirla haría fallar TODA restauración verificada, para siempre, por un desajuste que no
 * es un error.
 */
const DATA_TABLES = ['users', 'devices', 'projects', 'observations', 'push_receipts', 'allowlist'] as const

export type BackupDeps = {
  dump: () => Promise<Uint8Array>
  upload: (key: string, body: Uint8Array) => Promise<void>
  now: () => Date
}

export type BackupResult = { id: number; key: string; bytes: number; sha256: string }

/** `2026-09-03T04-05-06-007Z` — el ISO con los dos puntos y el punto cambiados por guiones. */
export function backupKey(at: Date): string {
  return `${KEY_PREFIX}${at.toISOString().replace(/[:.]/g, '-')}.dump`
}

/** Cuántas filas tiene cada tabla de datos ahora mismo. */
export async function countRows(pool: Pool): Promise<Record<string, number>> {
  const sql = DATA_TABLES
    .map((t) => `select '${t}' as tabla, count(*)::bigint as n from ${t}`)
    .join(' union all ')
  const { rows } = await pool.query(sql)
  return Object.fromEntries(rows.map((r) => [r.tabla, Number(r.n)]))
}

/**
 * Un backup completo: contar, dumpear, subir, dejar rastro.
 *
 * La fila se inserta ANTES de empezar: un proceso que muere a la mitad deja un `ok=false` con
 * `finished_at` nulo, visible, en vez de no haber existido nunca.
 *
 * Re-tira siempre después de registrar el fallo. Quien llama decide qué hacer: `index.ts` lo
 * loguea y sigue —un backup fallido no tumba un servicio que está sirviendo tráfico— y un
 * operador que lo corre a mano se entera.
 */
export async function runBackup(pool: Pool, deps: BackupDeps): Promise<BackupResult> {
  const at = deps.now()
  const key = backupKey(at)
  const { rows } = await pool.query(
    'insert into backups (object_key) values ($1) returning id',
    [key]
  )
  const id: number = Number(rows[0].id)

  try {
    const counts = await countRows(pool)
    const body = await deps.dump()
    // Un dump de cero bytes subido sin chistar es el peor backup posible: ocupa el lugar del
    // bueno y parece que está. `pg_dump` de una base sana nunca devuelve vacío.
    if (body.length === 0) throw new Error('el dump vino vacío: no se sube')

    const sha256 = createHash('sha256').update(body).digest('hex')
    await deps.upload(key, body)

    await pool.query(
      `update backups set ok = true, finished_at = now(), bytes = $2, sha256 = $3, row_counts = $4
        where id = $1`,
      [id, body.length, sha256, JSON.stringify(counts)]
    )
    return { id, key, bytes: body.length, sha256 }
  } catch (err) {
    const mensaje = err instanceof Error ? err.message : String(err)
    // El registro del fallo no puede tapar el fallo original: si esto también rompe (la base
    // se cayó), se ignora y se re-tira el error de verdad.
    await pool
      .query('update backups set ok = false, finished_at = now(), error = $2 where id = $1', [id, mensaje])
      .catch(() => {})
    throw err
  }
}

/** Si ya hubo un backup bueno en las últimas `hours` horas. Evita dumpear en cada redeploy. */
export async function hadRecentSuccess(pool: Pool, hours: number): Promise<boolean> {
  const { rows } = await pool.query(
    `select 1 from backups where ok = true and finished_at > now() - ($1 || ' hours')::interval limit 1`,
    [String(hours)]
  )
  return rows.length > 0
}

/**
 * Las dependencias reales, o `null` si R2 no está configurado.
 *
 * `null` y no una excepción: un deploy sin R2 —el de desarrollo, el de un cliente que todavía
 * no lo cargó— tiene que arrancar igual y decirlo en el log, no negarse a servir.
 */
export function backupDepsFromEnv(env: NodeJS.ProcessEnv = process.env): BackupDeps | null {
  const cfg = r2ConfigFromEnv(env)
  if (!cfg) return null
  // `PG_BIN_DATABASE_URL` es la URL que ven los BINARIOS de Postgres, que no siempre es la
  // misma que ve el driver `pg`. En producción son idénticas y esto no hace nada. En
  // desarrollo no: el driver corre en Windows y llega a la base por `127.0.0.1:55432`,
  // mientras que `pg_dump` corre adentro del contenedor por `docker exec` y desde ahí la
  // base es `127.0.0.1:5432`. Una sola variable no puede ser las dos cosas.
  const databaseUrl = env.PG_BIN_DATABASE_URL ?? env.DATABASE_URL
  if (!databaseUrl) return null
  return {
    dump: () => pgDump(databaseUrl, { env }),
    upload: (key, body) => putObject(cfg, key, body),
    now: () => new Date(),
  }
}
```

- [x] **Step 4: Correr y verificar que pasa**

Run: `cd server && npx vitest run __tests__/backup.test.ts; echo EXIT=$?`
Expected: PASS, 13 tests, `EXIT=0`.

- [x] **Step 5: Correr la suite entera y el typecheck**

Run: `cd server && npx vitest run; echo EXIT=$?` y después `npx tsc --noEmit -p tsconfig.json; echo EXIT=$?`
Expected: los dos en `EXIT=0`.

- [x] **Step 6: Commit**

```bash
git add server/src/backup.ts server/__tests__/backup.test.ts
git commit -m "feat(sync-service): el backup diario, con rastro de cada intento"
```

---

### Task 5: Prenderlo en el servicio

**Files:**
- Modify: `server/src/backup.ts` (sumar `shouldRunBackup`)
- Modify: `server/src/index.ts:18-28` (después del bloque del timer de purga)
- Modify: `server/Dockerfile` (el cliente de Postgres y el `COPY scripts`)
- Modify: `server/README.md` (tabla de variables de ambiente, después de la fila `PG_POOL_MAX`)
- Test: `server/__tests__/backup-schedule.test.ts`

**Interfaces:**
- Consumes: `runBackup`, `hadRecentSuccess`, `backupDepsFromEnv`, `BackupDeps` de `src/backup.ts`.
- Produces: `shouldRunBackup(pool: Pool, deps: BackupDeps | null, hours: number): Promise<boolean>` en `src/backup.ts` — la decisión, separada del timer, para que sea testeable sin esperar 24 horas.

`index.ts` no se puede testear con vitest (tiene top-level await, `listen()` y timers), así que la lógica que vale sale del timer y se testea aparte. Es el mismo motivo por el que `purgeTombstones` vive en `purge.ts` y no adentro del `setInterval`.

- [x] **Step 1: Escribir el test que falla**

```typescript
// server/__tests__/backup-schedule.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { getPool, migrate } from '../src/db'
import { runBackup, shouldRunBackup, type BackupDeps } from '../src/backup'

const pool = getPool()
beforeAll(async () => { await migrate(pool) })
afterAll(async () => { await pool.end() })

const deps: BackupDeps = {
  dump: async () => new Uint8Array([1]),
  upload: async () => {},
  now: () => new Date(),
}

describe('shouldRunBackup', () => {
  it('es false sin R2 configurado: no hay adonde subir', async () => {
    await pool.query('delete from backups')
    expect(await shouldRunBackup(pool, null, 20)).toBe(false)
  })

  it('es true si nunca hubo backup', async () => {
    await pool.query('delete from backups')
    expect(await shouldRunBackup(pool, deps, 20)).toBe(true)
  })

  // Railway redeploya en cada push. Sin esto, una tarde de trabajo son veinte dumps de la base
  // entera, y cada uno cuesta plata y lectura sobre la base de producción.
  it('es false justo despues de uno bueno', async () => {
    await pool.query('delete from backups')
    await runBackup(pool, deps)
    expect(await shouldRunBackup(pool, deps, 20)).toBe(false)
  })
})
```

- [x] **Step 2: Correrlo y verificar que falla**

Run: `cd server && npx vitest run __tests__/backup-schedule.test.ts; echo EXIT=$?`
Expected: FAIL — `shouldRunBackup` no está exportada, `EXIT=1`.

- [x] **Step 3: Sumar `shouldRunBackup` a `src/backup.ts`**

Al final del archivo:

```typescript
/**
 * Si corresponde correr un backup ahora. Separado del timer para poder testearlo sin esperar
 * un día: sin R2 no hay adónde subir, y con un backup bueno reciente no hace falta otro.
 */
export async function shouldRunBackup(
  pool: Pool,
  deps: BackupDeps | null,
  hours: number
): Promise<boolean> {
  if (!deps) return false
  return !(await hadRecentSuccess(pool, hours))
}
```

- [x] **Step 4: Correr y verificar que pasa**

Run: `cd server && npx vitest run __tests__/backup-schedule.test.ts; echo EXIT=$?`
Expected: PASS, 3 tests, `EXIT=0`.

- [x] **Step 5: Prender el timer en `src/index.ts`**

En los imports de arriba de todo, sumar:

```typescript
import { backupDepsFromEnv, runBackup, shouldRunBackup } from './backup'
```

Y después del bloque de la purga (que termina en la línea 28, el `setInterval(runPurge, ...)`), agregar:

```typescript
// Un backup por día, y uno al arrancar si hace más de 20 horas del último bueno. Ese margen
// existe por los redeploys: Railway reinicia el contenedor en cada push, y sin la guarda una
// tarde de trabajo serían veinte dumps de la base entera.
//
// Mismo criterio que la purga para el catch: un backup fallido NO tumba un servicio que está
// sirviendo tráfico. La diferencia es que este además deja una fila en `backups`, así que el
// fallo se puede consultar después en vez de vivir sólo en un log que nadie mira.
const BACKUP_EVERY_MS = 24 * 60 * 60 * 1000
const BACKUP_MIN_GAP_HOURS = 20
const backupDeps = backupDepsFromEnv()
if (!backupDeps) {
  console.warn('[backup] R2 no configurado (faltan R2_*): no se van a hacer backups')
}
const runBackupIfDue = async () => {
  try {
    if (!backupDeps) return
    if (!(await shouldRunBackup(pool, backupDeps, BACKUP_MIN_GAP_HOURS))) return
    const r = await runBackup(pool, backupDeps)
    console.log(`[backup] ${r.key} — ${r.bytes} bytes, sha256 ${r.sha256.slice(0, 12)}`)
  } catch (err) {
    console.error('[backup]', err)
  }
}

void runBackupIfDue()
setInterval(() => void runBackupIfDue(), BACKUP_EVERY_MS).unref()
```

- [x] **Step 6: Sumar el cliente de Postgres y los scripts al `Dockerfile`**

Dos cambios. El `Dockerfile` queda entero así:

```dockerfile
FROM node:22-alpine

# `postgresql16-client` trae pg_dump y pg_restore, que el backup diario corre como proceso
# hijo. Pinneado a 16 porque un pg_dump MÁS VIEJO que el servidor se niega a correr, y la base
# de producción es Postgres 16: sin el número, un rebuild futuro podría traer un cliente 15 y
# el backup dejaría de existir en silencio.
RUN apk add --no-cache postgresql16-client

WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev || npm install --omit=dev
COPY tsconfig.json ./
COPY src ./src
COPY migrations ./migrations
# `scripts/` no estaba en la imagen: por eso el modo remoto de mint-device-token.mjs se pipea
# por stdin. Ese truco NO sirve para restore-check.mjs, que importa de `../src/` — un script
# leído por stdin no tiene desde dónde resolver esa ruta. Y la restauración probada de §11.3
# hay que poder correrla contra la base de producción, que no tiene endpoint público: la única
# forma es adentro del contenedor.
COPY scripts ./scripts
ENV NODE_ENV=production
EXPOSE 8080
CMD ["npx", "tsx", "src/index.ts"]
```

`tsx` queda disponible en la imagen aun con `--omit=dev` porque está en `dependencies`, no en `devDependencies` — es con lo que arranca el propio servicio.

- [x] **Step 7: Verificar que la imagen buildea y que `pg_dump` quedó adentro**

```bash
cd server && docker build -t nest-memory-sync:backup-check .
docker run --rm nest-memory-sync:backup-check pg_dump --version
```
Expected: `pg_dump (PostgreSQL) 16.x`. Si dice 15 o 17, el paquete de Alpine cambió y hay que ajustar el nombre.

- [x] **Step 8: Documentar las variables en `server/README.md`**

Sumar a la tabla de variables de ambiente, después de la fila `PG_POOL_MAX`:

```markdown
| `R2_ACCOUNT_ID` | ninguno | ID de cuenta de Cloudflare, la primera parte del endpoint S3 de R2. **Sin las cuatro `R2_*` el servicio arranca igual pero no hace backups**, y lo dice en el log al arrancar. |
| `R2_ACCESS_KEY_ID` | ninguno | Access key del API token de R2, **acotado al bucket de backups**. |
| `R2_SECRET_ACCESS_KEY` | ninguno | Secret del mismo token. |
| `R2_BUCKET` | ninguno | Nombre del bucket, por ejemplo `nest-memory-backups`. **La retención de 30 días es una regla de ciclo de vida del bucket, no del código.** |
| `PG_DUMP_CMD` | `pg_dump` | Con qué correr `pg_dump`, como lista de palabras. Existe para desarrollo en máquinas sin cliente de Postgres instalado: `docker exec -i nest-memory-pg pg_dump`. En el contenedor del servicio no se setea. |
| `PG_RESTORE_CMD` | `pg_restore` | Lo mismo para `pg_restore`, que usa el script de restauración. |
| `PG_BIN_DATABASE_URL` | el valor de `DATABASE_URL` | La URL que ven los **binarios** de Postgres, que no siempre es la que ve el driver `pg`. En producción son la misma y esto no hace falta. En desarrollo sí: el driver corre en Windows y llega por `127.0.0.1:55432`, mientras que `pg_dump` corre adentro del contenedor por `docker exec` y desde ahí la base es `127.0.0.1:5432`. |
```

- [x] **Step 9: Correr la suite entera y el typecheck**

Run: `cd server && npx vitest run; echo EXIT=$?` y `npx tsc --noEmit -p tsconfig.json; echo EXIT=$?`
Expected: los dos en `EXIT=0`.

- [x] **Step 10: Commit**

```bash
git add server/src/index.ts server/src/backup.ts server/Dockerfile server/README.md server/__tests__/backup-schedule.test.ts
git commit -m "feat(sync-service): timer diario de backup y pg_dump 16 en la imagen"
```

---

### Task 6: La restauración probada

**Files:**
- Create: `server/scripts/restore-check.mjs`
- Create: `server/.gitignore` (para que los dumps de prueba no se commiteen)
- Modify: `server/README.md` (una sección nueva, "Backups y restauración")

**Interfaces:**
- Consumes: `src/r2.ts` (`r2ConfigFromEnv`, `listKeys`, `getObject`), `src/pg-dump.ts` (`pgRestore`), `pg`.
- Produces: un ejecutable de operador. No lo importa nadie.

Es la mitad que convierte esto en un backup de verdad: *un backup que nunca se restauró no es un backup*. Dos modos, y los dos hacen lo mismo salvo de dónde sale el dump: `--file <path>` (un dump local; **no necesita R2**, y es lo que permite probar el mecanismo entero hoy) y `--from-r2` (el último dump real de producción).

La verificación no se compara contra la base viva, que para cuando el script corre ya se movió: se compara contra los conteos que quedaron guardados en `backups.row_counts` **cuando se tomó ese dump**. Es la razón por la que existe esa columna.

- [x] **Step 1: Escribir el script**

```javascript
#!/usr/bin/env node
// server/scripts/restore-check.mjs
//
// La restauración probada de §11.3. Baja (o lee) un dump, lo restaura en una base LIMPIA y
// verifica que lo que quedó adentro es lo que había cuando se tomó.
//
// SE CORRE CON `npx tsx`, no con `node` pelado: importa módulos TypeScript de `src/`, y Node
// 22 no despoja tipos por su cuenta. `tsx` ya es dependencia del paquete y es con lo que
// arranca el propio servicio.
//
//   npx tsx scripts/restore-check.mjs --file /tmp/x.dump   # un dump local, sin R2
//   npx tsx scripts/restore-check.mjs --from-r2            # el último dump real
//   npx tsx scripts/restore-check.mjs --from-r2 --keep     # deja la base restaurada
//
// Es re-corrible: la base de verificación se crea con un nombre único y se borra al final.
// NUNCA toca la base de origen — sólo la lee para buscar los conteos del dump.
import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import pg from 'pg'
import { r2ConfigFromEnv, listKeys, getObject } from '../src/r2.ts'
import { pgRestore } from '../src/pg-dump.ts'

const args = process.argv.slice(2)
const flag = (n) => args.includes(n)
const value = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined }

// DOS URLs, no una. `DATABASE_URL` es la que usa el driver `pg`, que corre acá. La otra es la
// que ve `pg_restore`, que puede estar corriendo en OTRO lado: envuelto en `docker exec`, la
// base no es `127.0.0.1:55432` sino `127.0.0.1:5432`. En producción las dos son la misma.
const DATABASE_URL = process.env.DATABASE_URL
  ?? 'postgres://postgres:nestmem@127.0.0.1:55432/nest_memory'
const PG_BIN_DATABASE_URL = process.env.PG_BIN_DATABASE_URL ?? DATABASE_URL
const DATA_TABLES = ['users', 'devices', 'projects', 'observations', 'push_receipts', 'allowlist']

function fatal(msg) { console.error(`✗ ${msg}`); process.exit(1) }

/** El dump y, si se sabe, de qué clave salió. */
async function conseguirDump() {
  const file = value('--file')
  if (file) return { bytes: new Uint8Array(await readFile(file)), key: null, origen: file }

  if (!flag('--from-r2')) fatal('usá --file <path> o --from-r2')
  const cfg = r2ConfigFromEnv()
  if (!cfg) fatal('faltan las variables R2_* y pediste --from-r2')

  const keys = await listKeys(cfg, 'nest-memory/')
  if (keys.length === 0) fatal('el bucket no tiene ningún backup')
  const key = keys[keys.length - 1] // ordenadas: la última es la más nueva
  console.log(`· bajando ${key}`)
  return { bytes: await getObject(cfg, key), key, origen: `r2://${cfg.bucket}/${key}` }
}

/** La fila de `backups` de ESE dump, que trae los conteos del momento en que se tomó. */
async function filaDelBackup(key, sha256) {
  const client = new pg.Client({ connectionString: DATABASE_URL })
  await client.connect()
  try {
    const { rows } = key
      ? await client.query('select * from backups where object_key = $1', [key])
      : await client.query('select * from backups where sha256 = $1 order by id desc limit 1', [sha256])
    return rows[0] ?? null
  } finally { await client.end() }
}

async function main() {
  const { bytes, key, origen } = await conseguirDump()
  const sha256 = createHash('sha256').update(bytes).digest('hex')
  console.log(`· dump: ${origen} — ${bytes.length} bytes, sha256 ${sha256.slice(0, 12)}`)

  if (bytes.length === 0) fatal('el dump está vacío')
  if (Buffer.from(bytes.slice(0, 5)).toString() !== 'PGDMP') {
    fatal('el archivo no arranca con PGDMP: no es un dump en formato custom')
  }

  const fila = await filaDelBackup(key, sha256)
  if (fila?.sha256 && fila.sha256 !== sha256) {
    fatal(`el sha256 no coincide con el registrado: se corrompió en el camino\n  esperado ${fila.sha256}\n  bajado   ${sha256}`)
  }

  // Una base nueva por corrida, en el mismo servidor. Nunca se restaura sobre una existente.
  const nombre = `nest_memory_restorecheck_${Date.now()}`
  const admin = new pg.Client({ connectionString: DATABASE_URL, database: 'postgres' })
  await admin.connect()
  await admin.query(`create database ${nombre}`)
  console.log(`· base limpia: ${nombre}`)

  // La misma base nueva, vista desde los dos lados: el driver la abre por su URL, y
  // `pg_restore` por la suya. Con `docker exec` de por medio no son la misma cadena.
  const destinoDriver = new URL(DATABASE_URL)
  destinoDriver.pathname = `/${nombre}`
  const destinoBinario = new URL(PG_BIN_DATABASE_URL)
  destinoBinario.pathname = `/${nombre}`

  let fallo = null
  try {
    await pgRestore(destinoBinario.toString(), bytes)
    console.log('· restaurado')

    const verificador = new pg.Client({ connectionString: destinoDriver.toString() })
    await verificador.connect()
    try {
      const restaurados = {}
      for (const t of DATA_TABLES) {
        const { rows } = await verificador.query(`select count(*)::bigint as n from ${t}`)
        restaurados[t] = Number(rows[0].n)
      }

      const esperados = fila?.row_counts ?? null
      if (!esperados) {
        console.log('⚠ sin conteos registrados para este dump: sólo se verifica que restaure y tenga las tablas')
        console.table(restaurados)
      } else {
        console.table(DATA_TABLES.map((t) => ({ tabla: t, esperado: esperados[t], restaurado: restaurados[t] })))
        const diffs = DATA_TABLES
          .filter((t) => restaurados[t] !== esperados[t])
          .map((t) => `  ${t}: esperado ${esperados[t]}, restaurado ${restaurados[t]}`)
        if (diffs.length > 0) throw new Error(`conteos que no coinciden:\n${diffs.join('\n')}`)
      }

      // El conteo dice cuántas filas hay; el checksum dice que son LAS MISMAS. Sin esto, un
      // dump que restaura la cantidad correcta de memorias vacías pasaría como bueno.
      const { rows: sum } = await verificador.query(
        `select coalesce(md5(string_agg(sync_id || ':' || coalesce(content, '') || ':' || lamport, '|'
           order by sync_id)), 'vacio') as h from observations`
      )
      console.log(`· checksum del contenido de observations: ${sum[0].h}`)
    } finally { await verificador.end() }
  } catch (err) {
    fallo = err
  } finally {
    if (flag('--keep')) console.log(`· base ${nombre} conservada (--keep)`)
    else { await admin.query(`drop database ${nombre}`); console.log(`· base ${nombre} borrada`) }
    await admin.end()
  }

  if (fallo) fatal(fallo.message)
  console.log('✓ restauración verificada')
}

await main()
```

- [x] **Step 2: Probar el modo `--file` de punta a punta contra la base local**

Este es el paso que demuestra que el mecanismo entero funciona, y **no necesita R2**.

Primero, un lugar para los dumps de prueba que no se pueda commitear por accidente. Crear
`server/.gitignore` con:

```gitignore
tmp/
```

```bash
cd server && mkdir -p tmp

# Los binarios de Postgres corren adentro del contenedor, así que ven la base en :5432; el
# driver `pg` corre acá y la ve en :55432. Por eso son dos variables distintas.
export PG_DUMP_CMD="docker exec -i nest-memory-pg pg_dump"
export PG_RESTORE_CMD="docker exec -i nest-memory-pg pg_restore"
export PG_BIN_DATABASE_URL="postgres://postgres:nestmem@127.0.0.1:5432/nest_memory"

# 1. Un backup real contra la base local: dump real, subida de mentira. Deja la fila en
#    `backups` con sus row_counts, que es contra lo que después se verifica.
#    VA A UN ARCHIVO, no a `tsx -e`: con imports, `-e` no ejecuta nada y sale 0.
cat > tmp/hacer-backup-local.ts <<'TS'
import { writeFileSync } from 'node:fs'
import { getPool, migrate } from '../src/db.ts'
import { runBackup } from '../src/backup.ts'
import { pgDump } from '../src/pg-dump.ts'

const pool = getPool()
await migrate(pool)
const r = await runBackup(pool, {
  dump: async () => {
    const b = await pgDump(process.env.PG_BIN_DATABASE_URL!)
    writeFileSync('tmp/local.dump', b)
    return b
  },
  upload: async () => {},
  now: () => new Date(),
})
console.log('backup', r.key, r.bytes, 'bytes')
await pool.end()
TS
npx tsx tmp/hacer-backup-local.ts; echo EXIT=$?

# 2. Restaurarlo y verificarlo.
npx tsx scripts/restore-check.mjs --file tmp/local.dump; echo EXIT=$?
```
Expected: la tabla de conteos con `esperado` == `restaurado` en las seis tablas, el checksum, `✓ restauración verificada` y `EXIT=0`.

- [x] **Step 3: Probar que el script FALLA cuando tiene que fallar**

Un verificador que nunca falló no verificó nada.

```bash
cd server
# Un archivo que no es un dump.
echo "esto no es un dump" > tmp/basura.dump
npx tsx scripts/restore-check.mjs --file tmp/basura.dump; echo EXIT=$?
```
Expected: `✗ el archivo no arranca con PGDMP...` y `EXIT=1`.

```bash
# Un dump real truncado: pasa el chequeo del header y muere en el restore.
head -c 2000 tmp/local.dump > tmp/truncado.dump
npx tsx scripts/restore-check.mjs --file tmp/truncado.dump; echo EXIT=$?
```
Expected: `EXIT=1`, y la base temporal **borrada igual** (por el `finally`). Confirmarlo:
```bash
docker exec nest-memory-pg psql -U postgres -lqt | grep restorecheck
```
Expected: sin salida.

- [x] **Step 4: Documentar en `server/README.md`**

Sumar una sección nueva al final:

````markdown
## Backups y restauración

El servicio hace un `pg_dump -Fc` por día y lo sube a Cloudflare R2. La retención de 30 días la
hace **la regla de ciclo de vida del bucket**, no el código.

Cada intento deja una fila en `backups`, buena o mala. El último backup bueno:

```sql
select object_key, finished_at, bytes, row_counts from backups where ok order by id desc limit 1;
```

Y los que fallaron, que es la consulta que de verdad importa:

```sql
select started_at, error from backups where not ok order by id desc limit 10;
```

**Restaurar y verificar** (`scripts/restore-check.mjs`). Crea una base nueva, restaura ahí,
compara los conteos contra los que se guardaron cuando se tomó el dump, imprime el checksum del
contenido y borra la base. No toca la base de origen.

```bash
npx tsx scripts/restore-check.mjs --from-r2          # el último dump real
npx tsx scripts/restore-check.mjs --file x.dump      # un dump local, sin R2
npx tsx scripts/restore-check.mjs --from-r2 --keep   # deja la base para inspeccionarla
```

Va con `npx tsx` y no con `node` pelado porque importa módulos TypeScript de `src/`.

En una máquina sin cliente de Postgres instalado (Windows), apuntar los binarios al contenedor
de la base **y darles su propia URL**, que no es la del driver:

```bash
export PG_RESTORE_CMD="docker exec -i nest-memory-pg pg_restore"
export PG_BIN_DATABASE_URL="postgres://postgres:nestmem@127.0.0.1:5432/nest_memory"
```
````

- [x] **Step 5: Correr la suite entera y el typecheck una vez más**

Run: `cd server && npx vitest run; echo EXIT=$?` y `npx tsc --noEmit -p tsconfig.json; echo EXIT=$?`
Expected: los dos en `EXIT=0`.

- [x] **Step 6: Commit**

```bash
git add server/scripts/restore-check.mjs server/.gitignore server/README.md
git commit -m "feat(sync-service): restauracion probada, con los conteos del propio dump"
```

---

### Task 7: La corrida real contra producción

**Files:** ninguno. Es operación, no código.

**BLOQUEADA** hasta que existan el bucket y las cuatro variables en Railway. Todo lo anterior se puede hacer y verificar sin esto.

- [ ] **Step 1: Confirmar que las cuatro variables están cargadas**

```bash
railway variables --service sync | grep R2_
```
Expected: las cuatro. Si falta alguna, parar acá.

- [ ] **Step 2: Deployar y mirar el arranque**

```bash
git push origin smoke/memory-bridge
railway logs --service sync | tail -40
```
Expected: la migración 003 aplicada, `[sync] listening on 8080`, y una línea `[backup] nest-memory/... — N bytes, sha256 ...`. **No** tiene que aparecer `[backup] R2 no configurado`.

- [ ] **Step 3: Verificar que el objeto existe en R2**

Nada de `tsx -e` acá tampoco: con imports adentro no ejecuta y sale 0, o sea que imprimiría una lista vacía indistinguible de "el bucket está vacío". Va por un archivo escrito en el contenedor:

```bash
ssh railway-sync "cd /app && cat > /tmp/listar.ts <<'TS'
import { r2ConfigFromEnv, listKeys } from '/app/src/r2.ts'
console.log(await listKeys(r2ConfigFromEnv()!, 'nest-memory/'))
TS
npx tsx /tmp/listar.ts"
```
Expected: al menos una clave. (Recordar el gotcha ya documentado: `railway ssh` del CLI falla con "Host key verification failed"; lo que funciona es `ssh railway-sync "<comando>"` directo.)

- [ ] **Step 4: La restauración probada contra el dump REAL de producción**

Este es el paso que cierra §11.3.

```bash
ssh railway-sync "cd /app && npx tsx scripts/restore-check.mjs --from-r2"
```
Expected: conteos coincidentes, checksum impreso, `✓ restauración verificada`, salida 0.

- [ ] **Step 5: Verificar la regla de ciclo de vida**

Que la retención exista es la mitad de la promesa. Confirmar en el dashboard de R2 que el bucket tiene la regla a 30 días. **Sin la regla, el bucket crece para siempre y la "retención de 30 días" es sólo una frase en un documento.**

- [ ] **Step 6: Anotar el resultado en la memoria del proyecto**

Actualizar `nest-memory/raven-nest/nest-memory-sync-service.md`: la sección "Backups" pasa de "diseño aprobado, esperando el bucket" a lo que efectivamente quedó corriendo, con el tamaño medido del dump y la fecha de la restauración verificada.

---

## Lo que este plan NO hace

- **No implementa la retención en código.** Es una regla del bucket, a propósito: una cosa menos que puede fallar y una cosa menos que puede borrar de más.
- **No hace backups incrementales ni point-in-time.** Un dump diario completo de una base de 8 MB es la respuesta proporcionada. PITR es de Railway y no cubre el escenario de perder la cuenta, que es para lo que este backup existe.
- **No encripta el dump antes de subirlo.** El objeto viaja por TLS y R2 encripta en reposo. Encriptación propia agrega una llave más que se puede perder — y perder la llave del backup es perder el backup.
- **No manda alertas.** La tabla `backups` deja el rastro; que alguien mire es §11.5 (observabilidad), que es su propio pendiente.
- **No mete `server/` en el CI.** Sigue siendo el gap conocido: ni el typecheck ni los tests del servicio corren en GitHub Actions, sólo en la máquina de quien toca el código.
