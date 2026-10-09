// El sync del MCP del paquete portátil: §6.2 del spec, «paquete con cuenta → un `push` al
// final de cada operación de escritura y un `pull` perezoso al arrancar. No corre un daemon
// de fondo».
//
// `sync-del-paquete.ts` resuelve el caso de un comando que sincroniza una vez y se muere.
// El MCP es distinto: vive lo que dura la sesión del editor —horas— y escribe muchas veces.
// Eso trae dos problemas que este archivo resuelve, y nada más:
//
// - **El candado.** Un `MemoryDaemon` arrancado lo toma en el primer sync y lo suelta recién
//   en `stop()`. Un MCP que lo tomara y lo guardara dejaría a Nest, abierto en esta misma
//   máquina, sin poder sincronizar mientras el editor siga abierto. Este daemon nunca se
//   arranca, así que lo suelta él solo al terminar cada operación —también las que encadena
//   después de este `stop()`—, y el `stop()` de acá limpia el backoff que haya quedado.
// - **La fila.** Un agente puede guardar cinco memorias seguidas. Cinco pushes en paralelo
//   se pisarían; cinco en fila serían cinco viajes para lo que un solo push ya levanta,
//   porque `push()` drena el `mutation_log` entero. Así que van en fila, y las escrituras
//   que llegan mientras uno vuela se juntan en UN push más.
//
// Cuando el editor cierra, no hay que hacer nada especial: el proceso no termina mientras
// haya un `fetch` en vuelo, así que el último push sale igual.

/** Lo que hace falta del daemon. `MemoryDaemon` lo cumple tal cual. */
export interface SincronizadorSoltable {
  pull(): Promise<void>
  push(): Promise<void>
  /** Suelta el candado (y cualquier temporizador, que acá no hay porque nunca se arranca). */
  stop(): void
}

export class SyncDelMcp {
  private fila: Promise<void> = Promise.resolve()
  /** Hay un push encolado que todavía no empezó: una escritura más no necesita otro. */
  private pushPendiente = false

  constructor(private readonly s: SincronizadorSoltable, private readonly hayCuenta: boolean) {}

  /** El pull perezoso del arranque. No se espera: un agente puede leer lo que ya hay. */
  alArrancar(): void {
    if (!this.hayCuenta) return
    this.encolar(() => this.s.pull())
  }

  /** Llamarlo después de cada escritura. Sube lo encolado, sin bloquear al agente. */
  trasEscribir(): void {
    if (!this.hayCuenta || this.pushPendiente) return
    this.pushPendiente = true
    this.encolar(() => {
      // Se baja ANTES de empezar, no al terminar: una escritura que llega mientras este
      // push vuela ya no está garantizada en él, y tiene que poder pedir el siguiente.
      this.pushPendiente = false
      return this.s.push()
    })
  }

  /** Para los tests, y para quien quiera esperar a que se vacíe la fila. */
  enCurso(): Promise<void> {
    return this.fila
  }

  private encolar(op: () => Promise<void>): void {
    this.fila = this.fila.then(async () => {
      try {
        await op()
      } catch (err) {
        // Un sync que falla NO es un error del agente: lo escrito ya está en la base local
        // y en el `mutation_log`, así que el próximo push lo vuelve a intentar. El daemon
        // ya registró el motivo en su estado. stderr, nunca stdout: stdout es el protocolo.
        console.error(`[nest-memory] sync: ${err instanceof Error ? err.message : String(err)}`)
      } finally {
        this.s.stop()
      }
    })
  }
}
