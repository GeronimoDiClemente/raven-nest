// La pestaña Doctor cuando la TUI le habla al daemon de Nest: a las filas que ya se saben
// (Node, Nest, Memory…) se les suma lo bloqueado que contesta `memory.doctor`.
// Sólo tipos: corre también en el Node 20 de Electron.
import type { DoctorMemoryResult } from '../memory-protocol'
import type { DatosDeDoctor } from '../doctor-del-paquete'
import type { Llamador } from './fuente-comun'

/** La fila que manda a Nest a ver lo bloqueado: sobra cuando Nest contestó. */
export const ETIQUETA_DE_BLOQUEADAS = 'Blocked'

export function doctorDeNest(base: DatosDeDoctor, r: DoctorMemoryResult): DatosDeDoctor {
  const filas = base.filas.filter((f) => f.etiqueta !== ETIQUETA_DE_BLOQUEADAS)
  let avisos = base.avisos
  if (r.undecryptable > 0) {
    avisos++
    filas.push({
      marca: 'aviso', etiqueta: 'Encrypted',
      detalle: `${r.undecryptable} can't be opened on this machine — approve it from Memory settings in Nest`,
    })
  }
  const bloqueadas = r.blocked.map((b) => ({ syncId: b.syncId, titulo: b.title, motivo: b.reason }))
  // Igual que el doctor del paquete: lo bloqueado es UN aviso, no uno por fila.
  if (bloqueadas.length > 0) avisos++
  return { ...base, filas, bloqueadas, avisos }
}

/** Un Nest viejo contesta `Unknown method`: queda lo que ya se sabía, sin error. */
export async function completarDoctorConNest(c: Llamador, base: DatosDeDoctor): Promise<DatosDeDoctor> {
  try {
    return doctorDeNest(base, (await c.call('memory.doctor', {})) as DoctorMemoryResult)
  } catch {
    return base
  }
}
