// Cableado de la orquestación en main: registry de tokens, socket, servicio y puntero, y su
// enganche con el PtyManager y el renderer. Vive acá (y no en main.ts) para poder testearlo
// sin Electron. NO recibe nada de Memories a propósito (spec §6.8): main lo llama fuera del
// `try` de Memories, que puede dejar `memory === null`.

import { randomUUID } from 'node:crypto'
import { isAbsolute } from 'node:path'
import { PaneTokenRegistry } from './pane-tokens'
import { OrchestrationIpcServer } from './orchestration-ipc-server'
import { OrchestrationState, type WorkerRecord } from './orchestration-state'
import {
  OrchestrationService,
  type LaunchPaneRequest,
  type OrchestrationDeps,
  type PaneInfo
} from './orchestration-service'
import { PointerDelivery } from './pointer-delivery'
import type { ReviewEntry, ReviewStore } from './review-store'
import { createReviewActions, type ReviewResult } from './review-actions'
import type { PtyOrchestration } from '../pty-manager'

/** Lo que el cableado usa del PtyManager (los eventos y las escrituras internas). */
export interface OrchestrationPty {
  on(event: 'data' | 'input', cb: (paneId: string, data: string) => void): unknown
  on(event: 'exit', cb: (paneId: string, exitCode: number) => void): unknown
  setOrchestration(o: PtyOrchestration): void
  paneInfo(paneId: string): PaneInfo | undefined
  writeInternal(paneId: string, data: string): void
  getBuffer(paneId: string): string
  kill(paneId: string): void
  exists(paneId: string): boolean
  /** Proceso en primer plano del PTY (PtyManager.foregroundProcess). */
  foregroundProcess?(paneId: string): string | undefined
}

export interface WireOrchestrationDeps {
  pty: OrchestrationPty
  socketPath: string
  /** Args del shim MCP para un bin (ver mcp-launch-args.ts). */
  launchArgs(bin: string): string[]
  /** `createWorktreeForBot` de main.ts, tal cual (ruling R6). */
  createWorktree: OrchestrationDeps['createWorktree']
  /** `runGit` de git-exec.ts: args en array, sin shell. */
  runGit(args: string[], opts: { timeout: number }): Promise<string>
  /** El AccountStore: la cuenta "por defecto" de un agente es la primera guardada, la misma
   *  regla que usa el grafo (`accountDirForAgent` en main.ts). */
  accounts: { list(aiType: string): string[]; getDir(aiType: string, name: string): string }
  /** Manda al renderer; `false` si no hay ventana. */
  send(channel: string, payload?: unknown): boolean
  now?: () => number
  requestPaneTimeoutMs?: number
  /** Revisión de ramas (Task 9). Sin store, la revisión queda apagada (lista vacía). */
  reviewStore?: ReviewStore
  /** Borra el worktree de un worker: en main, la lógica de `worktree:remove`. */
  removeWorktree?(e: ReviewEntry): Promise<{ ok: true } | { ok: false; error: string }>
  /** Empuja la rama de un worktree: en main, la lógica de `git:pushBranch`. */
  pushBranch?(worktreePath: string): Promise<{ ok: true } | { ok: false; error: string }>
  openExternal?(url: string): Promise<void> | void
  /** Notificación de escritorio (§6.9): sólo cuando un worker queda esperando a alguien. */
  notifyDesktop?(title: string, body: string): void
}

export type ReviewActionResult = ReviewResult | { ok: false; error: 'busy' }

/** Lo que el renderer puede pedir sobre la revisión; cada id se valida contra el store. */
export interface OrchestrationReview {
  list(): ReviewEntry[]
  keepOpen(workerId: unknown): { ok: true } | { ok: false; error: 'unknown_worker' }
  autoClose(workerId: unknown): ReturnType<OrchestrationService['autoClose']>
  merge(workerId: unknown): Promise<ReviewActionResult>
  openPr(workerId: unknown): Promise<ReviewActionResult>
  discard(workerId: unknown): Promise<ReviewActionResult>
}

export interface LaunchPaneReply {
  requestId: string
  ok: boolean
  error?: string
  tabPaneCount?: number
}

export interface OrchestrationWiring {
  service: OrchestrationService
  /** La bandeja y los workers compartidos (los e2e la siembran; ver main.ts). */
  state: OrchestrationState
  delivery: PointerDelivery
  tokens: PaneTokenRegistry
  /** `orchestration:launch-pane-result` del renderer. */
  replyLaunchPane(res: unknown): void
  /** El renderer cerró (o mató) un pane: se suelta lo que el puntero tenga de él. */
  paneClosed(paneId: string): void
  review: OrchestrationReview
  stop(): void
}

export const REQUEST_PANE_TIMEOUT_MS = 10_000
const GIT_TIMEOUT_MS = 5_000
// Mismo tamaño de cola que samplePane en main.ts: alcanza para ver un prompt de permiso.
const POINTER_TAIL_CHARS = 2_000
// El `cmd` de un agente sin flags: lo mismo que AI_CONFIG[aiType].cmd del renderer. Sólo
// claude y codex pueden ser workers (el servicio valida `agent`).
const CMD_DE_AGENTE: Record<string, string> = { claude: 'claude', codex: 'codex' }
// Un pane con uno de éstos en primer plano está en el prompt del shell, no en el agente.
const SHELLS = new Set(['zsh', 'bash', 'sh', 'dash', 'ksh', 'fish', 'tcsh', 'csh', 'nu', 'pwsh', 'powershell', 'cmd'])

/** ¿El nombre de proceso es un shell pelado? Un login shell aparece como `-zsh`; en Windows
 *  node-pty da el nombre con `.exe`. Sin dato (undefined) no se bloquea nada. */
export function esShellPelado(nombre: string | undefined): boolean {
  if (!nombre) return false
  const base = (nombre.split(/[\\/]/).pop() ?? '').replace(/^-/, '').toLowerCase().replace(/\.exe$/, '')
  return SHELLS.has(base)
}

type PaneResult = Awaited<ReturnType<OrchestrationDeps['requestPane']>>

export function wireOrchestration(deps: WireOrchestrationDeps): OrchestrationWiring {
  const now = deps.now ?? (() => Date.now())
  const timeoutMs = deps.requestPaneTimeoutMs ?? REQUEST_PANE_TIMEOUT_MS
  const tokens = new PaneTokenRegistry()
  const state = new OrchestrationState()
  const lastOutputAt = new Map<string, number>() // ruling R4
  // Timers vivos del puntero: stop() los corta todos.
  const timers = new Set<() => void>()
  // requestId -> pedido de pane esperando la respuesta del renderer.
  const pendientes = new Map<string, { resolve: (r: PaneResult) => void; cancel: () => void }>()
  // Workers aceptados cuyo PTY todavía no habló: el vigía se arma con su primer output (un
  // tab que no está a la vista no monta el pane, y el vigía se da de baja solo con el pane
  // muerto).
  const vigiaPendiente = new Map<string, () => void>()
  const bajasDeVigia = new Map<string, () => void>()

  const setTimer = (fn: () => void, ms: number): (() => void) => {
    const t = setTimeout(() => {
      timers.delete(cancel)
      fn()
    }, ms)
    const cancel = (): void => {
      clearTimeout(t)
      timers.delete(cancel)
    }
    timers.add(cancel)
    return cancel
  }

  const requestPane = (req: LaunchPaneRequest): Promise<PaneResult> =>
    // Nunca rechaza: un rechazo dejaría el registro del worker colgado en el servicio.
    new Promise<PaneResult>((resolve) => {
      const requestId = randomUUID()
      let enviado = false
      try {
        enviado = deps.send('orchestration:launch-pane', { ...req, requestId })
      } catch {
        enviado = false
      }
      if (!enviado) return resolve({ ok: false, error: 'no_tab' })
      const t = setTimeout(() => {
        pendientes.delete(requestId)
        resolve({ ok: false, error: 'no_tab' })
      }, timeoutMs)
      pendientes.set(requestId, { resolve, cancel: () => clearTimeout(t) })
    })

  let delivery!: PointerDelivery

  const service = new OrchestrationService(
    {
      paneInfo: (id) => deps.pty.paneInfo(id),
      defaultAccount: (aiType) => {
        const cmd = CMD_DE_AGENTE[aiType]
        if (!cmd) return null
        const nombres = deps.accounts.list(aiType)
        if (nombres.length === 0) return null
        return { accountDir: deps.accounts.getDir(aiType, nombres[0]), cmd, accountName: nombres[0] }
      },
      createWorktree: deps.createWorktree,
      currentBranch: async (repoPath) => {
        try {
          return await deps.runGit(['-C', repoPath, 'rev-parse', '--abbrev-ref', 'HEAD'], { timeout: GIT_TIMEOUT_MS })
        } catch {
          throw new Error('not_a_git_repo')
        }
      },
      repoRoot: async (cwd) => {
        // currentBranch ya probó que es un repo: si esto falla igual, se sigue con el cwd.
        try {
          const raiz = (await deps.runGit(['-C', cwd, 'rev-parse', '--show-toplevel'], { timeout: GIT_TIMEOUT_MS })).trim()
          return isAbsolute(raiz) ? raiz : cwd
        } catch {
          return cwd
        }
      },
      isClean: async (worktreePath) => {
        try {
          const out = await deps.runGit(['-C', worktreePath, 'status', '--porcelain'], { timeout: GIT_TIMEOUT_MS })
          return out === ''
        } catch {
          return false // sin poder verificar, el done no se acepta
        }
      },
      requestPane,
      closePane: (paneId) => {
        delivery.forget(paneId)
        try { deps.send('orchestration:close-pane', { paneId }) } catch { /* sin ventana */ }
      },
      killPane: (paneId) => deps.pty.kill(paneId),
      writePty: (paneId, data) => deps.pty.writeInternal(paneId, data),
      bufferTail: (paneId) => deps.pty.getBuffer(paneId),
      now,
      onChange: () => {
        try { deps.send('orchestration:changed') } catch { /* sin ventana */ }
      },
      notifyCoordinator: (coordinatorPaneId) => delivery.notify(coordinatorPaneId),
      review: deps.reviewStore,
      onNeedsInput: (w) => {
        try {
          deps.notifyDesktop?.('Worker needs input', `${w.label} is waiting for your input.`)
        } catch { /* una notificación que falla no corta al worker */ }
      },
      onWorkerStarted: (w: WorkerRecord) => {
        const armar = (): void => {
          bajasDeVigia.get(w.paneId)?.()
          bajasDeVigia.set(
            w.paneId,
            delivery.watchWorker(w.paneId, () => service.onAgentNeedsInput(w.paneId))
          )
        }
        if (deps.pty.exists(w.paneId)) armar()
        else vigiaPendiente.set(w.paneId, armar)
      }
    },
    state
  )

  delivery = new PointerDelivery(
    {
      now,
      setTimer,
      writePty: (paneId, data) => deps.pty.writeInternal(paneId, data),
      bufferTail: (paneId) => deps.pty.getBuffer(paneId).slice(-POINTER_TAIL_CHARS),
      lastOutputAt: (paneId) => lastOutputAt.get(paneId) ?? null,
      isAlive: (paneId) => deps.pty.exists(paneId),
      // En Windows node-pty devuelve el proceso lanzado (el shell siempre), no el de primer
      // plano: ahí no se puede saber y no se bloquea.
      isAgentForeground: (paneId) =>
        process.platform === 'win32' || !esShellPelado(deps.pty.foregroundProcess?.(paneId))
    },
    state
  )

  const soltar = (paneId: string): void => {
    delivery.cancel(paneId)
    delivery.forget(paneId)
    lastOutputAt.delete(paneId)
    vigiaPendiente.delete(paneId)
    bajasDeVigia.get(paneId)?.()
    bajasDeVigia.delete(paneId)
  }

  deps.pty.on('data', (paneId: string) => {
    lastOutputAt.set(paneId, now())
    const armar = vigiaPendiente.get(paneId)
    if (armar) {
      vigiaPendiente.delete(paneId)
      armar()
    }
    delivery.onOutput(paneId)
  })
  deps.pty.on('input', (paneId: string, data: string) => delivery.onUserInput(paneId, data))
  deps.pty.on('exit', (paneId: string, exitCode: number) => {
    soltar(paneId)
    service.onPaneExit(paneId, exitCode)
  })

  const server = new OrchestrationIpcServer({
    socketPath: deps.socketPath,
    tokens,
    handle: (caller, method, params) => service.handle(caller, method, params)
  })
  server.start()
  deps.pty.setOrchestration({
    socketPath: deps.socketPath,
    tokens,
    launchArgs: (bin) => deps.launchArgs(bin),
    isWorker: (paneId) => state.workerByPane(paneId) !== undefined
  })

  const sinGit = async (): Promise<{ ok: false; error: string }> => ({ ok: false, error: 'not available' })
  const actions = createReviewActions({
    runGit: deps.runGit,
    store: { remove: (id) => deps.reviewStore?.remove(id) },
    removeWorktree: deps.removeWorktree ?? sinGit,
    pushBranch: deps.pushBranch ?? sinGit,
    openExternal: (url) => deps.openExternal?.(url)
  })
  // Un doble click no corre dos merges del mismo worker a la vez.
  const enCurso = new Set<string>()
  const conEntrada = async (
    workerId: unknown,
    accion: (e: ReviewEntry) => Promise<ReviewResult>,
    olvidar: boolean
  ): Promise<ReviewActionResult> => {
    const e = typeof workerId === 'string' ? deps.reviewStore?.get(workerId) : undefined
    if (!e) return { ok: false, error: 'unknown_worker' }
    if (enCurso.has(e.workerId)) return { ok: false, error: 'busy' }
    enCurso.add(e.workerId)
    try {
      const r = await accion(e)
      if (r.ok && olvidar) service.forgetWorker(e.workerId)
      // El panel vuelve a pedir la lista con este aviso (también tras un error: puede haber
      // quedado a medio camino, p. ej. mergeado pero sin poder borrar el worktree).
      try { deps.send('orchestration:changed') } catch { /* sin ventana */ }
      return r
    } finally {
      enCurso.delete(e.workerId)
    }
  }
  const review: OrchestrationReview = {
    list: () => deps.reviewStore?.list() ?? [],
    keepOpen: (workerId) =>
      typeof workerId === 'string' && service.keepOpen(workerId) ? { ok: true } : { ok: false, error: 'unknown_worker' },
    autoClose: (workerId) =>
      typeof workerId === 'string' ? service.autoClose(workerId) : Promise.resolve({ ok: false, error: 'unknown_worker' }),
    merge: (workerId) => conEntrada(workerId, actions.merge, true),
    openPr: (workerId) => conEntrada(workerId, actions.openPr, false),
    discard: (workerId) => conEntrada(workerId, actions.discard, true)
  }

  let parado = false
  return {
    review,
    state,
    service,
    delivery,
    tokens,
    replyLaunchPane(res: unknown) {
      if (!res || typeof res !== 'object') return
      const r = res as Partial<LaunchPaneReply>
      if (typeof r.requestId !== 'string') return
      const p = pendientes.get(r.requestId)
      if (!p) return // vencido o ajeno
      pendientes.delete(r.requestId)
      p.cancel()
      if (r.ok === true) {
        const n = typeof r.tabPaneCount === 'number' && Number.isFinite(r.tabPaneCount) ? r.tabPaneCount : 0
        p.resolve({ ok: true, tabPaneCount: n })
      } else {
        p.resolve({ ok: false, error: r.error === 'tab_full' ? 'tab_full' : 'no_tab' })
      }
    },
    paneClosed(paneId: string) {
      soltar(paneId)
    },
    stop() {
      if (parado) return
      parado = true
      // Antes que nada: en los caminos de salida de main sigue killAll() + app.exit(0), y el
      // exit de cada PTY no llega. Los vivos quedan stopped en la revisión acá.
      try { service.stopAll() } catch (err) {
        console.error('[orchestration] stopAll failed', err instanceof Error ? err.message : err)
      }
      server.stop()
      tokens.revokeAll()
      for (const [id, p] of pendientes) {
        p.cancel()
        p.resolve({ ok: false, error: 'no_tab' })
        pendientes.delete(id)
      }
      for (const baja of bajasDeVigia.values()) baja()
      bajasDeVigia.clear()
      vigiaPendiente.clear()
      for (const cancel of [...timers]) cancel()
      timers.clear()
    }
  }
}
