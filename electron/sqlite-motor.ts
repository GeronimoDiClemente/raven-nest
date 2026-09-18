// Qué motor de SQLite usa `MemoryStore` cuando nadie le pasa uno.
//
// Vive en su propio archivo, **sin un solo import**, por dos motivos que se juntan:
//
// 1. `memory-store.ts` no puede nombrar a `better-sqlite3` ni directa ni indirectamente: es
//    núcleo compartido con el paquete portátil, que corre bajo Node pelado. Lo fija
//    `paquete-sin-nativas.test.ts`, que camina el grafo de imports.
// 2. El arranque que registra el motor —`main.ts` en Electron, el `setupFiles` en los tests—
//    necesita registrarlo SIN cargar `memory-store.ts`. Cuando el registro vivía adentro de
//    ese archivo, el setup de los tests lo importaba y lo cargaba antes de que un test
//    pudiera instalar su `vi.mock('fs')`: el módulo quedaba con el `fs` real y tres tests de
//    migración dejaron de ver el fallo que simulaban. Un archivo intermedio y vacío de
//    dependencias corta esa cadena.
import type { AbridorDeBase } from './sqlite-forma'

let abridorRegistrado: AbridorDeBase | null = null
let abridorDeLecturaRegistrado: AbridorDeBase | null = null

/** Lo llama el arranque de cada entorno, una vez, con el motor que corresponda ahí. */
export function usarAbridorPorDefecto(abrir: AbridorDeBase): void {
  abridorRegistrado = abrir
}

export function abridorPorDefecto(): AbridorDeBase | null {
  return abridorRegistrado
}

/**
 * El de SÓLO LECTURA, que es otro: el modo sin daemon no puede migrar ni prender WAL sobre
 * una base que puede tener otro proceso abierta. Se registra aparte y no se deriva del de
 * arriba porque las opciones de apertura son distintas, no un detalle.
 */
export function usarAbridorDeLecturaPorDefecto(abrir: AbridorDeBase): void {
  abridorDeLecturaRegistrado = abrir
}

export function abridorDeLecturaPorDefecto(): AbridorDeBase | null {
  return abridorDeLecturaRegistrado
}
