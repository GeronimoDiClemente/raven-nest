// Servicio de orquestación: launch / report / stop de workers. Todo el IO entra por `deps`
// (spec §6.2–6.6). Los errores salen como `throw new Error('<error_string>')`: el servidor del
// socket devuelve el mensaje tal cual al agente.

import { randomUUID } from 'node:crypto'
import { basename } from 'node:path'
import { OrchestrationState, type WorkerRecord } from './orchestration-state'
import type { ReviewEntry } from './review-store'
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
  /** Raíz del repo (`git rev-parse --show-toplevel`) del cwd del coordinador: con el
   *  coordinador en una subcarpeta, el worktree no puede salir de ahí (quedaría DENTRO del
   *  repo). Sin la dep se usa el cwd tal cual. */
  repoRoot?(cwd: string): Promise<string>
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
  /** El pane del worker quedó aceptado y el worker pasó a `working` (el cableado arma ahí el
   *  vigía de "esperando input"). No se llama si el launch falla. */
  onWorkerStarted?(w: WorkerRecord): void
  /** Donde quedan las ramas terminadas (done / exited / stopped) para que Gero decida. */
  review?: { upsert(e: ReviewEntry): void }
  /** El worker quedó esperando a alguien (§6.9: aviso de escritorio). Nunca se llama por done. */
  onNeedsInput?(w: WorkerRecord, kind: 'question' | 'blocked' | 'waiting_permission'): void
}

/** Un worker del snapshot que ve el renderer: el registro más si Gero pidió "Keep open". */
export type WorkerSnapshot = WorkerRecord & { keepOpen?: boolean }

export type AutoCloseResult =
  | { ok: true }
  | { ok: false; error: 'unknown_worker' | 'not_done' | 'kept_open' | 'worktree_dirty' }

const WAIT_DEFAULT_MS = 60_000
const WAIT_MAX_MS = 240_000
const MAX_LABEL = 60
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
  private readonly waiters = new Map<string, Waiter[]>()
  // workerId -> repo del coordinador (su cwd al lanzar): la revisión lo necesita y el
  // registro del worker no lo guarda.
  private readonly repoOf = new Map<string, string>()
  // Workers cuyo pane Gero pidió no cerrar nunca ("Keep open"). Vive acá y no en el
  // renderer para que el banner lo refleje después de un re-render o de cambiar de tab.
  private readonly kept = new Set<string>()
  // Panes de workers que ya no están: salieron (onPaneExit) o el servicio los cerró. Lo que no
  // está acá sigue vivo, aunque el worker esté done (esperando la cuenta o "Keep open").
  private readonly panesCerrados = new Set<string>()

  // El estado se puede pasar de afuera: PointerDelivery lee la MISMA bandeja.
  constructor(
    private readonly deps: OrchestrationDeps,
    private readonly state: OrchestrationState = new OrchestrationState()
  ) {}

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

  snapshot(): WorkerSnapshot[] {
    return this.state.all().map((w) => (this.kept.has(w.workerId) ? { ...w, keepOpen: true } : { ...w }))
  }
  private readonly coordinators = new Set<string>()

  /** "Keep open": el pane de este worker no se cierra solo. false si el worker no existe. */
  keepOpen(workerId: string): boolean {
    if (!this.byId(workerId)) return false
    this.kept.add(workerId)
    this.deps.onChange()
    return true
  }

  /** La cuenta del banner llegó a 0. Se vuelve a validar acá: el renderer puede tener un
   *  estado viejo, y cerrar con cambios sin commitear sería perder trabajo (§4). */
  async autoClose(workerId: string): Promise<AutoCloseResult> {
    const w = this.byId(workerId)
    if (!w) return { ok: false, error: 'unknown_worker' }
    if (w.status !== 'done') return { ok: false, error: 'not_done' }
    if (this.kept.has(workerId)) return { ok: false, error: 'kept_open' }
    if (!(await this.deps.isClean(w.worktreePath))) return { ok: false, error: 'worktree_dirty' }
    this.cerrarPane(w.paneId)
    return { ok: true }
  }

  /** La rama ya se decidió (merge / discard): se cierra el pane si seguía abierto y el
   *  worker sale del snapshot. */
  forgetWorker(workerId: string): void {
    const w = this.byId(workerId)
    if (!w) return
    this.deps.killPane(w.paneId)
    this.deps.closePane(w.paneId)
    this.panesCerrados.delete(w.paneId)
    this.state.removeWorker(workerId)
    this.kept.delete(workerId)
    this.repoOf.delete(workerId)
    this.deps.onChange()
  }

  onPaneExit(paneId: string, exitCode: number): void {
    const w = this.state.workerByPane(paneId)
    if (w) {
      this.panesCerrados.add(paneId)
      if (!FINALES.has(w.status)) {
        this.state.setStatus(w.workerId, 'exited', this.deps.now())
        this.paraRevision(w)
        this.pushMsg(w, 'exited', `exit code ${exitCode}`)
        this.deps.onChange()
      }
      return
    }
    if (this.coordinators.has(paneId)) this.stopCoordinator(paneId)
  }

  onAgentNeedsInput(paneId: string): void {
    const w = this.state.workerByPane(paneId)
    if (!w || !VIVOS.has(w.status) || w.status === 'needs_input') return
    this.state.setStatus(w.workerId, 'needs_input', this.deps.now())
    this.pushMsg(w, 'waiting_permission', 'the agent is waiting for permission or input')
    this.deps.onNeedsInput?.(w, 'waiting_permission')
    this.deps.onChange()
  }

  stopCoordinator(paneId: string): void {
    for (const w of this.state.workersOf(paneId)) {
      if (VIVOS.has(w.status)) {
        // Queda como stopped en la revisión: la rama y el worktree siguen para que Gero decida.
        this.state.setStatus(w.workerId, 'stopped', this.deps.now())
        this.paraRevision(w)
      }
      // Un worker done (esperando la cuenta o con "Keep open") todavía tiene el pane abierto:
      // sin coordinador nadie lo cierra, y sin el registro el banner y el badge desaparecen.
      // La rama ya está en la revisión.
      if (!this.panesCerrados.has(w.paneId)) this.cerrarPane(w.paneId)
      this.panesCerrados.delete(w.paneId)
      this.kept.delete(w.workerId)
      this.repoOf.delete(w.workerId)
    }
    // No se borran worktrees ni ramas: el trabajo del worker queda.
    this.state.dropCoordinator(paneId)
    this.coordinators.delete(paneId)
    this.releaseWaiters(paneId, { timedOut: true })
    this.deps.onChange()
  }

  /** Nest se cierra: los workers vivos pasan a stopped y su rama entra a la revisión. Es
   *  síncrono a propósito: en los caminos de salida `killAll()` va seguido de `app.exit(0)`, y
   *  el exit asíncrono de cada PTY (onPaneExit) nunca llega a correr. */
  stopAll(): void {
    let alguno = false
    for (const w of this.state.all()) {
      if (!VIVOS.has(w.status)) continue
      this.state.setStatus(w.workerId, 'stopped', this.deps.now())
      this.paraRevision(w)
      alguno = true
    }
    for (const coord of [...this.waiters.keys()]) this.releaseWaiters(coord, { timedOut: true })
    if (alguno) this.deps.onChange()
  }

  // ---- métodos ----

  private async launch(callerPaneId: string, info: PaneInfo, p: LaunchParams) {
    if (!p || typeof p.task !== 'string' || !p.task.trim()) return fail('invalid_params')
    if (typeof p.label !== 'string') return fail('invalid_params')
    const label = p.label.trim()
    if (!label || label.length > MAX_LABEL) return fail('invalid_params')
    if (p.agent !== undefined && p.agent !== 'claude' && p.agent !== 'codex') {
      return fail('invalid_params')
    }

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
    const branch = branchName(label, workerId)
    const baseBranch = await this.deps.currentBranch(info.cwd)
    const raiz = this.deps.repoRoot ? await this.deps.repoRoot(info.cwd) : info.cwd
    const wt = await this.deps.createWorktree(raiz, branch)
    if (!wt.ok) return fail(wt.error)

    // Se vuelve a chequear: durante los await otro launch pudo llenar el cupo.
    const post = this.state.canLaunch(callerPaneId, 0)
    if (!post.ok) {
      // El worktree ya existe y no se borra (ruling R1): queda en la revisión para descartarlo.
      this.huerfano({ workerId, label, colorIndex: 0, branch, worktreePath: wt.worktreePath, baseBranch }, info.cwd)
      return fail(post.error)
    }

    const rec = this.state.addWorker(
      {
        workerId,
        coordinatorPaneId: callerPaneId,
        paneId,
        label: label,
        branch,
        worktreePath: wt.worktreePath,
        baseBranch,
        agent
      },
      this.deps.now()
    )
    this.coordinators.add(callerPaneId)
    this.repoOf.set(workerId, info.cwd)

    const res = await this.deps.requestPane({
      coordinatorPaneId: callerPaneId,
      paneId,
      aiType: agent,
      accountName: acct.accountName,
      accountDir: acct.accountDir,
      cmd: acct.cmd,
      repoPath: wt.worktreePath,
      label: label,
      colorIndex: rec.colorIndex,
      initialInput: workerPreamble({ label: label, branch, baseBranch, task: p.task }),
      workerId
    })
    if (!res.ok) {
      // El worktree ya existe: no se borra nada (ruling R1), pero tampoco puede quedar
      // invisible. Entra a la revisión como stopped (Gero lo ve y lo descarta) y el registro
      // se descarta, así no come cupo.
      this.state.setStatus(workerId, 'stopped', this.deps.now())
      const w = this.byId(workerId)
      if (w) this.paraRevision(w)
      this.state.removeWorker(workerId)
      this.repoOf.delete(workerId)
      this.deps.onChange()
      return fail(res.error)
    }
    // Durante el await el coordinador pudo cerrarse (stopCoordinator) o el worker detenerse:
    // el pane recién creado quedaría huérfano. Se cierra y no se devuelve éxito.
    const actual = this.state.workersOf(callerPaneId).find((x) => x.workerId === workerId)
    if (!actual || !VIVOS.has(actual.status)) {
      this.deps.killPane(paneId)
      this.deps.closePane(paneId)
      return fail('coordinator_gone')
    }
    this.state.setStatus(workerId, 'working', this.deps.now())
    this.deps.onChange()
    this.deps.onWorkerStarted?.({ ...actual, status: 'working' })
    return { workerId, branch, label: label }
  }

  private async report(callerPaneId: string, p: ReportParams) {
    const w = this.state.workerByPane(callerPaneId)!
    if (FINALES.has(w.status)) return fail('worker_finished')
    if (!p || !['done', 'question', 'blocked'].includes(p.kind) || typeof p.text !== 'string') {
      return fail('invalid_params')
    }
    if (p.kind === 'done') {
      if (!(await this.deps.isClean(w.worktreePath))) return fail('worktree_dirty')
      this.state.setStatus(w.workerId, 'done', this.deps.now())
      this.paraRevision(w)
    } else {
      this.state.setStatus(w.workerId, 'needs_input', this.deps.now())
    }
    this.pushMsg(w, p.kind, p.text)
    if (p.kind !== 'done') this.deps.onNeedsInput?.(w, p.kind as 'question' | 'blocked')
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
    if (!VIVOS.has(w.status)) return fail('worker_finished')
    typeThenSubmit(this.deps.writePty, (fn, ms) => setTimeout(fn, ms), w.paneId, p.text)
    return { ok: true }
  }

  private stop(callerPaneId: string, p: StopParams) {
    const objetivo = p.workerId
      ? [this.owned(callerPaneId, p.workerId)]
      : this.state.workersOf(callerPaneId)
    // Sólo se transiciona a los vivos: no se pisa done/exited ni se re-mata.
    const vivos = objetivo.filter((w) => VIVOS.has(w.status))
    const stopped: string[] = []
    for (const w of vivos) {
      this.state.setStatus(w.workerId, 'stopped', this.deps.now())
      this.paraRevision(w)
      this.cerrarPane(w.paneId)
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

  private cerrarPane(paneId: string): void {
    this.panesCerrados.add(paneId)
    this.deps.killPane(paneId)
    this.deps.closePane(paneId)
  }

  /** Un worktree creado para un worker que nunca llegó a tener registro: a la revisión. */
  private huerfano(
    w: Pick<WorkerRecord, 'workerId' | 'label' | 'colorIndex' | 'branch' | 'worktreePath' | 'baseBranch'>,
    repoPath: string
  ): void {
    if (!this.deps.review) return
    try {
      this.deps.review.upsert({ ...w, status: 'stopped', finishedAt: this.deps.now(), repoPath })
    } catch (err) {
      console.error('[orchestration] review store write failed', err instanceof Error ? err.message : err)
    }
    this.deps.onChange()
  }

  private byId(workerId: unknown): WorkerRecord | undefined {
    if (typeof workerId !== 'string') return undefined
    return this.state.all().find((w) => w.workerId === workerId)
  }

  /** Un worker llegó a done / exited / stopped: su rama entra a la revisión. Un fallo al
   *  escribir el archivo no corta el flujo del agente. */
  private paraRevision(w: WorkerRecord): void {
    if (!this.deps.review) return
    try {
      this.deps.review.upsert({
        workerId: w.workerId,
        label: w.label,
        colorIndex: w.colorIndex,
        branch: w.branch,
        worktreePath: w.worktreePath,
        baseBranch: w.baseBranch,
        status: w.status,
        finishedAt: w.finishedAt,
        repoPath: this.repoOf.get(w.workerId) ?? w.worktreePath
      })
    } catch (err) {
      console.error('[orchestration] review store write failed', err instanceof Error ? err.message : err)
    }
  }

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
