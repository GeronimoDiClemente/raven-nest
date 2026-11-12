// MIT License — Copyright (c) 2026 Lovecast Inc.
// Portado (simplificado) de Orca: src/main/runtime/orchestration/mailbox/terminal-pointer/
// mailbox-pointer-eligibility.ts, mailbox-pointer-delivery.ts, mailbox-pointer-stage.ts y
// mailbox-pointer-submit.ts. Texto completo de la licencia en THIRD_PARTY_NOTICES.md.
//
// Despierta al coordinador tipeando UNA línea en su PTY, pero sólo si el pane está quieto,
// sin prompt de permiso y sin que el usuario tenga un borrador a medio escribir. A diferencia
// de Orca, el borrador no se lee de un screen model: se infiere de lo que el usuario tipeó
// por pty:write desde el último Enter. Sólo lógica: los timers y el reloj vienen de `deps`.

import { detectNeedsInput } from '../integrations/agent-status'
import type { OrchestrationState } from './orchestration-state'
import { pointerLine } from './prompts'

export const QUIET_MS = 3_000
export const ENTER_DELAY_MS = 500
export const RECHECK_MS = 2_000
export const DRAFT_HOLD_MAX_MS = 600_000

export interface PointerDeps {
  now(): number
  setTimer(fn: () => void, ms: number): () => void
  writePty(paneId: string, data: string): void
  bufferTail(paneId: string): string
  lastOutputAt(paneId: string): number | null
  isAlive(paneId: string): boolean
}

interface Flight {
  cancelTimer: () => void
  // 'text': todavía no se escribió el puntero; 'enter': falta el \r
  phase: 'text' | 'enter'
}

interface Watch {
  onNeedsInput: () => void
  fired: boolean
  cancelTimer: () => void
}

export class PointerDelivery {
  private readonly flights = new Map<string, Flight>()
  private readonly drafts = new Map<string, number>() // paneId -> última tecla del usuario
  private readonly watches = new Map<string, Watch>()

  constructor(
    private readonly deps: PointerDeps,
    private readonly state: OrchestrationState
  ) {}

  /** Hay mensaje nuevo para el coordinador. */
  notify(coordinatorPaneId: string): void {
    if (this.flights.has(coordinatorPaneId)) return
    // Los ya apuntados no disparan otro puntero solos: hace falta algún 'pending'.
    const hayNuevo = this.state.pending(coordinatorPaneId).some((m) => m.delivery === 'pending')
    if (!hayNuevo) return
    const flight: Flight = { cancelTimer: () => {}, phase: 'text' }
    this.flights.set(coordinatorPaneId, flight)
    this.intentarTexto(coordinatorPaneId, flight)
  }

  /** Lo que el usuario escribió en un pane (pty:write del renderer). */
  onUserInput(paneId: string, data: string): void {
    const corte = Math.max(data.lastIndexOf('\r'), data.lastIndexOf('\n'))
    if (corte < 0) {
      this.drafts.set(paneId, this.deps.now())
      return
    }
    this.drafts.delete(paneId)
    if (data.slice(corte + 1).length > 0) this.drafts.set(paneId, this.deps.now())
  }

  onOutput(paneId: string): void {
    this.evaluarWatch(paneId)
  }

  cancel(coordinatorPaneId: string): void {
    this.flights.get(coordinatorPaneId)?.cancelTimer()
    this.flights.delete(coordinatorPaneId)
  }

  /** Avisa una vez por episodio de "esperando input" (quieto + prompt en pantalla). */
  watchWorker(paneId: string, onNeedsInput: () => void): () => void {
    this.watches.get(paneId)?.cancelTimer()
    const w: Watch = { onNeedsInput, fired: false, cancelTimer: () => {} }
    this.watches.set(paneId, w)
    this.programarWatch(paneId, w)
    return () => {
      w.cancelTimer()
      if (this.watches.get(paneId) === w) this.watches.delete(paneId)
    }
  }

  // --- internos ---

  private hayBorrador(paneId: string): boolean {
    const desde = this.drafts.get(paneId)
    if (desde === undefined) return false
    if (this.deps.now() - desde >= DRAFT_HOLD_MAX_MS) {
      this.drafts.delete(paneId)
      return false
    }
    return true
  }

  private quieto(paneId: string): boolean {
    const last = this.deps.lastOutputAt(paneId)
    return last === null || this.deps.now() - last >= QUIET_MS
  }

  private diálogo(paneId: string): boolean {
    return detectNeedsInput(this.deps.bufferTail(paneId))
  }

  private intentarTexto(coord: string, flight: Flight): void {
    if (this.flights.get(coord) !== flight) return
    if (!this.deps.isAlive(coord)) return this.cancel(coord)
    const n = this.state.pending(coord).length
    if (n === 0) return this.cancel(coord)
    if (this.quieto(coord) && !this.diálogo(coord) && !this.hayBorrador(coord)) {
      this.deps.writePty(coord, pointerLine(n))
      this.state.markPointed(coord)
      flight.phase = 'enter'
      flight.cancelTimer = this.deps.setTimer(() => this.intentarEnter(coord, flight), ENTER_DELAY_MS)
      return
    }
    flight.cancelTimer = this.deps.setTimer(() => this.intentarTexto(coord, flight), RECHECK_MS)
  }

  private intentarEnter(coord: string, flight: Flight): void {
    if (this.flights.get(coord) !== flight) return
    if (!this.deps.isAlive(coord)) return this.cancel(coord)
    // Re-chequeo: en estos 500 ms pudo aparecer un borrador o un diálogo.
    if (this.diálogo(coord) || this.hayBorrador(coord)) {
      flight.cancelTimer = this.deps.setTimer(() => this.intentarEnter(coord, flight), RECHECK_MS)
      return
    }
    this.deps.writePty(coord, '\r')
    this.flights.delete(coord)
  }

  private programarWatch(paneId: string, w: Watch): void {
    w.cancelTimer = this.deps.setTimer(() => {
      if (this.watches.get(paneId) !== w) return
      this.evaluarWatch(paneId)
      this.programarWatch(paneId, w)
    }, RECHECK_MS)
  }

  private evaluarWatch(paneId: string): void {
    const w = this.watches.get(paneId)
    if (!w || !this.deps.isAlive(paneId)) return
    if (!this.diálogo(paneId)) {
      w.fired = false // la condición se despejó: el próximo prompt es otro episodio
      return
    }
    if (w.fired || !this.quieto(paneId)) return
    w.fired = true
    w.onNeedsInput()
  }
}
