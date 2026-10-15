import type { Pool } from 'pg'
import { limitsFor, maxBytesFor } from './limits'

export interface StatusRosterProject {
  project_key: string
  display_name: string
  /** Task 14: con qué equipo está compartido este proyecto propio, o null. Es lo que le permite
   * a la OTRA máquina de quien compartió saber que sus filas de equipo van a ese equipo (y
   * con qué clave sellarlas): `projects.team_id` local sólo lo escribe la máquina que compartió. */
  team_id: string | null
}

export interface StatusResponse {
  device_id: string
  user_id: string
  plan: string
  next_poll_ms: number
  server_time: string
  quota: { used_bytes: number; max_bytes: number }
  // §5.3.1: the roster — keys and display names only, NEVER rows. `handlePull` only ever
  // returns rows for cursors the device already sent (the M25 hot-loop guarantee), so a
  // project a device has never seen locally can never surface through pull no matter how
  // long it waits. This is the only place a device can learn a project exists at all: the
  // client calls `ensureProject()` for anything here it doesn't already know, and that
  // project's cursor (starting at 0) then travels in the NEXT pull's `cursors` naturally —
  // no row is ever handed back for a cursor the device didn't ask for.
  projects: StatusRosterProject[]
  /**
   * La época de claves de la cuenta: 0 = esta cuenta NO tiene el cifrado activo.
   *
   * Está acá y no sólo en `GET /v1/keys` porque el cliente lo necesita en el camino que SÍ
   * recorre siempre. El daemon nunca llama `/v1/keys` —eso lo hace la tarjeta de cifrado, o
   * sea sólo si el usuario abre el overlay Memories— así que hasta el 2026-09-13 una máquina
   * que no tenía la clave no tenía forma de enterarse de que la cuenta cifraba, y el gate
   * fail-closed del push no llegaba a armarse: subía título y contenido EN CLARO a una cuenta
   * cifrada, con estado `idle` y sin un solo mensaje.
   *
   * No filtra nada: es un entero que dice si hay cifrado y cuántas veces se rotó, y ya viaja
   * en `GET /v1/keys` para el mismo usuario autenticado.
   */
  key_epoch: number
  /**
   * Task 14 (spec §9.4): los equipos con cifrado activo donde quien llama es miembro ACTIVO,
   * y si ESTE device ya tiene envoltura. Mismo motivo que `key_epoch`: el daemon tiene que
   * saber que un equipo cifra en el primer `status` del arranque, sin depender de que el
   * usuario abra la tarjeta — si no, sube filas de equipo EN CLARO a un equipo que cifra.
   * Sin época: v1 no rota la clave de equipo (spec §2, §8).
   */
  encrypted_teams: Array<{ team_id: string; has_wrap: boolean }>
}

// §5.3: this is the device's health check — today the client has no way to tell a dead
// subsystem from a healthy-but-unsynced one — and it is where the server hands back
// `next_poll_ms`, the one real cost lever the design has (~99% of pulls come back empty).
export async function handleStatus(
  pool: Pool,
  auth: { deviceId: string; userId: string; plan: string }
): Promise<StatusResponse> {
  // `where p.user_id = $1` is load-bearing: without it this sums every user's bytes, not
  // just this one's, and leaks the size of other tenants' data through a health check.
  // `coalesce(o.content, '')` is likewise required — a tombstone has null content, and
  // summing octet_length over a raw null would blow up rather than count as zero.
  const { rows } = await pool.query(
    `select coalesce(sum(octet_length(coalesce(o.content, ''))), 0)::bigint as used
       from observations o join projects p on p.id = o.project_id
      where p.user_id = $1`,
    [auth.userId]
  )

  // `where user_id = $1` is load-bearing here too, same as the quota query above: without
  // it every user's project roster leaks into every other user's status response.
  const { rows: projectRows } = await pool.query(
    `select project_key, display_name, team_id from projects where user_id = $1 order by project_key`,
    [auth.userId]
  )

  // La época va en la MISMA respuesta y no en una request aparte: el punto es que el cliente
  // se entere en el primer `status` de cualquier arranque, sin pagar un round-trip extra ni
  // depender de haber bajado una fila que no puede abrir.
  const { rows: epochRows } = await pool.query(
    'select key_epoch from users where id = $1',
    [auth.userId]
  )

  // `tm.user_id = $1 and tm.status = 'active'` es lo que hace que esto no filtre equipos
  // ajenos ni equipos de los que ya me fui. `has_wrap` se mira contra ESTE device (slot =
  // device_id), no contra la cuenta: es lo que decide si esta máquina puede readoptar sola.
  const { rows: equiposRows } = await pool.query(
    `select tk.team_id::text as team_id,
            exists (select 1 from team_key_wraps w
                     where w.team_id = tk.team_id and w.slot = $2::text) as has_wrap
       from team_keys tk
       join team_memberships tm on tm.team_id = tk.team_id
      where tm.user_id = $1 and tm.status = 'active'
      order by tk.team_id`,
    [auth.userId, auth.deviceId]
  )

  const limits = limitsFor(auth.plan)

  return {
    device_id: auth.deviceId,
    user_id: auth.userId,
    plan: auth.plan,
    next_poll_ms: limits.nextPollMs,
    server_time: new Date().toISOString(),
    // `maxBytesFor`, no `limits.maxBytes`: es la MISMA vía por la que `push.ts` decide
    // `quota_exceeded`, así que lo que el cliente ve informado acá es exactamente el techo
    // que se le va a aplicar — override de instancia dedicada incluido.
    quota: { used_bytes: Number(rows[0].used), max_bytes: maxBytesFor(auth.plan) },
    projects: projectRows.map((r) => ({
      project_key: r.project_key,
      display_name: r.display_name,
      team_id: (r.team_id as string | null) ?? null,
    })),
    key_epoch: Number(epochRows[0]?.key_epoch ?? 0),
    encrypted_teams: equiposRows.map((r) => ({ team_id: String(r.team_id), has_wrap: Boolean(r.has_wrap) })),
  }
}
