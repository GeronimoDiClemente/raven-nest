export type NombreRuta =
  | 'manifest'
  | 'accounts'
  | 'account'
  | 'plan'
  | 'equipos'
  | 'equipo_miembro'
  | 'equipo_owner'

export interface Ruta {
  nombre: NombreRuta
  /** Id de la cuenta (usuario). Sólo en las rutas que cuelgan de `accounts`. */
  id?: string
  /** Id del equipo. Sólo en las rutas que cuelgan de `equipos`. */
  teamId?: string
  /** Id de la fila de `team_members`, no del usuario. */
  memberId?: string
}

/**
 * Parsea el path a una ruta del contrato.
 *
 * Acepta el path con y sin el prefijo `/admin-api`: el back-office arma la URL
 * como `${baseUrl}/api/internal/...` y su baseUrl ya incluye
 * `/functions/v1/admin-api`, pero el prefijo depende de cómo se invoque.
 * `borrar` no sale de acá: es la ruta `account` con método DELETE.
 *
 * Los ids del equipo y del miembro son campos propios en vez de reusar `id`:
 * la ruta de miembros necesita dos, y un solo campo que signifique cosas
 * distintas según la ruta es la clase de ambigüedad que termina en una
 * escritura sobre el objeto equivocado.
 */
export function rutaDe(pathname: string): Ruta | null {
  const limpio = pathname.replace(/^\/admin-api/, '').replace(/\/+$/, '')
  const resto = limpio.startsWith('/api/internal') ? limpio.slice('/api/internal'.length) : null
  if (resto === null) return null

  if (resto === '/manifest') return { nombre: 'manifest' }
  if (resto === '' || resto === '/accounts') {
    return resto === '/accounts' ? { nombre: 'accounts' } : null
  }

  const partes = resto.split('/').filter(Boolean)

  if (partes[0] === 'equipos') {
    if (partes.length === 3 && partes[2] === 'owner') {
      return { nombre: 'equipo_owner', teamId: partes[1] }
    }
    if (partes.length === 4 && partes[2] === 'miembros') {
      return { nombre: 'equipo_miembro', teamId: partes[1], memberId: partes[3] }
    }
    return null
  }

  if (partes[0] !== 'accounts') return null
  if (partes.length === 2) return { nombre: 'account', id: partes[1] }
  if (partes.length === 3 && partes[2] === 'plan') return { nombre: 'plan', id: partes[1] }
  if (partes.length === 3 && partes[2] === 'equipos') return { nombre: 'equipos', id: partes[1] }
  return null
}
