// La pestaña Status cuando la TUI le habla al daemon de Nest: `memory.status` pasado a
// `DatosDeStatus`, con los textos de la tarjeta de Memories (`CloudMemoryCard.tsx`).
// Sólo tipos y `estilo-del-paquete`: corre también en el Node 20 de Electron.
import type { StatusMemoryResult } from '../memory-protocol'
import type { DatosDeStatus, FilaDeEstado, Marca } from '../status-del-paquete'
import { grupoDeTipo, type GrupoDeTipo } from '../estilo-del-paquete'
import type { Llamador } from './fuente-comun'

/** Lo que se muestra con un Nest que no sabe contestar `memory.status` (o que no contesta). */
export const STATUS_SOLO_NEST: DatosDeStatus = {
  modo: 'daemon', vacia: false, sinConteos: true, total: 0, porGrupo: {}, personal: 0, deEquipo: 0,
  guardadaEn: null, servicio: null, ilegiblesDeEquipo: 0, recientes: [],
  filas: [{ marca: 'ok', etiqueta: 'Nest', detalle: 'open — memory goes through it' }],
  resumen: 'Nest owns this memory',
}

const cambios = (n: number) => `${n} change${n === 1 ? '' : 's'}`

/** La fila Sync y la línea del encabezado. */
function sync(r: StatusMemoryResult): { fila: FilaDeEstado; resumen: string } {
  const s = r.sync
  const fila = (marca: Marca, detalle: string) => ({ marca, etiqueta: 'Sync', detalle })
  if (!s) return { fila: fila('nada', 'local only — connect cloud sync from Memory settings in Nest'), resumen: 'local only' }
  const n = r.pending
  if (s.status === 'error' && s.detail === 'needs_encryption_setup') {
    return { fila: fila('aviso', 'paused until encryption is on — turn it on in Memory settings'), resumen: 'needs encryption setup' }
  }
  if (s.status === 'error' && s.detail === 'needs_key') {
    return { fila: fila('aviso', 'this machine is not authorized yet — approve it from Memory settings'), resumen: 'not authorized yet' }
  }
  if (s.status === 'error') return { fila: fila('falla', `couldn't sync${s.detail ? ` (${s.detail})` : ''}`), resumen: 'sync error' }
  if (s.status === 'plan_required') return { fila: fila('aviso', "your plan doesn't include cloud sync"), resumen: 'local only' }
  if (s.status === 'paused' && s.detail === 'lock_held') {
    return { fila: fila('aviso', `another Nest is syncing this memory — ${cambios(n)} queued`), resumen: 'another Nest syncs' }
  }
  if (s.status === 'paused') return { fila: fila('aviso', `offline — ${cambios(n)} waiting`), resumen: 'offline' }
  if ((s.plaintextPending ?? 0) > 0) {
    return { fila: fila('pendiente', `encrypting your cloud memory… ${s.plaintextPending} left`), resumen: `encrypting… ${s.plaintextPending} left` }
  }
  if (n > 0) return { fila: fila('pendiente', `uploading ${cambios(n)}…`), resumen: `${n} waiting to sync` }
  if (s.status === 'syncing') return { fila: fila('pendiente', 'syncing…'), resumen: 'syncing' }
  return { fila: fila('ok', 'up to date'), resumen: 'synced' }
}

function conflictos(n: number | null): FilaDeEstado | null {
  if (n === null) return null
  return n === 0
    ? { marca: 'ok', etiqueta: 'Conflicts', detalle: 'none in the vault' }
    : { marca: 'aviso', etiqueta: 'Conflicts', detalle: `${n} in the vault's _conflicts — your hand edits, kept apart` }
}

function sesiones(s: StatusMemoryResult['sessions']): FilaDeEstado | null {
  if (!s) return null
  if (s.silent > 0) {
    return {
      marca: 'falla', etiqueta: 'Sessions',
      detalle: `${s.silent} silent${s.writing ? ` · ${s.writing} writing` : ''} — an agent is running without memory`,
    }
  }
  if (s.writing > 0) return { marca: 'ok', etiqueta: 'Sessions', detalle: `${s.writing} agent${s.writing === 1 ? '' : 's'} writing memory` }
  return { marca: 'nada', etiqueta: 'Sessions', detalle: 'no agent with memory open in Nest' }
}

export function statusDeNest(r: StatusMemoryResult): DatosDeStatus {
  const porGrupo: Partial<Record<GrupoDeTipo, number>> = {}
  for (const [tipo, c] of Object.entries(r.byType)) {
    const g = grupoDeTipo(tipo)
    porGrupo[g] = (porGrupo[g] ?? 0) + c
  }
  const s = sync(r)
  const filas = [s.fila, conflictos(r.conflicts), sesiones(r.sessions)].filter((f): f is FilaDeEstado => f !== null)
  // El encabezado nombra lo peor: una sesión muda antes que el sync, y el sync antes que un
  // conflicto (que es trabajo guardado aparte, no algo que se esté perdiendo).
  const mudas = r.sessions?.silent ?? 0
  const resumen = mudas > 0 ? `${mudas} silent session${mudas === 1 ? '' : 's'}`
    : s.resumen !== 'synced' ? s.resumen
    : (r.conflicts ?? 0) > 0 ? `${r.conflicts} conflict${r.conflicts === 1 ? '' : 's'}`
    : s.resumen
  return {
    modo: 'daemon', vacia: false, total: r.total, porGrupo, personal: r.total - r.team, deEquipo: r.team,
    guardadaEn: null, servicio: null, ilegiblesDeEquipo: 0, recientes: [], filas, resumen,
  }
}

/** Un Nest viejo contesta `Unknown method`: se vuelve a la línea de siempre, sin error. */
export async function leerStatusDeNest(c: Llamador): Promise<DatosDeStatus> {
  try {
    return statusDeNest((await c.call('memory.status', {})) as StatusMemoryResult)
  } catch {
    return STATUS_SOLO_NEST
  }
}
