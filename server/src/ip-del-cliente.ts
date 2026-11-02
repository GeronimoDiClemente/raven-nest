import type { IncomingMessage } from 'node:http'

/**
 * La IP con la que se llavean los limitadores de las rutas sin credencial de device
 * (`/v1/link/start`, `/v1/devices`).
 *
 * Detrás del proxy de Railway el socket puede ser el del proxy para TODOS: con esa clave el
 * balde de 20 por hora de `start` sería uno solo para todo el servicio y cualquiera lo
 * vaciaría con 20 `curl`. Con `TRUST_PROXY=1` la clave sale de `X-Forwarded-For`, y de su
 * entrada de MÁS A LA DERECHA: es la que agregó el proxy de confianza. Las de la izquierda
 * las escribe el cliente como quiera, así que tomarlas le daría un balde nuevo por request.
 *
 * Sin `TRUST_PROXY=1` el header se ignora (cualquiera puede mandarlo). Si la variable está
 * pero el header falta o su última entrada viene vacía, se cae al socket: antes una clave
 * compartida que una que el cliente pueda elegir.
 */
export function ipDelCliente(req: IncomingMessage, env: NodeJS.ProcessEnv = process.env): string {
  const socket = req.socket.remoteAddress ?? 'sin-ip'
  if (env.TRUST_PROXY !== '1') return socket
  const header = req.headers['x-forwarded-for']
  const valor = Array.isArray(header) ? header[header.length - 1] : header
  if (!valor) return socket
  const ultima = valor.split(',').pop()?.trim() ?? ''
  return ultima || socket
}
