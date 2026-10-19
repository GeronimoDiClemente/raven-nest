// A qué servicio de sync le habla el paquete portátil.
//
// Hasta el 2026-10-19 salía SÓLO de `NEST_MEMORY_SYNC_URL`, y sin esa variable `login`
// cortaba con «No sync service configured»: un `npx nest-memory` en una máquina nueva no podía
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
