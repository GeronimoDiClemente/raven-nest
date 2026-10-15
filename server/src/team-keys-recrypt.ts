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
import { resolveTopicCollision } from './lww'

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
  /**
   * Task 15b (I2): el HMAC del tema (`hmacTopicKey` con la clave de equipo: 32 hex), o null si
   * la fila no tiene tema. Antes la migración no lo tocaba: el histórico quedaba con el tema en
   * claro (se lo filtraba al operador) y una fila nueva del mismo tema —que llega con el HMAC—
   * nunca la encontraba para el supersede. Ausente equivale a null; una fila CON tema que llega
   * sin él se rechaza (`missing_topic_key`) y sigue pendiente, en vez de quedar "sellada" con
   * el tema a la vista.
   */
  topic_key?: string | null
}

/** Lo que `recrypt-pending` devuelve por página: trae el contenido, así que va chico. */
const PENDIENTES_POR_PAGINA = 200
/**
 * Minor 2 (review de Task 15): además del tope de filas, uno de bytes. 200 filas de contenido
 * grande podían sumar cientos de MiB en una sola respuesta. Una fila que sola pasa el tope va
 * sola: nunca se devuelve una página vacía mientras quede algo, o el cliente cortaría creyendo
 * que terminó.
 */
const BYTES_POR_PAGINA = 1024 * 1024

/** 32 hex en minúscula: exactamente lo que devuelve `hmacTopicKey` (electron/memory-crypto.ts). */
const HMAC_DE_TEMA = /^[0-9a-f]{32}$/

/**
 * EL predicado de "esta fila sigue (al menos en parte) en claro". Uno solo para `recrypt-pending`
 * y para el `already_sealed` de `recrypt` (Minor 1): antes pending miraba title O content y
 * recrypt sólo title, así que una fila con el título sellado y el resto en claro aparecía como
 * pendiente para siempre y recrypt la rechazaba siempre.
 *
 * Mira todo lo que `sealMutationPayload` sella: title, content, content_hash, origin_account y
 * tags (que se sellan como UN sobre: `["nmc1:…"]`). Un null o un `[]` no cuenta como en claro.
 *
 * `topic_key` NO entra, a propósito: sellado es un HMAC de 32 hex, que no se distingue de un
 * tema en claro que justo sea 32 hex — meterlo daría falsos "en claro" o falsos "sellado". Y no
 * hace falta: una fila que sella `sealMutationPayload` sale con el tema ya hasheado, y una que
 * migra este archivo cambia el tema en la MISMA escritura que el título, así que ninguna fila
 * que este predicado da por sellada conserva el tema en claro.
 *
 * El `case` de los tags no es estilo: `jsonb_array_length` lanza sobre un jsonb que no es array,
 * y en un `and` Postgres no garantiza el orden de evaluación.
 */
function enClaro(o: string): string {
  const campo = (c: string) => `(${o}.${c} is not null and ${o}.${c} not like 'nmc1:%')`
  return `(${o}.title not like 'nmc1:%'
    or ${campo('content')} or ${campo('content_hash')} or ${campo('origin_account')}
    or case when jsonb_typeof(${o}.tags) = 'array' and jsonb_array_length(${o}.tags) > 0
            then not (jsonb_array_length(${o}.tags) = 1 and coalesce(${o}.tags->>0, '') like 'nmc1:%')
            else false end)`
}

export interface PendingRow {
  sync_id: string
  lamport: number
  title: string
  content: string | null
  tags: unknown
  content_hash: string | null
  origin_account: string | null
  /** Task 15b (I2): con estos dos el cliente deriva el MISMO HMAC de tema que una fila nueva
   * (`hmacTopicKey(claves, project_key, 'team', tema)`), sin tener el proyecto clonado. */
  project_key: string
  topic_key: string | null
}

/**
 * Las filas `scope: 'team'` de ESTE equipo que siguen en claro, de CUALQUIER miembro (C1 de la
 * review final). Antes el cliente del leader armaba la migración con su `projects.team_id`
 * LOCAL, que sólo existe para los proyectos que ÉL compartió: lo que un member compartió desde
 * su propia copia quedaba en claro para siempre, mientras la tarjeta decía que se re-cifraba.
 *
 * "En claro" = `enClaro()` de arriba. Un `content` null (tombstone) no cuenta como en claro.
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
 * falta sin recorrer todas las páginas. La página corta por filas Y por bytes; como el corte es
 * siempre un prefijo en orden de `sync_id`, el `after` = último `sync_id` devuelto sigue siendo
 * correcto.
 */
export async function listRecryptPending(
  pool: Pool,
  auth: TeamKeysAuth,
  teamId: string,
  opts: { after?: string; limit?: number; maxBytes?: number }
): Promise<{ ok: true; total: number; items: PendingRow[] } | Fail<403>> {
  if (!(await isTeamLeader(pool, auth.userId, teamId))) {
    return { ok: false, status: 403, error: 'leader_required' }
  }
  const pendiente = `o.scope = 'team' and p.team_id = $1 and ${enClaro('o')}`
  const limit = Math.max(1, Math.min(PENDIENTES_POR_PAGINA, Math.floor(opts.limit ?? PENDIENTES_POR_PAGINA)))
  const maxBytes = Math.max(1, Math.floor(opts.maxBytes ?? BYTES_POR_PAGINA))
  const { rows: totalRows } = await pool.query(
    `select count(*)::int as n from observations o join projects p on p.id = o.project_id where ${pendiente}`,
    [teamId]
  )
  // El acumulado se calcula sobre la página ya cortada por filas (a lo sumo 200), no sobre todo
  // lo pendiente del equipo. `n = 1` es "al menos una fila", aunque sola pase el tope.
  const { rows } = await pool.query(
    `with pagina as (
       select o.sync_id, o.lamport, o.title, o.content, o.tags, o.content_hash, o.origin_account,
              o.topic_key, p.project_key,
              octet_length(o.title) + coalesce(octet_length(o.content), 0)
                + coalesce(octet_length(o.tags::text), 0) + coalesce(octet_length(o.content_hash), 0)
                + coalesce(octet_length(o.origin_account), 0) + coalesce(octet_length(o.topic_key), 0)
                + octet_length(p.project_key) as bytes
         from observations o join projects p on p.id = o.project_id
        where ${pendiente} and ($2::text is null or o.sync_id > $2::text)
        order by o.sync_id
        limit $3
     ), acumulada as (
       select pagina.*,
              sum(bytes) over (order by sync_id) as hasta_aca,
              row_number() over (order by sync_id) as n
         from pagina
     )
     select * from acumulada where n = 1 or hasta_aca <= $4 order by sync_id`,
    [teamId, opts.after ?? null, limit, maxBytes]
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
      project_key: String(r.project_key),
      topic_key: (r.topic_key as string | null) ?? null,
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
    // Lo único que el servidor puede chequear de un HMAC es la forma. Un tema en claro en este
    // campo sería volver a escribir el texto que se quiere sacar.
    if (it.topic_key != null && (typeof it.topic_key !== 'string' || !HMAC_DE_TEMA.test(it.topic_key))) {
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
      // que se compara abajo (si sigue en claro, lamport, tema) no cambia entre el chequeo y el
      // update.
      const { rows } = await client.query(
        `select o.project_id, o.lamport, o.topic_key, o.deleted, o.superseded_by, o.client_updated_at,
                ${enClaro('o')} as en_claro
           from observations o
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
      const actual = rows[0]
      // I1: una fila ya sellada se escribió DESPUÉS de activar (push normal, ya cifrado) o ya
      // se migró. Pisarla con lo que el leader cifró de su copia local es volver atrás. Mismo
      // predicado que `recrypt-pending` (Minor 1).
      if (!actual.en_claro) {
        await client.query('rollback')
        rejected.push({ sync_id: it.sync_id, error: 'already_sealed' })
        continue
      }
      if (Number(actual.lamport) !== it.lamport) {
        await client.query('rollback')
        rejected.push({ sync_id: it.sync_id, error: 'stale' })
        continue
      }
      // I2: una fila SIN tema queda sin tema, mande lo que mande el cliente. Una CON tema
      // necesita el HMAC: sellar el resto y dejar el tema en claro es justo lo que se arregla.
      const temaNuevo: string | null = actual.topic_key == null ? null : (it.topic_key ?? null)
      if (actual.topic_key != null && temaNuevo === null) {
        await client.query('rollback')
        rejected.push({ sync_id: it.sync_id, error: 'missing_topic_key' })
        continue
      }
      const projectId = Number(actual.project_id)
      const nuevoSeq = await allocateSeqRange(client, projectId, 1)

      // I2: con el HMAC, la fila migrada puede chocar contra una fila viva del mismo tema que se
      // guardó DESPUÉS de activar (ya llegó con el HMAC). `obs_topic_uniq` no admite dos vivas,
      // así que se resuelve igual que en push.ts (§8.1): mismo lock, misma regla
      // (`resolveTopicCollision`), y el que pierde queda `superseded_by` — nunca rechazado. Una
      // fila migrada que ya estaba superseded o borrada no compite (el índice no la mira).
      let supersededBy: string | null = (actual.superseded_by as string | null) ?? null
      const compite = temaNuevo !== null && !actual.deleted && supersededBy === null
      if (compite) {
        await client.query('select pg_advisory_xact_lock(hashtextextended($1, 0))', [
          `${projectId}:team:${temaNuevo}`,
        ])
        const owner = await client.query(
          `select sync_id, lamport, client_updated_at from observations
            where project_id = $1 and scope = 'team' and topic_key = $2
              and sync_id <> $3 and deleted = false and superseded_by is null
            for update`,
          [projectId, temaNuevo, it.sync_id]
        )
        if (owner.rows.length > 0) {
          const existente = {
            syncId: String(owner.rows[0].sync_id),
            updatedAt: new Date(owner.rows[0].client_updated_at).getTime(),
            lamport: Number(owner.rows[0].lamport),
          }
          const migrada = {
            syncId: it.sync_id,
            updatedAt: new Date(actual.client_updated_at).getTime(),
            lamport: Number(actual.lamport),
          }
          const { winner } = resolveTopicCollision(existente, migrada)
          if (winner.syncId === it.sync_id) {
            // Igual que push: el perdedor se marca ANTES de escribir el tema de la ganadora
            // (el índice no admite dos vivas ni por un instante) y recibe seq nuevo, para que
            // los devices que ya lo tenían se enteren de que perdió.
            await client.query(
              `update observations set superseded_by = $1, project_seq = $2 where sync_id = $3`,
              [it.sync_id, await allocateSeqRange(client, projectId, 1), existente.syncId]
            )
          } else {
            supersededBy = existente.syncId
          }
        }
      }

      // El lamport NO se toca: re-cifrar no es editar, y subirlo haría ganar esta versión en
      // LWW contra una edición concurrente. El bump de `project_seq` alcanza para que el resto
      // de los devices la vuelva a bajar.
      await client.query(
        `update observations
            set title = $1, content = $2, tags = $3::jsonb, project_seq = $4,
                content_hash = $5, origin_account = $6, topic_key = $7, superseded_by = $8
          where sync_id = $9`,
        [it.title, it.content, JSON.stringify(it.tags ?? []), nuevoSeq, it.content_hash, it.origin_account,
          temaNuevo, supersededBy, it.sync_id]
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
