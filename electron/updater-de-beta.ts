// De dónde se actualiza una beta (2026-10-05).
//
// Una versión estable se actualiza desde las releases públicas de GitHub. Una beta NO: la
// beta cerrada no se publica en GitHub (el repo es público), así que sus actualizaciones las
// sirve el servicio de sync, sólo a devices de cuentas del allowlist (`server/src/betas.ts`).
// La credencial es el token del device de memoria — el mismo que ya usa la nube.
//
// Sin ese token (la máquina todavía no conectó la nube) no hay con qué pedir: se saltea el
// chequeo en vez de pegarle al servicio para comerse un 401 cada cuatro horas. La beta
// siguiente la baja con su link personal, o se actualiza sola apenas conecte la nube.

/** `1.6.0-beta.3` sí; `1.6.0`, `1.6.0-rc.1`, no. Misma regla que el renderer y que `release.yml`. */
export function esVersionBeta(version: string): boolean {
  return /^\d+\.\d+\.\d+-beta\.\d+$/.test(version)
}

/** El feed genérico que lee electron-updater: `<base>/v1/beta/update/latest.yml` y siguientes. */
export function feedDeBeta(baseDeSync: string): string {
  return `${baseDeSync.replace(/\/+$/, '')}/v1/beta/update/`
}

/**
 * Los headers del chequeo, o `null` si no hay token y hay que saltearlo.
 *
 * `authorization` en minúscula, a propósito: electron-updater borra ESE nombre exacto cuando
 * un redirect lleva a una URL prefirmada de S3/R2. Con otra capitalización el token del device
 * viajaría a Cloudflare, y R2 rechaza un pedido con dos firmas.
 */
export function headersDeBeta(token: string | null): Record<string, string> | null {
  if (!token) return null
  return { authorization: `Bearer ${token}` }
}
