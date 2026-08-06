// Bus de eventos v1 — routing por recetas (evento → comandos → handlers).
// Los adapters/core emiten `DomainEvent`s; las recetas los mapean a `Command`s
// que ejecutan handlers registrados. Sin dependencias de Electron ni estado
// global: la instancia se inyecta (testeable en node puro). Cadena de imports:
// ticket-loop → event-bus → bus-types → ticket-types (nunca al revés).
import type { Command, DomainEvent } from './bus-types'
import type { PanelAdapterDeps } from '../integration-panels'

/**
 * Ejecuta un comando resuelto. Recibe el evento origen (para contexto/observabilidad)
 * y las deps inyectadas (token/config/fetch) — el bus nunca toca tokens ni red.
 */
export type CommandHandler = (
  cmd: Command,
  ev: DomainEvent,
  deps: PanelAdapterDeps,
) => Promise<void>

/**
 * Regla evento→comandos. `when` filtra por tipo de evento; `match` es un
 * predicado runtime opcional (p.ej. sólo un repo); `then` resuelve los params
 * del comando a partir del evento (p.ej. branch→ticket trackeado). Definida acá
 * (no en recipes.ts) para que recipes.ts la importe sin ciclo.
 */
export interface Recipe {
  id: string
  when: DomainEvent['type']
  match?: (ev: DomainEvent) => boolean
  then: (ev: DomainEvent) => Command[]
}

/**
 * Resultado de un `emit`. `commands` son los comandos que las recetas dispararon
 * (en orden, para test/observabilidad). `failed` son aquellos cuyo handler tiró:
 * el emit es best-effort (los demás igual corrieron), pero el emisor necesita
 * saber qué NO se aplicó para reintentar — p.ej. el ticket loop no destrackea un
 * PR mergeado si el `updateStatus` correspondiente está en `failed`. Un comando
 * sin handler registrado NO va a `failed` (reintentarlo sería un bucle: nunca lo
 * tendrá); se avisa por consola aparte.
 */
export interface EmitResult {
  commands: Command[]
  failed: Command[]
}

export class EventBus {
  private handlers = new Map<Command['cmd'], CommandHandler>()
  private recipes: Recipe[] = []
  private onEmitCb?: (ev: DomainEvent) => void

  registerHandler(cmd: Command['cmd'], handler: CommandHandler): void {
    this.handlers.set(cmd, handler)
  }

  setRecipes(recipes: Recipe[]): void {
    this.recipes = [...recipes]
  }

  /**
   * Optional observer invoked with every emitted event, before recipe
   * routing runs. Purely additive: does not read commands/failed, does not
   * touch handler execution, and has no default (a bus with none set is a
   * no-op here). Lets a caller (e.g. the Hub Activity log) capture the
   * event stream without coupling the bus itself to storage.
   */
  setOnEmit(cb: (ev: DomainEvent) => void): void {
    this.onEmitCb = cb
  }

  /**
   * Enruta `ev` por las recetas que matchean, ejecuta el handler de cada comando
   * resuelto y devuelve los comandos disparados (en orden) para test/observabilidad.
   *
   * Best-effort: un handler que tira NO interrumpe a los demás ni rechaza el
   * emit (se loguea con `console.warn` y el comando se acumula en `failed`).
   * Awaitea a TODOS los handlers antes de resolver — el llamador (ticket loop)
   * confía en que el tracking del branch sigue vivo mientras corren los handlers,
   * así que el emit no puede retornar antes de que terminen. Ver `EmitResult`.
   */
  async emit(ev: DomainEvent, deps: PanelAdapterDeps): Promise<EmitResult> {
    this.onEmitCb?.(ev)
    const commands: Command[] = []
    for (const recipe of this.recipes) {
      if (recipe.when !== ev.type) continue
      if (recipe.match && !recipe.match(ev)) continue
      try {
        commands.push(...recipe.then(ev))
      } catch (err) {
        console.warn('[event-bus] recipe.then falló', recipe.id, ev.type, err)
      }
    }
    const failed: Command[] = []
    for (const cmd of commands) {
      const handler = this.handlers.get(cmd.cmd)
      if (!handler) {
        console.warn('[event-bus] sin handler para comando', cmd.cmd, 'evento', ev.type)
        continue
      }
      try {
        await handler(cmd, ev, deps)
      } catch (err) {
        console.warn('[event-bus] handler falló', cmd.cmd, ev.type, err)
        failed.push(cmd)
      }
    }
    return { commands, failed }
  }
}
