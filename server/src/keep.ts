import type { Pool } from 'pg'
import { limitsFor } from './limits'
import { GLOBAL_PROJECT_KEY } from './push'

export type KeepResult =
  | { ok: true }
  | { ok: false; status: 400 | 409; error: 'unknown_project' | 'not_over_limit' }

/**
 * `POST /v1/projects/keep` (spec 2b-2 §4.7): qué proyecto sigue sincronizando quien quedó por
 * encima del tope. Sólo proyectos PROPIOS (la consulta es por `user_id`), nunca `__global__`.
 *
 * Bajo el mismo lock `project-limit:<user>` que el push: la elección y el chequeo de
 * permitidos de un push concurrente no se cruzan.
 */
export async function handleKeepProject(
  pool: Pool,
  auth: { userId: string; plan: string },
  body: Record<string, unknown>
): Promise<KeepResult> {
  const projectKey = typeof body.project_key === 'string' ? body.project_key : ''
  if (!projectKey || projectKey === GLOBAL_PROJECT_KEY) return { ok: false, status: 400, error: 'unknown_project' }

  const client = await pool.connect()
  try {
    await client.query('begin')
    await client.query('select pg_advisory_xact_lock(hashtextextended($1, 0))', [`project-limit:${auth.userId}`])
    const { rows } = await client.query('select project_key from projects where user_id = $1', [auth.userId])
    const propios = rows.map((r) => r.project_key as string).filter((k) => k !== GLOBAL_PROJECT_KEY)
    if (!propios.includes(projectKey)) {
      await client.query('rollback')
      return { ok: false, status: 400, error: 'unknown_project' }
    }
    if (propios.length <= limitsFor(auth.plan).maxProjects) {
      await client.query('rollback')
      return { ok: false, status: 409, error: 'not_over_limit' }
    }
    await client.query('update users set kept_project_key = $2 where id = $1', [auth.userId, projectKey])
    await client.query('commit')
    return { ok: true }
  } catch (err) {
    await client.query('rollback').catch(() => { /* la conexión ya puede estar rota */ })
    throw err
  } finally {
    client.release()
  }
}
