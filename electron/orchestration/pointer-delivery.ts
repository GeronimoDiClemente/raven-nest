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
// Un Esc al final de un chunk espera esto al chunk siguiente antes de tomarse por Esc suelto.
const ESC_FLUSH_MS = 50
const MAX_PEND = 4096

interface Draft {
  count: number
  at: number
  bs: boolean
  paste: boolean // dentro de un pegado con marcadores (persiste entre chunks)
  pend: string // escape incompleto a la espera del chunk siguiente
  cancelEsc: () => void
}

export interface PointerDeps {
  now(): number
  setTimer(fn: () => void, ms: number): () => void
  writePty(paneId: string, data: string): void
  bufferTail(paneId: string): string
  lastOutputAt(paneId: string): number | null
  isAlive(paneId: string): boolean
  /** El agente (y no un shell pelado) está en primer plano del PTY. Si el agente del
   *  coordinador salió, el pane volvió al prompt y el puntero lo ejecutaría el shell. */
  isAgentForeground(paneId: string): boolean
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
  // paneId -> borrador de la línea actual: cantidad de caracteres imprimibles, última tecla
  // y si el último fue una barra invertida (\ + Enter es salto de línea, no envío).
  private readonly drafts = new Map<string, Draft>()
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
    const d = this.draftDe(paneId)
    d.cancelEsc()
    d.cancelEsc = () => {}
    // Lo que quedó a medias del chunk anterior se completa con éste.
    const submitted = this.procesar(d, Array.from(d.pend + data))
    this.guardarDraft(paneId, d)
    // El Enter real del usuario ya envió lo que había en la línea, puntero incluido.
    if (submitted) {
      const f = this.flights.get(paneId)
      if (f && f.phase === 'enter') {
        f.cancelTimer()
        this.terminarVuelo(paneId, f)
      }
    }
    // Un Esc al final del chunk espera al siguiente; si no llega nada, era un Esc suelto.
    if (d.pend === '\x1b') {
      d.cancelEsc = this.deps.setTimer(() => {
        d.cancelEsc = () => {}
        if (d.pend !== '\x1b') return
        d.pend = ''
        d.count = 0
        d.bs = false
        d.at = this.deps.now()
        this.guardarDraft(paneId, d)
      }, ESC_FLUSH_MS)
    }
  }

  private draftDe(paneId: string): Draft {
    return (
      this.drafts.get(paneId) ?? {
        count: 0,
        at: 0,
        bs: false,
        paste: false,
        pend: '',
        cancelEsc: () => {}
      }
    )
  }

  private guardarDraft(paneId: string, d: Draft): void {
    d.at = this.deps.now()
    if (d.count > 0 || d.bs || d.paste || d.pend !== '') this.drafts.set(paneId, d)
    else this.drafts.delete(paneId)
  }

  // Devuelve true si hubo un Enter real (envío). Deja en d.pend un escape incompleto.
  private procesar(d: Draft, cs: string[]): boolean {
    let submitted = false
    d.pend = ''
    const salto = (): void => {
      // un salto de línea que no envía deja el borrador no vacío
      d.count = Math.max(d.count, 1)
      d.bs = false
    }
    const incompleto = (i: number): void => {
      const resto = cs.slice(i).join('')
      d.pend = resto.length > MAX_PEND ? '' : resto
    }
    for (let i = 0; i < cs.length; i++) {
      const c = cs[i]
      if (c === '\x1b') {
        const n = cs[i + 1]
        if (n === undefined) return (incompleto(i), submitted)
        if (n === '[') {
          let j = i + 2
          while (j < cs.length && cs[j].charCodeAt(0) >= 0x20 && cs[j].charCodeAt(0) <= 0x3f) j++
          if (j >= cs.length) return (incompleto(i), submitted)
          const params = cs.slice(i + 2, j).join('')
          const final = cs[j]
          if (final === '~' && params === '200') d.paste = true
          else if (final === '~' && params === '201') d.paste = false
          // reporte de mouse legacy: \x1b[M + 3 bytes crudos
          if (final === 'M' && params === '') {
            if (j + 3 >= cs.length) return (incompleto(i), submitted)
            j += 3
          }
          i = j
        } else if (n === 'O') {
          if (i + 2 >= cs.length) return (incompleto(i), submitted)
          i += 2 // SS3: \x1bO<x>
        } else if (n === ']' || n === 'P') {
          // OSC (termina en BEL o ST) y DCS (termina en ST): se saltea el payload
          let j = i + 2
          let fin = -1
          for (; j < cs.length; j++) {
            if (n === ']' && cs[j] === '\x07') {
              fin = j
              break
            }
            if (cs[j] === '\x1b' && cs[j + 1] === '\\') {
              fin = j + 1
              break
            }
          }
          if (fin < 0) return (incompleto(i), submitted)
          i = fin
        } else if (n === '\r') {
          salto() // Alt+Enter: no envía
          i += 1
        } else {
          i += 1 // Alt+tecla: se ignora el par
        }
        continue
      }
      if (c === '\r') {
        if (!d.paste && !d.bs) {
          d.count = 0
          submitted = true
        } else salto()
      } else if (c === '\n') salto()
      else if (c === '\x7f' || c === '\b') {
        d.count = Math.max(0, d.count - 1)
        d.bs = false
      } else if (c === '\x03' || c === '\x15') {
        d.count = 0
        d.bs = false
      } else if (c.codePointAt(0)! >= 0x20) {
        d.count++
        d.bs = c === '\\'
      }
    }
    return submitted
  }

  onOutput(paneId: string): void {
    this.evaluarWatch(paneId)
  }

  cancel(coordinatorPaneId: string): void {
    this.flights.get(coordinatorPaneId)?.cancelTimer()
    this.flights.delete(coordinatorPaneId)
  }

  // Pane muerto: además del vuelo se descarta el borrador. En paths con el pane vivo
  // (p.ej. n === 0) el borrador es real y se conserva.
  private muerto(paneId: string): void {
    this.cancel(paneId)
    this.soltarDraft(paneId)
  }

  private soltarDraft(paneId: string): void {
    this.drafts.get(paneId)?.cancelEsc()
    this.drafts.delete(paneId)
  }

  /** El pane se cerró: suelta vuelo, borrador y watch. */
  forget(paneId: string): void {
    this.muerto(paneId)
    this.watches.get(paneId)?.cancelTimer()
    this.watches.delete(paneId)
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
    const d = this.drafts.get(paneId)
    if (d === undefined) return false
    if (this.deps.now() - d.at >= DRAFT_HOLD_MAX_MS) {
      this.soltarDraft(paneId)
      return false
    }
    return true
  }

  private quieto(paneId: string): boolean {
    const last = this.deps.lastOutputAt(paneId)
    return last === null || this.deps.now() - last >= QUIET_MS
  }

  // Si la consulta tira, no se bloquea el puntero para siempre: se asume el agente.
  private agenteAlFrente(paneId: string): boolean {
    try {
      return this.deps.isAgentForeground(paneId)
    } catch {
      return true
    }
  }

  private diálogo(paneId: string): boolean {
    return detectNeedsInput(this.deps.bufferTail(paneId))
  }

  private intentarTexto(coord: string, flight: Flight): void {
    if (this.flights.get(coord) !== flight) return
    if (!this.deps.isAlive(coord)) return this.muerto(coord)
    const n = this.state.pending(coord).length
    if (n === 0) return this.cancel(coord)
    if (this.agenteAlFrente(coord) && this.quieto(coord) && !this.diálogo(coord) && !this.hayBorrador(coord)) {
      if (!this.escribir(coord, pointerLine(n))) return
      this.state.markPointed(coord)
      flight.phase = 'enter'
      flight.cancelTimer = this.deps.setTimer(
        () => this.intentarEnter(coord, flight),
        ENTER_DELAY_MS
      )
      return
    }
    flight.cancelTimer = this.deps.setTimer(() => this.intentarTexto(coord, flight), RECHECK_MS)
  }

  private intentarEnter(coord: string, flight: Flight): void {
    if (this.flights.get(coord) !== flight) return
    if (!this.deps.isAlive(coord)) return this.muerto(coord)
    // Re-chequeo: en estos 500 ms pudo aparecer un borrador o un diálogo, o salir el agente.
    if (!this.agenteAlFrente(coord) || this.diálogo(coord) || this.hayBorrador(coord)) {
      flight.cancelTimer = this.deps.setTimer(() => this.intentarEnter(coord, flight), RECHECK_MS)
      return
    }
    if (!this.escribir(coord, '\r')) return
    this.terminarVuelo(coord, flight)
  }

  // Un write que tira = pane muerto: se cancela y no se reintenta.
  private escribir(paneId: string, data: string): boolean {
    try {
      this.deps.writePty(paneId, data)
      return true
    } catch {
      this.muerto(paneId)
      return false
    }
  }

  // Terminado el vuelo, lo que llegó mientras tanto ('pending') arma otro puntero.
  private terminarVuelo(coord: string, flight: Flight): void {
    if (this.flights.get(coord) === flight) this.flights.delete(coord)
    this.notify(coord)
  }

  private programarWatch(paneId: string, w: Watch): void {
    w.cancelTimer = this.deps.setTimer(() => {
      if (this.watches.get(paneId) !== w) return
      if (!this.deps.isAlive(paneId)) {
        this.watches.delete(paneId) // pane muerto: se desuscribe solo
        return
      }
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
    try {
      w.onNeedsInput()
    } catch {
      // un callback que tira no corta la cadena de rechequeos
    }
  }
}
