# Cifrado de memoria de equipo — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que `scope: 'team'` viaje cifrado de punta a punta (el servidor nunca ve `title`/`content`/`tags` en claro), con una clave por equipo envuelta por device, gateada por rol `leader`, con migración retroactiva de lo ya subido en claro y código de recuperación propio.

**Architecture:** Reusa el 100% de la infraestructura criptográfica ya construida para el cifrado personal (`electron/memory-crypto.ts`, `electron/memory-key-wrap.ts`) y el mismo patrón servidor (`server/src/keys.ts` → análogo `server/src/team-keys.ts`). Lo único nuevo: dos tablas (`team_keys`, `team_key_wraps`), cuatro endpoints gateados por `team_memberships.role = 'leader'`, un resolver `project_key → team_id → MemoryKeys` en el punto único donde hoy `scope === 'team'` se salta el cifrado (`electron/memory-envelope.ts`), y un endpoint de migración retroactiva que reescribe contenido ajeno bajo un chequeo muy acotado.

**Tech Stack:** TypeScript, Postgres (`pg`), Electron (better-sqlite3 local store), Vitest, `node:crypto` (sin dependencias nuevas).

**Spec:** `docs/superpowers/specs/2026-10-14-cifrado-de-equipo-design.md`

## Global Constraints

- Ninguna dependencia nueva: todo el cifrado usa `node:crypto` únicamente (misma regla que ya aplicó `electron/memory-crypto.ts` y `electron/memory-key-wrap.ts`).
- `scope` sigue viajando SIEMPRE en claro — nunca se cifra, el servidor lo necesita para autorización. Ningún task de este plan lo toca.
- v1 no tiene épocas ni rotación para la clave de equipo (spec §2, §8) — no agregar una columna `key_epoch` a `team_keys`.
- v1 no re-cifra al salir un miembro (spec §8) — ningún task de este plan dispara un re-key al cambiar `team_memberships`.
- Sólo el rol `leader` (columna `team_memberships.role`) puede activar, autorizar o disparar la migración retroactiva — cada endpoint nuevo lo verifica server-side, nunca sólo en la UI.
- El endpoint de migración (`recrypt`) es la ÚNICA vía del sistema donde alguien reescribe contenido de una fila que no autoró — tiene que verificar `project.team_id` Y `scope = 'team'` por cada fila, nunca confiar en lo que mande el batch sin chequear contra la base.

## Review Focus

- **Un `sync_id` de OTRO equipo en el body de `recrypt`.** El endpoint tiene que rechazar esa fila puntual (no el lote entero) sin tocarla. Es el vector de sobreescritura cruzada que el spec marca como riesgo #2.
- **Un `sync_id` de `scope: 'personal'` o `'project'` colado en `recrypt`.** Mismo chequeo, falla distinta: si el `scope` no es `'team'`, se rechaza — el endpoint nunca debe poder reescribir una memoria personal de nadie.
- **Alguien que NO es `leader` llamando a `activate`/`authorize`/`recrypt`.** Los tres tienen que devolver 403 `leader_required`, chequeado contra `team_memberships`, nunca inferido de un header o de lo que mande el client.
- **Dos devices del mismo leader activando casi a la vez.** El segundo `POST .../activate` tiene que fallar con algo que el client distinga de un error real (mismo patrón que `stale_key_epoch` en personal) para no romper el flujo normal de "ya está activo, autorizame".
- **Una fila de equipo que llega sin que este device tenga wrap.** Tiene que mostrarse como "pendiente de autorización" (igual que hoy una fila `nmc1:` personal no descifrable), nunca como un crash ni como texto corrupto.

---

## Task 1: Migración — `team_keys` y `team_key_wraps`

**Files:**
- Create: `server/migrations/009_team_keys.sql`
- Test: `server/__tests__/team-keys-migration.test.ts`

**Interfaces:**
- Produces: tablas `team_keys(team_id, activated_by, activated_at)` y `team_key_wraps(team_id, slot, kind, wrapped, wrap_meta, created_at)`, que todos los tasks siguientes usan.

- [ ] **Step 1: Escribir el test que falla**

```ts
// server/__tests__/team-keys-migration.test.ts
import { describe, it, expect, beforeAll } from 'vitest'
import { randomUUID } from 'node:crypto'
import { getPool, migrate } from '../src/db'

const pool = getPool()
beforeAll(async () => { await migrate(pool) })

describe('migración 009 — team_keys / team_key_wraps', () => {
  it('crea las tablas con las columnas esperadas', async () => {
    const teamId = randomUUID()
    const userId = randomUUID()
    await pool.query('insert into users (id) values ($1)', [userId])
    await pool.query(
      'insert into team_keys (team_id, activated_by) values ($1, $2)',
      [teamId, userId]
    )
    const { rows } = await pool.query('select * from team_keys where team_id = $1', [teamId])
    expect(rows[0].activated_by).toBe(userId)
    expect(rows[0].activated_at).toBeInstanceOf(Date)

    await pool.query(
      `insert into team_key_wraps (team_id, slot, kind, wrapped, wrap_meta)
       values ($1, $2, 'device', 'W', null)`,
      [teamId, userId]
    )
    const wraps = await pool.query('select * from team_key_wraps where team_id = $1', [teamId])
    expect(wraps.rows).toHaveLength(1)
  })

  it('borra las wraps en cascada si se borra la fila de team_keys', async () => {
    const teamId = randomUUID()
    const userId = randomUUID()
    await pool.query('insert into users (id) values ($1)', [userId])
    await pool.query('insert into team_keys (team_id, activated_by) values ($1, $2)', [teamId, userId])
    await pool.query(
      `insert into team_key_wraps (team_id, slot, kind, wrapped) values ($1, 'recovery', 'recovery', 'W')`,
      [teamId]
    )
    await pool.query('delete from team_keys where team_id = $1', [teamId])
    const { rows } = await pool.query('select * from team_key_wraps where team_id = $1', [teamId])
    expect(rows).toHaveLength(0)
  })

  it('rechaza un kind que no sea device ni recovery', async () => {
    const teamId = randomUUID()
    const userId = randomUUID()
    await pool.query('insert into users (id) values ($1)', [userId])
    await pool.query('insert into team_keys (team_id, activated_by) values ($1, $2)', [teamId, userId])
    await expect(
      pool.query(
        `insert into team_key_wraps (team_id, slot, kind, wrapped) values ($1, 'x', 'bogus', 'W')`,
        [teamId]
      )
    ).rejects.toThrow()
  })
})
```

- [ ] **Step 2: Correr el test, confirmar que falla**

Run: `npx vitest run __tests__/team-keys-migration.test.ts` (desde `server/`)
Expected: FAIL — `relation "team_keys" does not exist`

- [ ] **Step 3: Escribir la migración**

```sql
-- server/migrations/009_team_keys.sql
-- Cifrado de memoria de equipo — spec 2026-10-14-cifrado-de-equipo-design.md.
-- Mismo patrón que 006_e2ee.sql (device_keys/key_wraps), sin épocas: v1 no rota la clave
-- de equipo (spec §2, §8) y la activa SIEMPRE el `leader` (team_memberships.role).

create table if not exists team_keys (
  team_id      uuid primary key,
  activated_by uuid not null references users(id),
  activated_at timestamptz not null default now()
);

-- Una fila por destinatario de la clave de equipo. `slot` es el device_id (como texto) o el
-- literal 'recovery' — mismo espacio de nombres que key_wraps, mismo motivo: el código de
-- recuperación es un destinatario más, no un caso especial.
create table if not exists team_key_wraps (
  team_id    uuid not null references team_keys(team_id) on delete cascade,
  slot       text not null,
  kind       text not null check (kind in ('device', 'recovery')),
  wrapped    text not null,
  wrap_meta  jsonb,
  created_at timestamptz not null default now(),
  primary key (team_id, slot)
);

create index if not exists team_key_wraps_by_team on team_key_wraps (team_id);
```

Agregar la migración a la lista que corre `migrate()` — revisar `server/src/db.ts` y sumar
`'009_team_keys.sql'` donde ya están listadas `'006_e2ee.sql'`, `'007_rotate_verifier.sql'`, etc.
(mismo array o mecanismo que ya usan esas dos).

- [ ] **Step 4: Correr el test, confirmar que pasa**

Run: `npx vitest run __tests__/team-keys-migration.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add server/migrations/009_team_keys.sql server/src/db.ts server/__tests__/team-keys-migration.test.ts
git commit -m "feat(cifrado-equipo): migración team_keys / team_key_wraps"
```

---

## Task 2: `server/src/team-keys.ts` — rol y lectura de estado

**Files:**
- Create: `server/src/team-keys.ts`
- Test: `server/__tests__/team-keys.test.ts`

**Interfaces:**
- Consumes: `Pool` de `pg`; tablas `team_memberships` (ya existe, ver `server/src/devices.ts:340-367`), `device_keys`, `devices`, `team_keys`, `team_key_wraps` (Task 1).
- Produces:
  - `export interface TeamKeysAuth { deviceId: string; userId: string }`
  - `export async function isTeamLeader(pool: Pool, userId: string, teamId: string): Promise<boolean>`
  - `export interface TeamKeyState { activated: boolean; wrap: { wrapped: string; wrapMeta: Record<string, unknown> | null } | null; pendingDevices: Array<{ deviceId: string; name: string; publicKey: string }> }`
  - `export async function getTeamKeyState(pool: Pool, auth: TeamKeysAuth, teamId: string, slot?: string): Promise<TeamKeyState | { ok: false; status: 403; error: string }>`

Los tasks 3-5 importan `isTeamLeader` y el tipo `TeamKeysAuth` de este archivo.

- [ ] **Step 1: Escribir el test que falla**

```ts
// server/__tests__/team-keys.test.ts
import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import { randomUUID } from 'node:crypto'
import { getPool, migrate } from '../src/db'
import { isTeamLeader, getTeamKeyState } from '../src/team-keys'

const pool = getPool()
let teamId: string, leaderId: string, memberId: string, outsiderId: string
let leaderDevice: string, memberDevice: string

beforeAll(async () => { await migrate(pool) })

beforeEach(async () => {
  teamId = randomUUID()
  leaderId = randomUUID()
  memberId = randomUUID()
  outsiderId = randomUUID()
  leaderDevice = randomUUID()
  memberDevice = randomUUID()
  for (const id of [leaderId, memberId, outsiderId]) {
    await pool.query('insert into users (id) values ($1)', [id])
  }
  await pool.query(
    `insert into team_memberships (user_id, team_id, team_name, role, status)
     values ($1, $2, 'Equipo', 'leader', 'active')`,
    [leaderId, teamId]
  )
  await pool.query(
    `insert into team_memberships (user_id, team_id, team_name, role, status)
     values ($1, $2, 'Equipo', 'member', 'active')`,
    [memberId, teamId]
  )
  for (const [devId, userId, nombre] of [[leaderDevice, leaderId, 'leader-pc'], [memberDevice, memberId, 'member-pc']] as const) {
    await pool.query(
      'insert into devices (id, user_id, name, token_hash) values ($1, $2, $3, $4)',
      [devId, userId, nombre, 'hash-' + devId]
    )
  }
})

describe('isTeamLeader', () => {
  it('es true para el leader activo', async () => {
    expect(await isTeamLeader(pool, leaderId, teamId)).toBe(true)
  })
  it('es false para un member', async () => {
    expect(await isTeamLeader(pool, memberId, teamId)).toBe(false)
  })
  it('es false para alguien sin membresía en ese team', async () => {
    expect(await isTeamLeader(pool, outsiderId, teamId)).toBe(false)
  })
})

describe('getTeamKeyState', () => {
  it('rechaza con 403 a quien no es miembro activo del equipo', async () => {
    const res = await getTeamKeyState(pool, { deviceId: 'x', userId: outsiderId }, teamId)
    expect(res).toEqual({ ok: false, status: 403, error: 'not_a_team_member' })
  })

  it('sin activar: activated=false y sin pendingDevices (nadie publicó public_key aún)', async () => {
    const res = await getTeamKeyState(pool, { deviceId: leaderDevice, userId: leaderId }, teamId)
    expect(res).toEqual({ activated: false, wrap: null, pendingDevices: [] })
  })

  it('lista como pendiente a un device de un miembro con public_key pero sin wrap', async () => {
    await pool.query(
      'insert into device_keys (device_id, user_id, public_key) values ($1, $2, $3)',
      [memberDevice, memberId, 'PUB-MEMBER']
    )
    const res = await getTeamKeyState(pool, { deviceId: leaderDevice, userId: leaderId }, teamId)
    expect(res).toEqual({
      activated: false,
      wrap: null,
      pendingDevices: [{ deviceId: memberDevice, name: 'member-pc', publicKey: 'PUB-MEMBER' }],
    })
  })

  it('una vez activado y con wrap propio, lo devuelve y ya no lista ese device como pendiente', async () => {
    await pool.query(
      'insert into device_keys (device_id, user_id, public_key) values ($1, $2, $3)',
      [leaderDevice, leaderId, 'PUB-LEADER']
    )
    await pool.query('insert into team_keys (team_id, activated_by) values ($1, $2)', [teamId, leaderId])
    await pool.query(
      `insert into team_key_wraps (team_id, slot, kind, wrapped) values ($1, $2, 'device', 'W-LEADER')`,
      [teamId, leaderDevice]
    )
    const res = await getTeamKeyState(pool, { deviceId: leaderDevice, userId: leaderId }, teamId)
    expect(res).toEqual({
      activated: true,
      wrap: { wrapped: 'W-LEADER', wrapMeta: null },
      pendingDevices: [],
    })
  })

  it('con ?slot=recovery devuelve la envoltura de recuperación en vez de la del device', async () => {
    await pool.query('insert into team_keys (team_id, activated_by) values ($1, $2)', [teamId, leaderId])
    await pool.query(
      `insert into team_key_wraps (team_id, slot, kind, wrapped, wrap_meta)
       values ($1, 'recovery', 'recovery', 'W-REC', $2::jsonb)`,
      [teamId, JSON.stringify({ salt: 'S' })]
    )
    const res = await getTeamKeyState(pool, { deviceId: leaderDevice, userId: leaderId }, teamId, 'recovery')
    expect(res).toEqual({
      activated: true,
      wrap: { wrapped: 'W-REC', wrapMeta: { salt: 'S' } },
      pendingDevices: [],
    })
  })
})
```

- [ ] **Step 2: Correr el test, confirmar que falla**

Run: `npx vitest run __tests__/team-keys.test.ts` (desde `server/`)
Expected: FAIL — `Cannot find module '../src/team-keys'`

- [ ] **Step 3: Implementar**

```ts
// server/src/team-keys.ts
import type { Pool } from 'pg'

export interface TeamKeysAuth {
  deviceId: string
  userId: string
}

/** Único chequeo de rol que usan activate/authorize/recrypt — nunca inferido del client. */
export async function isTeamLeader(pool: Pool, userId: string, teamId: string): Promise<boolean> {
  const { rows } = await pool.query(
    `select 1 from team_memberships
      where user_id = $1 and team_id = $2 and role = 'leader' and status = 'active'`,
    [userId, teamId]
  )
  return rows.length > 0
}

async function esMiembroActivo(pool: Pool, userId: string, teamId: string): Promise<boolean> {
  const { rows } = await pool.query(
    `select 1 from team_memberships where user_id = $1 and team_id = $2 and status = 'active'`,
    [userId, teamId]
  )
  return rows.length > 0
}

export interface TeamKeyState {
  activated: boolean
  wrap: { wrapped: string; wrapMeta: Record<string, unknown> | null } | null
  pendingDevices: Array<{ deviceId: string; name: string; publicKey: string }>
}

type Fail<S extends number> = { ok: false; status: S; error: string }

/**
 * `pendingDevices` cruza TODOS los miembros activos del equipo (no sólo los devices de QUIEN
 * llama, a diferencia de `getKeyState` personal) — es lo que el leader necesita ver para
 * autorizar a gente, no sólo a sí mismo.
 */
export async function getTeamKeyState(
  pool: Pool,
  auth: TeamKeysAuth,
  teamId: string,
  slot?: string
): Promise<TeamKeyState | Fail<403>> {
  if (!(await esMiembroActivo(pool, auth.userId, teamId))) {
    return { ok: false, status: 403, error: 'not_a_team_member' }
  }

  const { rows: activatedRows } = await pool.query(
    'select 1 from team_keys where team_id = $1', [teamId]
  )
  const activated = activatedRows.length > 0

  const { rows: pendingRows } = await pool.query(
    `select dk.device_id, d.name, dk.public_key
       from team_memberships tm
       join device_keys dk on dk.user_id = tm.user_id
       join devices d on d.id = dk.device_id and d.revoked_at is null
       left join team_key_wraps w on w.team_id = $1 and w.slot = dk.device_id::text
      where tm.team_id = $1 and tm.status = 'active' and w.slot is null
      order by d.created_at, d.id`,
    [teamId]
  )

  const { rows: wrapRows } = await pool.query(
    `select wrapped, wrap_meta from team_key_wraps
      where team_id = $1 and slot = $2`,
    [teamId, slot && slot.trim() !== '' ? slot : auth.deviceId]
  )

  return {
    activated,
    wrap: wrapRows.length > 0
      ? { wrapped: String(wrapRows[0].wrapped), wrapMeta: wrapRows[0].wrap_meta ?? null }
      : null,
    pendingDevices: pendingRows.map((r) => ({
      deviceId: String(r.device_id),
      name: String(r.name),
      publicKey: String(r.public_key),
    })),
  }
}
```

- [ ] **Step 4: Correr el test, confirmar que pasa**

Run: `npx vitest run __tests__/team-keys.test.ts`
Expected: PASS (8 tests)

- [ ] **Step 5: Commit**

```bash
git add server/src/team-keys.ts server/__tests__/team-keys.test.ts
git commit -m "feat(cifrado-equipo): rol de leader y lectura de estado de clave"
```

---

## Task 3: `activateTeamKey` — sólo el leader, una vez

**Files:**
- Modify: `server/src/team-keys.ts`
- Modify: `server/__tests__/team-keys.test.ts`

**Interfaces:**
- Consumes: `isTeamLeader` (Task 2).
- Produces: `export async function activateTeamKey(pool: Pool, auth: TeamKeysAuth, teamId: string, body: { wraps?: unknown }): Promise<{ ok: true } | Fail<400> | Fail<403> | Fail<409>>` — Task 6 (HTTP) y Task 7 (client) lo consumen.

- [ ] **Step 1: Escribir el test que falla**

```ts
// agregar a server/__tests__/team-keys.test.ts
import { activateTeamKey } from '../src/team-keys'

describe('activateTeamKey', () => {
  it('rechaza con 403 a quien no es leader', async () => {
    const res = await activateTeamKey(pool, { deviceId: memberDevice, userId: memberId }, teamId, {
      wraps: [{ slot: memberDevice, kind: 'device', wrapped: 'W' }],
    })
    expect(res).toEqual({ ok: false, status: 403, error: 'leader_required' })
  })

  it('el leader activa: crea team_keys y publica sus envolturas', async () => {
    const res = await activateTeamKey(pool, { deviceId: leaderDevice, userId: leaderId }, teamId, {
      wraps: [
        { slot: leaderDevice, kind: 'device', wrapped: 'W-LEADER' },
        { slot: 'recovery', kind: 'recovery', wrapped: 'W-REC', wrap_meta: { salt: 'S' } },
      ],
    })
    expect(res).toEqual({ ok: true })
    const { rows } = await pool.query('select activated_by from team_keys where team_id = $1', [teamId])
    expect(rows[0].activated_by).toBe(leaderId)
    const wraps = await pool.query(
      'select slot, kind, wrapped from team_key_wraps where team_id = $1 order by slot', [teamId]
    )
    expect(wraps.rows).toHaveLength(2)
  })

  it('rechaza sin wraps', async () => {
    const res = await activateTeamKey(pool, { deviceId: leaderDevice, userId: leaderId }, teamId, { wraps: [] })
    expect(res).toEqual({ ok: false, status: 400, error: 'no_wraps' })
  })

  it('un segundo activate sobre un equipo ya activado devuelve 409, no pisa nada', async () => {
    await activateTeamKey(pool, { deviceId: leaderDevice, userId: leaderId }, teamId, {
      wraps: [{ slot: leaderDevice, kind: 'device', wrapped: 'W-1' }],
    })
    const segundo = await activateTeamKey(pool, { deviceId: leaderDevice, userId: leaderId }, teamId, {
      wraps: [{ slot: leaderDevice, kind: 'device', wrapped: 'W-2' }],
    })
    expect(segundo).toEqual({ ok: false, status: 409, error: 'already_activated' })
    const { rows } = await pool.query(
      'select wrapped from team_key_wraps where team_id = $1 and slot = $2', [teamId, leaderDevice]
    )
    expect(rows[0].wrapped).toBe('W-1')
  })
})
```

- [ ] **Step 2: Correr el test, confirmar que falla**

Run: `npx vitest run __tests__/team-keys.test.ts -t activateTeamKey`
Expected: FAIL — `activateTeamKey is not a function`

- [ ] **Step 3: Implementar**

Agregar a `server/src/team-keys.ts`:

```ts
export interface TeamWrapInput {
  slot: string
  kind: 'device' | 'recovery'
  wrapped: string
  wrap_meta?: Record<string, unknown> | null
}

export async function activateTeamKey(
  pool: Pool,
  auth: TeamKeysAuth,
  teamId: string,
  body: { wraps?: unknown }
): Promise<{ ok: true } | Fail<400> | Fail<403> | Fail<409>> {
  if (!(await isTeamLeader(pool, auth.userId, teamId))) {
    return { ok: false, status: 403, error: 'leader_required' }
  }
  const wraps = Array.isArray(body?.wraps) ? (body.wraps as TeamWrapInput[]) : []
  if (wraps.length === 0) return { ok: false, status: 400, error: 'no_wraps' }
  for (const w of wraps) {
    if (typeof w?.slot !== 'string' || w.slot.trim() === '') return { ok: false, status: 400, error: 'invalid_slot' }
    if (w.kind !== 'device' && w.kind !== 'recovery') return { ok: false, status: 400, error: 'invalid_kind' }
    if (typeof w?.wrapped !== 'string' || w.wrapped.trim() === '') return { ok: false, status: 400, error: 'invalid_wrapped' }
  }

  const client = await pool.connect()
  try {
    await client.query('begin')
    // Serializa dos devices del mismo leader activando casi a la vez (Review Focus): el
    // segundo ve la fila ya insertada por el primero y sale con 409 ANTES de tocar wraps.
    await client.query('select pg_advisory_xact_lock(hashtextextended($1, 0))', [`team-key:${teamId}`])

    const { rows: existing } = await client.query(
      'select 1 from team_keys where team_id = $1 for update', [teamId]
    )
    if (existing.length > 0) {
      await client.query('rollback')
      return { ok: false, status: 409, error: 'already_activated' }
    }

    await client.query(
      'insert into team_keys (team_id, activated_by) values ($1, $2)', [teamId, auth.userId]
    )
    for (const w of wraps) {
      await client.query(
        `insert into team_key_wraps (team_id, slot, kind, wrapped, wrap_meta)
         values ($1, $2, $3, $4, $5)`,
        [teamId, w.slot, w.kind, w.wrapped, w.wrap_meta ?? null]
      )
    }
    await client.query('commit')
    return { ok: true }
  } catch (err) {
    await client.query('rollback').catch(() => {})
    throw err
  } finally {
    client.release()
  }
}
```

- [ ] **Step 4: Correr el test, confirmar que pasa**

Run: `npx vitest run __tests__/team-keys.test.ts`
Expected: PASS (12 tests en total)

- [ ] **Step 5: Commit**

```bash
git add server/src/team-keys.ts server/__tests__/team-keys.test.ts
git commit -m "feat(cifrado-equipo): activateTeamKey, gateado a leader"
```

---

## Task 4: `authorizeTeamDevice` — el leader suma un device pendiente

**Files:**
- Modify: `server/src/team-keys.ts`
- Modify: `server/__tests__/team-keys.test.ts`

**Interfaces:**
- Produces: `export async function authorizeTeamDevice(pool: Pool, auth: TeamKeysAuth, teamId: string, body: { wraps?: unknown }): Promise<{ ok: true } | Fail<400> | Fail<403> | Fail<404>>`

- [ ] **Step 1: Escribir el test que falla**

```ts
// agregar a server/__tests__/team-keys.test.ts
import { authorizeTeamDevice } from '../src/team-keys'

describe('authorizeTeamDevice', () => {
  beforeEach(async () => {
    await pool.query('insert into team_keys (team_id, activated_by) values ($1, $2)', [teamId, leaderId])
    await pool.query(
      `insert into team_key_wraps (team_id, slot, kind, wrapped) values ($1, $2, 'device', 'W-LEADER')`,
      [teamId, leaderDevice]
    )
  })

  it('rechaza con 403 a quien no es leader', async () => {
    const res = await authorizeTeamDevice(pool, { deviceId: memberDevice, userId: memberId }, teamId, {
      wraps: [{ slot: memberDevice, kind: 'device', wrapped: 'W-MEMBER' }],
    })
    expect(res).toEqual({ ok: false, status: 403, error: 'leader_required' })
  })

  it('rechaza con 404 si el equipo no tiene clave activada', async () => {
    const otroTeam = randomUUID()
    await pool.query(
      `insert into team_memberships (user_id, team_id, team_name, role, status)
       values ($1, $2, 'Otro', 'leader', 'active')`,
      [leaderId, otroTeam]
    )
    const res = await authorizeTeamDevice(pool, { deviceId: leaderDevice, userId: leaderId }, otroTeam, {
      wraps: [{ slot: memberDevice, kind: 'device', wrapped: 'W' }],
    })
    expect(res).toEqual({ ok: false, status: 404, error: 'not_activated' })
  })

  it('el leader autoriza al member: la wrap queda publicada', async () => {
    const res = await authorizeTeamDevice(pool, { deviceId: leaderDevice, userId: leaderId }, teamId, {
      wraps: [{ slot: memberDevice, kind: 'device', wrapped: 'W-MEMBER' }],
    })
    expect(res).toEqual({ ok: true })
    const { rows } = await pool.query(
      'select wrapped from team_key_wraps where team_id = $1 and slot = $2', [teamId, memberDevice]
    )
    expect(rows[0].wrapped).toBe('W-MEMBER')
  })

  it('nunca permite tocar el slot recovery desde authorize', async () => {
    const res = await authorizeTeamDevice(pool, { deviceId: leaderDevice, userId: leaderId }, teamId, {
      wraps: [{ slot: 'recovery', kind: 'recovery', wrapped: 'W-NUEVO' }],
    })
    expect(res).toEqual({ ok: false, status: 400, error: 'cannot_overwrite_recovery' })
  })
})
```

- [ ] **Step 2: Correr el test, confirmar que falla**

Run: `npx vitest run __tests__/team-keys.test.ts -t authorizeTeamDevice`
Expected: FAIL — `authorizeTeamDevice is not a function`

- [ ] **Step 3: Implementar**

Agregar a `server/src/team-keys.ts`:

```ts
export async function authorizeTeamDevice(
  pool: Pool,
  auth: TeamKeysAuth,
  teamId: string,
  body: { wraps?: unknown }
): Promise<{ ok: true } | Fail<400> | Fail<403> | Fail<404>> {
  if (!(await isTeamLeader(pool, auth.userId, teamId))) {
    return { ok: false, status: 403, error: 'leader_required' }
  }
  const { rows: activatedRows } = await pool.query('select 1 from team_keys where team_id = $1', [teamId])
  if (activatedRows.length === 0) return { ok: false, status: 404, error: 'not_activated' }

  const wraps = Array.isArray(body?.wraps) ? (body.wraps as TeamWrapInput[]) : []
  if (wraps.length === 0) return { ok: false, status: 400, error: 'no_wraps' }
  // El slot de recuperación sólo se escribe al activar: pisarlo acá invalidaría el código que
  // el leader ya tiene anotado, sin que nadie se lo pidiera (spec §6).
  if (wraps.some((w) => w.slot === 'recovery' || w.kind === 'recovery')) {
    return { ok: false, status: 400, error: 'cannot_overwrite_recovery' }
  }
  for (const w of wraps) {
    if (typeof w?.slot !== 'string' || w.slot.trim() === '') return { ok: false, status: 400, error: 'invalid_slot' }
    if (w.kind !== 'device') return { ok: false, status: 400, error: 'invalid_kind' }
    if (typeof w?.wrapped !== 'string' || w.wrapped.trim() === '') return { ok: false, status: 400, error: 'invalid_wrapped' }
  }

  const client = await pool.connect()
  try {
    await client.query('begin')
    for (const w of wraps) {
      await client.query(
        `insert into team_key_wraps (team_id, slot, kind, wrapped, wrap_meta)
         values ($1, $2, 'device', $3, $4)
         on conflict (team_id, slot) do update set wrapped = excluded.wrapped, wrap_meta = excluded.wrap_meta`,
        [teamId, w.slot, w.wrapped, w.wrap_meta ?? null]
      )
    }
    await client.query('commit')
    return { ok: true }
  } catch (err) {
    await client.query('rollback').catch(() => {})
    throw err
  } finally {
    client.release()
  }
}
```

- [ ] **Step 4: Correr el test, confirmar que pasa**

Run: `npx vitest run __tests__/team-keys.test.ts`
Expected: PASS (16 tests en total)

- [ ] **Step 5: Commit**

```bash
git add server/src/team-keys.ts server/__tests__/team-keys.test.ts
git commit -m "feat(cifrado-equipo): authorizeTeamDevice, gateado a leader"
```

---

## Task 5: `recryptTeamObservations` — la migración retroactiva, con tests adversariales

**Files:**
- Create: `server/src/team-keys-recrypt.ts`
- Test: `server/__tests__/team-keys-recrypt.test.ts`

**Interfaces:**
- Consumes: `isTeamLeader` de `./team-keys`, `allocateSeqRange` de `./seq`.
- Produces: `export async function recryptTeamObservations(pool: Pool, auth: TeamKeysAuth, teamId: string, body: { items?: unknown }): Promise<{ ok: true; applied: string[]; rejected: Array<{ sync_id: string; error: string }> } | Fail<400> | Fail<403>>`

Archivo separado de `team-keys.ts` a propósito — es la pieza marcada como riesgo #2 del spec
(la única vía donde alguien reescribe contenido ajeno) y conviene que tenga su propio archivo
chico y su propia suite, fácil de auditar entera de una vez.

- [ ] **Step 1: Escribir el test que falla — incluye los 3 casos adversariales del Review Focus**

```ts
// server/__tests__/team-keys-recrypt.test.ts
import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import { randomUUID } from 'node:crypto'
import { getPool, migrate } from '../src/db'
import { recryptTeamObservations } from '../src/team-keys-recrypt'

const pool = getPool()
let teamId: string, otroTeamId: string
let leaderId: string, memberId: string
let leaderDevice: string, memberDevice: string
let projectLeader: number, projectMember: number, projectOtroEquipo: number

beforeAll(async () => { await migrate(pool) })

beforeEach(async () => {
  teamId = randomUUID()
  otroTeamId = randomUUID()
  leaderId = randomUUID()
  memberId = randomUUID()
  leaderDevice = randomUUID()
  memberDevice = randomUUID()
  for (const id of [leaderId, memberId]) await pool.query('insert into users (id) values ($1)', [id])
  await pool.query(
    `insert into team_memberships (user_id, team_id, team_name, role, status)
     values ($1, $2, 'Equipo', 'leader', 'active'), ($3, $2, 'Equipo', 'member', 'active')`,
    [leaderId, teamId, memberId]
  )
  for (const [devId, userId] of [[leaderDevice, leaderId], [memberDevice, memberId]] as const) {
    await pool.query('insert into devices (id, user_id, name, token_hash) values ($1, $2, $3, $4)',
      [devId, userId, 'pc', 'hash-' + devId])
  }

  const proj = async (userId: string, key: string, teamFila: string | null) => {
    const { rows } = await pool.query(
      `insert into projects (user_id, project_key, display_name, team_id)
       values ($1, $2, 'p', $3) returning id`,
      [userId, key, teamFila]
    )
    return Number(rows[0].id)
  }
  projectLeader = await proj(leaderId, 'repo-x', teamId)
  projectMember = await proj(memberId, 'repo-x', teamId)
  projectOtroEquipo = await proj(leaderId, 'repo-y', otroTeamId)
})

function obs(syncId: string, projectId: number, scope: string, author: string) {
  return pool.query(
    `insert into observations
       (sync_id, project_id, project_seq, scope, type, title, content, author_id, lamport,
        client_updated_at, client_created_at, deleted)
     values ($1, $2, 1, $3, 'decision', 'en claro', 'contenido en claro', $4, 1, now(), now(), false)`,
    [syncId, projectId, scope, author]
  )
}

describe('recryptTeamObservations', () => {
  it('rechaza con 403 a quien no es leader', async () => {
    const res = await recryptTeamObservations(pool, { deviceId: memberDevice, userId: memberId }, teamId, {
      items: [],
    })
    expect(res).toEqual({ ok: false, status: 403, error: 'leader_required' })
  })

  it('re-cifra una fila de equipo del propio proyecto del leader', async () => {
    const syncId = randomUUID()
    await obs(syncId, projectLeader, 'team', leaderId)
    // El seq ORIGINAL, antes de recrypt — el fixture de `obs()` lo hardcodea en 1, que es
    // ADEMÁS lo que `allocateSeqRange` devolvería para un project_id recién creado (su
    // `seq_counter` arranca en 0 por default). Comparar contra un número fijo coincidía por
    // casualidad; comparar contra el valor capturado ANTES es lo único que prueba el bump
    // de verdad, sin importar de qué `seq_counter` parta el proyecto.
    const antes = (await pool.query('select project_seq from observations where sync_id = $1', [syncId])).rows[0].project_seq
    const res = await recryptTeamObservations(pool, { deviceId: leaderDevice, userId: leaderId }, teamId, {
      items: [{ sync_id: syncId, title: 'nmc1:xxx', content: 'nmc1:yyy', tags: [] }],
    })
    expect(res.ok).toBe(true)
    if (res.ok) {
      expect(res.applied).toEqual([syncId])
      expect(res.rejected).toEqual([])
    }
    const { rows } = await pool.query('select title, content, project_seq from observations where sync_id = $1', [syncId])
    expect(rows[0].title).toBe('nmc1:xxx')
    expect(rows[0].content).toBe('nmc1:yyy')
    expect(Number(rows[0].project_seq)).toBeGreaterThan(Number(antes)) // bump: el pull lo tiene que ver de nuevo
  })

  it('re-cifra una fila de equipo subida por OTRO autor (el member), es el punto central de este task', async () => {
    const syncId = randomUUID()
    await obs(syncId, projectMember, 'team', memberId)
    const res = await recryptTeamObservations(pool, { deviceId: leaderDevice, userId: leaderId }, teamId, {
      items: [{ sync_id: syncId, title: 'nmc1:a', content: 'nmc1:b', tags: [] }],
    })
    expect(res.ok && res.applied).toEqual([syncId])
    const { rows } = await pool.query('select title, author_id from observations where sync_id = $1', [syncId])
    expect(rows[0].title).toBe('nmc1:a')
    expect(rows[0].author_id).toBe(memberId) // la autoría NUNCA cambia
  })

  it('REVIEW FOCUS: rechaza un sync_id de OTRO equipo, sin tocarlo', async () => {
    const syncId = randomUUID()
    await obs(syncId, projectOtroEquipo, 'team', leaderId)
    const res = await recryptTeamObservations(pool, { deviceId: leaderDevice, userId: leaderId }, teamId, {
      items: [{ sync_id: syncId, title: 'nmc1:HACKEADO', content: 'nmc1:x', tags: [] }],
    })
    expect(res.ok && res.rejected).toEqual([{ sync_id: syncId, error: 'not_found_in_team' }])
    const { rows } = await pool.query('select title from observations where sync_id = $1', [syncId])
    expect(rows[0].title).toBe('en claro')
  })

  it('REVIEW FOCUS: rechaza un sync_id de scope personal del propio proyecto, sin tocarlo', async () => {
    const syncId = randomUUID()
    await obs(syncId, projectLeader, 'personal', leaderId)
    const res = await recryptTeamObservations(pool, { deviceId: leaderDevice, userId: leaderId }, teamId, {
      items: [{ sync_id: syncId, title: 'nmc1:HACKEADO', content: 'nmc1:x', tags: [] }],
    })
    expect(res.ok && res.rejected).toEqual([{ sync_id: syncId, error: 'not_found_in_team' }])
    const { rows } = await pool.query('select title from observations where sync_id = $1', [syncId])
    expect(rows[0].title).toBe('en claro')
  })

  it('un sync_id inexistente se rechaza individualmente, no aborta el lote', async () => {
    const syncIdReal = randomUUID()
    await obs(syncIdReal, projectLeader, 'team', leaderId)
    const res = await recryptTeamObservations(pool, { deviceId: leaderDevice, userId: leaderId }, teamId, {
      items: [
        { sync_id: 'no-existe', title: 'nmc1:x', content: 'nmc1:y', tags: [] },
        { sync_id: syncIdReal, title: 'nmc1:a', content: 'nmc1:b', tags: [] },
      ],
    })
    expect(res.ok && res.applied).toEqual([syncIdReal])
    expect(res.ok && res.rejected).toEqual([{ sync_id: 'no-existe', error: 'not_found_in_team' }])
  })

  it('nunca toca scope, type ni author_id de la fila', async () => {
    const syncId = randomUUID()
    await obs(syncId, projectLeader, 'team', leaderId)
    await recryptTeamObservations(pool, { deviceId: leaderDevice, userId: leaderId }, teamId, {
      items: [{ sync_id: syncId, title: 'nmc1:x', content: 'nmc1:y', tags: [] }],
    })
    const { rows } = await pool.query('select scope, type, author_id from observations where sync_id = $1', [syncId])
    expect(rows[0]).toEqual({ scope: 'team', type: 'decision', author_id: leaderId })
  })
})
```

- [ ] **Step 2: Correr el test, confirmar que falla**

Run: `npx vitest run __tests__/team-keys-recrypt.test.ts`
Expected: FAIL — `Cannot find module '../src/team-keys-recrypt'`

- [ ] **Step 3: Implementar**

```ts
// server/src/team-keys-recrypt.ts
//
// La única vía del sistema donde alguien reescribe contenido de una fila que no autoró — el
// push normal es por autor (`server/src/push.ts` guarda `where observations.author_id =
// excluded.author_id`, a propósito: evita una escritura cross-tenant). Esto existe SÓLO para
// la migración retroactiva del leader al activar el cifrado de equipo (spec §4), y se acota
// lo más posible: archivo propio, nunca toca `scope`/`type`/`author_id`, y cada fila se
// valida CONTRA LA BASE (project.team_id + scope) antes de tocarla — nunca confía en lo que
// mande el batch.
import type { Pool } from 'pg'
import { isTeamLeader, type TeamKeysAuth } from './team-keys'
import { allocateSeqRange } from './seq'

type Fail<S extends number> = { ok: false; status: S; error: string }

export interface RecryptItem {
  sync_id: string
  title: string
  content: string
  tags: unknown
}

export async function recryptTeamObservations(
  pool: Pool,
  auth: TeamKeysAuth,
  teamId: string,
  body: { items?: unknown }
): Promise<{ ok: true; applied: string[]; rejected: Array<{ sync_id: string; error: string }> } | Fail<400> | Fail<403>> {
  if (!(await isTeamLeader(pool, auth.userId, teamId))) {
    return { ok: false, status: 403, error: 'leader_required' }
  }
  const items = Array.isArray(body?.items) ? (body.items as RecryptItem[]) : []
  if (items.length === 0) return { ok: false, status: 400, error: 'no_items' }
  for (const it of items) {
    if (typeof it?.sync_id !== 'string' || it.sync_id.trim() === '') {
      return { ok: false, status: 400, error: 'invalid_sync_id' }
    }
    if (typeof it?.title !== 'string' || typeof it?.content !== 'string') {
      return { ok: false, status: 400, error: 'invalid_fields' }
    }
  }

  const applied: string[] = []
  const rejected: Array<{ sync_id: string; error: string }> = []

  // Una transacción corta POR FILA, no una grande para todo el lote: una fila rechazada no
  // tiene que poder abortar las que ya aplicaron, y el lock de cada project_seq dura lo
  // mínimo (mismo criterio que push.ts usa por mutación).
  for (const it of items) {
    const client = await pool.connect()
    try {
      await client.query('begin')
      // El chequeo central: la fila tiene que existir, pertenecer a UN proyecto cuyo team_id
      // sea EXACTAMENTE este equipo, y tener scope='team'. Cualquier otra cosa —otro equipo,
      // scope personal, sync_id inventado— no matchea ninguna fila y cae al rowCount === 0
      // de abajo. `for update` toma el lock de la fila antes del allocateSeqRange.
      const { rows } = await client.query(
        `select o.project_id from observations o
           join projects p on p.id = o.project_id
          where o.sync_id = $1 and p.team_id = $2 and o.scope = 'team'
          for update of o`,
        [it.sync_id, teamId]
      )
      if (rows.length === 0) {
        await client.query('rollback')
        rejected.push({ sync_id: it.sync_id, error: 'not_found_in_team' })
        continue
      }
      const projectId = Number(rows[0].project_id)
      const nuevoSeq = await allocateSeqRange(client, projectId, 1)
      await client.query(
        `update observations set title = $1, content = $2, tags = $3::jsonb, project_seq = $4
          where sync_id = $5`,
        [it.title, it.content, JSON.stringify(it.tags ?? []), nuevoSeq, it.sync_id]
      )
      await client.query('commit')
      applied.push(it.sync_id)
    } catch (err) {
      await client.query('rollback').catch(() => {})
      throw err
    } finally {
      client.release()
    }
  }

  return { ok: true, applied, rejected }
}
```

- [ ] **Step 4: Correr el test, confirmar que pasa**

Run: `npx vitest run __tests__/team-keys-recrypt.test.ts`
Expected: PASS (7 tests)

- [ ] **Step 5: Commit**

```bash
git add server/src/team-keys-recrypt.ts server/__tests__/team-keys-recrypt.test.ts
git commit -m "feat(cifrado-equipo): recryptTeamObservations con los 3 adversariales del Review Focus"
```

---

## Task 6: Rutas HTTP — `/v1/teams/key*`

**Files:**
- Modify: `server/src/http.ts`
- Test: `server/__tests__/team-keys-http.test.ts`

**Interfaces:**
- Consumes: `getTeamKeyState`, `activateTeamKey`, `authorizeTeamDevice` (Task 2-4), `recryptTeamObservations` (Task 5), `authenticate` (ya existe, `server/src/auth.ts`).
- Produces: rutas `GET /v1/teams/key`, `POST /v1/teams/key/activate`, `POST /v1/teams/key/authorize`, `POST /v1/teams/key/recrypt` — mismo estilo de ruteo plano que ya usan `/v1/keys*` (sin segmentos dinámicos; `team_id` va por query string en el GET y por body en los POST).

- [ ] **Step 1: Escribir el test que falla**

```ts
// server/__tests__/team-keys-http.test.ts
// Mismo patrón que server/__tests__/http.test.ts: arranca el server real en un puerto
// efímero y le pega con fetch, para probar el ruteo + la autenticación, no sólo las
// funciones sueltas (esas ya las prueba team-keys.test.ts).
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { randomUUID, createHash } from 'node:crypto'
import { createServer } from 'node:http'
import { getPool, migrate } from '../src/db'
import { startHttpServer } from '../src/http' // ajustar al export real que arranca el listener

const pool = getPool()
let baseUrl: string
let server: ReturnType<typeof createServer>
let teamId: string, leaderId: string, memberId: string
let leaderToken: string, memberToken: string
let leaderDeviceId: string, memberDeviceId: string

beforeAll(async () => {
  await migrate(pool)
  const started = await startHttpServer(pool, 0)
  server = started.server
  baseUrl = `http://127.0.0.1:${started.port}`
})
afterAll(() => server.close())

async function registrarDevice(userId: string, plan = 'team'): Promise<{ deviceId: string; token: string }> {
  const deviceId = randomUUID()
  const token = `nmk_${randomUUID()}`
  await pool.query('insert into users (id, plan) values ($1, $2) on conflict (id) do update set plan = excluded.plan', [userId, plan])
  await pool.query('insert into allowlist (user_id) values ($1) on conflict do nothing', [userId])
  await pool.query('insert into devices (id, user_id, name, token_hash) values ($1, $2, $3, $4)',
    [deviceId, userId, 'pc', createHash('sha256').update(token).digest('hex')])
  return { deviceId, token }
}

beforeEach(async () => {
  teamId = randomUUID(); leaderId = randomUUID(); memberId = randomUUID()
  const l = await registrarDevice(leaderId); leaderDeviceId = l.deviceId; leaderToken = l.token
  const m = await registrarDevice(memberId); memberDeviceId = m.deviceId; memberToken = m.token
  await pool.query(
    `insert into team_memberships (user_id, team_id, team_name, role, status)
     values ($1, $2, 'Equipo', 'leader', 'active'), ($3, $2, 'Equipo', 'member', 'active')`,
    [leaderId, teamId, memberId]
  )
})

describe('/v1/teams/key*', () => {
  it('GET sin token da 401', async () => {
    const res = await fetch(`${baseUrl}/v1/teams/key?team_id=${teamId}`)
    expect(res.status).toBe(401)
  })

  it('GET con token válido devuelve el estado', async () => {
    const res = await fetch(`${baseUrl}/v1/teams/key?team_id=${teamId}`, {
      headers: { Authorization: `Bearer ${leaderToken}` },
    })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ activated: false, wrap: null, pendingDevices: [] })
  })

  it('POST activate con un member da 403', async () => {
    const res = await fetch(`${baseUrl}/v1/teams/key/activate`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${memberToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ team_id: teamId, wraps: [{ slot: memberDeviceId, kind: 'device', wrapped: 'W' }] }),
    })
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ error: 'leader_required' })
  })

  it('POST activate con el leader activa, y después authorize suma al member', async () => {
    const act = await fetch(`${baseUrl}/v1/teams/key/activate`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${leaderToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ team_id: teamId, wraps: [{ slot: leaderDeviceId, kind: 'device', wrapped: 'W-L' }] }),
    })
    expect(act.status).toBe(200)

    const auth = await fetch(`${baseUrl}/v1/teams/key/authorize`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${leaderToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ team_id: teamId, wraps: [{ slot: memberDeviceId, kind: 'device', wrapped: 'W-M' }] }),
    })
    expect(auth.status).toBe(200)

    const estado = await fetch(`${baseUrl}/v1/teams/key?team_id=${teamId}`, {
      headers: { Authorization: `Bearer ${memberToken}` },
    })
    const json = (await estado.json()) as { wrap: { wrapped: string } | null }
    expect(json.wrap?.wrapped).toBe('W-M')
  })

  it('GET sin team_id da 400', async () => {
    const res = await fetch(`${baseUrl}/v1/teams/key`, { headers: { Authorization: `Bearer ${leaderToken}` } })
    expect(res.status).toBe(400)
  })
})
```

**Nota para quien implemente este task**: revisar `server/src/http.ts:200-230` para ver el
nombre real del helper que arranca el servidor (`startHttpServer` de arriba es el nombre
propuesto; si el archivo expone algo distinto — p. ej. sólo `createServer(pool)` sin abrir
puerto — ajustar el test a lo que `server/__tests__/http.test.ts` ya use, que prueba el mismo
servidor para las otras rutas).

- [ ] **Step 2: Correr el test, confirmar que falla**

Run: `npx vitest run __tests__/team-keys-http.test.ts`
Expected: FAIL — 404 en vez de los status esperados (la ruta no existe todavía)

- [ ] **Step 3: Implementar — agregar a `server/src/http.ts`**

Importar arriba del archivo, junto a los demás imports de `./keys`:

```ts
import { getTeamKeyState, activateTeamKey, authorizeTeamDevice } from './team-keys'
import { recryptTeamObservations } from './team-keys-recrypt'
```

Sumar las tres banderas de ruta junto a `isKeysEnroll`/`isKeysGet`/`isKeysPublish` (línea ~221):

```ts
const isTeamKeyGet = path === '/v1/teams/key'
const isTeamKeyActivate = path === '/v1/teams/key/activate'
const isTeamKeyAuthorize = path === '/v1/teams/key/authorize'
const isTeamKeyRecrypt = path === '/v1/teams/key/recrypt'
```

Sumarlas al `if` de 404 (línea ~225-227) y al de rate-limit (línea ~236, reusar `keysLimiter`):

```ts
if (!isPush && !isPull && !isStatus && !isDelete && !isShare
    && !isKeysEnroll && !isKeysGet && !isKeysPublish
    && !isTeamKeyGet && !isTeamKeyActivate && !isTeamKeyAuthorize && !isTeamKeyRecrypt) {
  return send(res, 404, { error: 'not_found' })
}
```

```ts
if (isPush || isPull || isKeysEnroll || isKeysGet || isKeysPublish
    || isTeamKeyGet || isTeamKeyActivate || isTeamKeyAuthorize || isTeamKeyRecrypt) {
  const limiter = isPush ? pushLimiter : isPull ? pullLimiter : keysLimiter
  // ...
}
```

Y los cuatro handlers, junto a los de `/v1/keys*` (después de la línea ~277):

```ts
if (isTeamKeyGet) {
  if (req.method !== 'GET') return send(res, 405, { error: 'method_not_allowed' })
  const teamId = url.searchParams.get('team_id') ?? ''
  if (!teamId) return send(res, 400, { error: 'missing_team_id' })
  const result = await getTeamKeyState(pool, auth, teamId, url.searchParams.get('slot') ?? undefined)
  if ('ok' in result) return send(res, result.status, { error: result.error })
  return send(res, 200, result)
}
if (isTeamKeyActivate) {
  if (req.method !== 'POST') return send(res, 405, { error: 'method_not_allowed' })
  const body = (await readBody(req)) as Record<string, unknown>
  const teamId = typeof body.team_id === 'string' ? body.team_id : ''
  if (!teamId) return send(res, 400, { error: 'missing_team_id' })
  const result = await activateTeamKey(pool, auth, teamId, body)
  if (!result.ok) return send(res, result.status, { error: result.error })
  return send(res, 200, { ok: true })
}
if (isTeamKeyAuthorize) {
  if (req.method !== 'POST') return send(res, 405, { error: 'method_not_allowed' })
  const body = (await readBody(req)) as Record<string, unknown>
  const teamId = typeof body.team_id === 'string' ? body.team_id : ''
  if (!teamId) return send(res, 400, { error: 'missing_team_id' })
  const result = await authorizeTeamDevice(pool, auth, teamId, body)
  if (!result.ok) return send(res, result.status, { error: result.error })
  return send(res, 200, { ok: true })
}
if (isTeamKeyRecrypt) {
  if (req.method !== 'POST') return send(res, 405, { error: 'method_not_allowed' })
  const body = (await readBody(req)) as Record<string, unknown>
  const teamId = typeof body.team_id === 'string' ? body.team_id : ''
  if (!teamId) return send(res, 400, { error: 'missing_team_id' })
  const result = await recryptTeamObservations(pool, auth, teamId, body)
  if (!result.ok) return send(res, result.status, { error: result.error })
  return send(res, 200, result)
}
```

**Nota**: adaptar los nombres exactos (`send`, `readBody`, `url`, `auth`) a como ya aparecen en
ese mismo archivo unas líneas arriba (Task leída en este plan a partir de `http.ts:200-290`,
confirmar que no cambiaron de nombre).

- [ ] **Step 4: Correr el test, confirmar que pasa**

Run: `npx vitest run __tests__/team-keys-http.test.ts`
Expected: PASS (5 tests — el bloque de arriba sólo escribe 5 `it(...)`, no 6;
corregido tras la review de ejecución del 2026-10-14. La cobertura de
`/v1/teams/key/recrypt` que falta acá se cierra en el fix round de Task 6,
no en este borrador.)

- [ ] **Step 5: Correr TODA la suite del servidor antes de seguir**

Run: `npx vitest run` (desde `server/`)
Expected: PASS — nada de lo existente se rompió (confirma que el `if` de 404 y el rate-limit no dejaron afuera ninguna ruta vieja)

- [ ] **Step 6: Commit**

```bash
git add server/src/http.ts server/__tests__/team-keys-http.test.ts
git commit -m "feat(cifrado-equipo): rutas HTTP /v1/teams/key*"
```

---

## Task 7: `electron/memory-team-keys-client.ts` — activar/adoptar/autorizar, puro

**Files:**
- Create: `electron/memory-team-keys-client.ts`
- Test: `electron/__tests__/memory-team-keys-client.test.ts`

**Interfaces:**
- Consumes: `generateMasterKey` (`./memory-crypto`), `wrapForDevice`, `unwrapWithDevice`, `type DeviceKeyPair` (`./memory-key-wrap`).
- Produces:
  - `export interface TeamKeysClientDeps { baseUrl: string; token: string; deviceId: string; fetchImpl?: typeof fetch }`
  - `export async function fetchTeamKeyState(deps, teamId: string, slot?: string): Promise<{ activated: boolean; wrap: {...} | null; pendingDevices: [...] }>`
  - `export async function activateTeamEncryption(deps, teamId: string, device: DeviceKeyPair): Promise<{ master: string; recoveryCode: string }>`
  - `export async function adoptExistingTeamKey(deps, teamId: string, device: DeviceKeyPair): Promise<{ master: string } | null>`
  - `export async function authorizeTeamDeviceFromClient(deps, teamId: string, master: string, target: { deviceId: string; publicKey: string }): Promise<void>`

Modelado 1:1 sobre `electron/memory-keys-client.ts` (líneas 1-150), sin `key_epoch` (v1 no
rota) — es la única diferencia estructural con el original.

- [ ] **Step 1: Escribir el test que falla**

```ts
// electron/__tests__/memory-team-keys-client.test.ts
// Mismo patrón que memory-keys-client.test.ts: un servidor de mentira en memoria, sin red
// real y sin Electron.
import { describe, it, expect, vi } from 'vitest'
import { generateDeviceKeyPair, wrapForDevice, unwrapWithDevice } from '../memory-key-wrap'
import {
  fetchTeamKeyState, activateTeamEncryption, adoptExistingTeamKey, authorizeTeamDeviceFromClient,
} from '../memory-team-keys-client'

interface FilaDb { wrapped: string; kind: string }

function servidorFalso() {
  const db = new Map<string, FilaDb>() // key = `${teamId}:${slot}`
  const publicKeys = new Map<string, string>() // deviceId -> publicKey
  // El cast final (`as unknown as typeof fetch`) es el mismo patrón YA probado en
  // `electron/__tests__/memory-keys-client.test.ts:19-79` — sin él, `tsc -p
  // tsconfig.node.json` (el chequeo real de CI, ver CLAUDE.md) falla: el tipo real de
  // `typeof fetch` acepta `URL | RequestInfo` en el primer parámetro, más ancho que el
  // `string` que esta función de mentira declara, y TypeScript no permite esa asignación
  // sin el cast. Mismo motivo para castear `init.headers` antes de indexarlo.
  const fetchImpl = (vi.fn(async (url: string, init: RequestInit) => {
    const u = new URL(url)
    const body = init.body ? JSON.parse(String(init.body)) : {}
    if (u.pathname === '/v1/teams/key' && (!init.method || init.method === 'GET')) {
      const teamId = u.searchParams.get('team_id')!
      const slot = u.searchParams.get('slot')
      const activated = [...db.keys()].some((k) => k.startsWith(`${teamId}:`))
      const deviceId = String((init as { headers?: Record<string, string> })?.headers?.['X-Device-Test'] ?? '')
      const fila = db.get(`${teamId}:${slot ?? deviceId}`)
      return new Response(JSON.stringify({
        activated, wrap: fila ? { wrapped: fila.wrapped, wrapMeta: null } : null, pendingDevices: [],
      }), { status: 200 })
    }
    if (u.pathname === '/v1/teams/key/activate') {
      if ([...db.keys()].some((k) => k.startsWith(`${body.team_id}:`))) {
        return new Response(JSON.stringify({ error: 'already_activated' }), { status: 409 })
      }
      for (const w of body.wraps) db.set(`${body.team_id}:${w.slot}`, { wrapped: w.wrapped, kind: w.kind })
      return new Response(JSON.stringify({ ok: true }), { status: 200 })
    }
    if (u.pathname === '/v1/teams/key/authorize') {
      for (const w of body.wraps) db.set(`${body.team_id}:${w.slot}`, { wrapped: w.wrapped, kind: w.kind })
      return new Response(JSON.stringify({ ok: true }), { status: 200 })
    }
    throw new Error(`ruta no mockeada: ${u.pathname}`)
  })) as unknown as typeof fetch
  return { fetchImpl, publicKeys }
}

describe('memory-team-keys-client', () => {
  it('activa, y el mismo leader lee su propia wrap después', async () => {
    const { fetchImpl } = servidorFalso()
    const device = generateDeviceKeyPair()
    const deps = { baseUrl: 'http://x', token: 't', deviceId: 'dev-leader', fetchImpl }
    const { master, recoveryCode } = await activateTeamEncryption(deps, 'team-1', device)
    expect(master).toBeTruthy()
    expect(recoveryCode).toMatch(/^[0-9A-Z-]+$/)

    const estado = await fetchTeamKeyState(deps, 'team-1')
    expect(estado.activated).toBe(true)
    expect(unwrapWithDevice(device.privateKey, estado.wrap!.wrapped).toString('base64')).toBe(master)
  })

  it('adoptExistingTeamKey da null si el equipo todavía no se activó', async () => {
    const { fetchImpl } = servidorFalso()
    const device = generateDeviceKeyPair()
    const deps = { baseUrl: 'http://x', token: 't', deviceId: 'dev-member', fetchImpl }
    expect(await adoptExistingTeamKey(deps, 'team-1', device)).toBeNull()
  })

  it('el leader autoriza al member y éste adopta la MISMA maestra', async () => {
    const { fetchImpl } = servidorFalso()
    const deviceLeader = generateDeviceKeyPair()
    const deviceMember = generateDeviceKeyPair()
    const depsLeader = { baseUrl: 'http://x', token: 't', deviceId: 'dev-leader', fetchImpl }
    const depsMember = { baseUrl: 'http://x', token: 't', deviceId: 'dev-member', fetchImpl }

    const { master } = await activateTeamEncryption(depsLeader, 'team-1', deviceLeader)
    await authorizeTeamDeviceFromClient(depsLeader, 'team-1', master, {
      deviceId: 'dev-member', publicKey: deviceMember.publicKey,
    })
    const adoptado = await adoptExistingTeamKey(depsMember, 'team-1', deviceMember)
    expect(adoptado?.master).toBe(master)
  })
})
```

- [ ] **Step 2: Correr el test, confirmar que falla**

Run: `npx vitest run electron/__tests__/memory-team-keys-client.test.ts`
Expected: FAIL — `Cannot find module '../memory-team-keys-client'`

- [ ] **Step 3: Implementar**

```ts
// electron/memory-team-keys-client.ts
// Las tres cosas que hace el leader de un equipo con su clave, contra `/v1/teams/key*`
// (server/src/team-keys.ts): activar, autorizar a otro device, y lo que hace cualquier
// miembro — adoptar la envoltura que el leader ya le dejó publicada.
//
// Mismo patrón que memory-keys-client.ts, sin épocas (spec §2/§8: v1 no rota la clave de
// equipo), así que no hay `key_epoch` ni `rotate_verifier`/`rotate_proof` en ningún lado.
import { generateMasterKey } from './memory-crypto'
import {
  wrapForDevice, unwrapWithDevice, wrapForRecovery, generateRecoveryCode, type DeviceKeyPair,
} from './memory-key-wrap'

export interface TeamKeysClientDeps {
  baseUrl: string
  token: string
  deviceId: string
  fetchImpl?: typeof fetch
}

export interface RemoteTeamKeyState {
  activated: boolean
  wrap: { wrapped: string; wrapMeta: Record<string, unknown> | null } | null
  pendingDevices: Array<{ deviceId: string; name: string; publicKey: string }>
}

export class TeamKeysHttpError extends Error {
  readonly status: number
  constructor(status: number, message: string) {
    super(message)
    this.name = 'TeamKeysHttpError'
    this.status = status
  }
}

async function pedir(
  deps: TeamKeysClientDeps,
  path: string,
  init: { method: 'GET' | 'POST'; body?: unknown }
): Promise<unknown> {
  const f = deps.fetchImpl ?? fetch
  const response = await f(`${deps.baseUrl}${path}`, {
    method: init.method,
    headers: {
      Authorization: `Bearer ${deps.token}`,
      'Content-Type': 'application/json',
      'X-Device-Test': deps.deviceId,
    },
    ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
  })
  const json = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw new TeamKeysHttpError(response.status, String((json as { error?: string }).error ?? response.status))
  }
  return json
}

export async function fetchTeamKeyState(
  deps: TeamKeysClientDeps,
  teamId: string,
  slot?: string
): Promise<RemoteTeamKeyState> {
  const qs = slot ? `&slot=${encodeURIComponent(slot)}` : ''
  const json = (await pedir(deps, `/v1/teams/key?team_id=${encodeURIComponent(teamId)}${qs}`, { method: 'GET' })) as Partial<RemoteTeamKeyState>
  return {
    activated: Boolean(json.activated),
    wrap: json.wrap ?? null,
    pendingDevices: Array.isArray(json.pendingDevices) ? json.pendingDevices : [],
  }
}

/** Sólo el `leader` puede llamar a esto (el servidor lo re-verifica igual: spec §9.2). */
export async function activateTeamEncryption(
  deps: TeamKeysClientDeps,
  teamId: string,
  device: DeviceKeyPair
): Promise<{ master: string; recoveryCode: string }> {
  const master = generateMasterKey()
  const recoveryCode = generateRecoveryCode()
  const recovery = wrapForRecovery(recoveryCode, master)
  await pedir(deps, '/v1/teams/key/activate', {
    method: 'POST',
    body: {
      team_id: teamId,
      wraps: [
        { slot: deps.deviceId, kind: 'device', wrapped: wrapForDevice(device.publicKey, master) },
        { slot: 'recovery', kind: 'recovery', wrapped: recovery.wrapped, wrap_meta: { salt: recovery.salt } },
      ],
    },
  })
  return { master: master.toString('base64'), recoveryCode }
}

/** `null` es la respuesta normal mientras el equipo no tiene clave, o esta máquina espera
 * que el leader la autorice — no lanza en ninguno de los dos casos. */
export async function adoptExistingTeamKey(
  deps: TeamKeysClientDeps,
  teamId: string,
  device: DeviceKeyPair
): Promise<{ master: string } | null> {
  const estado = await fetchTeamKeyState(deps, teamId)
  if (!estado.activated || !estado.wrap) return null
  return { master: unwrapWithDevice(device.privateKey, estado.wrap.wrapped).toString('base64') }
}

/** Sólo lo llama el `leader` (gateado también server-side). Envuelve la maestra que YA tiene
 * con la pública del device objetivo. */
export async function authorizeTeamDeviceFromClient(
  deps: TeamKeysClientDeps,
  teamId: string,
  master: string,
  target: { deviceId: string; publicKey: string }
): Promise<void> {
  await pedir(deps, '/v1/teams/key/authorize', {
    method: 'POST',
    body: {
      team_id: teamId,
      wraps: [{
        slot: target.deviceId, kind: 'device',
        wrapped: wrapForDevice(target.publicKey, Buffer.from(master, 'base64')),
      }],
    },
  })
}
```

- [ ] **Step 4: Correr el test, confirmar que pasa**

Run: `npx vitest run electron/__tests__/memory-team-keys-client.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add electron/memory-team-keys-client.ts electron/__tests__/memory-team-keys-client.test.ts
git commit -m "feat(cifrado-equipo): client puro de activar/adoptar/autorizar"
```

---

## Task 8: Código de recuperación de equipo

**Files:**
- Modify: `electron/memory-team-keys-client.ts`
- Modify: `electron/__tests__/memory-team-keys-client.test.ts`

**Interfaces:**
- Consumes: `unwrapWithRecovery`, `normalizeRecoveryCode` (`./memory-key-wrap`).
- Produces: `export async function recoverTeamWithCode(deps: TeamKeysClientDeps, teamId: string, device: DeviceKeyPair, code: string): Promise<{ master: string }>`

- [ ] **Step 1: Escribir el test que falla**

```ts
// agregar a electron/__tests__/memory-team-keys-client.test.ts
import { recoverTeamWithCode } from '../memory-team-keys-client'

it('recupera con el código y se auto-autoriza para no volver a pedirlo', async () => {
  const { fetchImpl } = servidorFalso()
  const deviceLeader = generateDeviceKeyPair()
  const deviceNuevo = generateDeviceKeyPair()
  const depsLeader = { baseUrl: 'http://x', token: 't', deviceId: 'dev-leader', fetchImpl }
  const depsNuevo = { baseUrl: 'http://x', token: 't', deviceId: 'dev-nuevo', fetchImpl }

  const { master, recoveryCode } = await activateTeamEncryption(depsLeader, 'team-1', deviceLeader)
  const recuperado = await recoverTeamWithCode(depsNuevo, 'team-1', deviceNuevo, recoveryCode)
  expect(recuperado.master).toBe(master)

  // Se auto-autorizó: una segunda lectura, sin volver a recuperar, ya tiene wrap propia.
  const adoptado = await adoptExistingTeamKey(depsNuevo, 'team-1', deviceNuevo)
  expect(adoptado?.master).toBe(master)
})

it('un código equivocado tira ANTES de publicar nada', async () => {
  const { fetchImpl } = servidorFalso()
  const deviceLeader = generateDeviceKeyPair()
  const deviceNuevo = generateDeviceKeyPair()
  const depsLeader = { baseUrl: 'http://x', token: 't', deviceId: 'dev-leader', fetchImpl }
  const depsNuevo = { baseUrl: 'http://x', token: 't', deviceId: 'dev-nuevo', fetchImpl }
  await activateTeamEncryption(depsLeader, 'team-1', deviceLeader)

  await expect(
    recoverTeamWithCode(depsNuevo, 'team-1', deviceNuevo, '0000-0000-0000-0000-0000-0000')
  ).rejects.toThrow()
  expect(await adoptExistingTeamKey(depsNuevo, 'team-1', deviceNuevo)).toBeNull()
})
```

También agregar al `servidorFalso()` el GET con `?slot=recovery` (hoy sólo responde la del
`deviceId` que llama): el bloque `if (u.pathname === '/v1/teams/key' ...)` ya lee `slot` de
`u.searchParams`, así que alcanza con que el test de activación haya guardado la fila
`${teamId}:recovery` — ya lo hace `activateTeamEncryption`. No hace falta tocar el mock.

- [ ] **Step 2: Correr el test, confirmar que falla**

Run: `npx vitest run electron/__tests__/memory-team-keys-client.test.ts`
Expected: FAIL — `recoverTeamWithCode is not a function`

- [ ] **Step 3: Implementar**

Agregar a `electron/memory-team-keys-client.ts`:

```ts
import { unwrapWithRecovery } from './memory-key-wrap'

export async function recoverTeamWithCode(
  deps: TeamKeysClientDeps,
  teamId: string,
  device: DeviceKeyPair,
  code: string
): Promise<{ master: string }> {
  const estado = await fetchTeamKeyState(deps, teamId, 'recovery')
  const wrap = estado.wrap
  if (!wrap?.wrapMeta?.salt || typeof wrap.wrapMeta.salt !== 'string') {
    throw new Error('There is no recovery copy for this team.')
  }
  // Lanza MemoryUnwrapError con el código equivocado, ANTES de publicar nada — mismo orden
  // que `recoverWithCode` personal.
  const master = unwrapWithRecovery(code, { wrapped: wrap.wrapped, salt: wrap.wrapMeta.salt })
  await authorizeTeamDeviceFromClient(deps, teamId, master.toString('base64'), {
    deviceId: deps.deviceId, publicKey: device.publicKey,
  })
  return { master: master.toString('base64') }
}
```

- [ ] **Step 4: Correr el test, confirmar que pasa**

Run: `npx vitest run electron/__tests__/memory-team-keys-client.test.ts`
Expected: PASS (5 tests en total)

- [ ] **Step 5: Commit**

```bash
git add electron/memory-team-keys-client.ts electron/__tests__/memory-team-keys-client.test.ts
git commit -m "feat(cifrado-equipo): código de recuperación de equipo"
```

---

## Task 9: Cablear el cifrado real en `memory-envelope.ts` — el punto único

**Files:**
- Modify: `electron/memory-envelope.ts`
- Modify: `electron/__tests__/memory-envelope.test.ts` (si no existe con ese nombre exacto,
  buscar el archivo de test real de `memory-envelope.ts` con `Glob "electron/__tests__/*envelope*"`
  antes de crear uno nuevo)
- Modify: `electron/memory-store.ts` (un método nuevo)

**Interfaces:**
- Consumes: `MemoryKeys` (`./memory-crypto`).
- Produces:
  - `export interface EnvelopeContext { keys: MemoryKeys; keyEpoch: number; teamKeys?: (projectKey: string) => MemoryKeys | null }` — el campo `teamKeys` es nuevo, opcional, resuelve `project_key → clave de equipo` o `null` si ese proyecto no tiene equipo con cifrado activo.
  - En `memory-store.ts`: `teamIdForProjectKey(projectKey: string): string | null` (lee `projects.team_id`, columna que ya existe desde `shareProjectWithTeam`).

Este task NO toca `getEnvelopeContext` de `electron/main.ts` (eso es Task 10, que arma el mapa
real de claves de equipo) — acá sólo se prueba que `sealMutationPayload`/`openPulledRow`
USAN `teamKeys` cuando está, y siguen sin cifrar cuando no.

- [ ] **Step 1: Escribir el test que falla**

```ts
// agregar al archivo de test existente de memory-envelope.ts (ubicarlo primero con Glob)
import { deriveKeys, generateMasterKey } from '../memory-crypto'

describe('scope team con teamKeys', () => {
  const masterPersonal = generateMasterKey()
  const keysPersonal = deriveKeys(masterPersonal)
  const masterEquipo = generateMasterKey()
  const keysEquipo = deriveKeys(masterEquipo)

  it('sealMutationPayload cifra una fila team cuando hay clave de equipo para ESE project_key', () => {
    const ctx = { keys: keysPersonal, keyEpoch: 1, teamKeys: (pk: string) => (pk === 'proj-x' ? keysEquipo : null) }
    const sellado = sealMutationPayload(ctx, {
      sync_id: 'abc', scope: 'team', project_key: 'proj-x', title: 'Decisión', content: 'texto', tags: [],
    })
    expect(sellado.title).toMatch(/^nmc1:/)
    expect(sellado.content).toMatch(/^nmc1:/)
  })

  it('sealMutationPayload NO cifra team si teamKeys da null para ese proyecto (sin activar)', () => {
    const ctx = { keys: keysPersonal, keyEpoch: 1, teamKeys: () => null }
    const sellado = sealMutationPayload(ctx, {
      sync_id: 'abc', scope: 'team', project_key: 'proj-x', title: 'Decisión', content: 'texto', tags: [],
    })
    expect(sellado.title).toBe('Decisión')
  })

  it('sealMutationPayload sigue sin tocar scope personal cuando hay teamKeys configurado', () => {
    const ctx = { keys: keysPersonal, keyEpoch: 1, teamKeys: () => keysEquipo }
    const sellado = sealMutationPayload(ctx, {
      sync_id: 'abc', scope: 'personal', project_key: 'proj-x', title: 'Nota', content: 'texto', tags: [],
    })
    expect(sellado.title).toMatch(/^nmc1:/) // cifrada con la PERSONAL, como siempre
  })

  it('openPulledRow descifra una fila team con la clave de equipo correcta', () => {
    const sellado = sealMutationPayload(
      { keys: keysPersonal, keyEpoch: 1, teamKeys: () => keysEquipo },
      { sync_id: 'abc', scope: 'team', project_key: 'proj-x', title: 'Decisión', content: 'texto', tags: [] }
    )
    const { row, undecryptable } = openPulledRow(
      { keys: keysPersonal, keyEpoch: 1, teamKeys: (pk) => (pk === 'proj-x' ? keysEquipo : null) },
      { syncId: 'abc', scope: 'team', projectKey: 'proj-x', title: sellado.title as string, content: sellado.content as string, tags: [] } as never
    )
    expect(row.title).toBe('Decisión')
    expect(undecryptable).toBe(false)
  })

  it('openPulledRow marca undecryptable si la fila es team y no hay clave de equipo para ese proyecto', () => {
    const sellado = sealMutationPayload(
      { keys: keysPersonal, keyEpoch: 1, teamKeys: () => keysEquipo },
      { sync_id: 'abc', scope: 'team', project_key: 'proj-x', title: 'Decisión', content: 'texto', tags: [] }
    )
    const { undecryptable } = openPulledRow(
      { keys: keysPersonal, keyEpoch: 1, teamKeys: () => null },
      { syncId: 'abc', scope: 'team', projectKey: 'proj-x', title: sellado.title as string, content: sellado.content as string, tags: [] } as never
    )
    expect(undecryptable).toBe(true)
  })

  it('el HMAC de tópico de una fila team usa la clave de EQUIPO, no la personal de quien llama', () => {
    // Dos "personas" con personales DISTINTAS pero la MISMA clave de equipo — el caso real:
    // dos miembros de un equipo, cada uno con su propia cuenta cifrada, compartiendo un tema.
    const keysPersonalDeOtraPersona = deriveKeys(generateMasterKey())
    const ctxAutorA = { keys: keysPersonal, keyEpoch: 1, teamKeys: () => keysEquipo }
    const ctxAutorB = { keys: keysPersonalDeOtraPersona, keyEpoch: 1, teamKeys: () => keysEquipo }

    const selladoA = sealMutationPayload(ctxAutorA, {
      sync_id: 'abc', scope: 'team', project_key: 'proj-x', topic_key: 'mismo-tema', title: 't', content: 'c', tags: [],
    })
    const selladoB = sealMutationPayload(ctxAutorB, {
      sync_id: 'def', scope: 'team', project_key: 'proj-x', topic_key: 'mismo-tema', title: 't', content: 'c', tags: [],
    })
    // Si esto usara `ctx.keys` (la personal de cada uno) en vez de la clave de equipo
    // resuelta, los dos HMAC saldrían distintos y el supersede de equipo (`push.ts:537`,
    // que compara por igualdad) dejaría de encontrarlos como el mismo tema.
    expect(selladoA.topic_key).toBe(selladoB.topic_key)
  })
})
```

- [ ] **Step 2: Correr el test, confirmar que falla**

Run: `npx vitest run electron -t "scope team con teamKeys"`
Expected: FAIL — `teamKeys` no existe en `EnvelopeContext`, las filas team viajan sin cifrar

- [ ] **Step 3: Implementar**

En `electron/memory-envelope.ts`, reemplazar la función `esDeEquipo` y las dos funciones que
la usan:

```ts
export interface EnvelopeContext {
  keys: MemoryKeys
  keyEpoch: number
  /** `project_key -> claves de equipo activas para ESE proyecto`, o `null` si el proyecto no
   * tiene equipo con cifrado activo (equipo sin activar, o este device sin wrap todavía).
   * Ausente (no sólo `null`) en builds/callers viejos que no conocen el cifrado de equipo. */
  teamKeys?: (projectKey: string) => MemoryKeys | null
}
```

```ts
export function sealMutationPayload(
  ctx: EnvelopeContext | null,
  payload: Record<string, unknown>
): Record<string, unknown> {
  const esTeam = payload.scope === 'team'
  const keysDeTeam = esTeam ? (ctx?.teamKeys?.(String(payload.project_key ?? '')) ?? null) : null
  if (esTeam && !keysDeTeam) return payload // equipo sin cifrado activo: en claro, como hoy
  const keys = esTeam ? keysDeTeam! : ctx?.keys
  if (!keys) return payload

  const syncId = String(payload.sync_id ?? '')
  const sealed: Record<string, unknown> = { ...payload }

  for (const field of SEALED_FIELDS) {
    const value = payload[field]
    if (typeof value !== 'string') continue
    sealed[field] = encryptField(keys, value, fieldAad(syncId, field))
  }

  const tags = payload.tags
  if (Array.isArray(tags) && tags.length > 0) {
    sealed.tags = [encryptField(keys, JSON.stringify(tags), fieldAad(syncId, 'tags'))]
  }

  // El HMAC de tópico usa la MISMA clave que acaba de cifrar los campos de esta fila (`keys`:
  // la de equipo si es team y hay una activa, si no la personal) — NUNCA incondicionalmente
  // la personal. El servidor supersede por igualdad de este valor (`push.ts:537`): si dos
  // miembros de un equipo derivaran el HMAC con sus respectivas claves PERSONALES (que son
  // distintas entre sí), el mismo tema lógico produciría dos HMACs distintos y el supersede
  // de equipo dejaría de funcionar entre autores distintos. `keys` ya es `undefined` cuando
  // no hay ninguna clave disponible (equipo sin activar y sin `ctx`), así que el chequeo de
  // abajo sigue sirviendo para "no hay nada con qué derivar".
  const topicKey = payload.topic_key
  if (typeof topicKey === 'string' && topicKey !== '') {
    sealed.topic_key = hmacTopicKey(keys, String(payload.project_key ?? ''), String(payload.scope ?? 'personal'), topicKey)
  }

  return sealed
}
```

```ts
export function openPulledRow(ctx: EnvelopeContext | null, row: PulledRow): OpenedRow {
  const esTeam = row.scope === 'team'
  const keysDeTeam = esTeam ? (ctx?.teamKeys?.(row.projectKey) ?? null) : null
  const keys = esTeam ? keysDeTeam : ctx?.keys
  // Fila team sin clave de equipo disponible: si YA viene en claro (equipo nunca activó
  // cifrado), pasa igual que antes. Si viene cifrada (nmc1:) y no hay clave, es undecryptable
  // — mismo tratamiento que una personal sin autorizar. `abrir()` de abajo ya distingue los
  // dos casos por `isCiphertext`, así que sólo hace falta pasarle `keys` (o nada).

  const abierto: PulledRow = { ...row }
  let undecryptable = false

  const abrir = (value: string | null | undefined, field: string): string | null | undefined => {
    if (value == null || !isCiphertext(value)) return value
    if (!keys) { undecryptable = true; return value }
    try {
      return decryptField(keys, value, fieldAad(row.syncId, field))
    } catch (err) {
      if (err instanceof MemoryDecryptError) { undecryptable = true; return value }
      throw err
    }
  }

  abierto.title = abrir(row.title, 'title') ?? undefined
  abierto.content = abrir(row.content, 'content') ?? null
  abierto.contentHash = abrir(row.contentHash, 'content_hash') ?? undefined
  if (row.originAccount !== undefined) {
    abierto.originAccount = abrir(row.originAccount, 'origin_account') ?? undefined
  }

  if (Array.isArray(row.tags) && row.tags.length === 1 && isCiphertext(row.tags[0])) {
    const claro = abrir(row.tags[0], 'tags')
    if (claro != null && !isCiphertext(claro)) {
      try {
        const parsed = JSON.parse(claro)
        abierto.tags = Array.isArray(parsed) ? parsed.filter((t): t is string => typeof t === 'string') : []
      } catch {
        abierto.tags = []
      }
    }
  }

  abierto.topicKeyHmac = null
  if (row.topicKey) {
    if (ctx && looksLikeTopicHmac(row.topicKey)) {
      abierto.topicKey = null
      abierto.topicKeyHmac = row.topicKey
    } else if (keys) {
      // Misma corrección que en `sealMutationPayload`: con `keys` (la de equipo si
      // corresponde) y no incondicionalmente `ctx.keys`, para que dos miembros de un
      // equipo deriven el MISMO HMAC de tópico sobre la MISMA clave compartida.
      abierto.topicKeyHmac = hmacTopicKey(keys, row.projectKey, row.scope, row.topicKey)
    }
  }

  return { row: abierto, undecryptable }
}
```

Borrar la función `esDeEquipo` (ya no se usa) y su comentario de la Decisión 1 del §9 — dejar
en su lugar un comentario corto apuntando a
`docs/superpowers/specs/2026-10-14-cifrado-de-equipo-design.md` como la decisión vigente.

En `electron/memory-store.ts`, agregar junto a los demás métodos de `projects`:

```ts
/** `projects.team_id` de ESTE project_key, o null si no está compartido con ningún equipo. */
teamIdForProjectKey(projectKey: string): string | null {
  const fila = this.db.prepare('SELECT team_id FROM projects WHERE project_key = ?').get(projectKey) as { team_id: string | null } | undefined
  return fila?.team_id ?? null
}
```

(Ubicar el método junto a los demás que leen de la tabla `projects` — buscar con
`Grep "FROM projects WHERE"` en `memory-store.ts` para ponerlo al lado del que más se parece.)

- [ ] **Step 4: Correr el test, confirmar que pasa**

Run: `npx vitest run electron -t "scope team con teamKeys"`
Expected: PASS (6 tests)

- [ ] **Step 5: Correr toda la suite de `electron/` antes de seguir**

Run: `npx vitest run electron`
Expected: PASS — ningún test existente de `memory-envelope.test.ts` ni de nada que dependa de
`sealMutationPayload`/`openPulledRow` se rompió (el camino `ctx === null` y el de scope
personal no cambiaron de comportamiento).

- [ ] **Step 6: Commit**

```bash
git add electron/memory-envelope.ts electron/memory-store.ts electron/__tests__/*.test.ts
git commit -m "feat(cifrado-equipo): sealMutationPayload/openPulledRow usan la clave de equipo cuando hay una"
```

---

## Task 10: Migración retroactiva del lado del cliente

**Files:**
- Create: `electron/memory-team-reencrypt.ts`
- Test: `electron/__tests__/memory-team-reencrypt.test.ts`

**Interfaces:**
- Consumes: `deriveKeys` (`./memory-crypto`), `encryptField`, `fieldAad` (`./memory-crypto`), `recryptTeamObservations`-equivalent del cliente (una función `pedir` propia o reusar `fetch` directo, ya que es un endpoint nuevo sin cliente propio todavía — crearla acá).
- Produces: `export async function runTeamRecrypt(deps: { baseUrl: string; token: string; deviceId: string; fetchImpl?: typeof fetch }, teamId: string, master: Buffer, rows: Array<{ syncId: string; title: string; content: string | null; tags: string[]; contentHash: string | null; originAccount: string | null }>, onProgress?: (p: { total: number; done: number }) => void): Promise<{ total: number; applied: number; rejected: number }>`

**Ruling de la ejecución (no estaba en la primera versión de este plan)**: la review de
Task 5 encontró que `recryptTeamObservations` dejaba `content_hash`/`origin_account` en
claro para siempre tras la migración — `origin_account` tiene el email del usuario
(`server/README.md`). Se amplió el contrato de Task 5 para incluir esos dos campos
(mismo mecanismo que `title`/`content`, ver Task 5 actualizado); este task arrastra ese
cambio: `LocalTeamRow` y el payload que arma `runTeamRecrypt` llevan `contentHash`/
`originAccount` también. `topic_key` queda explícitamente FUERA — es un HMAC, no un
cifrado simétrico, y re-derivarlo retroactivamente sobre filas ya existentes es un
problema aparte (afecta el supersede por igualdad del servidor); conocido y aceptado
como límite de v1, no se migra.

A diferencia de la migración personal (`memory-reencrypt.ts`, que re-encola por el `push`
normal porque cada quien re-sube SU PROPIA fila), acá el leader re-cifra filas de OTROS
autores — por eso llama al endpoint dedicado `/v1/teams/key/recrypt` (Task 5/6) en vez de
re-encolar mutaciones.

- [ ] **Step 1: Escribir el test que falla**

```ts
// electron/__tests__/memory-team-reencrypt.test.ts
import { describe, it, expect, vi } from 'vitest'
import { generateMasterKey, deriveKeys } from '../memory-crypto'
import { runTeamRecrypt } from '../memory-team-reencrypt'

describe('runTeamRecrypt', () => {
  it('cifra cada fila con la clave de equipo y la manda al endpoint en un solo lote', async () => {
    const master = generateMasterKey()
    const llamadas: unknown[] = []
    const fetchImpl = vi.fn(async (url: string, init: RequestInit) => {
      llamadas.push(JSON.parse(String(init.body)))
      return new Response(JSON.stringify({ ok: true, applied: ['a', 'b'], rejected: [] }), { status: 200 })
    })
    const res = await runTeamRecrypt(
      { baseUrl: 'http://x', token: 't', deviceId: 'd', fetchImpl },
      'team-1',
      master,
      [
        { syncId: 'a', title: 'Uno', content: 'contenido uno', tags: ['x'], contentHash: 'hash-uno', originAccount: 'gero@example.com' },
        { syncId: 'b', title: 'Dos', content: null, tags: [], contentHash: null, originAccount: null },
      ]
    )
    expect(res).toEqual({ total: 2, applied: 2, rejected: 0 })
    const body = llamadas[0] as { team_id: string; items: Array<{ sync_id: string; title: string; content: string | null; content_hash: string | null; origin_account: string | null }> }
    expect(body.team_id).toBe('team-1')
    expect(body.items).toHaveLength(2)
    expect(body.items[0].title).toMatch(/^nmc1:/)
    expect(body.items[0].content_hash).toMatch(/^nmc1:/)
    expect(body.items[0].origin_account).toMatch(/^nmc1:/) // el email no viaja en claro
    expect(body.items[1].content).toBeNull() // un content null (tombstone) no se cifra, viaja tal cual
    expect(body.items[1].content_hash).toBeNull()
    expect(body.items[1].origin_account).toBeNull()
  })

  it('reporta progreso y cuenta los rejected del servidor', async () => {
    const master = generateMasterKey()
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ ok: true, applied: ['a'], rejected: [{ sync_id: 'b', error: 'not_found_in_team' }] }), { status: 200 }))
    const progreso: Array<{ total: number; done: number }> = []
    const res = await runTeamRecrypt(
      { baseUrl: 'http://x', token: 't', deviceId: 'd', fetchImpl },
      'team-1', master,
      [
        { syncId: 'a', title: 'A', content: 'x', tags: [], contentHash: null, originAccount: null },
        { syncId: 'b', title: 'B', content: 'y', tags: [], contentHash: null, originAccount: null },
      ],
      (p) => progreso.push(p)
    )
    expect(res).toEqual({ total: 2, applied: 1, rejected: 1 })
    expect(progreso.at(-1)).toEqual({ total: 2, done: 2 })
  })
})
```

- [ ] **Step 2: Correr el test, confirmar que falla**

Run: `npx vitest run electron/__tests__/memory-team-reencrypt.test.ts`
Expected: FAIL — `Cannot find module '../memory-team-reencrypt'`

- [ ] **Step 3: Implementar**

```ts
// electron/memory-team-reencrypt.ts
// Migración retroactiva (spec §4): el leader re-cifra lo que YA está en claro en la nube
// bajo la clave de equipo recién creada. A diferencia de la migración personal
// (memory-reencrypt.ts), esto reescribe filas de OTROS autores, así que no puede pasar por
// el push normal (server/src/push.ts exige same-author) — llama al endpoint dedicado.
import { encryptField, fieldAad } from './memory-crypto'
import type { MemoryKeys } from './memory-crypto'

export interface TeamReencryptDeps {
  baseUrl: string
  token: string
  deviceId: string
  fetchImpl?: typeof fetch
}

export interface LocalTeamRow {
  syncId: string
  title: string
  content: string | null
  tags: string[]
  /** `null` si la fila nunca tuvo hash (o ya era null antes de cifrar) — mismo tratamiento
   * que `content`: no se cifra un `null`, viaja tal cual. */
  contentHash: string | null
  /** El email de quien guardó la memoria, vía `NEST_MEMORY_ACCOUNT` — el mismo campo que
   * ya se cifra en el push normal (Task 9, `SEALED_FIELDS`); si no se migra acá queda en
   * claro para siempre en filas anteriores a la activación del cifrado de equipo. */
  originAccount: string | null
}

const MAX_POR_LOTE = 400 // bajo el MAX_WRAPS_POR_REQUEST/MAX_BATCH de la familia de endpoints de este servicio

export async function runTeamRecrypt(
  deps: TeamReencryptDeps,
  teamId: string,
  master: Buffer,
  rows: LocalTeamRow[],
  onProgress?: (p: { total: number; done: number }) => void
): Promise<{ total: number; applied: number; rejected: number }> {
  const keys: MemoryKeys = { field: master, topic: master } // sólo se usa `field` acá; `topic` no aplica a este endpoint
  let applied = 0
  let rejected = 0
  const f = deps.fetchImpl ?? fetch

  for (let i = 0; i < rows.length; i += MAX_POR_LOTE) {
    const lote = rows.slice(i, i + MAX_POR_LOTE)
    const items = lote.map((r) => ({
      sync_id: r.syncId,
      title: encryptField(keys, r.title, fieldAad(r.syncId, 'title')),
      content: r.content === null ? null : encryptField(keys, r.content, fieldAad(r.syncId, 'content')),
      tags: r.tags.length > 0 ? [encryptField(keys, JSON.stringify(r.tags), fieldAad(r.syncId, 'tags'))] : [],
      content_hash: r.contentHash === null ? null : encryptField(keys, r.contentHash, fieldAad(r.syncId, 'content_hash')),
      origin_account: r.originAccount === null ? null : encryptField(keys, r.originAccount, fieldAad(r.syncId, 'origin_account')),
    }))
    const res = await f(`${deps.baseUrl}/v1/teams/key/recrypt`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${deps.token}`, 'Content-Type': 'application/json', 'X-Device-Test': deps.deviceId },
      body: JSON.stringify({ team_id: teamId, items }),
    })
    const json = (await res.json()) as { applied?: string[]; rejected?: Array<{ sync_id: string }> }
    applied += json.applied?.length ?? 0
    rejected += json.rejected?.length ?? 0
    onProgress?.({ total: rows.length, done: Math.min(i + lote.length, rows.length) })
  }

  return { total: rows.length, applied, rejected }
}
```

- [ ] **Step 4: Correr el test, confirmar que pasa**

Run: `npx vitest run electron/__tests__/memory-team-reencrypt.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add electron/memory-team-reencrypt.ts electron/__tests__/memory-team-reencrypt.test.ts
git commit -m "feat(cifrado-equipo): migración retroactiva del lado del cliente"
```

---

## Task 11: IPC — `main.ts` + `preload.ts` + `types.ts`

**Files:**
- Modify: `electron/main.ts` (junto a los handlers `memory:encryption:*`, línea ~3325-3490)
- Modify: `electron/preload.ts` (junto a `registerDevice`, línea ~80)
- Modify: `src/types.ts` (junto a la interfaz de `registerDevice`, línea ~973)

**Interfaces:**
- Consumes: Task 7-10 completos.
- Produces los 6 canales IPC que Task 12 (UI) consume:
  - `memory:teamEncryption:status(teamId: string)`
  - `memory:teamEncryption:activate(teamId: string)`
  - `memory:teamEncryption:authorize(teamId: string, deviceId: string)`
  - `memory:teamEncryption:recover(teamId: string, code: string)`
  - `memory:teamEncryption:recrypt(teamId: string)`
  - `memory:teamEncryption:adopt(teamId: string)` — el que cierra el círculo: sin esto, una
    máquina recién autorizada por el leader (Task 4/7) no tiene NINGUNA forma de enterarse,
    porque `teamMasterKeys` vive sólo en memoria y se pierde en cada reinicio de la app.

Este task es de wiring puro (sin lógica nueva — todo lo nuevo ya está probado en los Tasks
7-10), así que no lleva TDD de unidad: lleva un smoke manual al final en vez de Step 1-4 con
test automatizado, porque probarlo de verdad exige el daemon + la base local + un servidor
real, que es exactamente lo que ya cubre Task 13.

- [ ] **Step 1: Mantener un mapa de claves de equipo en memoria, junto a `memoryKeys`**

En `electron/main.ts`, cerca de donde se declara `let memoryKeys: ... | null` (buscar con
`Grep "let memoryKeys"`), agregar:

```ts
/** teamId -> maestra de ESE equipo, sólo en memoria — igual de propósito que `memoryKeys.master`
 * pero SIN persistencia a disco en v1 (nunca se guarda en el keyring/safeStorage): se re-adopta
 * en cada arranque llamando a `memory:teamEncryption:adopt` (Step 3 más abajo), mismo costo que
 * un fetch, y evita sumar un segundo formato a `saveKeyMaterial`/`memory-key-store.ts` para una
 * clave que nunca escribe nada propio (sólo re-cifra lo que ya viaja por push/pull). Si el
 * costo de volver a pedirla en cada arranque resulta alto en la práctica, persistirla es un
 * cambio aislado a este Map — no toca ningún otro task. */
const teamMasterKeys = new Map<string, Buffer>()

function teamKeysDeps() {
  return keysDeps() // ya existe (línea ~3317): baseUrl/token/deviceId — no cambia por team
}
```

- [ ] **Step 2: Los 6 handlers, junto a `memory:encryption:*`**

```ts
ipcMain.handle('memory:teamEncryption:status', async (_e, teamId: string) => {
  const deps = teamKeysDeps()
  if (!deps) return { activated: false, wrap: null, pendingDevices: [], hasMaster: false }
  const estado = await fetchTeamKeyState(deps, teamId)
  return { ...estado, hasMaster: teamMasterKeys.has(teamId) }
})

ipcMain.handle('memory:teamEncryption:activate', async (_e, teamId: string) => {
  const deps = teamKeysDeps()
  if (!deps || !memoryKeys) return { ok: false, error: 'Cloud memory is not connected.' }
  try {
    const { master, recoveryCode } = await activateTeamEncryption(deps, teamId, memoryKeys.device)
    teamMasterKeys.set(teamId, Buffer.from(master, 'base64'))
    return { ok: true, recoveryCode }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
})

/**
 * El cierre del flujo de autorización — gemelo de `memory:encryption:adopt` (personal). Sin
 * esto, después de que el leader autoriza (Step siguiente), la máquina recién autorizada no
 * tiene NINGUNA forma de enterarse: `teamMasterKeys` nunca se repuebla sola.
 */
ipcMain.handle('memory:teamEncryption:adopt', async (_e, teamId: string) => {
  const deps = teamKeysDeps()
  if (!deps || !memoryKeys) return { ok: false, error: 'Cloud memory is not connected.' }
  try {
    const yaExiste = await adoptExistingTeamKey(deps, teamId, memoryKeys.device)
    if (!yaExiste) return { ok: true, adoptada: false }
    teamMasterKeys.set(teamId, Buffer.from(yaExiste.master, 'base64'))
    // Las filas de equipo que esta máquina se salteó por ilegibles quedaron marcadas
    // `undecryptable`, igual que en personal — el próximo pull normal las vuelve a abrir
    // porque `openPulledRow` ahora encuentra la clave en `teamMasterKeys`. No hace falta
    // resetear cursores: a diferencia de personal, el pull de equipo no se saltea filas por
    // cursor al no poder leerlas, sólo las marca `undecryptable` (Task 9).
    return { ok: true, adoptada: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
})

ipcMain.handle('memory:teamEncryption:authorize', async (_e, teamId: string, deviceId: string) => {
  const deps = teamKeysDeps()
  const master = teamMasterKeys.get(teamId)
  if (!deps || !master) return { ok: false, error: 'This machine does not have the team key.' }
  try {
    const estado = await fetchTeamKeyState(deps, teamId)
    const target = estado.pendingDevices.find((d) => d.deviceId === deviceId)
    if (!target) return { ok: false, error: 'That machine has not published its key yet.' }
    await authorizeTeamDeviceFromClient(deps, teamId, master.toString('base64'), target)
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
})

ipcMain.handle('memory:teamEncryption:recover', async (_e, teamId: string, code: string) => {
  const deps = teamKeysDeps()
  if (!deps || !memoryKeys) return { ok: false, error: 'Cloud memory is not connected.' }
  try {
    const { master } = await recoverTeamWithCode(deps, teamId, memoryKeys.device, code)
    teamMasterKeys.set(teamId, Buffer.from(master, 'base64'))
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
})

ipcMain.handle('memory:teamEncryption:recrypt', async (_e, teamId: string) => {
  const deps = teamKeysDeps()
  const master = teamMasterKeys.get(teamId)
  if (!deps || !master || !memory) return { total: 0, applied: 0, rejected: 0 }
  const rows = memory.store.localTeamRowsForTeam(teamId) // método nuevo, ver Step 3
  return runTeamRecrypt(deps, teamId, master, rows)
})
```

Agregar los imports correspondientes arriba del archivo, junto a los de `./memory-keys-client`:

```ts
import {
  fetchTeamKeyState, activateTeamEncryption, adoptExistingTeamKey, authorizeTeamDeviceFromClient,
  recoverTeamWithCode,
} from './memory-team-keys-client'
import { runTeamRecrypt } from './memory-team-reencrypt'
import { deriveKeys } from './memory-crypto'
```

**Paso que cierra Task 9 de verdad**: ubicar la función u objeto que hoy arma el
`EnvelopeContext` real que el daemon consume (`Grep "getEnvelopeContext:" electron/main.ts` —
es el mismo lugar que construye `{ keys: deriveKeys(Buffer.from(memoryKeys.master, 'base64')),
keyEpoch: memoryKeys.keyEpoch }` o similar) y sumarle el resolver:

```ts
teamKeys: (projectKey: string) => {
  const teamId = memory?.store.teamIdForProjectKey(projectKey)
  const master = teamId ? teamMasterKeys.get(teamId) : undefined
  return master ? deriveKeys(master) : null
},
```

Sin este paso, Task 9 queda probado en aislamiento pero NUNCA se ejecuta en la app real: el
daemon seguiría llamando a `getEnvelopeContext()` sin el campo `teamKeys`, y toda fila `scope:
'team'` seguiría viajando en claro pase lo que pase en el resto de los tasks.

- [ ] **Step 3: El método que falta en `memory-store.ts` — filas locales de un equipo**

```ts
/** Todo lo que esta instalación tiene localmente con scope 'team' para proyectos de ESTE
 * equipo — lo que la migración retroactiva (Task 10) necesita re-cifrar. Nunca pasa por el
 * cursor de pull: es lo que YA bajó, exactamente lo que el leader vería hoy sin cifrado. */
localTeamRowsForTeam(teamId: string): Array<{
  syncId: string; title: string; content: string | null; tags: string[]
  contentHash: string | null; originAccount: string | null
}> {
  return this.db.prepare(`
    SELECT o.sync_id as syncId, o.title, o.content, o.tags,
           o.content_hash as contentHash, o.origin_account as originAccount
      FROM observations o
      JOIN projects p ON p.project_key = o.project_key
     WHERE p.team_id = ? AND o.scope = 'team' AND o.deleted = 0
  `).all(teamId).map((r: unknown) => {
    const row = r as { syncId: string; title: string; content: string | null; tags: string; contentHash: string | null; originAccount: string | null }
    return { ...row, tags: row.tags ? JSON.parse(row.tags) : [] }
  })
}
```

**Nota para quien implemente**: confirmar con `Grep "CREATE TABLE.*observations"` en
`memory-store.ts` los nombres EXACTOS de columna (`project_key` vs `project_id`, `tags` como
JSON vs columna separada, y si `content_hash`/`origin_account` existen con esos nombres
exactos o algo distinto) antes de pegar esto — el schema local no es necesariamente idéntico
al del servidor (`server/migrations/001_init.sql`) que vimos en el diseño. Si alguno de los
dos campos no existe en el schema local (por ejemplo, si nunca se persistió localmente),
devolver `null` para ese campo es la salida correcta — `runTeamRecrypt` (Task 10) ya trata
`null` como "no cifrar, viaja tal cual", mismo camino que ya usa `content`.

- [ ] **Step 4: `preload.ts`**

Junto a `registerDevice: (jwt: string) => ipcRenderer.invoke('memory:registerDevice', jwt)`:

```ts
teamEncryptionStatus: (teamId: string) => ipcRenderer.invoke('memory:teamEncryption:status', teamId),
teamEncryptionActivate: (teamId: string) => ipcRenderer.invoke('memory:teamEncryption:activate', teamId),
teamEncryptionAdopt: (teamId: string) => ipcRenderer.invoke('memory:teamEncryption:adopt', teamId),
teamEncryptionAuthorize: (teamId: string, deviceId: string) => ipcRenderer.invoke('memory:teamEncryption:authorize', teamId, deviceId),
teamEncryptionRecover: (teamId: string, code: string) => ipcRenderer.invoke('memory:teamEncryption:recover', teamId, code),
teamEncryptionRecrypt: (teamId: string) => ipcRenderer.invoke('memory:teamEncryption:recrypt', teamId),
```

- [ ] **Step 5: `src/types.ts`**

Junto a la declaración de `registerDevice?:` (línea ~973):

```ts
teamEncryptionStatus?: (teamId: string) => Promise<{
  activated: boolean
  wrap: { wrapped: string; wrapMeta: Record<string, unknown> | null } | null
  pendingDevices: Array<{ deviceId: string; name: string; publicKey: string }>
  hasMaster: boolean
}>
teamEncryptionActivate?: (teamId: string) => Promise<{ ok: true; recoveryCode: string } | { ok: false; error: string }>
teamEncryptionAdopt?: (teamId: string) => Promise<{ ok: true; adoptada: boolean } | { ok: false; error: string }>
teamEncryptionAuthorize?: (teamId: string, deviceId: string) => Promise<{ ok: boolean; error?: string }>
teamEncryptionRecover?: (teamId: string, code: string) => Promise<{ ok: boolean; error?: string }>
teamEncryptionRecrypt?: (teamId: string) => Promise<{ total: number; applied: number; rejected: number }>
```

- [ ] **Step 6: Typecheck + suite completa — el smoke de este task**

Run: `npx tsc -p tsconfig.node.json --noEmit --composite false && npx tsc -p tsconfig.web.json --noEmit --composite false`
Expected: 0 errores en los dos (ver CLAUDE.md — `tsc -b` NO es el chequeo real de este repo)

Run: `npm test` (o el runner que uses para `electron/` + `src/`)
Expected: PASS, nada roto por el wiring

- [ ] **Step 7: Commit**

```bash
git add electron/main.ts electron/preload.ts electron/memory-store.ts src/types.ts
git commit -m "feat(cifrado-equipo): wiring IPC completo (status/activate/authorize/recover/recrypt)"
```

---

## Task 12: `TeamEncryptionCard.tsx` — UI, gateada por rol

**Files:**
- Create: `src/components/TeamEncryptionCard.tsx`
- Test: `src/__tests__/components/TeamEncryptionCard.test.tsx`
- Modify: el componente que hoy monta `MemoryEncryptionCard` (ubicar con
  `Grep "MemoryEncryptionCard" src/components/MemoriesWorkspace.tsx` — ahí al lado va esta)

**Interfaces:**
- Consumes: `window.memory.teamEncryption*` (Task 11), `useTeam()` (`../hooks/useTeam`, ya
  existe — da `activeTeam`, `userId`, `members` con `.role`).

Modelado sobre `MemoryEncryptionCard.tsx` (350 líneas, leído entero más arriba en este plan):
mismos 4 estados (se puede activar / activo / esperando autorización / cargando), más un
quinto que el personal no tiene — "sos member, sólo el leader puede activar esto".

- [ ] **Step 1: Escribir el test que falla**

```tsx
// src/__tests__/components/TeamEncryptionCard.test.tsx
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import TeamEncryptionCard from '../../components/TeamEncryptionCard'

vi.mock('../../hooks/useTeam', () => ({
  useTeam: () => ({ activeTeam: { id: 'team-1', name: 'Equipo' }, userId: 'u-leader', members: [
    { user_id: 'u-leader', role: 'leader' }, { user_id: 'u-member', role: 'member' },
  ] }),
}))

beforeEach(() => {
  window.memory = {
    teamEncryptionStatus: vi.fn().mockResolvedValue({ activated: false, wrap: null, pendingDevices: [], hasMaster: false }),
  } as never
})

describe('TeamEncryptionCard', () => {
  it('el leader ve el botón de activar cuando el equipo no tiene clave', async () => {
    render(<TeamEncryptionCard />)
    expect(await screen.findByRole('button', { name: /turn on team encryption/i })).toBeInTheDocument()
  })

  it('al activar muestra el código de recuperación una vez', async () => {
    window.memory.teamEncryptionActivate = vi.fn().mockResolvedValue({ ok: true, recoveryCode: 'ABCD-EFGH-1234-5678-9012-3456' })
    render(<TeamEncryptionCard />)
    await userEvent.click(await screen.findByRole('button', { name: /turn on team encryption/i }))
    expect(await screen.findByText('ABCD-EFGH-1234-5678-9012-3456')).toBeInTheDocument()
  })
})

describe('TeamEncryptionCard — adopción automática', () => {
  it('si el equipo está activado y esta máquina no tiene la clave, adopta sola al montar', async () => {
    window.memory.teamEncryptionStatus = vi.fn()
      .mockResolvedValueOnce({ activated: true, wrap: null, pendingDevices: [], hasMaster: false })
      .mockResolvedValueOnce({ activated: true, wrap: null, pendingDevices: [], hasMaster: true })
    window.memory.teamEncryptionAdopt = vi.fn().mockResolvedValue({ ok: true, adoptada: true })
    render(<TeamEncryptionCard />)
    await waitFor(() => expect(window.memory.teamEncryptionAdopt).toHaveBeenCalledWith('team-1'))
    expect(await screen.findByText(/team encryption on/i)).toBeInTheDocument()
  })
})

describe('TeamEncryptionCard — un member (no leader)', () => {
  it('no ofrece activar, sólo informa que falta el leader', async () => {
    vi.resetModules()
    vi.doMock('../../hooks/useTeam', () => ({
      useTeam: () => ({ activeTeam: { id: 'team-1', name: 'Equipo' }, userId: 'u-member', members: [
        { user_id: 'u-leader', role: 'leader' }, { user_id: 'u-member', role: 'member' },
      ] }),
    }))
    const { default: TeamEncryptionCardReimportado } = await import('../../components/TeamEncryptionCard')
    render(<TeamEncryptionCardReimportado />)
    expect(await screen.findByText(/ask your team leader to turn on encryption/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /turn on team encryption/i })).not.toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Correr el test, confirmar que falla**

Run: `npx vitest run src/__tests__/components/TeamEncryptionCard.test.tsx`
Expected: FAIL — `Cannot find module '../../components/TeamEncryptionCard'`

- [ ] **Step 3: Implementar**

```tsx
// src/components/TeamEncryptionCard.tsx
// Hermana de MemoryEncryptionCard.tsx para scope 'team': mismos estados, más uno que el
// personal no necesita — "sólo el leader puede activar/autorizar esto" (spec §3/§5).
import { useCallback, useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ShieldCheck, ShieldAlert, ShieldQuestion } from 'lucide-react'
import { ICON_SIZE } from '../lib/icons'
import { useTeam } from '../hooks/useTeam'

interface EstadoCifradoEquipo {
  activated: boolean
  wrap: { wrapped: string; wrapMeta: Record<string, unknown> | null } | null
  pendingDevices: Array<{ deviceId: string; name: string; publicKey: string }>
  hasMaster: boolean
}

export default function TeamEncryptionCard() {
  const { activeTeam, userId, members } = useTeam()
  const [estado, setEstado] = useState<EstadoCifradoEquipo | null>(null)
  const [codigo, setCodigo] = useState<string | null>(null)
  const [confirmado, setConfirmado] = useState(false)
  const [recuperando, setRecuperando] = useState(false)
  const [codigoTipeado, setCodigoTipeado] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [ocupado, setOcupado] = useState(false)
  const [reencriptadas, setReencriptadas] = useState<number | null>(null)
  const [buscandoAutorizacion, setBuscandoAutorizacion] = useState(false)

  const esLeader = members.some((m) => m.user_id === userId && m.role === 'leader')
  const api = window.memory

  const refrescar = useCallback(async () => {
    if (!api?.teamEncryptionStatus || !activeTeam) return
    try { setEstado(await api.teamEncryptionStatus(activeTeam.id)) } catch { /* sin red */ }
  }, [api, activeTeam])

  useEffect(() => { void refrescar() }, [refrescar])

  /**
   * Gemelo del `useEffect` de adopción automática de `MemoryEncryptionCard.tsx` (líneas 69-81):
   * si el equipo ya tiene clave y esta máquina no, intenta tomar la envoltura que el leader
   * pueda haber dejado publicada. Sin esto, autorizar desde la máquina del leader no tendría
   * ningún efecto visible en la del recién autorizado hasta que alguien reabra la app.
   */
  const adoptar = api?.teamEncryptionAdopt
  const necesitaClave = Boolean(activeTeam && estado && estado.activated && !estado.hasMaster)
  useEffect(() => {
    if (!necesitaClave || !adoptar || !activeTeam) return
    let vivo = true
    void (async () => {
      try {
        const res = await adoptar(activeTeam.id)
        if (vivo && res.ok && res.adoptada) await refrescar()
      } catch { /* sin red: se reintenta al reabrir, o con el botón de abajo */ }
    })()
    return () => { vivo = false }
  }, [necesitaClave, adoptar, activeTeam, refrescar])

  if (!api?.teamEncryptionStatus || !activeTeam || !estado) return null

  async function conBloqueo(fn: () => Promise<void>) {
    setOcupado(true); setError(null)
    try { await fn() } finally { setOcupado(false) }
  }

  const activar = () => conBloqueo(async () => {
    const res = await api?.teamEncryptionActivate?.(activeTeam.id)
    if (!res) return
    if (res.ok) setCodigo(res.recoveryCode)
    else setError(res.error)
    await refrescar()
  })

  const autorizar = (deviceId: string) => conBloqueo(async () => {
    const res = await api?.teamEncryptionAuthorize?.(activeTeam.id, deviceId)
    if (res && !res.ok) setError(res.error ?? 'Could not authorise.')
    await refrescar()
  })

  const recuperar = () => conBloqueo(async () => {
    const res = await api?.teamEncryptionRecover?.(activeTeam.id, codigoTipeado)
    if (res && !res.ok) { setError(res.error ?? 'Could not recover.'); return }
    setRecuperando(false); setCodigoTipeado(''); await refrescar()
  })

  const reencriptar = () => conBloqueo(async () => {
    const res = await api?.teamEncryptionRecrypt?.(activeTeam.id)
    if (res) setReencriptadas(res.applied)
    await refrescar()
  })

  const marco = 'flex shrink-0 flex-col gap-2 rounded-md border border-border p-3'

  if (codigo) {
    return (
      <div className={marco}>
        <div className="flex items-center gap-2">
          <ShieldCheck size={ICON_SIZE.md} className="text-ok" aria-hidden />
          <p className="text-fs font-medium text-foreground">Save this team code</p>
        </div>
        <p className="text-fs-sm text-muted-foreground">
          It is the only thing that recovers this team&rsquo;s memories if you lose every leader machine.
        </p>
        <p className="select-all rounded-md border border-border bg-muted/30 px-3 py-2 text-center font-mono text-fs tracking-[0.08em] text-foreground">
          {codigo}
        </p>
        <label className="flex items-center gap-2 text-fs-sm text-foreground">
          <input type="checkbox" checked={confirmado} onChange={(e) => setConfirmado(e.target.checked)} />
          I have saved it somewhere safe
        </label>
        <div><Button size="sm" disabled={!confirmado} onClick={() => setCodigo(null)}>Done</Button></div>
      </div>
    )
  }

  if (!estado.activated && !esLeader) {
    return (
      <div className={marco}>
        <div className="flex items-center gap-2">
          <ShieldQuestion size={ICON_SIZE.md} className="text-muted-foreground" aria-hidden />
          <p className="text-fs font-medium text-foreground">Team encryption</p>
        </div>
        <p className="text-fs-sm text-muted-foreground">
          Ask your team leader to turn on encryption for this team — only they can activate it.
        </p>
      </div>
    )
  }

  if (!estado.activated && esLeader) {
    return (
      <div className={marco}>
        <div className="flex items-center gap-2">
          <ShieldQuestion size={ICON_SIZE.md} className="text-muted-foreground" aria-hidden />
          <p className="text-fs font-medium text-foreground">Team encryption</p>
        </div>
        <p className="text-fs-sm text-muted-foreground">
          Once it&rsquo;s on, nobody who runs the server can read this team&rsquo;s shared memory — us included.
          Everything already shared gets re-encrypted too.
        </p>
        {error && <p className="text-fs-sm text-destructive">{error}</p>}
        <div><Button size="sm" disabled={ocupado} onClick={() => void activar()}>Turn on team encryption</Button></div>
      </div>
    )
  }

  if (!estado.hasMaster) {
    return (
      <div className={marco}>
        <div className="flex items-center gap-2">
          <ShieldAlert size={ICON_SIZE.md} className="text-warn" aria-hidden />
          <p className="text-fs font-medium text-foreground">This machine is not authorised yet</p>
        </div>
        <p className="text-fs-sm text-muted-foreground">
          Ask your team leader to authorise this machine, or use the team recovery code.
        </p>
        {error && <p className="text-fs-sm text-destructive">{error}</p>}
        {/* Reintentar a mano, igual que MemoryEncryptionCard: el intento automático de arriba
            corre al abrir la tarjeta, pero si el leader autoriza MIENTRAS esta pantalla ya
            está abierta, hace falta una forma de decir "ya está" sin cerrar y reabrir. */}
        {!recuperando && adoptar && (
          <div>
            <Button
              size="sm"
              disabled={buscandoAutorizacion}
              onClick={() => void (async () => {
                setBuscandoAutorizacion(true); setError(null)
                try {
                  const res = await adoptar(activeTeam.id)
                  if (res.ok && res.adoptada) await refrescar()
                  else if (res.ok) setError('No authorisation for this machine yet.')
                  else setError(res.error ?? 'Could not check.')
                } finally { setBuscandoAutorizacion(false) }
              })()}
            >
              {buscandoAutorizacion ? 'Checking…' : "I've been authorised"}
            </Button>
          </div>
        )}
        {recuperando ? (
          <div className="flex flex-col gap-2">
            <Input value={codigoTipeado} onChange={(e) => setCodigoTipeado(e.target.value)}
              placeholder="XXXX-XXXX-XXXX-XXXX-XXXX-XXXX" aria-label="Team recovery code" className="font-mono" />
            <div className="flex gap-2">
              <Button size="sm" disabled={ocupado} onClick={() => void recuperar()}>Recover</Button>
              <Button size="sm" variant="ghost" onClick={() => setRecuperando(false)}>Cancel</Button>
            </div>
          </div>
        ) : (
          <div><Button size="sm" variant="outline" onClick={() => setRecuperando(true)}>Use the team recovery code</Button></div>
        )}
      </div>
    )
  }

  return (
    <div className={marco}>
      <div className="flex items-center gap-2">
        <ShieldCheck size={ICON_SIZE.md} className="text-ok" aria-hidden />
        <p className="text-fs font-medium text-foreground">Team encryption on</p>
      </div>
      {error && <p className="text-fs-sm text-destructive">{error}</p>}
      {esLeader && estado.pendingDevices.length > 0 && (
        <div className="flex flex-col gap-1">
          <p className="text-fs-sm text-foreground">Machines waiting for authorisation:</p>
          {estado.pendingDevices.map((d) => (
            <div key={d.deviceId} className="flex items-center justify-between rounded-md border border-border p-2">
              <p className="text-fs-sm text-foreground">{d.name}</p>
              <Button size="sm" variant="outline" disabled={ocupado} onClick={() => void autorizar(d.deviceId)}>Authorise</Button>
            </div>
          ))}
        </div>
      )}
      {esLeader && (
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" disabled={ocupado} onClick={() => void reencriptar()}>
            Re-upload what was already there
          </Button>
          {reencriptadas !== null && (
            <span className="text-fs-sm text-muted-foreground">
              <span className="font-mono tabular-nums text-foreground">{reencriptadas}</span> re-encrypted
            </span>
          )}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 4: Correr el test, confirmar que pasa**

Run: `npx vitest run src/__tests__/components/TeamEncryptionCard.test.tsx`
Expected: PASS (4 tests)

- [ ] **Step 5: Montarlo junto a `MemoryEncryptionCard`**

Ubicar el JSX que renderiza `<MemoryEncryptionCard />` (`Grep "MemoryEncryptionCard" src/components/MemoriesWorkspace.tsx`)
y agregar `<TeamEncryptionCard />` al lado, **sólo cuando hay un `activeTeam`** (la propia
card ya devuelve `null` sin uno, pero evitar el import/render innecesario en el caso Personal
puro es más barato).

- [ ] **Step 6: Commit**

```bash
git add src/components/TeamEncryptionCard.tsx src/__tests__/components/TeamEncryptionCard.test.tsx src/components/MemoriesWorkspace.tsx
git commit -m "feat(cifrado-equipo): tarjeta de UI, gateada por rol leader"
```

---

## Task 13: Integración real de punta a punta

**Files:**
- Create: `e2e/16-cifrado-de-equipo.spec.ts`

**Interfaces:**
- Consumes: todo lo anterior. Mismo harness que `e2e/13-equipo-dos-cuentas.spec.ts` (`cuentaNueva`,
  `apuntarAlRemoto`, `conectar`, `guardar`, `compartir`, `promoverPorMcp`, `abrirMemories`) —
  reusar esos helpers tal cual, importándolos o copiando el patrón si no están exportados.

Esto es lo que cierra el círculo: activar de verdad (vía IPC, no llamando las funciones
sueltas), migrar lo que ya estaba, autorizar al compañero, y que el compañero lo lea en claro
en su pantalla.

- [ ] **Step 1: Escribir el test**

```ts
// e2e/16-cifrado-de-equipo.spec.ts
// Mismo servicio real que e2e/13 (ver su encabezado para cómo levantarlo). Dos cuentas, un
// equipo: A es leader, comparte y promueve UNA memoria en claro ANTES de activar el cifrado
// (para probar la migración retroactiva), activa el cifrado, autoriza a B, y B la lee en
// claro en su pantalla — la nube, mientras tanto, nunca tuvo el texto legible.
import { test, expect } from '@playwright/test'
import { launchHarness, teardown } from './helpers/harness'
// reusar los mismos helpers que e2e/13: cuentaNueva, hacerMiembro (pero con role leader/member
// reales), apuntarAlRemoto, conectar, guardar, todoSubido, compartir, promoverPorMcp,
// abrirMemories, filaEnElServicio — copiar sus imports/firmas tal cual de ese archivo.

test('cifrado de equipo: migra lo viejo, autoriza al compañero, el compañero lo lee en claro', async () => {
  const marca = `ce${Date.now()}`
  const teamId = /* randomUUID() */ ''
  const cA = /* cuentaNueva(marca, 'leader') */ null!
  const cB = /* cuentaNueva(marca, 'companero') */ null!
  // hacerMiembro(cA, teamId, 'leader'); hacerMiembro(cB, teamId, 'member') — el helper de e2e/13
  // siempre pone role='member'; este test necesita una variante con role parametrizable.

  let h = await launchHarness()
  // apuntarAlRemoto(h.repoDir, marca); conectar(h.page, cA)
  // const { syncIdEquipo, projectKey } = await autorComparteYPromueve(h, teamId, marca) — reusar
  // tal cual de e2e/13.

  // Activar el cifrado DESPUÉS de tener una fila de equipo ya en claro en el servicio — es el
  // caso que prueba la migración.
  const act = await h.page.evaluate((tid) =>
    (window as unknown as { memory: { teamEncryptionActivate(t: string): Promise<{ ok: boolean; recoveryCode?: string }> } })
      .memory.teamEncryptionActivate(tid), teamId)
  expect(act.ok).toBe(true)

  // Migrar lo que ya estaba.
  const migr = await h.page.evaluate((tid) =>
    (window as unknown as { memory: { teamEncryptionRecrypt(t: string): Promise<{ applied: number }> } })
      .memory.teamEncryptionRecrypt(tid), teamId)
  expect(migr.applied).toBe(1)

  // En el SERVICIO, la fila ahora tiene que estar cifrada.
  // expect(filaEnElServicio(syncIdEquipo)!.title).toMatch(/^nmc1:/)

  await teardown(h); h = null as never

  // B se conecta: todavía no está autorizado, la fila de equipo se ve como pendiente.
  h = await launchHarness()
  // apuntarAlRemoto(h.repoDir, marca); conectar(h.page, cB)
  // await guardar(h.page, h.repoDir, `Nota propia del companero ${marca}`); await todoSubido(h.page)
  const estadoAntes = await h.page.evaluate((tid) =>
    (window as unknown as { memory: { teamEncryptionStatus(t: string): Promise<{ hasMaster: boolean }> } })
      .memory.teamEncryptionStatus(tid), teamId)
  expect(estadoAntes.hasMaster).toBe(false)
  await teardown(h)

  // A (el leader) autoriza el device de B.
  h = await launchHarness()
  // apuntarAlRemoto(h.repoDir, marca); conectar(h.page, cA)
  const estadoDeB = await h.page.evaluate((tid) =>
    (window as unknown as { memory: { teamEncryptionStatus(t: string): Promise<{ pendingDevices: Array<{ deviceId: string }> }> } })
      .memory.teamEncryptionStatus(tid), teamId)
  const deviceDeB = estadoDeB.pendingDevices[0].deviceId
  const auth = await h.page.evaluate(({ tid, dev }) =>
    (window as unknown as { memory: { teamEncryptionAuthorize(t: string, d: string): Promise<{ ok: boolean }> } })
      .memory.teamEncryptionAuthorize(tid, dev), { tid: teamId, dev: deviceDeB })
  expect(auth.ok).toBe(true)
  await teardown(h)

  // B, de nuevo: ya tiene la clave, y la memoria de equipo se lee EN CLARO en pantalla.
  h = await launchHarness()
  // apuntarAlRemoto(h.repoDir, marca); conectar(h.page, cB)
  // await abrirMemories(h.page)
  // await expect(h.page.getByText(deEquipo).first()).toBeVisible({ timeout: 20_000 })
  await teardown(h)
})
```

**Nota importante para quien implemente este task**: el esqueleto de arriba está deliberadamente
incompleto en los `// comentarios` — son exactamente los helpers de
`e2e/13-equipo-dos-cuentas.spec.ts` (líneas 60-230 de ese archivo), que hay que importar o
copiar tal cual, más UNA variante nueva de `hacerMiembro` que reciba `role: 'leader' | 'member'`
en vez de tenerlo fijo en `'member'`. Esto no es un placeholder de "implementar después": es la
instrucción de copiar un archivo ya escrito y adaptarlo, que es más preciso que repetir acá
230 líneas ya existentes letra por letra.

- [ ] **Step 2: Correr el test**

Run (ver encabezado de `e2e/13` para cómo levantar `nest-memory-pg` + el servicio local):
```
docker start nest-memory-pg
(cd server && PORT=8099 npx tsx src/index.ts)
npm run build
NEST_E2E_SYNC_URL=http://127.0.0.1:8099 NEST_E2E_PG_DOCKER=nest-memory-pg \
  npx playwright test e2e/16-cifrado-de-equipo.spec.ts
```
Expected: PASS

- [ ] **Step 3: Correr la suite completa (unitarios + los dos typechecks de CI) una última vez**

Run:
```
npx tsc -p tsconfig.node.json --noEmit --composite false
npx tsc -p tsconfig.web.json --noEmit --composite false
npm test
(cd server && npx vitest run)
```
Expected: 0 errores, todo verde — ésta es la foto final antes de pedir review de la rama.

- [ ] **Step 4: Commit**

```bash
git add e2e/16-cifrado-de-equipo.spec.ts
git commit -m "test(cifrado-equipo): e2e real de punta a punta — migración, autorización, lectura en claro"
```
