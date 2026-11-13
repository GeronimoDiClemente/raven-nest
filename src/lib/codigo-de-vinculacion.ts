// El código que alguien lee de una terminal y tipea en Nest para conectar esa máquina.
//
// La otra punta de `server/src/link.ts`: la CLI muestra `WXYZ-1234` y el usuario lo aprueba
// desde acá, donde sí hay una sesión iniciada. Lo único que pasa entre las dos es un string
// corto leído a ojo, así que todo lo que puede salir mal de este lado es de tipeo.
//
// **Acá NO se valida contra el alfabeto con el que el servidor genera los códigos**, y es
// deliberado: copiarlo crearía una segunda verdad, y el día que el servidor lo cambie este
// archivo rechazaría códigos perfectamente válidos. Un cliente que manda uno inválido recibe
// un error claro; uno que rechaza los válidos deja al usuario sin salida y sin entender por
// qué. Lo que sí se valida es la FORMA —ocho alfanuméricos— que es lo que permite avisar de
// un tipeo sin ir y volver por la red.

/** Cuántos símbolos tiene el código, sin contar el guión. */
const LARGO = 8

export type CodigoNormalizado =
  | { ok: true; codigo: string }
  | { ok: false; motivo: 'incompleto' | 'largo' | 'simbolo' }

/**
 * Deja el código como el servidor lo espera, perdonando las tres formas en que la gente lo
 * tipea de verdad: en minúsculas, sin el guión, y con espacios de haberlo copiado de una
 * terminal.
 *
 * `incompleto` no es un error que haya que mostrar en rojo mientras alguien escribe: es el
 * estado normal de un campo a medio llenar. Quien llama decide cuándo se vuelve un reproche.
 */
export function normalizarCodigo(texto: string): CodigoNormalizado {
  const limpio = texto.replace(/[\s-]/g, '').toUpperCase()
  if (limpio === '') return { ok: false, motivo: 'incompleto' }
  if (!/^[A-Z0-9]*$/.test(limpio)) return { ok: false, motivo: 'simbolo' }
  if (limpio.length < LARGO) return { ok: false, motivo: 'incompleto' }
  if (limpio.length > LARGO) return { ok: false, motivo: 'largo' }
  return { ok: true, codigo: `${limpio.slice(0, 4)}-${limpio.slice(4)}` }
}

/**
 * Lo que el servicio contesta, dicho de una forma que se pueda leer y actuar.
 *
 * Un código que este mapa no conoce **se muestra tal cual** en vez de convertirse en un
 * "something went wrong": el servicio puede aprender errores nuevos después de que esta
 * versión salga, y tragárselos deja al usuario sin nada que buscar ni que reportar.
 */
export function copyDeErrorDeVinculacion(codigo: string): string {
  switch (codigo) {
    case 'unknown_code':
      return 'That code does not exist, or it already expired. Codes last 10 minutes — ask the other machine for a new one.'
    case 'expired':
      return 'That code expired. Codes last 10 minutes — ask the other machine for a new one.'
    case 'already_approved':
      return 'That code was already used. Ask the other machine for a new one.'
    case 'not_in_beta':
      return 'This account is not in the beta yet, so it cannot connect new machines.'
    case 'plan_required':
      return 'Connecting another machine needs a plan with cloud sync.'
    case 'device_limit':
      return 'This account reached its device limit. Revoke one from Settings and try again.'
    case 'issuer_unavailable':
      return 'The sync service cannot issue tokens right now. This is a service problem, not your login.'
    case 'unauthorized':
      return 'Your session expired. Sign in again and retry.'
    default:
      return `The sync service refused the code: ${codigo}`
  }
}
