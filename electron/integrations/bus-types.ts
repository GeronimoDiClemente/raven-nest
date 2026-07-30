// Bus de eventos v1 — vocabulario compartido entre adapters, core y recetas.
// Los adapters/core EMITEN `DomainEvent`s estándar; las recetas los mapean a
// `Command`s estándar que ejecutan los handlers. Este módulo es la capa más baja
// del bus: SOLO tipos + guards runtime. Importa únicamente `TicketState` de
// ticket-types.ts para no crear un ciclo (ticket-loop → event-bus → bus-types →
// ticket-types). Nunca debe importar ticket-loop.ts.
import type { TicketState } from './ticket-types'

// ── Eventos de dominio (unión discriminada por `type`) ──────────────────────

export interface TaskCreatedEvent {
  type: 'task.created'
  taskId: string
  pluginId: string
  providerId: string
  repoFullName: string | null
  branch: string
  title?: string
}

export interface SessionOpenedEvent {
  type: 'session.opened'
  branch: string
  repoPath: string
  pluginId?: string
  providerId?: string
}

export interface SessionClosedEvent {
  type: 'session.closed'
  branch: string
}

export interface PrOpenedEvent {
  type: 'pr.opened'
  branch: string
  repoFullName: string
}

export interface PrMergedEvent {
  type: 'pr.merged'
  branch: string
  repoFullName: string
}

export interface CiFailedEvent {
  type: 'ci.failed'
  branch: string
  repoFullName: string
  runUrl?: string
  summary?: string
}

export interface ErrorDetectedEvent {
  type: 'error.detected'
  source: string
  ref: string
  summary: string
}

export interface BlockStartedEvent {
  type: 'block.started'
  taskId?: string
  label: string
}

export interface MeetingTranscribedEvent {
  type: 'meeting.transcribed'
  title: string
  items: string[]
}

// H4 Motor 3 — señales de review. Su emisión efectiva al bus y sus recetas
// `notify` son H5; en H4 sólo se declaran los tipos (+ guards) para que el motor
// pueda tiparlos. `changes.requested` viaja hoy por IPC directo (no bus).
export interface ChangesRequestedEvent {
  type: 'changes.requested'
  branch: string
  repoFullName: string
  prNumber: number
}

export interface ReviewRequestedEvent {
  type: 'review.requested'
  repoFullName: string
  prNumber: number
  prTitle: string
}

export type DomainEvent =
  | TaskCreatedEvent
  | SessionOpenedEvent
  | SessionClosedEvent
  | PrOpenedEvent
  | PrMergedEvent
  | CiFailedEvent
  | ErrorDetectedEvent
  | BlockStartedEvent
  | MeetingTranscribedEvent
  | ChangesRequestedEvent
  | ReviewRequestedEvent

// ── Comandos (unión discriminada por `cmd`) ─────────────────────────────────

export interface NotifyButton {
  label: string
  action: string
}

export interface CreateTaskCommand {
  cmd: 'createTask'
  pluginId: string
  title: string
  body?: string
}

export interface OpenSessionCommand {
  cmd: 'openSession'
  pluginId?: string
  providerId?: string
  branch?: string
  repoFullName?: string
  context?: string
}

export interface NotifyCommand {
  cmd: 'notify'
  channel: string
  message: string
  buttons?: NotifyButton[]
}

export interface UpdateStatusCommand {
  cmd: 'updateStatus'
  pluginId: string
  providerId: string
  to: TicketState
}

export interface LogOutcomeCommand {
  cmd: 'logOutcome'
  ref: string
  summary: string
}

export interface ScheduleBlockCommand {
  cmd: 'scheduleBlock'
  when: string
  label: string
}

// H5 Motor 4 — auto-status del terminal (Slack users.profile.set). El emoji es
// opcional; el handler usa `:hammer_and_wrench:` por defecto. Requiere el scope
// `users.profile:write`; sin él, el handler degrada a no-op con warn.
export interface SetPresenceCommand {
  cmd: 'setPresence'
  text: string
  emoji?: string
}

export type Command =
  | CreateTaskCommand
  | OpenSessionCommand
  | NotifyCommand
  | UpdateStatusCommand
  | LogOutcomeCommand
  | ScheduleBlockCommand
  | SetPresenceCommand

// ── Guards runtime mínimos ──────────────────────────────────────────────────
// Los eventos/comandos pueden cruzar el borde IPC o venir de recipes.json en
// disco, así que un cast ciego es inseguro. Validamos el discriminante + los
// campos requeridos, y los opcionales solo si están presentes.

const TICKET_STATES: readonly TicketState[] = ['todo', 'in_progress', 'in_review', 'done']

function isStr(v: unknown): v is string {
  return typeof v === 'string'
}

function optStr(v: unknown): boolean {
  return v === undefined || typeof v === 'string'
}

export function isDomainEvent(x: unknown): x is DomainEvent {
  if (!x || typeof x !== 'object') return false
  const e = x as Record<string, unknown>
  switch (e.type) {
    case 'task.created':
      return isStr(e.taskId) && isStr(e.pluginId) && isStr(e.providerId)
        && (e.repoFullName === null || isStr(e.repoFullName))
        && isStr(e.branch) && optStr(e.title)
    case 'session.opened':
      return isStr(e.branch) && isStr(e.repoPath) && optStr(e.pluginId) && optStr(e.providerId)
    case 'session.closed':
      return isStr(e.branch)
    case 'pr.opened':
    case 'pr.merged':
      return isStr(e.branch) && isStr(e.repoFullName)
    case 'ci.failed':
      return isStr(e.branch) && isStr(e.repoFullName) && optStr(e.runUrl) && optStr(e.summary)
    case 'error.detected':
      return isStr(e.source) && isStr(e.ref) && isStr(e.summary)
    case 'block.started':
      return optStr(e.taskId) && isStr(e.label)
    case 'meeting.transcribed':
      return isStr(e.title) && Array.isArray(e.items) && e.items.every(isStr)
    case 'changes.requested':
      return isStr(e.branch) && isStr(e.repoFullName) && typeof e.prNumber === 'number'
    case 'review.requested':
      return isStr(e.repoFullName) && typeof e.prNumber === 'number' && isStr(e.prTitle)
    default:
      return false
  }
}

function isNotifyButton(v: unknown): v is NotifyButton {
  if (!v || typeof v !== 'object') return false
  const b = v as Record<string, unknown>
  return isStr(b.label) && isStr(b.action)
}

export function isCommand(x: unknown): x is Command {
  if (!x || typeof x !== 'object') return false
  const c = x as Record<string, unknown>
  switch (c.cmd) {
    case 'createTask':
      return isStr(c.pluginId) && isStr(c.title) && optStr(c.body)
    case 'openSession':
      return optStr(c.pluginId) && optStr(c.providerId) && optStr(c.branch)
        && optStr(c.repoFullName) && optStr(c.context)
    case 'notify':
      return isStr(c.channel) && isStr(c.message)
        && (c.buttons === undefined || (Array.isArray(c.buttons) && c.buttons.every(isNotifyButton)))
    case 'updateStatus':
      return isStr(c.pluginId) && isStr(c.providerId)
        && TICKET_STATES.includes(c.to as TicketState)
    case 'logOutcome':
      return isStr(c.ref) && isStr(c.summary)
    case 'scheduleBlock':
      return isStr(c.when) && isStr(c.label)
    case 'setPresence':
      return isStr(c.text) && optStr(c.emoji)
    default:
      return false
  }
}
