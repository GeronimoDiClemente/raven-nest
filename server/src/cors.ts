// CORS para las DOS rutas que llama la página `nestmux.com/link` (spec login sin Nest §3).
//
// Cerrado a orígenes conocidos y sin credenciales: el JWT viaja en `Authorization`, nunca en
// una cookie, así que no hay nada que un `Allow-Credentials` habilite que haga falta. El resto
// del servicio no tiene CORS y no lo necesita: lo llaman Nest y la CLI, que no son navegadores.

/** Sin `LINK_WEB_ORIGINS`: la landing y el `astro dev` local (desarrollo). */
export const ORIGENES_POR_DEFECTO: readonly string[] = ['https://nestmux.com', 'http://localhost:4321']

/**
 * La lista de orígenes permitidos. Con la variable seteada manda SÓLO ella: es como producción
 * deja afuera a localhost. Se lee en cada request, igual que el resto del entorno del servicio.
 */
export function origenesDeVinculacion(env: string | undefined): string[] {
  const lista = (env ?? '')
    .split(',')
    .map((o) => o.trim().replace(/\/+$/, ''))
    .filter((o) => o !== '')
  return lista.length > 0 ? lista : [...ORIGENES_POR_DEFECTO]
}

/**
 * Las cabeceras para una respuesta a `origen`. `Vary: Origin` va siempre: la respuesta cambia
 * según quién pregunta, y un caché intermedio que no lo sepa le serviría a un origen la
 * respuesta armada para otro.
 */
export function cabecerasCors(origen: string | undefined, permitidos: readonly string[]): Record<string, string> {
  if (!origen || !permitidos.includes(origen)) return { Vary: 'Origin' }
  return {
    'Access-Control-Allow-Origin': origen,
    'Access-Control-Allow-Methods': 'POST',
    'Access-Control-Allow-Headers': 'authorization, content-type',
    'Access-Control-Max-Age': '600',
    Vary: 'Origin',
  }
}
