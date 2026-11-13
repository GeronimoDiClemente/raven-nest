// De dónde saca las memorias el paquete portátil (spec
// `2026-09-13-nest-memory-portable-design.md` §5), decidido sin tocar el disco.
//
// El orden importa y es el del spec: si Nest está corriendo en esta máquina, él es el
// escritor único y el que sincroniza, así que el paquete delega. Recién si no está se abre
// una base directo.
//
// **Por qué la base de Nest gana sobre una propia que ya exista**: son las mismas memorias.
// Tener dos copias sería el peor resultado posible — dos verdades de lo mismo, y ninguna
// forma de saber cuál leyó el agente.
import { join } from 'path'

export type DecisionDeBase =
  /** Nest está vivo acá: se le habla por el socket y no se abre nada. */
  | { modo: 'daemon'; socket: string; token: string }
  /** Sin Nest corriendo, pero esta máquina tiene su base. */
  | { modo: 'nest'; path: string }
  /** Ni Nest ni su base: el paquete abre la suya. `nueva` distingue la primera vez. */
  | { modo: 'propia'; path: string; nueva: boolean }

export interface EntornoDeBase {
  home: string
  existe: (path: string) => boolean
  /**
   * El Nest que contestó un `ping`, o `null`. Lo averigua `buscarNestVivo` antes de decidir,
   * porque es la única pregunta asincrónica: hay que hablarle de verdad.
   *
   * No alcanza con que haya dónde buscarlo: Nest inyecta las variables en sus terminales y
   * deja el `pipe-auth.json` en disco, y las dos cosas SIGUEN AHÍ cuando el usuario cierra
   * Nest. Sin la sonda, el paquete le hablaría a un socket muerto justo cuando el modo local
   * es lo que corresponde.
   */
  nestVivo: { socket: string; token: string } | null
  /** El `.db` que Nest declara activo, o `null`. Ver `memory-active-store.ts`. */
  punteroDeNest: () => string | null
}

/** `{home}/.nest-memory/memory.db` — la base del paquete en una máquina que nunca tuvo Nest. */
export function pathDeBasePropia(home: string): string {
  return join(home, '.nest-memory', 'memory.db')
}

export function decidirBase(e: EntornoDeBase): DecisionDeBase {
  if (e.nestVivo) return { modo: 'daemon', ...e.nestVivo }

  const deNest = e.punteroDeNest()
  if (deNest) return { modo: 'nest', path: deNest }

  const propia = pathDeBasePropia(e.home)
  return { modo: 'propia', path: propia, nueva: !e.existe(propia) }
}
