// La fuente de la TUI que corre adentro de Nest: sólo el daemon, por las variables del pane.
// Corre en el Node 20 de Electron, así que NO puede importar nada que llegue a `node:sqlite`,
// `better-sqlite3` ni `electron` (lo fija un test de grafo de imports): sólo el cliente del
// socket y los tipos del protocolo.
import { MemoryDaemonClient } from '../memory-mcp/client'
import type { FuenteDeLaTui } from './fuente'
import { ErrorDeEscritura } from './fuente'
import {
  nombreDelProyecto, leerRecientes, leerBusqueda, leerDetalle, pedidoDeGuardar,
  pedidoDeActualizar, verificarActualizacion, mensajeDe,
} from './fuente-comun'
import { leerStatusDeNest } from './status-de-nest'
import { completarDoctorConNest, ETIQUETA_DE_BLOQUEADAS } from './doctor-de-nest'

export function crearFuenteDelDaemon(socket: string, token: string, cwd: string): FuenteDeLaTui {
  const c = new MemoryDaemonClient(socket, token)
  const escribir = async <T>(method: string, params: unknown): Promise<T> => {
    try {
      return (await c.call(method as never, params)) as T
    } catch (err) {
      throw new ErrorDeEscritura(mensajeDe(err))
    }
  }
  return {
    proyecto: () => nombreDelProyecto(cwd),
    recientes: (o) => leerRecientes(c, cwd, o),
    buscar: (q, limite) => leerBusqueda(c, cwd, q, limite),
    obtener: (id) => leerDetalle(c, cwd, id),
    guardar: async (m) => { await escribir('memory.save', pedidoDeGuardar(cwd, m)) },
    actualizar: async (id, m) => {
      verificarActualizacion(await escribir('memory.update', pedidoDeActualizar(cwd, id, m)))
    },
    borrar: async (id) => { await escribir('memory.delete', { cwd, syncId: id }) },
    status: () => leerStatusDeNest(c),
    doctor: () => completarDoctorConNest(c, {
      filas: [
        { marca: 'ok', etiqueta: 'Nest', detalle: 'open — memory goes through it' },
        { marca: 'nada', etiqueta: ETIQUETA_DE_BLOQUEADAS, detalle: 'see Memory settings in Nest' },
      ],
      homeDeNest: false, bloqueadas: [], problemas: 0, avisos: 0,
    }),
    cerrar: () => {},
  }
}
