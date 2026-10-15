// electron/memory-team-reencrypt.ts
// Migración retroactiva (spec §4): el leader re-cifra lo que YA está en claro en la nube
// bajo la clave de equipo recién creada. A diferencia de la migración personal
// (memory-reencrypt.ts), esto reescribe filas de OTROS autores, así que no puede pasar por
// el push normal (server/src/push.ts exige same-author) — llama al endpoint dedicado.
//
// Task 15 (review final):
// - C1: QUÉ migrar, y CON QUÉ contenido, lo dice el SERVIDOR (`recrypt-pending`). Antes salía
//   de la base local filtrada por `projects.team_id` local, que sólo existe para los proyectos
//   que este device compartió: lo que un member compartió desde su copia quedaba en claro para
//   siempre. Tampoco alcanza con buscar local por `sync_id`: el pull sólo baja filas de los
//   `project_key` que el device ya tiene, así que una fila de un repo que el leader no clonó
//   no le llega nunca. El servidor ya la tiene en claro (es lo que se va a sellar) y el leader
//   ya está autorizado a leerla (miembro activo del equipo).
// - I1: cada item lleva el `lamport` de la versión que se selló; si la fila se edita entre la
//   lectura y el envío, el servidor la rechaza (`stale`) y queda para la próxima vuelta.
// - I3: lotes con tope de bytes, reintento ante 429, y un error a mitad devuelve lo aplicado.
//
// Task 15b: también se sella el TEMA (I2) — con el mismo HMAC que `sealMutationPayload` le pone
// a una fila nueva del equipo, para que el supersede las encuentre —, `migrateTeam` ya no puede
// rechazar (Minor 4), y lo pendiente sólo se pregunta si este usuario es leader (Minor 3).
import { deriveKeys, encryptField, fieldAad, hmacTopicKey, isCiphertext, teamKeyProof } from './memory-crypto'
import type { MemoryKeys } from './memory-crypto'

export interface TeamReencryptDeps {
  baseUrl: string
  token: string
  deviceId: string
  fetchImpl?: typeof fetch
}

/** Una fila de equipo que el servidor todavía tiene en claro, tal como la devuelve. */
interface FilaPendiente {
  sync_id: string
  lamport: number
  title: string
  content: string | null
  tags: unknown
  content_hash: string | null
  origin_account: string | null
  /** Task 15b (I2): el proyecto de la fila en el servidor y su tema EN CLARO (o null). */
  project_key: string
  topic_key: string | null
}

export interface TeamMigrationResult {
  /** Cuántas filas de equipo estaban en claro en el servidor al empezar. */
  total: number
  applied: number
  /** Rechazadas por el servidor fila por fila (`stale`, `already_sealed`, `not_found_in_team`). */
  rejected: number
  /** Cuántas siguen en claro en el servidor al terminar. La UI sólo dice "terminado" con 0. */
  remaining: number
  error?: string
}

export interface MigrateOpts {
  maxItemsPerBatch?: number
  maxBytesPerBatch?: number
  /** Inyectable para los tests; en la app es un setTimeout. */
  sleep?: (ms: number) => Promise<void>
}

/** Bajo el `MAX_BATCH` (500) de push: cada fila es una transacción en el servidor. */
const ITEMS_POR_LOTE = 200
/** 1 MiB, contra los 20 MiB de `MAX_BODY_BYTES`: un lote de 200 filas grandes los pasaba. */
const BYTES_POR_LOTE = 1024 * 1024
/** Reintentos por request ante un 429; después, el error sube y lo aplicado se conserva. */
const REINTENTOS_429 = 3
const ESPERA_MAXIMA_MS = 60_000

class RecryptHttpError extends Error {
  constructor(readonly status: number, detalle: string) {
    super(`recrypt rejected: ${status} ${detalle}`.trim())
    this.name = 'RecryptHttpError'
  }
}

async function pedir(
  deps: TeamReencryptDeps,
  path: string,
  init: { method: 'GET' | 'POST'; body?: string },
  sleep: (ms: number) => Promise<void>,
  reintentos = REINTENTOS_429
): Promise<unknown> {
  const f = deps.fetchImpl ?? fetch
  for (let intento = 0; ; intento++) {
    const res = await f(`${deps.baseUrl}${path}`, {
      method: init.method,
      headers: { Authorization: `Bearer ${deps.token}`, 'Content-Type': 'application/json', 'X-Device-Test': deps.deviceId },
      ...(init.body !== undefined ? { body: init.body } : {}),
    })
    if (res.status === 429 && intento < reintentos) {
      const dice = Number(res.headers.get('Retry-After'))
      const ms = Number.isFinite(dice) && dice > 0 ? dice * 1000 : 2_000 * 2 ** intento
      await sleep(Math.min(ms, ESPERA_MAXIMA_MS))
      continue
    }
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string }
      throw new RecryptHttpError(res.status, body.error ?? '')
    }
    return res.json()
  }
}

async function paginaPendiente(
  deps: TeamReencryptDeps,
  teamId: string,
  after: string | undefined,
  sleep: (ms: number) => Promise<void>,
  reintentos?: number
): Promise<{ total: number; items: FilaPendiente[] }> {
  const qs = `team_id=${encodeURIComponent(teamId)}${after ? `&after=${encodeURIComponent(after)}` : ''}`
  const json = (await pedir(deps, `/v1/teams/key/recrypt-pending?${qs}`, { method: 'GET' }, sleep, reintentos)) as {
    total?: number; items?: FilaPendiente[]
  }
  return { total: Number(json.total ?? 0), items: Array.isArray(json.items) ? json.items : [] }
}

/** Sella un campo; uno que ya es ciphertext viaja como está (no se cifra dos veces). */
function sellarCampo(keys: MemoryKeys, valor: string, syncId: string, campo: string): string {
  return isCiphertext(valor) ? valor : encryptField(keys, valor, fieldAad(syncId, campo))
}

function sellar(keys: MemoryKeys, r: FilaPendiente) {
  const tags = Array.isArray(r.tags) ? r.tags.map(String) : []
  return {
    sync_id: r.sync_id,
    title: sellarCampo(keys, r.title, r.sync_id, 'title'),
    content: r.content === null ? null : sellarCampo(keys, r.content, r.sync_id, 'content'),
    // Mismo formato que `sealMutationPayload`: los tags van como UN sobre con el JSON del array.
    tags: tags.length === 0 ? [] : tags.length === 1 && isCiphertext(tags[0]) ? tags
      : [encryptField(keys, JSON.stringify(tags), fieldAad(r.sync_id, 'tags'))],
    content_hash: r.content_hash === null ? null : sellarCampo(keys, r.content_hash, r.sync_id, 'content_hash'),
    origin_account: r.origin_account === null ? null : sellarCampo(keys, r.origin_account, r.sync_id, 'origin_account'),
    lamport: r.lamport,
    // I2: la MISMA derivación que `sealMutationPayload` (memory-envelope.ts) usa para una fila
    // nueva de equipo: clave de equipo, `project_key` de la fila y scope 'team'. Si difiriera en
    // un byte, la fila migrada y una nueva del mismo tema nunca chocarían y las dos quedarían
    // vivas. Lo pendiente siempre trae el tema en claro: una fila que ya pasó por
    // `sealMutationPayload` llega con todo sellado y no está pendiente.
    topic_key: r.topic_key ? hmacTopicKey(keys, r.project_key, 'team', r.topic_key) : null,
  }
}

/**
 * Migra lo que el servidor dice que sigue en claro para este equipo: lee una página de lo
 * pendiente (con su contenido), la sella, la manda en lotes, y sigue con la siguiente.
 *
 * Nunca lanza: un error a mitad se devuelve en `error`, con lo aplicado hasta ahí, y
 * `remaining` sale de volver a preguntarle al servidor.
 */
export async function migrateTeam(
  deps: TeamReencryptDeps,
  teamId: string,
  master: Buffer,
  opts: MigrateOpts = {}
): Promise<TeamMigrationResult> {
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))
  const maxItems = opts.maxItemsPerBatch ?? ITEMS_POR_LOTE
  const maxBytes = opts.maxBytesPerBatch ?? BYTES_POR_LOTE
  let total = 0
  let applied = 0
  let rejected = 0
  let error: string | undefined

  // Se derivan ADENTRO del try de abajo (Minor 4): afuera, una maestra inválida lanzaba antes
  // del try y `void migrarEquipo(teamId)` en main.ts terminaba en un unhandled rejection.
  let proof = ''
  // El sobre del body (team_id, proof, llaves) se cuenta aparte; un item que solo ya pasa el
  // tope va solo.
  let sobre = 0
  let lote: Array<ReturnType<typeof sellar>> = []
  let bytes = sobre
  const enviar = async () => {
    if (lote.length === 0) return
    const json = (await pedir(deps, '/v1/teams/key/recrypt', {
      method: 'POST', body: JSON.stringify({ team_id: teamId, proof, items: lote }),
    }, sleep)) as { applied?: string[]; rejected?: unknown[] }
    applied += json.applied?.length ?? 0
    rejected += json.rejected?.length ?? 0
    lote = []
    bytes = sobre
  }

  try {
    const keys = deriveKeys(master)
    proof = teamKeyProof(master, teamId)
    sobre = Buffer.byteLength(JSON.stringify({ team_id: teamId, proof, items: [] }), 'utf8')
    bytes = sobre
    // Keyset por `sync_id`: lo ya sellado sale de la lista, así que avanzar con `after` (y no
    // con un offset) es lo que no saltea filas. Lo rechazado como `stale` queda atrás del
    // cursor y vuelve en la próxima corrida.
    let after: string | undefined
    let primera = true
    for (;;) {
      const pagina = await paginaPendiente(deps, teamId, after, sleep)
      if (primera) { total = pagina.total; primera = false }
      if (pagina.items.length === 0) break
      for (const r of pagina.items) {
        const item = sellar(keys, r)
        const tam = Buffer.byteLength(JSON.stringify(item), 'utf8') + 1
        if (lote.length > 0 && (lote.length >= maxItems || bytes + tam > maxBytes)) await enviar()
        lote.push(item)
        bytes += tam
      }
      await enviar()
      after = pagina.items[pagina.items.length - 1].sync_id
    }
  } catch (err) {
    error = err instanceof Error ? err.message : String(err)
  }

  // Lo que queda lo dice el servidor, no la resta: también cuenta lo rechazado como `stale`
  // y lo que otro device haya escrito mientras tanto. Si ni eso se puede leer, la estimación.
  let remaining: number
  try {
    remaining = (await paginaPendiente(deps, teamId, undefined, sleep)).total
  } catch (err) {
    remaining = Math.max(0, total - applied)
    error ??= err instanceof Error ? err.message : String(err)
  }
  return { total, applied, rejected, remaining, ...(error !== undefined ? { error } : {}) }
}

/** Sólo cuánto falta, para la tarjeta. Sin reintento: un 429 acá es mejor mostrarlo como
 * "desconocido" que demorar el render esperando el Retry-After. */
export async function countRecryptPending(deps: TeamReencryptDeps, teamId: string): Promise<number> {
  return (await paginaPendiente(deps, teamId, undefined, async () => {}, 0)).total
}

/**
 * Lo que la tarjeta muestra como pendiente (Minor 3). Sólo pregunta si el servidor dice que este
 * usuario es leader del equipo (`isLeader` de `GET /v1/teams/key`), el equipo está activado y
 * este device tiene la clave: para cualquier otro, `recrypt-pending` es un 403 seguro que
 * además gasta el limiter propio de recrypt (60/min por device). `null` = no aplica o no se
 * pudo leer; la tarjeta no dice "terminado" sin haberlo leído.
 */
export async function pendientesSiEsLeader(
  deps: TeamReencryptDeps,
  teamId: string,
  estado: { activated: boolean; isLeader?: boolean },
  hasMaster: boolean
): Promise<number | null> {
  if (!estado.activated || !estado.isLeader || !hasMaster) return null
  try {
    return await countRecryptPending(deps, teamId)
  } catch {
    return null
  }
}
