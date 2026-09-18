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
  env: Record<string, string | undefined>
  home: string
  existe: (path: string) => boolean
  /**
   * Si el socket que dice el entorno responde.
   *
   * No alcanza con que la variable esté: Nest se la inyecta a las terminales que abre, y si
   * el usuario **cierra Nest** la variable sigue puesta en esa terminal para siempre. Es el
   * caso más común, no un borde: sin esta sonda el paquete le hablaría a un socket muerto y
   * fallaría justo cuando el modo local es lo que corresponde.
   */
  socketVivo: (socket: string) => boolean
  /** El `.db` que Nest declara activo, o `null`. Ver `memory-active-store.ts`. */
  punteroDeNest: () => string | null
}

/** `{home}/.nest-memory/memory.db` — la base del paquete en una máquina que nunca tuvo Nest. */
export function pathDeBasePropia(home: string): string {
  return join(home, '.nest-memory', 'memory.db')
}

export function decidirBase(e: EntornoDeBase): DecisionDeBase {
  const socket = e.env.NEST_MEMORY_SOCKET
  const token = e.env.NEST_MEMORY_TOKEN
  // Los dos o ninguno: con el socket pero sin el token no hay forma de autenticarse, y
  // delegar en algo a lo que no se le puede hablar es peor que no delegar.
  if (socket && token && e.socketVivo(socket)) return { modo: 'daemon', socket, token }

  const deNest = e.punteroDeNest()
  if (deNest) return { modo: 'nest', path: deNest }

  const propia = pathDeBasePropia(e.home)
  return { modo: 'propia', path: propia, nueva: !e.existe(propia) }
}
