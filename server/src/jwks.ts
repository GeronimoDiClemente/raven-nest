// Las claves públicas del proyecto de Supabase, cacheadas.
//
// Supabase firma los tokens de sesión con una clave por proyecto (ES256) y publica la parte
// pública en `/auth/v1/.well-known/jwks.json`. Este módulo es lo único del servicio que sale
// a la red para autenticar, y lo hace en el camino de una request de usuario — así que todo
// acá es sobre *cuándo NO pedir*: un caché con vencimiento, y un refresco por `kid`
// desconocido que está limitado para que no se lo pueda disparar a voluntad.
import type { JsonWebKey } from 'node:crypto'
import type { ClavesDeFirma } from './devices'

/** Diez minutos. Es el tiempo que una clave retirada puede seguir sirviendo acá. */
export const TTL_DEL_JWKS = 10 * 60 * 1000

/** Lo mínimo entre dos refrescos disparados por un `kid` que no está en el caché. */
export const ESPERA_ENTRE_REFRESCOS = 60 * 1000

export interface DepsDeJwks {
  buscar: (url: string) => Promise<Response>
  ahora: () => number
}

function esClaveDeFirma(k: unknown): k is JsonWebKey & { kid: string } {
  if (!k || typeof k !== 'object') return false
  const jwk = k as { kid?: unknown; use?: unknown }
  if (typeof jwk.kid !== 'string' || jwk.kid === '') return false
  // `use` es opcional; lo que no se acepta es una clave declarada para OTRA cosa. Verificar
  // una firma con una clave de cifrado es usar una llave para lo que su dueño dijo que no.
  return jwk.use === undefined || jwk.use === 'sig'
}

/**
 * Un emisor de claves para un proyecto de Supabase.
 *
 * Cada instancia tiene su propio caché, así que se crea UNA por proceso (lo hace `http.ts`) y
 * no una por request — si no, el caché no cachea nada.
 */
export function clavesDeSupabase(
  urlDelProyecto: string,
  deps: DepsDeJwks = { buscar: (url) => fetch(url), ahora: () => Date.now() }
): ClavesDeFirma {
  const url = `${urlDelProyecto.replace(/\/+$/, '')}/auth/v1/.well-known/jwks.json`

  let cache: Map<string, JsonWebKey> | null = null
  let traidoEn = 0
  // Arranca en el infinito negativo y no en `ahora()`: el primer `kid` desconocido de la vida
  // del proceso SÍ vale un refresco, porque puede ser una rotación que pasó mientras el
  // caché estaba tibio.
  let ultimoRefrescoPorDesconocido = -Infinity

  /** Devuelve `true` si el caché quedó cargado. Nunca lanza. */
  async function traer(): Promise<boolean> {
    try {
      const res = await deps.buscar(url)
      if (!res.ok) return false
      const cuerpo = (await res.json()) as { keys?: unknown } | null
      if (!cuerpo || !Array.isArray(cuerpo.keys)) return false
      const mapa = new Map<string, JsonWebKey>()
      for (const k of cuerpo.keys) if (esClaveDeFirma(k)) mapa.set(k.kid, k)
      cache = mapa
      traidoEn = deps.ahora()
      return true
    } catch {
      // Una red caída no puede tumbar la request: desde el verificador se ve igual que una
      // credencial que no cierra, y el login falla con 401 en vez de con un 500.
      return false
    }
  }

  return {
    async paraKid(kid: string): Promise<JsonWebKey | null> {
      // Un caché vencido o vacío se recarga sin límite de frecuencia: mientras falla, el
      // servicio ya no está autenticando a nadie, así que no hay nada que proteger.
      if (!cache || deps.ahora() - traidoEn > TTL_DEL_JWKS) {
        if (!(await traer())) return null
      }

      const encontrada = cache?.get(kid)
      if (encontrada) return encontrada

      // El `kid` no está: puede ser una rotación recién hecha, o alguien inventando `kid`s.
      // El refresco cubre lo primero; la espera evita que lo segundo se convierta en un
      // martillo contra Supabase con una request nuestra por cada intento ajeno.
      if (deps.ahora() - ultimoRefrescoPorDesconocido < ESPERA_ENTRE_REFRESCOS) return null
      ultimoRefrescoPorDesconocido = deps.ahora()
      if (!(await traer())) return null
      return cache?.get(kid) ?? null
    },
  }
}
