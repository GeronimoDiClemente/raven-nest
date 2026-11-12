// Protocolo del socket de orquestación: una línea JSON por request, una por respuesta.
// El coordinador (y los workers) hablan con main por acá, autenticados con el token del pane.

export type OrchMethod =
  | 'worker.launch' | 'worker.list' | 'worker.read' | 'worker.send' | 'worker.stop'
  | 'inbox.read' | 'inbox.wait' | 'worker.report'

export const ORCH_METHODS: readonly OrchMethod[] = [
  'worker.launch', 'worker.list', 'worker.read', 'worker.send', 'worker.stop',
  'inbox.read', 'inbox.wait', 'worker.report',
]

export interface OrchRequest { id: string; method: OrchMethod; params: unknown; token: string }
export type OrchResponse =
  | { id: string; ok: true; result: unknown }
  | { id: string; ok: false; error: string }

export interface LaunchParams { task: string; label: string; agent?: 'claude' | 'codex' }
export interface ReportParams { kind: 'done' | 'question' | 'blocked'; text: string }
export interface SendParams { workerId: string; text: string }
/** Sin workerId = todos. */
export interface StopParams { workerId?: string }
/** Default 60_000, máx 240_000 (la fetch del cliente corta a 300 s). */
export interface WaitParams { timeoutMs?: number }

/**
 * Ruta del socket (unix) o named pipe (Windows). `pipeId` es aleatorio por arranque de la
 * app: un nombre derivable del home dejaría a cualquier proceso local adelantarse al pipe.
 * El control de acceso real es el token por pane.
 */
export function orchestrationSocketPath(ravenHomeDir: string, isWin: boolean, pipeId: string): string {
  if (isWin) {
    return `\\\\.\\pipe\\nest-orchestration-${pipeId}`
  }
  return `${ravenHomeDir}/.raven-nest/orchestration.sock`
}
