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
  LogOutcomeCommand,
  NotifyCommand,
  OpenSessionCommand,
  SetPresenceCommand,
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

/**
 * Superficie mínima del adapter de Calendar que el handler `logOutcome` (H6,
 * Motor 4 salida) necesita: buscar el evento por taskId y, según exista o no,
 * apendear el outcome o crear un evento de registro. Estructural (no importa
 * gcal.ts) — el `GcalAdapter` real es asignable a esto.
 */
export interface GcalOutcomeSink {
  findEventByTask(taskId: string): Promise<{ id: string } | null>
  appendOutcome(eventId: string, summary: string): Promise<void>
  createOutcomeEvent(summary: string, whenIso: string): Promise<unknown>
}

export interface BusCommandDeps {
  ticketLoop: TicketProviderResolver
  /** Gancho a "Work on this"/worktree:create. Sin él, `openSession` no-op con warn. */
  openSession?: OpenSessionFn
  /** Resuelve el sink de Calendar con las deps inyectadas. Sin él (o si devuelve
   *  null), `logOutcome` degrada a no-op con warn — igual que notify sin token. */
  gcal?: (deps: PanelAdapterDeps) => GcalOutcomeSink | null
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

async function handleSetPresence(cmd: SetPresenceCommand, deps: PanelAdapterDeps): Promise<void> {
  const token = deps.getToken('slack')
  if (!token) {
    console.warn('[bus-commands] setPresence sin token de Slack, no-op')
    return
  }
  try {
    const res = await deps.fetch('https://slack.com/api/users.profile.set', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ profile: { status_text: cmd.text, status_emoji: cmd.emoji ?? ':hammer_and_wrench:' } }),
    })
    const json = (await res.json()) as { ok?: boolean; error?: string }
    // Sin el scope users.profile:write, Slack devuelve no-ok: degrada a no-op con warn.
    if (!json.ok) console.warn('[bus-commands] setPresence no-ok', json.error ?? 'unknown')
  } catch (err) {
    console.warn('[bus-commands] setPresence falló', err)
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

// H6 Motor 4 (salida) — registra el outcome real en el calendario. Resuelve el
// evento por `ref` (taskId): si existe, apendea la línea a su description; si no,
// crea un evento corto de registro. Credential-free (el sink llega por opts.gcal);
// sin gcal → no-op con warn. Best-effort: un fallo de la API de Calendar no debe
// romper la secuencia (por eso NO re-throwea; no reporta a `failed`).
async function handleLogOutcome(cmd: LogOutcomeCommand, deps: PanelAdapterDeps, opts: BusCommandDeps): Promise<void> {
  const gcal = opts.gcal?.(deps)
  if (!gcal) {
    console.warn('[bus-commands] logOutcome sin gcal, no-op', cmd.ref)
    return
  }
  try {
    const ev = await gcal.findEventByTask(cmd.ref)
    if (ev) await gcal.appendOutcome(ev.id, cmd.summary)
    else await gcal.createOutcomeEvent(cmd.summary, new Date().toISOString())
  } catch (err) {
    console.warn('[bus-commands] logOutcome falló', cmd.ref, err)
  }
}

/**
 * Registra en `bus` los handlers de los comandos estándar:
 *  - `updateStatus` → `provider.transition` (provider resuelto vía ticketLoop).
 *  - `notify`       → Slack chat.postMessage (token por deps; sin token no-op).
 *  - `setPresence`  → Slack users.profile.set (H5; sin token/scope no-op con warn).
 *  - `openSession`  → callback inyectado (worktree:create vive en main).
 *  - `createTask`   → `provider.createTask` si lo soporta; si no, no-op con warn.
 *  - `logOutcome`   → Calendar (H6): apendea/crea el registro de la sesión; sin
 *                     gcal inyectado, no-op con warn.
 * `scheduleBlock` (Motor 5) llega en un hito futuro.
 */
export function registerBusCommands(bus: EventBus, opts: BusCommandDeps): void {
  bus.registerHandler('updateStatus', async (cmd, _ev, deps) => {
    await handleUpdateStatus(cmd as UpdateStatusCommand, deps, opts)
  })
  bus.registerHandler('notify', async (cmd, _ev, deps) => {
    await handleNotify(cmd as NotifyCommand, deps)
  })
  bus.registerHandler('setPresence', async (cmd, _ev, deps) => {
    await handleSetPresence(cmd as SetPresenceCommand, deps)
  })
  bus.registerHandler('openSession', async (cmd, ev, _deps) => {
    await handleOpenSession(cmd as OpenSessionCommand, ev, opts)
  })
  bus.registerHandler('createTask', async (cmd, _ev, deps) => {
    await handleCreateTask(cmd as CreateTaskCommand, deps, opts)
  })
  bus.registerHandler('logOutcome', async (cmd, _ev, deps) => {
    await handleLogOutcome(cmd as LogOutcomeCommand, deps, opts)
  })
}
