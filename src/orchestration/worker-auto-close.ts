// MIT License — Copyright (c) 2026 Lovecast Inc.
// Portado de Orca: src/shared/orchestration/workers/worker-auto-close.ts (formato m:ss de la
// cuenta) y src/main/runtime/orchestration/terminal-authority/release/
// worker-terminal-auto-release-working-yield.ts (el cierre automático cede ante un agente que
// vuelve a trabajar y la cuenta arranca de nuevo cuando descansa). En Orca el plazo lo lleva el
// host en su base; acá vive en el renderer, y main revalida al llegar a 0 (`autoClose`).
//
// Spec 2026-11-12-orquestacion-panes §6.10: el `done` aceptado programa el cierre del pane a los
// 2 minutos, con un banner y "Keep open"; si el agente vuelve a trabajar, la cuenta se suspende.

import { useEffect, useRef, useState } from 'react'
import type { OrchestrationWorkerStatus } from '../types'

export const WORKER_AUTO_CLOSE_MS = 120_000
const TICK_MS = 250

/** 120 s, salvo el override de un e2e (preload: sólo con RAVEN_E2E=1). */
export function autoCloseDurationMs(): number {
  const o = typeof window !== 'undefined' ? window.orchestration?.autoCloseMs : null
  return typeof o === 'number' && Number.isFinite(o) && o > 0 ? o : WORKER_AUTO_CLOSE_MS
}

/** m:ss de lo que falta, nunca por debajo de 0:00 (redondea para arriba, como Orca). */
export function formatAutoCloseCountdown(remainingMs: number): string {
  const s = Math.max(0, Math.ceil(remainingMs / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

export type AutoClosePhase =
  /** No terminó (o volvió a otro estado): no hay cuenta. */
  | 'off'
  /** Gero pidió "Keep open": no se cierra nunca. */
  | 'kept'
  /** Terminó pero el agente está sacando output: la cuenta espera a que descanse. */
  | 'paused'
  | 'counting'
  /** La cuenta llegó a 0 y ya se pidió el cierre. */
  | 'due'

export interface WorkerAutoCloseInput {
  status: OrchestrationWorkerStatus
  keepOpen: boolean
  /** El pane está sacando output ahora (el `isBusy` de TerminalPane). */
  busy: boolean
  durationMs: number
  onDue: () => void
}

export function useWorkerAutoClose({ status, keepOpen, busy, durationMs, onDue }: WorkerAutoCloseInput): {
  phase: AutoClosePhase
  remainingMs: number
} {
  const activo = status === 'done' && !keepOpen && !busy
  const [closesAt, setClosesAt] = useState<number | null>(() => (activo ? Date.now() + durationMs : null))
  const [now, setNow] = useState(() => Date.now())
  const [due, setDue] = useState(false)
  const onDueRef = useRef(onDue)
  onDueRef.current = onDue

  // Cada vez que se vuelve activo, la cuenta arranca entera; al dejar de serlo se descarta.
  useEffect(() => {
    if (!activo) {
      setClosesAt(null)
      setDue(false)
      return
    }
    const t0 = Date.now()
    const fin = t0 + durationMs
    setClosesAt(fin)
    setNow(t0)
    setDue(false)
    let disparado = false
    const id = setInterval(() => {
      const t = Date.now()
      setNow(t)
      if (!disparado && t >= fin) {
        disparado = true
        clearInterval(id)
        setDue(true)
        onDueRef.current()
      }
    }, TICK_MS)
    return () => clearInterval(id)
  }, [activo, durationMs])

  let phase: AutoClosePhase
  if (status !== 'done') phase = 'off'
  else if (keepOpen) phase = 'kept'
  else if (busy) phase = 'paused'
  else phase = due ? 'due' : 'counting'

  const remainingMs = phase === 'counting' || phase === 'due'
    ? Math.max(0, (closesAt ?? Date.now() + durationMs) - now)
    : durationMs
  return { phase, remainingMs }
}
