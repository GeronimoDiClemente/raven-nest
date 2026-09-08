// Mutex por clave, sin dependencias: una cadena de promesas por clave.
//
// Por que existe (review final de rama, junto con C2/I3): mientras el unico disparador del
// hilo de equipo fue un click humano, dos pasadas sobre el mismo `rootDir` no podian
// coexistir. Con los cuatro disparadores de la spec §8.1 (debounce, poll de 60s,
// reconciliacion al arranque, toggle) por N worktrees del mismo repo, si pueden — y
// `applyVaultPlan` lee el manifest al empezar y lo reescribe entero al final, con lo cual
// dos pasadas intercaladas se pisan la contabilidad.

export class KeyedLock {
  private chains = new Map<string, Promise<unknown>>()

  /** Cuantas claves estan tomadas ahora mismo. Solo para tests: una clave que no se suelta
   *  al drenar seria un leak. */
  get size(): number {
    return this.chains.size
  }

  run<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const previa = this.chains.get(key) ?? Promise.resolve()
    // `then(fn, fn)`: que la anterior haya fallado NO puede trabar la clave para siempre.
    const actual = previa.then(fn, fn)
    // La cadena guarda la version que nunca rechaza; si no, el `then` del proximo caller
    // arrastraria el error ajeno y ademas quedaria un unhandled rejection.
    const drenada = actual.then(() => undefined, () => undefined)
    this.chains.set(key, drenada)
    void drenada.then(() => {
      // Solo si nadie encolo despues: si otro caller ya reemplazo la cadena, esa manda.
      if (this.chains.get(key) === drenada) this.chains.delete(key)
    })
    return actual
  }
}
