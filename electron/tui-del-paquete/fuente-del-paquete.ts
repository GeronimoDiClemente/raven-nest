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
import { homedir } from 'os'
import { MemoryDaemonClient } from '../memory-mcp/client'
import { MemoryLocalClient } from '../memory-mcp/local'
import { resolveGitInfoForCwd } from '../git-info'
import { buscarNestVivo, type DondeHablarle } from '../nest-vivo-del-paquete'
import { dondeEstaLaBase } from '../donde-esta-la-base'
import { ravenHome } from '../raven-home'
import { readActivePointer } from '../memory-active-store'
import { alAbrirConSync } from '../sync-del-paquete-tras-escribir'
import { dependenciasDeStatus, dependenciasDeDoctor } from '../dependencias-de-lectura-del-paquete'
import { leerStatusDelPaquete, type DatosDeStatus } from '../status-del-paquete'
import { leerDoctorDelPaquete, type DatosDeDoctor } from '../doctor-del-paquete'
import { decidirBase, type DecisionDeBase } from '../base-para-el-paquete'
import type { UpdateMemoryResult } from '../memory-protocol'
import { ErrorDeEscritura, type FuenteDeLaTui } from './fuente'
import {
  nombreDelProyecto, leerRecientes, leerBusqueda, leerDetalle, pedidoDeGuardar,
  pedidoDeActualizar, verificarActualizacion, mensajeDe, type Llamador,
} from './fuente-comun'

export type BaseLocal = Exclude<DecisionDeBase, { modo: 'daemon' }>

export interface DependenciasDeFuente {
  /** La base decidida al arrancar. */
  base: DecisionDeBase
  cwd: string
  existe: (path: string) => boolean
  buscarNest: () => Promise<DondeHablarle | null>
  /**
   * La base a usar cuando Nest no contesta: la de Nest en disco (el puntero activo) o, si no
   * hay, la propia. Se vuelve a decidir en cada escritura que cae al local.
   */
  baseSinNest: () => BaseLocal
  crearDaemon: (d: DondeHablarle) => Llamador
  /**
   * Recibe la base decidida en ese momento: con la propia engancha el sync, con la de Nest no.
   * `esperarSync` resuelve cuando la fila de sync de esa base se vació.
   */
  crearLocal: (base: BaseLocal) => Local
  leerStatus: (base: DecisionDeBase) => Promise<DatosDeStatus>
  leerDoctor: (base: DecisionDeBase) => Promise<DatosDeDoctor>
  /** Cuánto espera `cerrar` al sync en vuelo antes de cerrar igual. Default 5 s. */
  topeDeSyncAlCerrarMs?: number
}

type Local = Llamador & { close: () => void; esperarSync?: () => Promise<void> }

const TOPE_DE_SYNC_AL_CERRAR_MS = 5_000

/** `p`, o `ms` milisegundos, lo que llegue antes. Nunca rechaza y no deja el timer vivo. */
async function conTope(p: Promise<unknown>, ms: number): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    await Promise.race([
      p.catch(() => {}),
      new Promise<void>((r) => { timer = setTimeout(r, ms); timer.unref?.() }),
    ])
  } finally {
    clearTimeout(timer)
  }
}

const CODIGOS_DE_CONEXION = new Set(['ECONNREFUSED', 'ENOENT', 'EPIPE'])

/** El mensaje propio del cliente del daemon (`memory-mcp/client.ts`); un `ok: false` que lo
 *  mencione en su texto no cuenta. */
const TIMEOUT_DEL_CLIENTE = 'Nest Memory daemon timed out'

/** El daemon no está o se cortó: distinto de un daemon que contestó que no. */
function esErrorDeConexion(err: unknown): boolean {
  const code = (err as { code?: unknown } | null)?.code
  if (typeof code === 'string' && CODIGOS_DE_CONEXION.has(code)) return true
  return mensajeDe(err).startsWith(TIMEOUT_DEL_CLIENTE)
}

/** A quién le habla la lectura: lo último que una escritura decidió, o la base de arranque. */
type Destino = { tipo: 'daemon'; d: DondeHablarle } | { tipo: 'local'; base: BaseLocal }

export function crearFuenteDelPaquete(deps: DependenciasDeFuente): FuenteDeLaTui {
  const { base, cwd } = deps
  const locales = new Map<string, Local>()
  let destino: Destino = base.modo === 'daemon'
    ? { tipo: 'daemon', d: { socket: base.socket, token: base.token } }
    : { tipo: 'local', base }

  const abrirLocal = (b: BaseLocal) => {
    let c = locales.get(b.path)
    if (!c) { c = deps.crearLocal(b); locales.set(b.path, c) }
    return c
  }

  const lector = async (): Promise<Llamador | null> => {
    if (destino.tipo === 'daemon') return deps.crearDaemon(destino.d)
    const b = destino.base
    if (b.modo === 'propia' && b.nueva && !deps.existe(b.path)) return null
    return abrirLocal(b)
  }

  /** Va al daemon si Nest está vivo, con un reintento al local si se cae; si no, al local. */
  async function escribir<T>(method: string, params: unknown): Promise<T> {
    const nest = await deps.buscarNest()
    const alLocal = async (): Promise<T> => {
      // Con la base de arranque local se sigue en ella; si se arrancó con Nest, se decide
      // de nuevo ahora que ya no está (el puntero de Nest, o la propia).
      const b = base.modo === 'daemon' ? deps.baseSinNest() : base
      destino = { tipo: 'local', base: b }
      try {
        return (await abrirLocal(b).call(method, params)) as T
      } catch (err) {
        throw new ErrorDeEscritura(mensajeDe(err))
      }
    }
    if (!nest) return alLocal()
    try {
      const r = (await deps.crearDaemon(nest).call(method, params)) as T
      destino = { tipo: 'daemon', d: nest }
      return r
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
    // Un push encolado tras la última escritura (guardar y salir enseguida) se espera: cerrar la
    // base debajo lo haría fallar con "database is not open", con el error impreso en la
    // terminal ya restaurada y la memoria sin subir hasta la próxima sesión.
    cerrar: async () => {
      const abiertos = [...locales.values()]
      locales.clear()
      await conTope(
        Promise.all(abiertos.map((c) => c.esperarSync?.())),
        deps.topeDeSyncAlCerrarMs ?? TOPE_DE_SYNC_AL_CERRAR_MS,
      )
      for (const c of abiertos) { try { c.close() } catch { /* ya cerrada */ } }
    },
  }
}

/**
 * La fuente real: decide la base como el resto del paquete y cablea los clientes de verdad.
 * El local se crea con el sync de una pasada cuando la base es la propia.
 */
export async function crearFuenteReal(cwd: string): Promise<FuenteDeLaTui> {
  const base = await dondeEstaLaBase()
  const raven = ravenHome()
  return crearFuenteDelPaquete({
    base, cwd,
    existe: (p) => existsSync(p),
    buscarNest: () => buscarNestVivo(process.env, raven, process.platform === 'win32'),
    baseSinNest: () => decidirBase({
      home: homedir(), existe: (p) => existsSync(p), nestVivo: null,
      punteroDeNest: () => readActivePointer(raven)?.storePath ?? null,
    }) as BaseLocal,
    crearDaemon: (d) => new MemoryDaemonClient(d.socket, d.token),
    // El sync se arma con la base decidida AHORA, no con la de arranque.
    crearLocal: (b) => {
      const alAbrir = alAbrirConSync(b)
      const c = new MemoryLocalClient(b.path, resolveGitInfoForCwd, alAbrir)
      return { call: (m, p) => c.call(m, p), close: () => c.close(), esperarSync: () => alAbrir.enCurso() }
    },
    leerStatus: (b) => leerStatusDelPaquete(dependenciasDeStatus(b)),
    leerDoctor: (b) => leerDoctorDelPaquete(dependenciasDeDoctor(b)),
  })
}
