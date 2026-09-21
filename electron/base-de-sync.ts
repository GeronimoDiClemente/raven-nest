// La base del servicio de sync: cuál es, y de dónde sale.
//
// Vivía como una expresión de tres términos adentro de `main.ts` y ahí se escondía un agujero
// que costó una semana de diagnóstico equivocado del lado del servidor: el término que el C4
// pensó para que apuntar a otro backend no exigiera recompilar (`syncBaseUrl` en
// `connection.json`) **no lo escribía nadie**, y el otro (`MAIN_VITE_SUPABASE_URL`) se hornea
// en tiempo de build desde un `.env` que sólo existe en una máquina de desarrollo. Los
// workflows de release no pasan esa variable, así que toda instalación armada por CI contesta
// «No sync service configured for this build» y no hay nada que el usuario pueda hacer.
//
// Por eso acá hay un default. Una instalación tiene que nacer sabiendo con qué servicio
// hablar; la cuenta ya está protegida por el allowlist del servicio, no por que el cliente no
// sepa la dirección.

/**
 * El servicio con el que habla una instalación que nadie configuró.
 *
 * **Es una decisión de producto que vive en una constante a propósito**: el día que el
 * servicio se mude a un dominio propio se cambia acá, y las instalaciones viejas —que ya
 * habrían quedado apuntando a una dirección muerta— se arreglan desde la UI sin esperar un
 * release, que es justamente para lo que existe el override guardado.
 */
export const BASE_DE_SYNC_POR_DEFECTO = 'https://sync-production-54ba.up.railway.app'

export interface OrigenesDeBase {
  /** Lo que eligió ESTA instalación (`connection.json`). */
  guardada: string | null
  /** Lo que se horneó en el build (`MAIN_VITE_SUPABASE_URL`), para los builds de desarrollo. */
  delBuild: string | null
}

/**
 * Deja una base lista para concatenarle `/v1/...`, o `null` si no sirve como servicio.
 *
 * Sólo http y https: un `file:` o un `javascript:` guardado no puede convertirse en un
 * destino al que la app le manda un token. Las barras finales se sacan porque quien la usa
 * concatena, y `https://x//v1/sync/push` no es la misma ruta.
 */
export function normalizarBaseDeSync(valor: string | null | undefined): string | null {
  const limpio = (valor ?? '').trim()
  if (limpio === '') return null
  let url: URL
  try {
    url = new URL(limpio)
  } catch {
    return null
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
  if (url.hostname === '') return null
  return `${url.origin}${url.pathname}`.replace(/\/+$/, '')
}

/**
 * La base que corresponde usar, siempre. **Nunca devuelve `null`**: quedarse sin servicio no
 * es un estado que esta función pueda producir, y por eso quien la llama ya no necesita un
 * camino de error para "no hay sync configurado".
 *
 * Un origen que no se puede usar no frena la búsqueda, se saltea: si una URL guardada mal
 * apagara la nube, un dedazo en el campo de la UI dejaría a la instalación sin manera de
 * volver salvo editando un JSON a mano.
 */
export function resolverBaseDeSync(origenes: OrigenesDeBase): string {
  return (
    normalizarBaseDeSync(origenes.guardada) ??
    normalizarBaseDeSync(origenes.delBuild) ??
    BASE_DE_SYNC_POR_DEFECTO
  )
}

export type CambioDeBase = { ok: true; guardar: string | null } | { ok: false; error: string }

/**
 * Qué hacer con lo que el usuario escribió en el campo de la UI.
 *
 * **Es más estricto que `resolverBaseDeSync` a propósito.** Leer se saltea una URL que no
 * sirve, porque la app tiene que tener servicio pase lo que pase; guardar no puede hacer lo
 * mismo, porque entonces un dedazo quedaría guardado y a la vista mientras la app le habla a
 * otro servicio, sin una sola señal de que algo no cerró.
 *
 * Vaciar el campo guarda `null`, que significa «la que venga por default». Y escribir a mano
 * exactamente la del default NO es lo mismo: queda elegida, así que el día que el default
 * cambie esta instalación no se muda sola.
 */
export function decidirCambioDeBase(valor: string | null | undefined): CambioDeBase {
  if ((valor ?? '').trim() === '') return { ok: true, guardar: null }
  const limpia = normalizarBaseDeSync(valor)
  if (!limpia) return { ok: false, error: 'That is not a service address — it has to start with https:// (or http:// for a local one)' }
  return { ok: true, guardar: limpia }
}
