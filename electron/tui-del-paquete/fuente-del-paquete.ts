// La fuente de la TUI del paquete portátil.
//
// **Lecturas**: del daemon si la base decidida es la de Nest vivo; si no, de la base local.
// Con la base propia NUEVA y sin archivo no se crea nada: leer no deja rastro.
//
// **Escrituras**: cada una vuelve a preguntar si Nest está vivo (`buscarNest`), porque puede
// abrirse o cerrarse mientras la TUI está en pantalla. Si contesta, va al daemon; si no, al
// local (con sync de una pasada cuando la base es la propia). Si el daemon se cae a mitad de
// camino —ECONNREFUSED, ENOENT, EPIPE, "timed out"— se reintenta UNA vez con el local. Cualquier
// otro error (candado, base de sólo lectura, un `ok: false`) es `ErrorDeEscritura` con su
// mensaje, sin reintentar.
import { existsSync } from 'fs'
import { MemoryDaemonClient } from '../memory-mcp/client'
import { MemoryLocalClient } from '../memory-mcp/local'
import { resolveGitInfoForCwd } from '../git-info'
import { buscarNestVivo, type DondeHablarle } from '../nest-vivo-del-paquete'
import { dondeEstaLaBase } from '../donde-esta-la-base'
import { ravenHome } from '../raven-home'
import { alAbrirConSync } from '../sync-del-paquete-tras-escribir'
import { dependenciasDeStatus, dependenciasDeDoctor } from '../dependencias-de-lectura-del-paquete'
import { leerStatusDelPaquete, type DatosDeStatus } from '../status-del-paquete'
import { leerDoctorDelPaquete, type DatosDeDoctor } from '../doctor-del-paquete'
import type { DecisionDeBase } from '../base-para-el-paquete'
import type { UpdateMemoryResult } from '../memory-protocol'
import { ErrorDeEscritura, type FuenteDeLaTui } from './fuente'
import {
  nombreDelProyecto, leerRecientes, leerBusqueda, leerDetalle, pedidoDeGuardar,
  pedidoDeActualizar, verificarActualizacion, mensajeDe, type Llamador,
} from './fuente-comun'

export interface DependenciasDeFuente {
  /** La base decidida al arrancar. */
  base: DecisionDeBase
  cwd: string
  existe: (path: string) => boolean
  buscarNest: () => Promise<DondeHablarle | null>
  crearDaemon: (d: DondeHablarle) => Llamador
  crearLocal: (path: string) => Llamador & { close: () => void }
  leerStatus: (base: DecisionDeBase) => Promise<DatosDeStatus>
  leerDoctor: (base: DecisionDeBase) => Promise<DatosDeDoctor>
}

const CODIGOS_DE_CONEXION = new Set(['ECONNREFUSED', 'ENOENT', 'EPIPE'])

/** El daemon no está o se cortó: distinto de un daemon que contestó que no. */
function esErrorDeConexion(err: unknown): boolean {
  const code = (err as { code?: unknown } | null)?.code
  if (typeof code === 'string' && CODIGOS_DE_CONEXION.has(code)) return true
  return mensajeDe(err).includes('timed out')
}

export function crearFuenteDelPaquete(deps: DependenciasDeFuente): FuenteDeLaTui {
  const { base, cwd } = deps
  let local: (Llamador & { close: () => void }) | null = null

  /** El path de la base local, o `null` si la base decidida era la de un Nest vivo. */
  const pathLocal = (): string | null => (base.modo === 'daemon' ? null : base.path)
  const abrirLocal = (path: string) => (local ??= deps.crearLocal(path))

  const lector = async (): Promise<Llamador | null> => {
    if (base.modo === 'daemon') return deps.crearDaemon({ socket: base.socket, token: base.token })
    if (base.modo === 'propia' && base.nueva && !deps.existe(base.path)) return null
    return abrirLocal(base.path)
  }

  /** Va al daemon si Nest está vivo, con un reintento al local si se cae; si no, al local. */
  async function escribir<T>(method: string, params: unknown): Promise<T> {
    const nest = await deps.buscarNest()
    const alLocal = async (): Promise<T> => {
      const path = pathLocal()
      if (!path) throw new ErrorDeEscritura('Nest is not running and there is no local memory to write to')
      try {
        return (await abrirLocal(path).call(method, params)) as T
      } catch (err) {
        throw new ErrorDeEscritura(mensajeDe(err))
      }
    }
    if (!nest) return alLocal()
    try {
      return (await deps.crearDaemon(nest).call(method, params)) as T
    } catch (err) {
      if (esErrorDeConexion(err)) return alLocal()
      throw new ErrorDeEscritura(mensajeDe(err))
    }
  }

  const leyendo = async <T>(vacio: T, f: (c: Llamador) => Promise<T>): Promise<T> => {
    const c = await lector()
    return c ? f(c) : vacio
  }

  return {
    proyecto: () => nombreDelProyecto(cwd),
    recientes: (o) => leyendo([], (c) => leerRecientes(c, cwd, o)),
    buscar: (q, limite) => leyendo([], (c) => leerBusqueda(c, cwd, q, limite)),
    obtener: (id) => leyendo(null, (c) => leerDetalle(c, cwd, id)),
    guardar: async (m) => { await escribir('memory.save', pedidoDeGuardar(cwd, m)) },
    actualizar: async (id, m) => {
      verificarActualizacion(await escribir<UpdateMemoryResult>('memory.update', pedidoDeActualizar(cwd, id, m)))
    },
    borrar: async (id) => { await escribir('memory.delete', { cwd, syncId: id }) },
    status: () => deps.leerStatus(base),
    doctor: () => deps.leerDoctor(base),
    cerrar: () => { try { local?.close() } finally { local = null } },
  }
}

/**
 * La fuente real: decide la base como el resto del paquete y cablea los clientes de verdad.
 * El local se crea con el sync de una pasada cuando la base es la propia.
 */
export async function crearFuenteReal(cwd: string): Promise<FuenteDeLaTui> {
  const base = await dondeEstaLaBase()
  return crearFuenteDelPaquete({
    base, cwd,
    existe: (p) => existsSync(p),
    buscarNest: () => buscarNestVivo(process.env, ravenHome(), process.platform === 'win32'),
    crearDaemon: (d) => new MemoryDaemonClient(d.socket, d.token),
    crearLocal: (path) => new MemoryLocalClient(path, resolveGitInfoForCwd, alAbrirConSync(base)),
    leerStatus: (b) => leerStatusDelPaquete(dependenciasDeStatus(b)),
    leerDoctor: (b) => leerDoctorDelPaquete(dependenciasDeDoctor(b)),
  })
}
