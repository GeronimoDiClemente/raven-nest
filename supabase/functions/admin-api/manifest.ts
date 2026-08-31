import type { Manifest } from './tipos.ts'

/**
 * Lo que Nest declara saber hacer. El back-office arma su navegación con esto
 * y nunca pregunta "¿este producto es Nest?".
 */
export const MANIFEST: Manifest = {
  product: 'nest',
  account_label: { singular: 'usuario', plural: 'usuarios' },
  capabilities: ['accounts'],
  // Nest no tiene flags de staff: `user_preferences` es configuración de UI del
  // usuario y el back-office no tiene por qué tocarla.
  flags: [],
  usage_meters: [
    { key: 'seats', label: 'Seats', unit: 'seats' },
    { key: 'repos', label: 'Repos conectados', unit: 'repos' },
    { key: 'teams', label: 'Equipos', unit: 'equipos' },
  ],
  sections: [{ key: 'equipos', label: 'Equipos', module: 'nest/equipos' }],
}
