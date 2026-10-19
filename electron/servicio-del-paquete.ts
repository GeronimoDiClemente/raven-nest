// A qué servicio de sync le habla el paquete portátil.
//
// Hasta el 2026-10-19 salía SÓLO de `NEST_MEMORY_SYNC_URL`, y sin esa variable `login`
// cortaba con «No sync service configured»: un `npx @nestmux/memory` en una máquina nueva no podía
// conectarse sin que la persona supiera una URL. Ahora es el mismo orden que Nest
// (`base-de-sync.ts`): lo explícito, después lo guardado, y al final el default.
import { normalizarBaseDeSync, BASE_DE_SYNC_POR_DEFECTO } from './base-de-sync'

/**
 * `env` gana porque es lo que alguien pidió a propósito para ESTA corrida (un servicio de
 * desarrollo, staging). `guardada` es contra la que se hizo el `login`: el token sólo vale en
 * el servicio que lo emitió, así que una máquina conectada a staging tiene que seguir
 * hablándole a staging aunque mañana falte la variable. Nunca devuelve null.
 */
export function servicioDelPaquete(origenes: { env: string | undefined; guardada: string | null | undefined }): string {
  return (
    normalizarBaseDeSync(origenes.env) ??
    normalizarBaseDeSync(origenes.guardada) ??
    BASE_DE_SYNC_POR_DEFECTO
  )
}

/**
 * Review final de rama, A: `env` le GANA a `guardada` arriba, a propósito — pero un token
 * sólo vale en el servicio que lo emitió. Si alguien setea `NEST_MEMORY_SYNC_URL` apuntando
 * a otro lado que donde esta máquina hizo `login`, `servicioDelPaquete` calla y usa el env de
 * todos modos: el fallo que eso produce (401/403 contra un servicio que nunca vio este
 * token) no explica por qué. Este es el aviso que lo dice — `null` sin conflicto (sin env,
 * sin credencial guardada, o las dos apuntan al mismo lugar), para que el caller no imprima
 * nada en el caso normal.
 */
export function avisoDeServicioDistinto(origenes: { env: string | undefined; guardada: string | null | undefined }): string | null {
  const env = normalizarBaseDeSync(origenes.env)
  const guardada = normalizarBaseDeSync(origenes.guardada)
  if (!env || !guardada || env === guardada) return null
  return `NEST_MEMORY_SYNC_URL (${env}) differs from the service this device's token was issued by (${guardada}) — using the env one, so sync may fail with an auth error.`
}
