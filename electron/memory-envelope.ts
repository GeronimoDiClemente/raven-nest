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
}

/** Los campos de texto que se cifran, en el orden de la tabla del §5.2. */
const SEALED_FIELDS = ['title', 'content', 'project_display_name', 'content_hash'] as const

/**
 * Decision 1 del §9: en la v1 el scope `team` NO se cifra. La clave por equipo del §5.4
 * necesita un par de claves por usuario que todavia no existe, y hoy los tres equipos de
 * prueba tienen 0 miembros, asi que no hay memoria de equipo real que proteger. Va
 * anunciado en la landing, no escondido.
 */
function esDeEquipo(scope: unknown): boolean {
  return scope === 'team'
}

/** 32 hex en minuscula es exactamente lo que devuelve `hmacTopicKey`. */
export function looksLikeTopicHmac(value: string): boolean {
  return /^[0-9a-f]{32}$/.test(value)
}

export function sealMutationPayload(
  ctx: EnvelopeContext | null,
  payload: Record<string, unknown>
): Record<string, unknown> {
  if (!ctx || esDeEquipo(payload.scope)) return payload

  const syncId = String(payload.sync_id ?? '')
  const sealed: Record<string, unknown> = { ...payload }

  for (const field of SEALED_FIELDS) {
    const value = payload[field]
    // `null` se respeta: un tombstone nulea el content y ese null es informacion que el
    // servidor usa (`incomingDeleted` en push.ts). Cifrar un null lo convertiria en un
    // string y el tombstone dejaria de leerse como tal.
    if (typeof value !== 'string') continue
    sealed[field] = encryptField(ctx.keys, value, fieldAad(syncId, field))
  }

  // Los tags van como UN sobre, no uno por tag: cifrar cada uno por separado filtraria
  // cuantos tags tiene la observacion y dejaria dos tags iguales con longitudes iguales.
  // El array de un elemento es para que el servidor los siga viendo como el jsonb array
  // que su COALESCE espera (memory-daemon.ts documenta por que `[]` y no `null`).
  const tags = payload.tags
  if (Array.isArray(tags) && tags.length > 0) {
    sealed.tags = [encryptField(ctx.keys, JSON.stringify(tags), fieldAad(syncId, 'tags'))]
  }

  // HMAC y no cifrado: el servidor supersede por igualdad (`server/src/push.ts:537`).
  const topicKey = payload.topic_key
  if (typeof topicKey === 'string' && topicKey !== '') {
    sealed.topic_key = hmacTopicKey(
      ctx.keys,
      String(payload.project_key ?? ''),
      String(payload.scope ?? 'personal'),
      topicKey
    )
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
  if (esDeEquipo(row.scope)) return { row, undecryptable: false }

  const abierto: PulledRow = { ...row }
  let undecryptable = false

  const abrir = (value: string | null | undefined, field: string): string | null | undefined => {
    if (value == null || !isCiphertext(value)) return value // fila en claro: pasa tal cual
    if (!ctx) { undecryptable = true; return value }
    try {
      return decryptField(ctx.keys, value, fieldAad(row.syncId, field))
    } catch (err) {
      if (err instanceof MemoryDecryptError) { undecryptable = true; return value }
      throw err
    }
  }

  abierto.title = abrir(row.title, 'title') ?? undefined
  abierto.content = abrir(row.content, 'content') ?? null
  abierto.contentHash = abrir(row.contentHash, 'content_hash') ?? undefined

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
    } else if (ctx) {
      abierto.topicKeyHmac = hmacTopicKey(ctx.keys, row.projectKey, row.scope, row.topicKey)
    }
  }

  return { row: abierto, undecryptable }
}
