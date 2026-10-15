// electron/memory-team-reencrypt.ts
// Migración retroactiva (spec §4): el leader re-cifra lo que YA está en claro en la nube
// bajo la clave de equipo recién creada. A diferencia de la migración personal
// (memory-reencrypt.ts), esto reescribe filas de OTROS autores, así que no puede pasar por
// el push normal (server/src/push.ts exige same-author) — llama al endpoint dedicado.
//
// Task 15 (review final):
// - C1: QUÉ migrar lo dice el SERVIDOR (`recrypt-pending`), no el `projects.team_id` local.
//   Ese campo sólo existe para los proyectos que este device compartió, así que lo que un
//   member compartió desde su copia quedaba en claro para siempre.
// - I1: cada item lleva el `lamport` de la copia local; si no es el del servidor, la fila se
//   editó después del último pull y no se manda (el servidor igual la rechazaría: `stale`).
// - I3: lotes con tope de bytes, reintento ante 429, y un error a mitad devuelve lo aplicado.
import { deriveKeys, encryptField, fieldAad, teamKeyProof } from './memory-crypto'
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
  /** El de la copia local: tiene que ser el del servidor para que la fila se pueda migrar. */
  lamport: number
}

/** Lo que la migración necesita de la base local y del daemon. */
export interface TeamMigrationLocal {
  /** Las filas locales con esos `sync_id`, de CUALQUIER proyecto. Las que no estén, no vienen. */
  rowsBySyncIds(ids: string[]): LocalTeamRow[]
  /** Un pull normal, esperado: trae lo de equipo nuevo o editado (`team_cursors`). */
  pullNow(): Promise<void>
}

export interface TeamMigrationResult {
  /** Cuántas filas de equipo estaban en claro en el servidor al empezar. */
  total: number
  applied: number
  /** Rechazadas por el servidor fila por fila (`stale`, `already_sealed`, `not_found_in_team`). */
  rejected: number
  /** Cuántas siguen en claro en el servidor al terminar. La UI sólo dice "terminado" con 0. */
  remaining: number
  /** Pendientes que este device no tiene (o tiene en otra versión) aun después de un pull. */
  missingLocally: number
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

/** Toda la lista de lo pendiente, recorriendo las páginas por `sync_id`. */
async function pendientes(
  deps: TeamReencryptDeps,
  teamId: string,
  sleep: (ms: number) => Promise<void>
): Promise<{ total: number; items: Map<string, number> }> {
  const items = new Map<string, number>()
  let after: string | undefined
  let total = 0
  for (;;) {
    const qs = `team_id=${encodeURIComponent(teamId)}${after ? `&after=${encodeURIComponent(after)}` : ''}`
    const json = (await pedir(deps, `/v1/teams/key/recrypt-pending?${qs}`, { method: 'GET' }, sleep)) as {
      total?: number; items?: Array<{ sync_id: string; lamport: number }>
    }
    total = Number(json.total ?? 0)
    const pagina = Array.isArray(json.items) ? json.items : []
    for (const it of pagina) items.set(it.sync_id, Number(it.lamport))
    if (pagina.length === 0) break
    after = pagina[pagina.length - 1].sync_id
    if (items.size >= total) break
  }
  return { total, items }
}

/** Sólo las copias locales que son exactamente la versión del servidor. */
function utilizables(local: TeamMigrationLocal, items: Map<string, number>): LocalTeamRow[] {
  return local.rowsBySyncIds([...items.keys()]).filter((r) => items.get(r.syncId) === r.lamport)
}

function sellar(keys: MemoryKeys, r: LocalTeamRow) {
  return {
    sync_id: r.syncId,
    title: encryptField(keys, r.title, fieldAad(r.syncId, 'title')),
    content: r.content === null ? null : encryptField(keys, r.content, fieldAad(r.syncId, 'content')),
    tags: r.tags.length > 0 ? [encryptField(keys, JSON.stringify(r.tags), fieldAad(r.syncId, 'tags'))] : [],
    content_hash: r.contentHash === null ? null : encryptField(keys, r.contentHash, fieldAad(r.syncId, 'content_hash')),
    origin_account: r.originAccount === null ? null : encryptField(keys, r.originAccount, fieldAad(r.syncId, 'origin_account')),
    lamport: r.lamport,
  }
}

/**
 * Migra lo que el servidor dice que sigue en claro para este equipo.
 *
 * Si falta alguna fila localmente (o la copia local no es la del servidor), pide UN pull y
 * vuelve a mirar: el pull normal trae lo de equipo nuevo o editado. Lo que siga faltando se
 * reporta en `missingLocally` y queda en `remaining` — no se fuerza un reset de cursores,
 * porque lo que un pull no trajo es una fila que este device no puede ver, no una salteada.
 *
 * Nunca lanza: un error a mitad se devuelve en `error`, con lo aplicado hasta ahí.
 */
export async function migrateTeam(
  deps: TeamReencryptDeps,
  teamId: string,
  master: Buffer,
  local: TeamMigrationLocal,
  opts: MigrateOpts = {}
): Promise<TeamMigrationResult> {
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))
  const maxItems = opts.maxItemsPerBatch ?? ITEMS_POR_LOTE
  const maxBytes = opts.maxBytesPerBatch ?? BYTES_POR_LOTE
  const keys = deriveKeys(master)
  const proof = teamKeyProof(master, teamId)
  let total = 0
  let applied = 0
  let rejected = 0
  let missingLocally = 0
  let error: string | undefined

  try {
    let lista = await pendientes(deps, teamId, sleep)
    total = lista.total
    if (lista.items.size === 0) return { total: 0, applied: 0, rejected: 0, remaining: 0, missingLocally: 0 }

    let filas = utilizables(local, lista.items)
    if (filas.length < lista.items.size) {
      await local.pullNow()
      lista = await pendientes(deps, teamId, sleep)
      filas = utilizables(local, lista.items)
    }
    missingLocally = lista.items.size - filas.length

    // Lotes que cortan por cantidad Y por bytes. El sobre del body (team_id, proof, llaves)
    // se estima aparte; un item que solo ya pasa el tope va solo.
    const sobre = Buffer.byteLength(JSON.stringify({ team_id: teamId, proof, items: [] }), 'utf8')
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
    for (const r of filas) {
      const item = sellar(keys, r)
      const tam = Buffer.byteLength(JSON.stringify(item), 'utf8') + 1
      if (lote.length > 0 && (lote.length >= maxItems || bytes + tam > maxBytes)) await enviar()
      lote.push(item)
      bytes += tam
    }
    await enviar()
  } catch (err) {
    error = err instanceof Error ? err.message : String(err)
  }

  // Lo que queda lo dice el servidor, no la resta: también cuenta lo que otro device haya
  // migrado o editado mientras tanto. Si ni eso se puede leer, la mejor estimación.
  let remaining: number
  try {
    remaining = (await pendientes(deps, teamId, sleep)).total
  } catch (err) {
    remaining = Math.max(0, total - applied)
    error ??= err instanceof Error ? err.message : String(err)
  }
  return { total, applied, rejected, remaining, missingLocally, ...(error !== undefined ? { error } : {}) }
}

/** Sólo cuánto falta, para la tarjeta. */
export async function countRecryptPending(deps: TeamReencryptDeps, teamId: string): Promise<number> {
  const json = (await pedir(deps, `/v1/teams/key/recrypt-pending?team_id=${encodeURIComponent(teamId)}`, { method: 'GET' },
    // Sin reintento: es la lectura de la tarjeta, y un 429 acá es mejor mostrarlo como
    // "desconocido" que demorar el render esperando el Retry-After.
    async () => {}, 0)) as { total?: number }
  return Number(json.total ?? 0)
}
