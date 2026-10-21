import type { Pool } from 'pg'
import { limitsFor } from './limits'
import { UUID_RE } from './uuid'

export interface ShareProjectBody {
  project_key?: unknown
  team_id?: unknown
}

export type ShareProjectResult =
  | { ok: true }
  | { ok: false; status: 400 | 403 | 404 | 409; error: string }

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
  auth: { userId: string; plan: string },
  body: ShareProjectBody
): Promise<ShareProjectResult> {
  /**
   * El plan, ANTES que nada.
   *
   * Faltaba, y el agujero era este: compartir un proyecto es la accion que hace que la
   * memoria pueda salir del autor, y no se chequeaba. `push.ts` si rechaza un
   * `scope: 'team'` de un plan que no lo tiene, asi que el usuario podia compartir con exito
   * —la accion devolvia ok, `projects.team_id` quedaba escrito— y recien despues descubrir
   * que ninguna memoria llegaba. Se gateaba la segunda puerta con la primera abierta.
   *
   * El mismo `teamScope` que usa el push: una sola fuente de verdad para el limite.
   */
  if (!limitsFor(auth.plan).teamScope) {
    return { ok: false, status: 403, error: 'sharing_needs_a_team_deployment' }
  }

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

  /**
   * Re-share entre equipos: prohibido si el equipo ACTUAL cifra (handoff 2026-10-15).
   *
   * Las filas de ese proyecto están selladas con la maestra del equipo actual, y el pull las
   * manda con el `team_id` del proyecto —el cliente elige la clave por ese id—. Moverlo a otro
   * equipo las deja ilegibles para todos: el nuevo no tiene la maestra vieja y el viejo ya no
   * las recibe. Se eligió prohibirlo antes que re-cifrar en el re-share o guardar el equipo
   * por fila: es lo más simple y no tiene estado intermedio que pueda quedar a medias.
   *
   * La condición va DENTRO del update y no en un select previo: entre leer y escribir otro
   * request podría activar la clave del equipo actual.
   */
  const { rowCount } = await pool.query(
    `update projects set team_id = $1
      where user_id = $2 and project_key = $3
        and (team_id is null or team_id = $1
             or not exists (select 1 from team_keys tk where tk.team_id = projects.team_id))`,
    [teamId, auth.userId, projectKey]
  )
  if (rowCount === 0) {
    // Cero filas es "no es tuyo / no existe" o "lo frenó el re-share". Se distingue mirando
    // SÓLO entre los proyectos del llamante, así que un project_key ajeno sigue dando 404 y
    // no filtra que existe bajo otra cuenta.
    const { rows: propio } = await pool.query(
      `select 1 from projects where user_id = $1 and project_key = $2`,
      [auth.userId, projectKey]
    )
    if (propio.length === 0) return { ok: false, status: 404, error: 'project_not_found' }
    return { ok: false, status: 409, error: 'team_encrypted_reshare_forbidden' }
  }

  return { ok: true }
}
