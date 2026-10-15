// electron/memory-team-reencrypt.ts
// Migración retroactiva (spec §4): el leader re-cifra lo que YA está en claro en la nube
// bajo la clave de equipo recién creada. A diferencia de la migración personal
// (memory-reencrypt.ts), esto reescribe filas de OTROS autores, así que no puede pasar por
// el push normal (server/src/push.ts exige same-author) — llama al endpoint dedicado.
import { encryptField, fieldAad } from './memory-crypto'
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
}

const MAX_POR_LOTE = 400 // bajo el MAX_WRAPS_POR_REQUEST/MAX_BATCH de la familia de endpoints de este servicio

export async function runTeamRecrypt(
  deps: TeamReencryptDeps,
  teamId: string,
  master: Buffer,
  rows: LocalTeamRow[],
  onProgress?: (p: { total: number; done: number }) => void
): Promise<{ total: number; applied: number; rejected: number }> {
  const keys: MemoryKeys = { field: master, topic: master } // sólo se usa `field` acá; `topic` no aplica a este endpoint
  let applied = 0
  let rejected = 0
  const f = deps.fetchImpl ?? fetch

  for (let i = 0; i < rows.length; i += MAX_POR_LOTE) {
    const lote = rows.slice(i, i + MAX_POR_LOTE)
    const items = lote.map((r) => ({
      sync_id: r.syncId,
      title: encryptField(keys, r.title, fieldAad(r.syncId, 'title')),
      content: r.content === null ? null : encryptField(keys, r.content, fieldAad(r.syncId, 'content')),
      tags: r.tags.length > 0 ? [encryptField(keys, JSON.stringify(r.tags), fieldAad(r.syncId, 'tags'))] : [],
      content_hash: r.contentHash === null ? null : encryptField(keys, r.contentHash, fieldAad(r.syncId, 'content_hash')),
      origin_account: r.originAccount === null ? null : encryptField(keys, r.originAccount, fieldAad(r.syncId, 'origin_account')),
    }))
    const res = await f(`${deps.baseUrl}/v1/teams/key/recrypt`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${deps.token}`, 'Content-Type': 'application/json', 'X-Device-Test': deps.deviceId },
      body: JSON.stringify({ team_id: teamId, items }),
    })
    const json = (await res.json()) as { applied?: string[]; rejected?: Array<{ sync_id: string }> }
    applied += json.applied?.length ?? 0
    rejected += json.rejected?.length ?? 0
    onProgress?.({ total: rows.length, done: Math.min(i + lote.length, rows.length) })
  }

  return { total: rows.length, applied, rejected }
}
