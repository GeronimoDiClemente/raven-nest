// Servicio de orquestación: launch / report / stop de workers. Todo el IO entra por `deps`
// (spec §6.2–6.6). Los errores salen como `throw new Error('<error_string>')`: el servidor del
// socket devuelve el mensaje tal cual al agente.

import { randomUUID } from 'node:crypto'
import { basename } from 'node:path'
import { OrchestrationState, type WorkerRecord } from './orchestration-state'
import { workerPreamble } from './prompts'
import { branchName } from './branch-name'
import { typeThenSubmit } from './submit'
import type {
  OrchMethod,
  LaunchParams,
  ReportParams,
  SendParams,
  StopParams,
  WaitParams
} from './protocol'

export { branchName } from './branch-name'

export interface PaneInfo {
  paneId: string
  cmd: string
  accountDir: string
  aiType: string
  cwd: string
}

export interface LaunchPaneRequest {
  coordinatorPaneId: string
  paneId: string
  aiType: string
  accountName: string
  accountDir: string
  cmd: string
  repoPath: string
  label: string
  colorIndex: number
  initialInput: string
  workerId: string
}

export interface OrchestrationDeps {
  paneInfo(paneId: string): PaneInfo | undefined
  defaultAccount(aiType: string): { accountDir: string; cmd: string; accountName: string } | null
  createWorktree(
    repoPath: string,
    branch: string
  ): Promise<{ ok: true; worktreePath: string } | { ok: false; error: string }>
  currentBranch(repoPath: string): Promise<string>
  isClean(worktreePath: string): Promise<boolean>
  requestPane(
    req: LaunchPaneRequest
  ): Promise<{ ok: true; tabPaneCount: number } | { ok: false; error: 'tab_full' | 'no_tab' }>
  closePane(paneId: string): void
  killPane(paneId: string): void
  writePty(paneId: string, data: string): void
  bufferTail(paneId: string): string
  now(): number
  /** Avisa al renderer de que cambió el estado. */
  onChange(): void
  /** Se llama tras cada push a la bandeja (después se cablea al módulo de punteros). */
  notifyCoordinator(coordinatorPaneId: string): void
}

const WAIT_DEFAULT_MS = 60_000
const WAIT_MAX_MS = 240_000
const READ_TAIL_CHARS = 4000
const VIVOS = new Set(['starting', 'working', 'needs_input'])
const FINALES = new Set(['done', 'exited', 'stopped'])

interface Waiter {
  resolve: (v: unknown) => void
  timer: ReturnType<typeof setTimeout>
}

const fail = (code: string): never => {
  throw new Error(code)
}

export class OrchestrationService {
  private readonly state = new OrchestrationState()
  private readonly waiters = new Map<string, Waiter[]>()

  constructor(private readonly deps: OrchestrationDeps) {}

  async handle(callerPaneId: string, method: OrchMethod, params: unknown): Promise<unknown> {
    const info = this.deps.paneInfo(callerPaneId)
    if (!info) return fail('unauthorized')
    const esWorker = !!this.state.workerByPane(callerPaneId)

    if (method === 'worker.report') {
      if (!esWorker) return fail('not_a_coordinator')
      return this.report(callerPaneId, params as ReportParams)
    }
    if (method === 'worker.launch') {
      // canLaunch devuelve nesting_not_allowed si el caller es un worker.
      return this.launch(callerPaneId, info, params as LaunchParams)
    }
    if (esWorker) return fail('not_a_coordinator')

    switch (method) {
      case 'worker.list':
        return this.state.workersOf(callerPaneId)
      case 'worker.read':
        return this.read(callerPaneId, params as { workerId: string })
      case 'worker.send':
        return this.send(callerPaneId, params as SendParams)
      case 'worker.stop':
        return this.stop(callerPaneId, (params ?? {}) as StopParams)
      case 'inbox.read':
        return this.state.markDelivered(callerPaneId)
      case 'inbox.wait':
        return this.wait(callerPaneId, (params ?? {}) as WaitParams)
      default:
        return fail('unknown_method')
    }
  }

  snapshot(): WorkerRecord[] {
    // El estado no expone "todos": se junta por coordinadores conocidos vía workerByPane no existe,
    // así que se lleva un índice aparte.
    return [...this.coordinators].flatMap((c) => this.state.workersOf(c))
  }
  private readonly coordinators = new Set<string>()

  onPaneExit(paneId: string, exitCode: number): void {
    const w = this.state.workerByPane(paneId)
    if (w) {
      if (!FINALES.has(w.status)) {
        this.state.setStatus(w.workerId, 'exited', this.deps.now())
        this.pushMsg(w, 'exited', `exit code ${exitCode}`)
        this.deps.onChange()
      }
      return
    }
    if (this.coordinators.has(paneId)) this.stopCoordinator(paneId)
  }

  onAgentNeedsInput(paneId: string): void {
    const w = this.state.workerByPane(paneId)
    if (!w || !VIVOS.has(w.status)) return
    this.state.setStatus(w.workerId, 'needs_input', this.deps.now())
    this.pushMsg(w, 'waiting_permission', 'the agent is waiting for permission or input')
    this.deps.onChange()
  }

  stopCoordinator(paneId: string): void {
    for (const w of this.state.workersOf(paneId)) {
      if (VIVOS.has(w.status)) {
        this.deps.killPane(w.paneId)
        this.deps.closePane(w.paneId)
      }
    }
    // No se borran worktrees ni ramas: el trabajo del worker queda.
    this.state.dropCoordinator(paneId)
    this.coordinators.delete(paneId)
    this.releaseWaiters(paneId, { timedOut: true })
    this.deps.onChange()
  }

  // ---- métodos ----

  private async launch(callerPaneId: string, info: PaneInfo, p: LaunchParams) {
    if (!p || typeof p.task !== 'string' || !p.task.trim()) return fail('invalid_params')
    if (typeof p.label !== 'string' || !p.label.trim()) return fail('invalid_params')

    const pre = this.state.canLaunch(callerPaneId, 0)
    if (!pre.ok) return fail(pre.error)

    const agent = p.agent ?? info.aiType
    let acct: { accountDir: string; cmd: string; accountName: string }
    if (agent === info.aiType) {
      // Mismo agente: cmd y cuenta del coordinador, sin tocar.
      acct = { accountDir: info.accountDir, cmd: info.cmd, accountName: basename(info.accountDir) }
    } else {
      const d = this.deps.defaultAccount(agent)
      if (!d) return fail('no_account_for_agent')
      acct = d
    }

    const workerId = randomUUID()
    const paneId = randomUUID()
    const branch = branchName(p.label, workerId)
    const baseBranch = await this.deps.currentBranch(info.cwd)
    const wt = await this.deps.createWorktree(info.cwd, branch)
    if (!wt.ok) return fail(wt.error)

    // Se vuelve a chequear: durante los await otro launch pudo llenar el cupo.
    const post = this.state.canLaunch(callerPaneId, 0)
    if (!post.ok) return fail(post.error)

    const rec = this.state.addWorker(
      {
        workerId,
        coordinatorPaneId: callerPaneId,
        paneId,
        label: p.label,
        branch,
        worktreePath: wt.worktreePath,
        baseBranch,
        agent
      },
      this.deps.now()
    )
    this.coordinators.add(callerPaneId)

    const res = await this.deps.requestPane({
      coordinatorPaneId: callerPaneId,
      paneId,
      aiType: agent,
      accountName: acct.accountName,
      accountDir: acct.accountDir,
      cmd: acct.cmd,
      repoPath: wt.worktreePath,
      label: p.label,
      colorIndex: rec.colorIndex,
      initialInput: workerPreamble({ label: p.label, branch, baseBranch, task: p.task }),
      workerId
    })
    if (!res.ok) {
      // El worktree ya existe: no se borra nada, sólo se descarta el registro.
      this.state.removeWorker(workerId)
      return fail(res.error)
    }
    this.state.setStatus(workerId, 'working', this.deps.now())
    this.deps.onChange()
    return { workerId, branch, label: p.label }
  }

  private async report(callerPaneId: string, p: ReportParams) {
    const w = this.state.workerByPane(callerPaneId)!
    if (!p || !['done', 'question', 'blocked'].includes(p.kind) || typeof p.text !== 'string') {
      return fail('invalid_params')
    }
    if (p.kind === 'done') {
      if (!(await this.deps.isClean(w.worktreePath))) return fail('worktree_dirty')
      this.state.setStatus(w.workerId, 'done', this.deps.now())
    } else {
      this.state.setStatus(w.workerId, 'needs_input', this.deps.now())
    }
    this.pushMsg(w, p.kind, p.text)
    this.deps.onChange()
    return { ok: true }
  }

  private read(callerPaneId: string, p: { workerId: string }) {
    const w = this.owned(callerPaneId, p?.workerId)
    return { worker: w, output: this.deps.bufferTail(w.paneId).slice(-READ_TAIL_CHARS) }
  }

  private send(callerPaneId: string, p: SendParams) {
    const w = this.owned(callerPaneId, p?.workerId)
    if (typeof p.text !== 'string') return fail('invalid_params')
    typeThenSubmit(this.deps.writePty, (fn, ms) => setTimeout(fn, ms), w.paneId, p.text)
    return { ok: true }
  }

  private stop(callerPaneId: string, p: StopParams) {
    const objetivo = p.workerId
      ? [this.owned(callerPaneId, p.workerId)]
      : this.state.workersOf(callerPaneId).filter((w) => VIVOS.has(w.status))
    const stopped: string[] = []
    for (const w of objetivo) {
      this.state.setStatus(w.workerId, 'stopped', this.deps.now())
      this.deps.killPane(w.paneId)
      this.deps.closePane(w.paneId)
      stopped.push(w.workerId)
    }
    this.deps.onChange()
    return { stopped }
  }

  private wait(callerPaneId: string, p: WaitParams): Promise<unknown> {
    if (this.state.pending(callerPaneId).length > 0) {
      return Promise.resolve(this.state.markDelivered(callerPaneId))
    }
    const ms =
      typeof p.timeoutMs === 'number' && Number.isFinite(p.timeoutMs) && p.timeoutMs > 0
        ? Math.min(p.timeoutMs, WAIT_MAX_MS)
        : WAIT_DEFAULT_MS
    return new Promise((resolve) => {
      const waiter: Waiter = {
        resolve,
        timer: setTimeout(() => {
          this.removeWaiter(callerPaneId, waiter)
          resolve({ timedOut: true })
        }, ms)
      }
      const lista = this.waiters.get(callerPaneId) ?? []
      lista.push(waiter)
      this.waiters.set(callerPaneId, lista)
    })
  }

  // ---- helpers ----

  private owned(callerPaneId: string, workerId: unknown): WorkerRecord {
    const w =
      typeof workerId === 'string'
        ? this.state.workersOf(callerPaneId).find((x) => x.workerId === workerId)
        : undefined
    if (!w) return fail('unknown_worker')
    return w as WorkerRecord
  }

  private pushMsg(w: WorkerRecord, kind: Parameters<OrchestrationState['push']>[1], text: string) {
    this.state.push(w.workerId, kind, text, this.deps.now())
    this.deps.notifyCoordinator(w.coordinatorPaneId)
    // Despierta a los que esperan: el primero se lleva los mensajes.
    const lista = [...(this.waiters.get(w.coordinatorPaneId) ?? [])]
    for (const waiter of lista) {
      if (this.state.pending(w.coordinatorPaneId).length === 0) break
      this.removeWaiter(w.coordinatorPaneId, waiter)
      clearTimeout(waiter.timer)
      waiter.resolve(this.state.markDelivered(w.coordinatorPaneId))
    }
  }

  private removeWaiter(coordinator: string, waiter: Waiter): void {
    const l = (this.waiters.get(coordinator) ?? []).filter((x) => x !== waiter)
    if (l.length) this.waiters.set(coordinator, l)
    else this.waiters.delete(coordinator)
  }

  private releaseWaiters(coordinator: string, value: unknown): void {
    for (const w of this.waiters.get(coordinator) ?? []) {
      clearTimeout(w.timer)
      w.resolve(value)
    }
    this.waiters.delete(coordinator)
  }
}
