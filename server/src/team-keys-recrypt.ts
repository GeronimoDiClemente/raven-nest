// La única vía del sistema donde alguien reescribe contenido de una fila que no autoró — el
// push normal es por autor (`server/src/push.ts` guarda `where observations.author_id =
// excluded.author_id`, a propósito: evita una escritura cross-tenant). Esto existe SÓLO para
// la migración retroactiva del leader al activar el cifrado de equipo (spec §4), y se acota
// lo más posible: archivo propio, nunca toca `scope`/`type`/`author_id`/`lamport`, cada fila se
// valida CONTRA LA BASE (project.team_id + scope + que siga en claro + que nadie la haya
// editado desde que el leader la leyó) antes de tocarla — nunca confía en lo que mande el
// batch — y quien la pide tiene que probar que tiene la maestra del equipo.
import type { Pool } from 'pg'
import { isTeamLeader, pruebaDePosesionValida, type TeamKeysAuth } from './team-keys'
import { allocateSeqRange } from './seq'

type Fail<S extends number> = { ok: false; status: S; error: string }

export interface RecryptItem {
  sync_id: string
  title: string
  /** `null` para un tombstone (push.ts guarda `content = null` al borrar). Antes el servidor lo
   * rechazaba con `invalid_fields` y tiraba el LOTE entero (I2 de la review final). */
  content: string | null
  tags: unknown
  // Mismos dos campos que `SEALED_FIELDS` sella además de title/content (electron/
  // memory-envelope.ts). Sin re-cifrarlos acá, una fila migrada "retroactivamente" seguía
  // dejando `origin_account` —el email de quien la guardó— en claro para siempre: el mismo
  // leak que `server/README.md:32` ya documenta y arregló para personal. `null` se respeta
  // igual que en `sealMutationPayload`: significa que el valor original era null/ausente,
  // no "no cifrar".
  content_hash: string | null
  origin_account: string | null
  /**
   * El `lamport` de la copia que el leader cifró (I1). Si la fila de la base ya no tiene ese
   * lamport, alguien la editó después del último pull del leader, y escribir lo que él mandó
   * pisaría esa edición con contenido VIEJO bajo el lamport NUEVO — que además empata en LWW
   * con la copia de quien editó, así que ni siquiera converge.
   */
  lamport: number
}

/** Lo que `recrypt-pending` devuelve por página: trae el contenido, así que va chico. */
const PENDIENTES_POR_PAGINA = 200

export interface PendingRow {
  sync_id: string
  lamport: number
  title: string
  content: string | null
  tags: unknown
  content_hash: string | null
  origin_account: string | null
}

/**
 * Las filas `scope: 'team'` de ESTE equipo que siguen en claro, de CUALQUIER miembro (C1 de la
 * review final). Antes el cliente del leader armaba la migración con su `projects.team_id`
 * LOCAL, que sólo existe para los proyectos que ÉL compartió: lo que un member compartió desde
 * su propia copia quedaba en claro para siempre, mientras la tarjeta decía que se re-cifraba.
 *
 * "En claro" = `title` o `content` sin `nmc1:`. Los dos se miran porque los dos se sellan
 * juntos, y una fila a medias sigue exponiendo lo que le falta. Un `content` null (tombstone)
 * no cuenta como en claro.
 *
 * Devuelve el CONTENIDO de cada fila, no sólo el `sync_id`. La primera versión devolvía sólo
 * ids y el cliente las buscaba en su base local, pero el pull sólo baja filas de los
 * `project_key` que el device ya tiene: una fila de equipo de un repo que el leader no clonó
 * no le llega nunca, así que ningún pull la arreglaba y quedaba en claro para siempre. No
 * amplía lo que el leader puede leer: es miembro activo del equipo, y el pull ya le sirve toda
 * fila de equipo de cualquier proyecto con ese `team_id` (`pull.ts`, `p.team_id in
 * team_memberships`) — sólo le faltaba nombrar el `project_key`. Y lo que devuelve está en
 * claro en el servidor de todos modos: es exactamente lo que se va a sellar. Con el `lamport`
 * de cada fila, el recrypt rechaza (`stale`) lo que se edite entre esta lectura y el envío.
 *
 * Paginado por `sync_id` (keyset): la lista se achica a medida que la migración avanza, así
 * que un offset saltearía filas. `total` es el conteo entero, para que la UI muestre cuánto
 * falta sin recorrer todas las páginas.
 */
export async function listRecryptPending(
  pool: Pool,
  auth: TeamKeysAuth,
  teamId: string,
  opts: { after?: string; limit?: number }
): Promise<{ ok: true; total: number; items: PendingRow[] } | Fail<403>> {
  if (!(await isTeamLeader(pool, auth.userId, teamId))) {
    return { ok: false, status: 403, error: 'leader_required' }
  }
  const enClaro = `o.scope = 'team' and p.team_id = $1
     and (o.title not like 'nmc1:%' or (o.content is not null and o.content not like 'nmc1:%'))`
  const limit = Math.max(1, Math.min(PENDIENTES_POR_PAGINA, Math.floor(opts.limit ?? PENDIENTES_POR_PAGINA)))
  const { rows: totalRows } = await pool.query(
    `select count(*)::int as n from observations o join projects p on p.id = o.project_id where ${enClaro}`,
    [teamId]
  )
  const { rows } = await pool.query(
    `select o.sync_id, o.lamport, o.title, o.content, o.tags, o.content_hash, o.origin_account
       from observations o join projects p on p.id = o.project_id
      where ${enClaro} and ($2::text is null or o.sync_id > $2::text)
      order by o.sync_id
      limit $3`,
    [teamId, opts.after ?? null, limit]
  )
  return {
    ok: true,
    total: Number(totalRows[0]?.n ?? 0),
    items: rows.map((r) => ({
      sync_id: String(r.sync_id),
      lamport: Number(r.lamport),
      title: String(r.title ?? ''),
      content: (r.content as string | null) ?? null,
      tags: r.tags ?? [],
      content_hash: (r.content_hash as string | null) ?? null,
      origin_account: (r.origin_account as string | null) ?? null,
    })),
  }
}

export async function recryptTeamObservations(
  pool: Pool,
  auth: TeamKeysAuth,
  teamId: string,
  body: { items?: unknown; proof?: unknown }
): Promise<{ ok: true; applied: string[]; rejected: Array<{ sync_id: string; error: string }> } | Fail<400> | Fail<403> | Fail<404>> {
  if (!(await isTeamLeader(pool, auth.userId, teamId))) {
    return { ok: false, status: 403, error: 'leader_required' }
  }
  const { rows: activado } = await pool.query('select 1 from team_keys where team_id = $1', [teamId])
  if (activado.length === 0) return { ok: false, status: 404, error: 'not_activated' }
  /**
   * C2 (review final): un leader SIN la maestra (spec §6: el rol se transfiere, la clave no)
   * podía mandar "ciphertext" de cualquier cosa —con el prefijo `nmc1:` alcanza para pasar
   * todos los chequeos— y dejar el histórico del equipo ilegible para todos, para siempre: lo
   * que hay en claro se reemplaza y no queda copia en el servidor.
   */
  if (!(await pruebaDePosesionValida(pool, teamId, body?.proof))) {
    return { ok: false, status: 403, error: 'must_hold_team_key' }
  }
  const items = Array.isArray(body?.items) ? (body.items as RecryptItem[]) : []
  if (items.length === 0) return { ok: false, status: 400, error: 'no_items' }
  for (const it of items) {
    if (typeof it?.sync_id !== 'string' || it.sync_id.trim() === '') {
      return { ok: false, status: 400, error: 'invalid_sync_id' }
    }
    if (typeof it?.title !== 'string') {
      return { ok: false, status: 400, error: 'invalid_fields' }
    }
    if (it.content !== null && typeof it.content !== 'string') {
      return { ok: false, status: 400, error: 'invalid_fields' }
    }
    if (it.content_hash !== null && typeof it.content_hash !== 'string') {
      return { ok: false, status: 400, error: 'invalid_fields' }
    }
    if (it.origin_account !== null && typeof it.origin_account !== 'string') {
      return { ok: false, status: 400, error: 'invalid_fields' }
    }
    if (typeof it.lamport !== 'number' || !Number.isInteger(it.lamport) || it.lamport < 0) {
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
      // scope personal, sync_id inventado— no matchea ninguna fila y cae al rows.length === 0
      // de abajo. `for update` toma el lock de la fila antes del allocateSeqRange, así que lo
      // que se compara abajo (título y lamport) no cambia entre el chequeo y el update.
      const { rows } = await client.query(
        `select o.project_id, o.title, o.lamport from observations o
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
      // I1: una fila ya sellada se escribió DESPUÉS de activar (push normal, ya cifrado) o ya
      // se migró. Pisarla con lo que el leader cifró de su copia local es volver atrás.
      if (String(rows[0].title).startsWith('nmc1:')) {
        await client.query('rollback')
        rejected.push({ sync_id: it.sync_id, error: 'already_sealed' })
        continue
      }
      if (Number(rows[0].lamport) !== it.lamport) {
        await client.query('rollback')
        rejected.push({ sync_id: it.sync_id, error: 'stale' })
        continue
      }
      const projectId = Number(rows[0].project_id)
      const nuevoSeq = await allocateSeqRange(client, projectId, 1)
      // El lamport NO se toca: re-cifrar no es editar, y subirlo haría ganar esta versión en
      // LWW contra una edición concurrente. El bump de `project_seq` alcanza para que el resto
      // de los devices la vuelva a bajar.
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
