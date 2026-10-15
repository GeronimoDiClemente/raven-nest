import type { Pool } from 'pg'
import { limitsFor } from './limits'

/**
 * `project_key` → `source` → cursor. `source` es el id del proyecto DE OTRA PERSONA del que
 * salen las filas de equipo: opaco para el cliente, que sólo lo guarda y lo devuelve.
 */
export type TeamCursors = Record<string, Record<string, number>>

export interface PullBody {
  cursors?: Record<string, number>
  /**
   * Los cursores de lo que viene de proyectos AJENOS compartidos con un equipo. Que el campo
   * venga —aunque sea `{}`— es lo que dice que el cliente sabe llevarlos; ver `handlePull`.
   */
  team_cursors?: TeamCursors
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
  author_id: string | null
  author_display: string | null
  content_hash: string | null
  /**
   * Task 14: sólo en filas `scope: 'team'` — el `projects.team_id` del proyecto de ORIGEN.
   * El cliente elige con esto la clave de equipo para descifrar; su `projects.team_id` local
   * sólo existe si ÉL compartió su copia, y un compañero no tiene por qué haberlo hecho.
   * No filtra nada: la fila sólo viaja a miembros activos de ese equipo o a su dueño.
   */
  team_id?: string | null
}

export interface PullResponse {
  rows: PulledRow[]
  cursors: Record<string, number>
  /** Sólo cuando el pedido trajo `team_cursors`. */
  team_cursors?: TeamCursors
  next_poll_ms: number
}

const MAX_LIMIT = 500

const cursorSano = (v: unknown): number => {
  const n = Number(v)
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0
}

const COLUMNAS = `o.sync_id, p.project_key, o.project_seq, o.client_updated_at, o.lamport, o.scope,
            o.type, o.topic_key, o.title, o.content, o.tags, o.deleted, o.superseded_by,
            o.origin_ai, o.origin_account, o.git_branch, o.author_id, o.author_display, o.content_hash,
            p.team_id`

function aFila(r: Record<string, unknown>): PulledRow {
  return {
    sync_id: r.sync_id as string,
    project_key: r.project_key as string,
    project_seq: Number(r.project_seq),
    client_updated_at: new Date(r.client_updated_at as string).toISOString(),
    lamport: Number(r.lamport),
    scope: r.scope as string,
    type: r.type as string,
    topic_key: r.topic_key as string | null,
    title: r.title as string,
    content: r.content as string | null,
    tags: Array.isArray(r.tags) ? (r.tags as string[]) : [],
    deleted: r.deleted as boolean,
    superseded_by: r.superseded_by as string | null,
    origin_ai: r.origin_ai as string | null,
    origin_account: r.origin_account as string | null,
    git_branch: r.git_branch as string | null,
    author_id: r.author_id as string | null,
    author_display: r.author_display as string | null,
    content_hash: r.content_hash as string | null,
    // Spread condicional y no `team_id: null` en todas: una fila personal no tiene equipo, y
    // agregarle la clave cambiaría el shape que ya ven los tests y los clientes de hoy.
    ...(r.scope === 'team' ? { team_id: (r.team_id as string | null) ?? null } : {}),
  }
}

export async function handlePull(
  pool: Pool,
  auth: { userId: string; plan: string; deviceId: string },
  body: PullBody
): Promise<PullResponse> {
  // Observabilidad (005_observability.sql): un incremento por LLAMADA, no por fila
  // devuelta — corre antes del early-return de cursores vacíos a propósito, porque ese
  // caso (sin nada que traer) es ~99% del tráfico real (§11.4) y el contador mide
  // actividad, no resultados. A diferencia del rechazo terminal en push.ts, acá no hay
  // ninguna transacción abierta que pueda hacer rollback de este UPDATE: es un statement
  // suelto en autocommit, así que no hace falta el patrón de "loguear después del
  // rollback" que usa push.ts para rejected_pushes.
  await pool.query(`update devices set pull_count = pull_count + 1 where id = $1`, [auth.deviceId])

  // §11.4: the interval is the server's call, not the client's. It is the only real cost
  // lever, because ~99% of pulls come back empty — and it now depends on the caller's
  // plan, same as the quota in `handleStatus`.
  const nextPollMs = limitsFor(auth.plan).nextPollMs
  const cursors = body.cursors ?? {}
  const keys = Object.keys(cursors)

  // `limit` is device-controlled input, not trusted. A non-finite, fractional, or
  // negative value falls back to the max rather than being passed through to a bigint SQL
  // parameter, where Postgres would throw ("invalid input syntax for type bigint") and turn
  // a malformed client request into a 500 instead of a well-defined response.
  //
  // `limit: 0` is treated as a genuine zero-row request, not "unspecified" — a client
  // polling only to read `next_poll_ms` should get back zero rows, not up to MAX_LIMIT.
  // Only an omitted or malformed limit (undefined, NaN, negative) falls back to the max.
  const rawLimit = Number(body.limit)
  const limit =
    Number.isFinite(rawLimit) && rawLimit >= 0 ? Math.min(Math.floor(rawLimit), MAX_LIMIT) : MAX_LIMIT

  // Empty cursors deliberately means "nothing to report" and returns nothing — NOT "give
  // me everything." Iterating every project the caller has is exactly the hot-loop
  // regression described below that this handler exists to prevent: a device must name a
  // project before this handler will ever return rows for it.
  if (keys.length === 0) return { rows: [], cursors: {}, next_poll_ms: nextPollMs }

  // Only projects whose cursor this device actually sent. Returning rows for unsent
  // cursors is what made the old client hot-loop: the server iterated every account
  // project and defaulted an unsent cursor to 0, so a project the device did not know
  // restarted from 0 on every pull, forever.
  //
  // Each cursor value is likewise device-controlled: a non-finite or negative value falls
  // back to 0, which means "send me everything for this project" — the same starting
  // point as a device that has never synced it. That is always safe: it can only cause
  // rows already seen to be re-sent, never a row to be skipped.
  const cursorValues = keys.map((k) => cursorSano(cursors[k]))

  // Seed `next` from the clamped values, not the raw `cursors` input — otherwise a
  // malformed cursor (e.g. a non-numeric string) would round-trip back to the client
  // unchanged: `seq > "not-a-number"` coerces to `seq > NaN`, which is always false, so
  // the bad value would never get overwritten by a real project_seq.
  const next: Record<string, number> = {}
  keys.forEach((k, i) => { next[k] = cursorValues[i] })

  if (body.team_cursors !== undefined) {
    return pullConCursoresDeEquipo(pool, auth, body.team_cursors, keys, cursorValues, next, limit, nextPollMs)
  }

  // ── Cliente que todavía no manda `team_cursors` ────────────────────────────────────────
  // Lo de abajo queda como estaba, a propósito: es el comportamiento que esos clientes ya
  // conocen. Tiene el defecto que `pullConCursoresDeEquipo` existe para arreglar.

  // Team Memory Layer 1, Parte 5. Dos caminos por los que una fila puede volver, y sólo
  // dos: la propia (`p.user_id = $1`, sin cambios) o una ajena que además cumple LAS DOS
  // cosas a la vez — `o.scope = 'team'` en ESA fila puntual (no alcanza con que el
  // proyecto esté compartido: una fila 'personal' o 'project' en un proyecto ya
  // compartido tiene que seguir sin viajar) y `p.team_id` uno de los equipos donde el
  // llamante es miembro ACTIVO hoy (el espejo `team_memberships` que `registerDevice`
  // sincroniza desde Supabase — Parte 2). Sin la unión de las dos condiciones sobre LA
  // FILA, alcanzaría con que el proyecto tuviera team_id para filtrar por scope="team" de
  // cualquier fila del proyecto — exactamente la fuga que el test dedicado
  // (`pull-team-scope.test.ts`) existe para cerrar.
  const { rows } = await pool.query(
    `select ${COLUMNAS}
       from observations o
       join projects p on p.id = o.project_id
       join unnest($2::text[], $3::bigint[]) as c(project_key, cursor) on c.project_key = p.project_key
      where (p.user_id = $1
             or (o.scope = 'team' and p.team_id in (
                  select team_id from team_memberships
                   where user_id = $1 and status = 'active'
                )))
        and o.project_seq > c.cursor
      order by o.project_seq asc
      limit $4`,
    [auth.userId, keys, cursorValues, limit]
  )

  const mapped: PulledRow[] = rows.map((r) => {
    const fila = aFila(r)
    if (fila.project_seq > (next[fila.project_key] ?? 0)) next[fila.project_key] = fila.project_seq
    return fila
  })

  return { rows: mapped, cursors: next, next_poll_ms: nextPollMs }
}

/**
 * El pull para un cliente que lleva los cursores de equipo aparte.
 *
 * El defecto que arregla: `project_seq` se cuenta POR PROYECTO, y el proyecto del autor y el
 * del compañero son dos proyectos distintos que comparten `project_key` (los dos clonaron el
 * mismo repo). Con un solo cursor por `project_key`, el del compañero avanza con sus propias
 * memorias, y una fila de equipo cuyo `project_seq` —contado en el proyecto del AUTOR— queda
 * por debajo no vuelve nunca, sin error. No era un caso raro: cualquiera que haya trabajado
 * en el repo ya tiene memorias propias ahí. Lo encontró `e2e/13-equipo-dos-cuentas.spec.ts`.
 *
 * Así que son dos consultas con dos juegos de cursores:
 *   · lo propio, contra `cursors[project_key]`, que ahora sólo avanza con filas propias;
 *   · lo ajeno de equipo, contra `team_cursors[project_key][source]`, un cursor por cada
 *     proyecto de origen — con dos compañeros compartiendo el mismo repo, un cursor único
 *     para "lo de equipo" tendría el mismo defecto entre ellos dos.
 *
 * Un `source` que el cliente no mandó arranca en 0: es como se entera de un proyecto recién
 * compartido, o de una membresía nueva. La autorización es la misma de siempre y se evalúa
 * por FILA (ver el comentario del camino viejo, arriba): los cursores sólo dicen desde dónde.
 */
async function pullConCursoresDeEquipo(
  pool: Pool,
  auth: { userId: string },
  teamCursorsIn: TeamCursors,
  keys: string[],
  cursorValues: number[],
  next: Record<string, number>,
  limit: number,
  nextPollMs: number
): Promise<PullResponse> {
  const { rows: propias } = await pool.query(
    `select ${COLUMNAS}
       from observations o
       join projects p on p.id = o.project_id
       join unnest($2::text[], $3::bigint[]) as c(project_key, cursor) on c.project_key = p.project_key
      where p.user_id = $1
        and o.project_seq > c.cursor
      order by o.project_seq asc
      limit $4`,
    [auth.userId, keys, cursorValues, limit]
  )

  // Sólo de los proyectos que el device nombró en `cursors`, igual que lo propio: un
  // `team_cursors` con una `project_key` que no está ahí no abre nada.
  const tk: string[] = []
  const ts: string[] = []
  const tc: number[] = []
  const nextTeam: TeamCursors = {}
  const entrada = teamCursorsIn && typeof teamCursorsIn === 'object' ? teamCursorsIn : {}
  for (const key of keys) {
    const porOrigen = entrada[key]
    if (!porOrigen || typeof porOrigen !== 'object') continue
    for (const [source, cursor] of Object.entries(porOrigen)) {
      // `source` cae en una comparación contra `projects.id` (bigint): uno mal formado
      // sería un 22P02 de Postgres, o sea un 500 nuestro por un dato del cliente.
      if (!/^\d{1,18}$/.test(source)) continue
      const sano = cursorSano(cursor)
      tk.push(key); ts.push(source); tc.push(sano)
      ;(nextTeam[key] ??= {})[source] = sano
    }
  }

  // Ordenado por origen y después por secuencia: si el `limit` corta, lo que queda afuera es
  // siempre la COLA de un origen (o un origen entero), nunca un hueco en el medio, así que
  // "el mayor `project_seq` devuelto de ese origen" es un cursor que no saltea nada.
  const { rows: ajenas } = await pool.query(
    `select ${COLUMNAS}, p.id as source_id
       from observations o
       join projects p on p.id = o.project_id
       left join unnest($3::text[], $4::bigint[], $5::bigint[]) as t(project_key, source_id, cursor)
              on t.project_key = p.project_key and t.source_id = p.id
      where p.project_key = any($2::text[])
        and p.user_id <> $1
        and o.scope = 'team'
        and p.team_id in (
              select team_id from team_memberships
               where user_id = $1 and status = 'active'
            )
        and o.project_seq > coalesce(t.cursor, 0)
      order by p.id asc, o.project_seq asc
      limit $6`,
    [auth.userId, keys, tk, ts, tc, limit]
  )

  const rows: PulledRow[] = []
  for (const r of propias) {
    const fila = aFila(r)
    if (fila.project_seq > (next[fila.project_key] ?? 0)) next[fila.project_key] = fila.project_seq
    rows.push(fila)
  }
  for (const r of ajenas) {
    const fila = aFila(r)
    const porOrigen = (nextTeam[fila.project_key] ??= {})
    const source = String(r.source_id)
    if (fila.project_seq > (porOrigen[source] ?? 0)) porOrigen[source] = fila.project_seq
    rows.push(fila)
  }

  return { rows, cursors: next, team_cursors: nextTeam, next_poll_ms: nextPollMs }
}
