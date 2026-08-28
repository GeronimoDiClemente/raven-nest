export type NombreRuta = 'manifest' | 'accounts' | 'account' | 'plan'

export interface Ruta {
  nombre: NombreRuta
  id?: string
}

/**
 * Parsea el path a una ruta del contrato.
 *
 * Acepta el path con y sin el prefijo `/admin-api`: el back-office arma la URL
 * como `${baseUrl}/api/internal/...` y su baseUrl ya incluye
 * `/functions/v1/admin-api`, pero el prefijo depende de cómo se invoque.
 * `borrar` no sale de acá: es la ruta `account` con método DELETE.
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
  if (partes[0] !== 'accounts') return null
  if (partes.length === 2) return { nombre: 'account', id: partes[1] }
  if (partes.length === 3 && partes[2] === 'plan') return { nombre: 'plan', id: partes[1] }
  return null
}
