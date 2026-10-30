/**
 * Stripe contesta `resource_missing` sobre `customer` cuando el customer guardado en el perfil
 * ya no existe (borrado a mano en el dashboard, o de otra cuenta de Stripe). `code` y `param`
 * cuelgan del error como propiedades; se leen defensivamente porque llega como `unknown`.
 * Compartido por `stripe-checkout` y `stripe-portal`.
 */
export function esClienteInexistente(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false
  const { code, param } = err as { code?: unknown; param?: unknown }
  return code === 'resource_missing' && param === 'customer'
}
