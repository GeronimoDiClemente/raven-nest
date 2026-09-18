// Qué muestra el panel de la extensión, decidido sin VS Code de por medio.
//
// El §3.3 del spec es explícito sobre qué es la extensión: «empaqueta la CLI y le pone una
// cara»; «la extensión es la puerta, no el motor». Entonces lo único propio que tiene es esta
// decisión — qué titular, qué detalle y qué acción ofrecer dado el estado del mundo— y se
// puede escribir y probar entera sin levantar un editor.
//
// Todo lo que entra acá ya existe y está probado: de dónde sale la base (§5.2), si esta
// máquina puede descifrar (§7), y cuántas memorias hay. Esto sólo lo ordena para alguien que
// mira un panel.
//
// Tres reglas vienen derecho del §7 y están fijadas con tests, porque son las que un rediseño
// se lleva puestas sin querer:
//
// 1. **La huella se muestra siempre que se esté esperando**, no sólo cuando algo falla. Es el
//    mecanismo que hace visible la sustitución de clave: el usuario compara dos strings
//    cortos antes de autorizar.
// 2. **El código de recuperación es el camino B.** Usarlo gasta la única copia de emergencia,
//    así que se ofrece, pero nunca como acción principal.
// 3. **Lo que no puede leer, lo dice.** Bajar filas cifradas y mostrarlas vacías —o peor, no
//    mostrarlas— es el modo de falla que más confianza destruye.
import type { DecisionDeBase } from './base-para-el-paquete'
import type { ResultadoDeEnrolamiento } from './enrolamiento-del-paquete'

export type AccionDelPanel =
  | 'conectar-cuenta'
  | 'copiar-huella'
  | 'usar-codigo-de-recuperacion'
  | 'configurar-editores'

export interface EntradaDelPanel {
  base: DecisionDeBase
  cuentaConectada: boolean
  enrolamiento: ResultadoDeEnrolamiento
  memorias: number
  /** Cuántas memorias hay que esta máquina no puede abrir. */
  ilegibles: number
}

export interface EstadoDelPanel {
  titular: string
  detalle: string
  /** De dónde salen las memorias que se ven, dicho para una persona. */
  origen: string
  memorias: number
  ilegibles: number
  huella: string | null
  acciones: AccionDelPanel[]
  accionPrincipal: AccionDelPanel | null
}

function origenDe(base: DecisionDeBase): string {
  if (base.modo === 'daemon') return 'Nest is running here — it owns the memory and the syncing.'
  if (base.modo === 'nest') return "This machine's Nest memory."
  return base.nueva ? 'A new memory on this machine.' : 'The memory on this machine.'
}

export function estadoDelPanel(e: EntradaDelPanel): EstadoDelPanel {
  const origen = origenDe(e.base)
  const acciones: AccionDelPanel[] = ['configurar-editores']
  let huella: string | null = null
  let titular: string
  let detalle: string
  let accionPrincipal: AccionDelPanel | null = null

  // Con Nest vivo acá no se ofrece conectar: él es el escritor único y el que sincroniza, y
  // dos daemons sobre la misma cuenta es exactamente lo que el candado del §6.3 evita.
  // Poner el botón invita al usuario a crear ese problema con un clic.
  const puedeConectar = e.base.modo !== 'daemon'

  if (!e.cuentaConectada) {
    titular = 'Your memory lives on this machine only.'
    // Sin cuenta no se habla de cifrado: no hay nube que descifrar, y mencionarlo acá suena
    // a que algo está mal cuando no lo está.
    detalle = puedeConectar
      ? 'Connect your account to carry it between machines.'
      : 'Nest is connected here, so this panel has nothing to connect.'
    if (puedeConectar) { acciones.push('conectar-cuenta'); accionPrincipal = 'conectar-cuenta' }
    return { titular, detalle, origen, memorias: e.memorias, ilegibles: e.ilegibles, huella, acciones, accionPrincipal }
  }

  switch (e.enrolamiento.estado) {
    case 'sin-llavero':
      titular = 'This system has no keyring, so encrypted memory stays closed.'
      detalle = 'Saving, searching and reading what lives on this machine works exactly the same.'
      break

    case 'cuenta-sin-cifrado':
      titular = 'Connected.'
      detalle = 'Your account does not encrypt memory, so there is nothing to authorize.'
      break

    case 'esperando-autorizacion':
      huella = e.enrolamiento.huella
      titular = 'This machine cannot read your encrypted memory yet.'
      detalle = 'Authorize it from Nest on another machine, comparing this fingerprint.'
      acciones.push('copiar-huella', 'usar-codigo-de-recuperacion')
      accionPrincipal = 'copiar-huella'
      break

    case 'lista':
      titular = 'Connected, and this machine can read your encrypted memory.'
      detalle = 'Nothing to do.'
      break

    case 'error':
      titular = 'Could not check whether this machine can decrypt.'
      // El detalle del servicio va tal cual. Un "something went wrong" deja al usuario sin
      // nada que buscar ni que reportar.
      detalle = e.enrolamiento.detalle
      break
  }

  // El conteo de ilegibles va al final y en TODOS los casos con cuenta: es la mitad honesta
  // de lo que el panel dice, y esconderla cuando el estado es bueno la volvería una excusa
  // en vez de un dato.
  if (e.ilegibles > 0) {
    detalle = `${detalle} ${e.ilegibles} ${e.ilegibles === 1 ? 'memory is' : 'memories are'} unreadable here.`
  }

  return { titular, detalle, origen, memorias: e.memorias, ilegibles: e.ilegibles, huella, acciones, accionPrincipal }
}
