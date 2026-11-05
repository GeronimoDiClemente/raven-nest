// De dónde saca los datos la TUI. La TUI no sabe si le habla a Nest, a la base local o a un
// cliente falso: recibe una `FuenteDeLaTui`. Las dos reales: `fuente-del-paquete.ts` (el
// paquete portátil) y `fuente-del-daemon.ts` (la TUI que corre adentro de Nest).
import type { ObservationSummary } from '../memory-protocol'
import type { DatosDeStatus } from '../status-del-paquete'
import type { DatosDeDoctor } from '../doctor-del-paquete'
import type { DetalleDeMemoria } from './estado'
import type { MemoriaEscrita } from './frontmatter'

export interface FuenteDeLaTui {
  /** Basename de la raíz git del cwd, o del cwd. */
  proyecto(): string
  /** `memory.context`. */
  recientes(o: { todos: boolean; limite: number }): Promise<ObservationSummary[]>
  /** `memory.search`. */
  buscar(consulta: string, limite: number): Promise<ObservationSummary[]>
  /** `memory.get`; `null` si no existe o está borrada. */
  obtener(syncId: string): Promise<DetalleDeMemoria | null>
  /** `memory.save` con `source: 'ui'`. */
  guardar(m: MemoriaEscrita): Promise<void>
  /** `memory.update` con title, content, tags y type. */
  actualizar(syncId: string, m: MemoriaEscrita): Promise<void>
  /** `memory.delete`. */
  borrar(syncId: string): Promise<void>
  status(): Promise<DatosDeStatus>
  doctor(): Promise<DatosDeDoctor>
  /** Puede esperar (con tope) a que salga el sync en vuelo antes de cerrar la base. */
  cerrar(): void | Promise<void>
}

/** El mensaje es el motivo tal cual se muestra en la barra de la TUI. */
export class ErrorDeEscritura extends Error {
  constructor(mensaje: string) {
    super(mensaje)
    this.name = 'ErrorDeEscritura'
  }
}
