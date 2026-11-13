// MIT License — Copyright (c) 2026 Lovecast Inc.
// Idea de la máquina de entrega (pending → pointed → delivered) derivada de
// Orca: src/main/runtime/orchestration/mailbox/terminal-pointer/mailbox-pointer-state.ts.
// Acá es sólo lógica pura: sin IO, sin timers, sin Electron.

import { randomUUID } from 'node:crypto'

export type WorkerStatus = 'starting' | 'working' | 'needs_input' | 'done' | 'exited' | 'stopped'

export interface WorkerRecord {
  workerId: string
  coordinatorPaneId: string
  paneId: string
  label: string
  colorIndex: number
  branch: string
  worktreePath: string
  baseBranch: string
  agent: string
  status: WorkerStatus
  createdAt: number
  finishedAt?: number
}

export type InboxKind = 'done' | 'question' | 'blocked' | 'exited' | 'waiting_permission'

export interface InboxMessage {
  msgId: string
  workerId: string
  kind: InboxKind
  text: string
  at: number
  delivery: 'pending' | 'pointed' | 'delivered'
}

const MAX_WORKERS_VIVOS = 4
const MAX_PANES_POR_TAB = 12
const ESTADOS_VIVOS: ReadonlySet<WorkerStatus> = new Set(['starting', 'working', 'needs_input'])
const ESTADOS_FINALES: ReadonlySet<WorkerStatus> = new Set(['done', 'exited', 'stopped'])

const vivo = (w: WorkerRecord): boolean => ESTADOS_VIVOS.has(w.status)

export class OrchestrationState {
  private readonly workers = new Map<string, WorkerRecord>()
  // Bandeja en orden de llegada (FIFO); los entregados se descartan.
  private readonly inbox = new Map<string, InboxMessage[]>() // coordinatorPaneId -> mensajes

  canLaunch(
    coordinatorPaneId: string,
    tabPaneCount: number
  ): { ok: true } | { ok: false; error: 'nesting_not_allowed' | 'worker_limit' | 'tab_full' } {
    if (this.workerByPane(coordinatorPaneId)) return { ok: false, error: 'nesting_not_allowed' }
    if (this.workersOf(coordinatorPaneId).filter(vivo).length >= MAX_WORKERS_VIVOS) {
      return { ok: false, error: 'worker_limit' }
    }
    if (tabPaneCount >= MAX_PANES_POR_TAB) return { ok: false, error: 'tab_full' }
    return { ok: true }
  }

  addWorker(
    w: Omit<WorkerRecord, 'colorIndex' | 'status' | 'createdAt'>,
    now: number
  ): WorkerRecord {
    const usados = new Set(
      this.workersOf(w.coordinatorPaneId)
        .filter(vivo)
        .map((x) => x.colorIndex)
    )
    let colorIndex = 0
    while (usados.has(colorIndex)) colorIndex++
    const rec: WorkerRecord = { ...w, colorIndex, status: 'starting', createdAt: now }
    this.workers.set(rec.workerId, rec)
    return rec
  }

  /** Descarta un worker que nunca llegó a tener pane (falló requestPane). */
  removeWorker(workerId: string): void {
    this.workers.delete(workerId)
  }

  workerByPane(paneId: string): WorkerRecord | undefined {
    for (const w of this.workers.values()) if (w.paneId === paneId) return w
    return undefined
  }

  all(): WorkerRecord[] {
    return [...this.workers.values()]
  }

  workersOf(coordinatorPaneId: string): WorkerRecord[] {
    return [...this.workers.values()].filter((w) => w.coordinatorPaneId === coordinatorPaneId)
  }

  setStatus(workerId: string, s: WorkerStatus, now: number): void {
    const w = this.workers.get(workerId)
    if (!w) return
    w.status = s
    if (ESTADOS_FINALES.has(s)) w.finishedAt = now
  }

  push(workerId: string, kind: InboxKind, text: string, now: number): InboxMessage {
    const w = this.workers.get(workerId)
    if (!w) throw new Error(`worker desconocido: ${workerId}`)
    const msg: InboxMessage = {
      msgId: randomUUID(),
      workerId,
      kind,
      text,
      at: now,
      delivery: 'pending'
    }
    const cola = this.inbox.get(w.coordinatorPaneId) ?? []
    cola.push(msg)
    this.inbox.set(w.coordinatorPaneId, cola)
    return msg
  }

  pending(coordinatorPaneId: string): InboxMessage[] {
    return (this.inbox.get(coordinatorPaneId) ?? []).filter((m) => m.delivery !== 'delivered')
  }

  markPointed(coordinatorPaneId: string): void {
    for (const m of this.inbox.get(coordinatorPaneId) ?? []) {
      if (m.delivery === 'pending') m.delivery = 'pointed'
    }
  }

  markDelivered(coordinatorPaneId: string): InboxMessage[] {
    const entregados = this.pending(coordinatorPaneId)
    for (const m of entregados) m.delivery = 'delivered'
    this.inbox.delete(coordinatorPaneId)
    return entregados
  }

  dropCoordinator(coordinatorPaneId: string): WorkerRecord[] {
    const suyos = this.workersOf(coordinatorPaneId)
    for (const w of suyos) this.workers.delete(w.workerId)
    this.inbox.delete(coordinatorPaneId)
    return suyos
  }
}
