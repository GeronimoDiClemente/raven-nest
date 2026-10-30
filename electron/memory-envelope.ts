// La tabla del §5.2 de la spec, hecha codigo. Un solo lugar decide que campo se cifra, cual
// se hashea y cual queda en claro — el daemon solo llama a estas dos funciones.
//
// Puro: recibe las claves por parametro. Todo lo raro (el scope team, las filas en claro
// de antes de la migracion, un sobre que no abre) se prueba aca, sin base y sin red.
import {
  encryptField, decryptField, isCiphertext, fieldAad, hmacTopicKey,
  MemoryDecryptError, type MemoryKeys,
} from './memory-crypto'
import type { PulledRow } from './memory-daemon'

export interface EnvelopeContext {
  keys: MemoryKeys
  /** Solo informativo hoy; existe para que un futuro `nmc2:` sepa con que epoca abrir. */
  keyEpoch: number
  /** `project_key -> claves de equipo activas para ESE proyecto`, o `null` si el proyecto no
   * tiene equipo con cifrado activo (equipo sin activar, o este device sin wrap todavía).
   * Ausente (no sólo `null`) en builds/callers viejos que no conocen el cifrado de equipo.
   *
   * Lo usa el PUSH, por `projects.team_id` local — correcto para quien sube, que es quien
   * compartió el proyecto. En el pull es sólo el fallback contra un servicio viejo que no
   * manda `team_id` en la fila. */
  teamKeys?: (projectKey: string) => MemoryKeys | null
  /** PULL: `team_id -> clave de equipo`. El `team_id` lo manda el servidor en cada
   * fila de equipo; el `projects.team_id` local NO sirve acá, porque sólo existe si ESTE
   * device compartió su copia del proyecto, y un compañero no tiene por qué haberlo hecho. */
  teamKeysById?: (teamId: string) => MemoryKeys | null
}

/**
 * Los campos de texto que se cifran, en el orden de la tabla del §5.2.
 *
 * `origin_account` no está en esa tabla y se cifra igual: `pty-manager.ts` inyecta
 * `NEST_MEMORY_ACCOUNT = "<ai>:<accountName>"`, y `accountName` sale del directorio
 * `accounts/<ai>/<cuenta>` — que en una máquina real ES el email del usuario, con el punto
 * cambiado por coma. En claro, cada observación guardada por un agente subiría el mail. El
 * servidor sólo lo almacena y lo devuelve: no lo consulta ni filtra por él, así
 * que cifrarlo no rompe nada del lado del servicio.
 */
const SEALED_FIELDS = ['title', 'content', 'project_display_name', 'content_hash', 'origin_account'] as const

// El cifrado de scope `team`: ver `docs/superpowers/specs/2026-10-14-cifrado-de-equipo-design.md`.

/** 32 hex en minuscula es exactamente lo que devuelve `hmacTopicKey`. */
export function looksLikeTopicHmac(value: string): boolean {
  return /^[0-9a-f]{32}$/.test(value)
}

/**
 * La clave con la que se sella UNA fila: la de equipo si es `team` (o `null` si ese equipo
 * no tiene clave en este device: va en claro), si no la personal. Una sola regla para el
 * push y para el HMAC local, que tienen que coincidir.
 */
function keysParaFila(ctx: EnvelopeContext | null, projectKey: string, scope: string): MemoryKeys | null {
  if (scope === 'team') return ctx?.teamKeys?.(projectKey) ?? null
  return ctx?.keys ?? null
}

/**
 * El `topic_key_hmac` que `save()` escribe en la base local. Tiene que ser el MISMO que
 * `sealMutationPayload` sube y el pull baja: el supersede del pull busca al dueño local por
 * ese valor (`findActiveTopicOwnerByHmac`). Usar siempre la personal no coincidiría en filas
 * `team` con el HMAC de equipo, y dos versiones de un tema de autores distintos quedarían
 * vivas en la app. `null` para una fila team sin clave de equipo: sube con
 * el tema en claro y baja sin HMAC, y `backfillTopicHmacs` la completa si después llega.
 */
export function localTopicHmac(
  ctx: EnvelopeContext | null,
  projectKey: string,
  scope: string,
  topicKey: string
): string | null {
  const keys = keysParaFila(ctx, projectKey, scope)
  return keys ? hmacTopicKey(keys, projectKey, scope, topicKey) : null
}

export function sealMutationPayload(
  ctx: EnvelopeContext | null,
  payload: Record<string, unknown>
): Record<string, unknown> {
  // Equipo sin cifrado activo (o sin contexto): en claro.
  const keys = keysParaFila(ctx, String(payload.project_key ?? ''), String(payload.scope ?? 'personal'))
  if (!keys) return payload

  const syncId = String(payload.sync_id ?? '')
  const sealed: Record<string, unknown> = { ...payload }

  for (const field of SEALED_FIELDS) {
    const value = payload[field]
    // `null` se respeta: un tombstone nulea el content y ese null es informacion que el
    // servidor usa (`incomingDeleted` en push.ts). Cifrar un null lo convertiria en un
    // string y el tombstone dejaria de leerse como tal.
    if (typeof value !== 'string') continue
    sealed[field] = encryptField(keys, value, fieldAad(syncId, field))
  }

  // Los tags van como UN sobre, no uno por tag: cifrar cada uno por separado filtraria
  // cuantos tags tiene la observacion y dejaria dos tags iguales con longitudes iguales.
  // El array de un elemento es para que el servidor los siga viendo como el jsonb array
  // que su COALESCE espera (memory-daemon.ts documenta por que `[]` y no `null`).
  const tags = payload.tags
  if (Array.isArray(tags) && tags.length > 0) {
    sealed.tags = [encryptField(keys, JSON.stringify(tags), fieldAad(syncId, 'tags'))]
  }

  // El HMAC de tópico usa la MISMA clave que acaba de cifrar los campos de esta fila (`keys`:
  // la de equipo si es team y hay una activa, si no la personal) — NUNCA incondicionalmente
  // la personal. El servidor supersede por igualdad de este valor (`push.ts:537`): si dos
  // miembros de un equipo derivaran el HMAC con sus respectivas claves PERSONALES (que son
  // distintas entre sí), el mismo tema lógico produciría dos HMACs distintos y el supersede
  // de equipo dejaría de funcionar entre autores distintos. `keys` ya es `undefined` cuando
  // no hay ninguna clave disponible (equipo sin activar y sin `ctx`), así que el chequeo de
  // abajo sigue sirviendo para "no hay nada con qué derivar".
  const topicKey = payload.topic_key
  if (typeof topicKey === 'string' && topicKey !== '') {
    sealed.topic_key = hmacTopicKey(keys, String(payload.project_key ?? ''), String(payload.scope ?? 'personal'), topicKey)
  }

  return sealed
}

export interface OpenedRow {
  row: PulledRow
  /**
   * §5.5.4: el modo de falla nuevo. La fila llego cifrada y esta maquina no la puede leer
   * — todavia no fue autorizada, o la clave rotó. NO es una excepcion a proposito: tirar
   * desde acá frenaria el cursor del pull y el device dejaria de sincronizar del todo.
   */
  undecryptable: boolean
}

export function openPulledRow(ctx: EnvelopeContext | null, row: PulledRow): OpenedRow {
  const esTeam = row.scope === 'team'
  // Con `teamId` manda el servidor, sin fallback: si no tengo ESA clave, la fila es ilegible,
  // aunque el proyecto local apunte a otro equipo. Sin `teamId` (servicio viejo) se resuelve
  // por `project_key` local.
  const keysDeTeam = !esTeam
    ? null
    : row.teamId
      ? (ctx?.teamKeysById?.(row.teamId) ?? null)
      : (ctx?.teamKeys?.(row.projectKey) ?? null)
  const keys = esTeam ? keysDeTeam : ctx?.keys
  // Fila team sin clave de equipo disponible: si YA viene en claro (equipo nunca activó
  // cifrado), pasa tal cual. Si viene cifrada (nmc1:) y no hay clave, es undecryptable
  // — mismo tratamiento que una personal sin autorizar. `abrir()` de abajo ya distingue los
  // dos casos por `isCiphertext`, así que sólo hace falta pasarle `keys` (o nada).

  const abierto: PulledRow = { ...row }
  let undecryptable = false

  const abrir = (value: string | null | undefined, field: string): string | null | undefined => {
    if (value == null || !isCiphertext(value)) return value // fila en claro: pasa tal cual
    if (!keys) { undecryptable = true; return value }
    try {
      return decryptField(keys, value, fieldAad(row.syncId, field))
    } catch (err) {
      if (err instanceof MemoryDecryptError) { undecryptable = true; return value }
      throw err
    }
  }

  abierto.title = abrir(row.title, 'title') ?? undefined
  abierto.content = abrir(row.content, 'content') ?? null
  abierto.contentHash = abrir(row.contentHash, 'content_hash') ?? undefined
  // Un campo que se sella tiene que abrirse acá: si no, el `nmc1:…` se escribe en la base
  // LOCAL como si fuera el nombre de la cuenta. Los dos lados salen de la misma lista y hay
  // un test que lo fija.
  if (row.originAccount !== undefined) {
    abierto.originAccount = abrir(row.originAccount, 'origin_account') ?? undefined
  }

  if (Array.isArray(row.tags) && row.tags.length === 1 && isCiphertext(row.tags[0])) {
    const claro = abrir(row.tags[0], 'tags')
    if (claro != null && !isCiphertext(claro)) {
      try {
        const parsed = JSON.parse(claro)
        abierto.tags = Array.isArray(parsed) ? parsed.filter((t): t is string => typeof t === 'string') : []
      } catch {
        // Descifro pero no es JSON: no puede pasar con lo que sella `sealMutationPayload`,
        // y perder los tags de UNA fila no justifica marcar la fila entera como ilegible.
        abierto.tags = []
      }
    }
  }

  // El tema: lo que llega es el HMAC, y de un HMAC no se vuelve. Una fila anterior a la
  // migracion trae el tema en claro, y en ese caso el HMAC se recalcula acá — asi el
  // `findActiveTopicOwnerByHmac` local encuentra al dueño durante toda la ventana en que
  // la nube tiene las dos cosas mezcladas, sin tener que frenar el pull.
  // Explicito y no `undefined`: quien consume esto lo escribe en una columna, y el que
  // llame sin contexto tiene que ver "no hay HMAC" y no "nadie decidio".
  abierto.topicKeyHmac = null
  if (row.topicKey) {
    if (ctx && looksLikeTopicHmac(row.topicKey)) {
      abierto.topicKey = null
      abierto.topicKeyHmac = row.topicKey
    } else if (keys) {
      // Igual que en `sealMutationPayload`: con `keys` (la de equipo si
      // corresponde) y no incondicionalmente `ctx.keys`, para que dos miembros de un
      // equipo deriven el MISMO HMAC de tópico sobre la MISMA clave compartida.
      abierto.topicKeyHmac = hmacTopicKey(keys, row.projectKey, row.scope, row.topicKey)
    }
  }

  return { row: abierto, undecryptable }
}
