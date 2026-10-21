// Una sola fila para todas las escrituras de window.settings del renderer (final review M5).
// useSettings y useMemoryPrefs escriben read-modify-write (D15): si cada uno tuviera su fila,
// get/get/set/set se cruzan y el segundo set borra lo que guardó el primero.
let cola: Promise<void> = Promise.resolve()

/** Corre `escritura` cuando terminó la anterior. Un error no traba la fila. */
export function encolarEscrituraDeSettings(escritura: () => Promise<void>): Promise<void> {
  const esta = cola.then(escritura)
  cola = esta.catch(() => {})
  return esta
}

/** Sólo para tests. */
export function __reiniciarColaDeSettings(): void { cola = Promise.resolve() }
