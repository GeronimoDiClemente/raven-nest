// La base del servicio de sync: cuál es, y de dónde sale.
//
// `MAIN_VITE_SYNC_URL` se hornea en tiempo de build desde un `.env` que sólo existe en una
// máquina de desarrollo; los workflows de release no pasan esa variable. Sin un default, toda
// instalación armada por CI se quedaría sin servicio y el usuario no podría hacer nada.
//
// Por eso acá hay un default. Una instalación tiene que nacer sabiendo con qué servicio
// hablar; la cuenta ya está protegida por el allowlist del servicio, no por que el cliente no
// sepa la dirección.

/**
 * El servicio con el que habla una instalación sin configurar.
 *
 * **Es una decisión de producto que vive en una constante a propósito.** Es un dominio propio y no la dirección de un proveedor: mudar el servicio (de Railway a otro
 * lado) pasa a ser cambiar un registro DNS, sin release y sin que ninguna instalación lo note.
 */
export const BASE_DE_SYNC_POR_DEFECTO = 'https://sync.nestmux.com'

/**
 * Direcciones que son el MISMO servidor que otra, con otro nombre. La de Railway prod es la
 * que se horneó antes del dominio propio: la tienen guardada instalaciones (Advanced › Sync
 * server) y el plugin (el servicio de su `login`). Sin el alias, el plugin vería un token «de
 * otro servicio» y avisaría. Staging no va acá: es otro servidor, y sus tokens no valen en prod.
 */
const ALIAS_DE_BASE: Record<string, string> = {
  'https://sync-production-54ba.up.railway.app': BASE_DE_SYNC_POR_DEFECTO,
}

export interface OrigenesDeBase {
  /** Lo que eligió ESTA instalación (`connection.json`). */
  guardada: string | null
  /** Lo que se horneó en el build (`MAIN_VITE_SYNC_URL`), para los builds de desarrollo. */
  delBuild: string | null
}

/**
 * Deja una base lista para concatenarle `/v1/...`, o `null` si no sirve como servicio.
 *
 * Sólo http y https: un `file:` o un `javascript:` guardado no puede convertirse en un
 * destino al que la app le manda un token. Las barras finales se sacan porque quien la usa
 * concatena, y `https://x//v1/sync/push` no es la misma ruta. Una dirección de `ALIAS_DE_BASE`
 * sale con su nombre nuevo: como todo origen pasa por acá, ninguno tiene que saber del alias.
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
  const base = `${url.origin}${url.pathname}`.replace(/\/+$/, '')
  return ALIAS_DE_BASE[base] ?? base
}

/**
 * La base que corresponde usar, siempre. **Nunca devuelve `null`**: quedarse sin servicio no
 * es un estado que esta función pueda producir, y por eso quien la llama no necesita un
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
