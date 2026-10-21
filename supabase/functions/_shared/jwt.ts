/** El token de `Authorization: Bearer <jwt>`, o null. Compartido por las functions de cobro. */
export function jwtDelHeader(header: string | null): string | null {
  const m = /^Bearer\s+(.+)$/i.exec(header ?? '')
  const token = m?.[1]?.trim()
  return token ? token : null
}
