// Handlers de comandos del bus v1 (T5). El EventBus enruta eventos → comandos
// (recetas) y estos handlers EJECUTAN cada comando estándar contra el adapter
// real. Credential-free: los tokens/red llegan SOLO por `deps` inyectadas
// (getToken/getConfig/fetch) — el repo es público, cero secretos hardcodeados.
//
// Contrato best-effort: el EventBus ya envuelve cada handler en try/catch, pero
// además NINGÚN handler debe tirar por token/config ausente — degrada con
// `console.warn` y no-op, así una integración desconectada no rompe el resto de
// la secuencia (updateStatus real igual corre aunque notify no tenga token).
//
// Cadena de imports permitida: bus-commands → event-bus/bus-types/ticket-types
// (+ integration-panels para deps). Nunca importa ticket-loop.ts: la resolución
// del provider llega por inyección estructural (`TicketProviderResolver`).
import type { EventBus } from './event-bus'
import type {
  CreateTaskCommand,
  NotifyCommand,
  OpenSessionCommand,
  UpdateStatusCommand,
  DomainEvent,
} from './bus-types'
import type { PanelAdapterDeps } from '../integration-panels'
import type { TicketProvider } from './ticket-types'

/**
 * Lo mínimo que los handlers necesitan del TicketLoop: resolver el provider de
 * un pluginId con las deps inyectadas. Estructural (no importa la clase) para no
 * crear un ciclo con ticket-loop.ts; el `TicketLoop` real es asignable a esto.
 */
export interface TicketProviderResolver {
  providerFor(pluginId: string, deps: PanelAdapterDeps): TicketProvider | null
}

/**
 * Extensión OPCIONAL del provider: crear un ticket. En v1 el `TicketProvider`
 * base no la declara (solo Jira/Linear la implementarán); el handler `createTask`
 * la detecta por duck-typing y degrada a no-op si el provider no la soporta.
 */
export interface TaskCreatingProvider {
  createTask(title: string, body?: string): Promise<void>
}

function canCreateTask(p: unknown): p is TaskCreatingProvider {
  return !!p && typeof (p as TaskCreatingProvider).createTask === 'function'
}

/**
 * Abre una sesión (worktree + `.nest/TASK.md`). El wiring real vive en main
 * (worktree:create), así que se inyecta como callback — acá solo se enruta el
 * comando. Testeable con un fake.
 */
export type OpenSessionFn = (cmd: OpenSessionCommand, ev: DomainEvent) => Promise<void>

export interface BusCommandDeps {
  ticketLoop: TicketProviderResolver
  /** Gancho a "Work on this"/worktree:create. Sin él, `openSession` no-op con warn. */
  openSession?: OpenSessionFn
}

async function handleUpdateStatus(cmd: UpdateStatusCommand, deps: PanelAdapterDeps, opts: BusCommandDeps): Promise<void> {
  const provider = opts.ticketLoop.providerFor(cmd.pluginId, deps)
  if (!provider) {
    console.warn('[bus-commands] updateStatus sin provider para', cmd.pluginId)
    return
  }
  // No envolvemos el error de transition: el best-effort del bus (T2) ya lo
  // captura, y en el path sin-bus (H3) el propio TicketLoop maneja el reintento.
  await provider.transition(cmd.providerId, cmd.to)
}

async function handleNotify(cmd: NotifyCommand, deps: PanelAdapterDeps): Promise<void> {
  const token = deps.getToken('slack')
  if (!token) {
    console.warn('[bus-commands] notify sin token de Slack, no-op', cmd.channel)
    return
  }
  // Las recetas H5 emiten channel:'' a propósito: el destino canónico vive en
  // la config del plugin Slack (getConfig('slack').channel). Un cmd con channel
  // explícito (recetas custom) lo pisa. Sin ninguno de los dos, no-op con warn.
  const channel = cmd.channel || String((deps.getConfig('slack') as { channel?: unknown }).channel ?? '')
  if (!channel) {
    console.warn('[bus-commands] notify sin channel (cmd ni config), no-op')
    return
  }
  try {
    const res = await deps.fetch('https://slack.com/api/chat.postMessage', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ channel, text: cmd.message }),
    })
    const json = (await res.json()) as { ok?: boolean; error?: string }
    if (!json.ok) console.warn('[bus-commands] notify: Slack respondió no-ok', json.error ?? 'unknown', channel)
  } catch (err) {
    // best-effort: un fallo de red no debe romper la secuencia de comandos.
    console.warn('[bus-commands] notify falló', channel, err)
  }
}

async function handleOpenSession(cmd: OpenSessionCommand, ev: DomainEvent, opts: BusCommandDeps): Promise<void> {
  if (!opts.openSession) {
    console.warn('[bus-commands] openSession sin gancho inyectado, no-op', cmd.branch)
    return
  }
  await opts.openSession(cmd, ev)
}

async function handleCreateTask(cmd: CreateTaskCommand, deps: PanelAdapterDeps, opts: BusCommandDeps): Promise<void> {
  const provider = opts.ticketLoop.providerFor(cmd.pluginId, deps)
  if (!canCreateTask(provider)) {
    console.warn('[bus-commands] createTask: provider no soporta crear (o no existe)', cmd.pluginId)
    return
  }
  await provider.createTask(cmd.title, cmd.body)
}

/**
 * Registra en `bus` los handlers de los 4 comandos estándar de v1:
 *  - `updateStatus` → `provider.transition` (provider resuelto vía ticketLoop).
 *  - `notify`       → Slack chat.postMessage (token por deps; sin token no-op).
 *  - `openSession`  → callback inyectado (worktree:create vive en main).
 *  - `createTask`   → `provider.createTask` si lo soporta; si no, no-op con warn.
 * `logOutcome`/`scheduleBlock` (Motor 3/5) llegan en hitos futuros.
 */
export function registerBusCommands(bus: EventBus, opts: BusCommandDeps): void {
  bus.registerHandler('updateStatus', async (cmd, _ev, deps) => {
    await handleUpdateStatus(cmd as UpdateStatusCommand, deps, opts)
  })
  bus.registerHandler('notify', async (cmd, _ev, deps) => {
    await handleNotify(cmd as NotifyCommand, deps)
  })
  bus.registerHandler('openSession', async (cmd, ev, _deps) => {
    await handleOpenSession(cmd as OpenSessionCommand, ev, opts)
  })
  bus.registerHandler('createTask', async (cmd, _ev, deps) => {
    await handleCreateTask(cmd as CreateTaskCommand, deps, opts)
  })
}
