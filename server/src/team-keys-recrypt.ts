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
  // Mismos dos campos que `SEALED_FIELDS` sella además de title/content (electron/
  // memory-envelope.ts). Sin re-cifrarlos acá, una fila migrada "retroactivamente" seguía
  // dejando `origin_account` —el email de quien la guardó— en claro para siempre: el mismo
  // leak que `server/README.md:32` ya documenta y arregló para personal. `null` se respeta
  // igual que en `sealMutationPayload`: significa que el valor original era null/ausente,
  // no "no cifrar".
  content_hash: string | null
  origin_account: string | null
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
    if (it.content_hash !== null && typeof it.content_hash !== 'string') {
      return { ok: false, status: 400, error: 'invalid_fields' }
    }
    if (it.origin_account !== null && typeof it.origin_account !== 'string') {
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
        `update observations
            set title = $1, content = $2, tags = $3::jsonb, project_seq = $4,
                content_hash = $5, origin_account = $6
          where sync_id = $7`,
        [it.title, it.content, JSON.stringify(it.tags ?? []), nuevoSeq, it.content_hash, it.origin_account, it.sync_id]
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
