// Una línea JSON por request: lo mínimo para saber desde los logs de Railway qué falla, cuánto
// tarda y con qué frecuencia, sin abrir un agujero en lo que el servicio promete no saber.
//
// Qué NO va, a propósito: el cuerpo, los headers (llevan el token `nmk_` o el JWT), la query
// string, el device ni el usuario. La ruta pasa por `rutaParaLog`: las de `/beta/` llevan un
// token en el path, y una ruta desconocida puede ser cualquier cosa que alguien mandó.
import { randomUUID } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'

const RUTAS_CONOCIDAS = new Set([
  '/health',
  '/internal/plan',
  '/internal/memberships',
  '/v1/devices',
  '/v1/devices/revoke',
  '/v1/link/start',
  '/v1/link/approve',
  '/v1/link/check',
  '/v1/link/poll',
  '/v1/sync/push',
  '/v1/sync/pull',
  '/v1/sync/status',
  '/v1/sync/delete-data',
  '/functions/v1/memory-sync/push',
  '/functions/v1/memory-sync/pull',
  '/functions/v1/memory-sync/delete-cloud-data',
  '/v1/projects/share',
  '/v1/projects/keep',
  '/v1/keys',
  '/v1/keys/enroll',
  '/v1/keys/publish',
  '/v1/teams/key',
  '/v1/teams/key/activate',
  '/v1/teams/key/authorize',
  '/v1/teams/key/recrypt',
  '/v1/teams/key/recrypt-pending',
])

export function rutaParaLog(path: string): string {
  if (RUTAS_CONOCIDAS.has(path)) return path
  if (path.startsWith('/v1/beta/')) return '/v1/beta/:x'
  if (path.startsWith('/beta/')) return '/beta/:x'
  return '(otra)'
}

export interface LineaDeRequest {
  t: string
  rid: string
  metodo: string
  ruta: string
  status: number
  ms: number
}

/**
 * Le pone un id a la request (también como `X-Request-Id` en la respuesta, para que un reporte
 * de un usuario se pueda cruzar con el log) y emite la línea cuando la respuesta terminó.
 *
 * `/health` con 200 no se registra: un monitor de uptime le pega cada minuto y taparía todo lo
 * demás. Un `/health` que falla sí.
 */
export function registrarRequest(
  req: IncomingMessage,
  res: ServerResponse,
  emitir: (linea: LineaDeRequest) => void,
  ahora: () => number = () => performance.now()
): string {
  const rid = randomUUID()
  const inicio = ahora()
  res.setHeader('X-Request-Id', rid)
  res.on('finish', () => {
    const ruta = rutaParaLog(new URL(req.url ?? '/', 'http://x').pathname)
    if (ruta === '/health' && res.statusCode === 200) return
    emitir({
      t: new Date().toISOString(),
      rid,
      metodo: req.method ?? '?',
      ruta,
      status: res.statusCode,
      ms: Math.round(ahora() - inicio),
    })
  })
  return rid
}

/** El emisor de producción. `SYNC_ACCESS_LOG=0` lo apaga (lo usa el suite de tests). */
export function emisorDelEntorno(env: NodeJS.ProcessEnv = process.env): (l: LineaDeRequest) => void {
  if (env.SYNC_ACCESS_LOG === '0') return () => {}
  return (l) => console.log(JSON.stringify(l))
}
