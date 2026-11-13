// Protocolo del socket de orquestación: una línea JSON por request, una por respuesta.
// El coordinador (y los workers) hablan con main por acá, autenticados con el token del pane.

import { tmpdir } from 'node:os'

export type OrchMethod =
  | 'worker.launch' | 'worker.list' | 'worker.read' | 'worker.send' | 'worker.stop'
  | 'inbox.read' | 'inbox.wait' | 'worker.report'

export const ORCH_METHODS: readonly OrchMethod[] = [
  'worker.launch', 'worker.list', 'worker.read', 'worker.send', 'worker.stop',
  'inbox.read', 'inbox.wait', 'worker.report',
]

/**
 * Los `error` que puede devolver el socket. Excepción: si crear el worktree falla, el error es
 * el texto de `createWorktreeForBot` (main.ts) tal cual.
 */
export type OrchError =
  | 'unauthorized' | 'unknown_method' | 'internal_error' | 'invalid_params'
  | 'not_a_coordinator' | 'nesting_not_allowed' | 'worker_limit' | 'tab_full' | 'no_tab'
  | 'no_account_for_agent' | 'not_a_git_repo' | 'coordinator_gone'
  | 'unknown_worker' | 'worker_finished' | 'worktree_dirty'

export const ORCH_ERRORS: readonly OrchError[] = [
  'unauthorized', 'unknown_method', 'internal_error', 'invalid_params',
  'not_a_coordinator', 'nesting_not_allowed', 'worker_limit', 'tab_full', 'no_tab',
  'no_account_for_agent', 'not_a_git_repo', 'coordinator_gone',
  'unknown_worker', 'worker_finished', 'worktree_dirty',
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

// sun_path de un socket unix tiene ~104 bytes en macOS (108 en Linux): se deja margen.
const MAX_SOCKET_PATH = 100

/**
 * Ruta del socket (unix) o named pipe (Windows). `pipeId` es aleatorio por arranque de la
 * app, también en unix: un nombre fijo haría que dos Nest con el mismo home (la instalada y
 * un build de desarrollo) se pisaran el socket — el segundo borra el del primero. Un nombre
 * derivable del home, además, dejaría a cualquier proceso local adelantarse al pipe. El control
 * de acceso real es el token por pane. Si el home es tan largo que la ruta no entra en
 * sun_path, cae a `tmpDir`.
 */
export function orchestrationSocketPath(
  ravenHomeDir: string,
  isWin: boolean,
  pipeId: string,
  tmpDir: string = tmpdir()
): string {
  if (isWin) {
    return `\\\\.\\pipe\\nest-orchestration-${pipeId}`
  }
  const enElHome = `${ravenHomeDir}/.raven-nest/orch-${pipeId}.sock`
  if (enElHome.length <= MAX_SOCKET_PATH) return enElHome
  return `${tmpDir.replace(/\/+$/, '')}/nest-orch-${pipeId}.sock`
}
