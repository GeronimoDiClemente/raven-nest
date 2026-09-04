import type { Pool } from 'pg'

export interface ShareProjectBody {
  project_key?: unknown
  team_id?: unknown
}

export type ShareProjectResult =
  | { ok: true }
  | { ok: false; status: 400 | 403 | 404; error: string }

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * `POST /v1/projects/share` (Team Memory Layer 1, Parte 3) — la ÚNICA forma de que un
 * proyecto quede compartido con un equipo: ningún otro camino del servicio escribe
 * `projects.team_id`.
 *
 * Dos chequeos, los dos server-side por la misma razón que el resto de los gates de este
 * servicio (§9.3 del push original — lo que sólo se chequea en el renderer no está
 * chequeado): que `auth.userId` sea miembro ACTIVO de `team_id` (contra el espejo
 * `team_memberships` que `registerDevice` ya sincroniza desde Supabase con el JWT del
 * propio usuario — Parte 2), y que el proyecto sea DEL llamante.
 *
 * El segundo chequeo no es una query separada: el propio `update ... where user_id = $1`
 * ya lo hace. Un `project_key` ajeno o inexistente da `rowCount = 0` por igual, así que la
 * respuesta no filtra si ese project_key existe bajo otro dueño.
 */
export async function handleShareProject(
  pool: Pool,
  auth: { userId: string },
  body: ShareProjectBody
): Promise<ShareProjectResult> {
  const projectKey = typeof body.project_key === 'string' ? body.project_key.trim() : ''
  if (!projectKey) return { ok: false, status: 400, error: 'missing_project_key' }

  // Validado ACÁ, no dejado para que Postgres lo rechace: `team_id` cae en una columna
  // `uuid`, y un valor mal formado ahí produce un 22P02 que el catch genérico de http.ts
  // no sabe clasificar como error del cliente — terminaría en un 500 nuestro por un dato
  // mal formado del caller.
  const teamId = typeof body.team_id === 'string' ? body.team_id.trim() : ''
  if (!UUID_RE.test(teamId)) return { ok: false, status: 400, error: 'invalid_team_id' }

  const { rows: membership } = await pool.query(
    `select 1 from team_memberships where user_id = $1 and team_id = $2 and status = 'active'`,
    [auth.userId, teamId]
  )
  if (membership.length === 0) return { ok: false, status: 403, error: 'not_team_member' }

  const { rowCount } = await pool.query(
    `update projects set team_id = $1 where user_id = $2 and project_key = $3`,
    [teamId, auth.userId, projectKey]
  )
  if (rowCount === 0) return { ok: false, status: 404, error: 'project_not_found' }

  return { ok: true }
}
