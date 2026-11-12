// Spec §6.10 — el `done` aceptado programa el cierre del pane a los 2 minutos, con la cuenta a
// la vista y "Keep open". Una fila chica como la de estado de Memories: etiqueta en
// `microlabel`, el número en `font-mono tabular-nums`, y el botón a la derecha.
import { useCallback, useState } from 'react'
import { Button } from '@/components/ui/button'
import type { OrchestrationWorker } from '../../types'
import { autoCloseDurationMs, formatAutoCloseCountdown, useWorkerAutoClose } from '../../orchestration/worker-auto-close'

interface Props {
  worker: OrchestrationWorker
  /** El pane está sacando output ahora: la cuenta espera a que el agente descanse. */
  busy: boolean
  /** Para tests y capturas: por default, la duración de `autoCloseDurationMs()`. */
  durationMs?: number
}

const MOTIVO: Record<string, string> = {
  worktree_dirty: 'Kept open: the worktree has uncommitted changes.',
}

export default function WorkerAutoCloseBanner({ worker, busy, durationMs }: Props) {
  const [error, setError] = useState<string | null>(null)
  const [pidiendo, setPidiendo] = useState(false)
  const api = typeof window !== 'undefined' ? window.orchestration : undefined

  const onDue = useCallback(() => {
    if (!api) return
    // main revalida (done, no mantenido, worktree limpio) y cierra por el mismo camino que
    // `orchestration:close-pane`. Si se niega, la cuenta no se reintenta: queda el motivo.
    void api.autoClose(worker.workerId).then(
      (r) => {
        if (r.ok) return
        if (r.error === 'not_done' || r.error === 'kept_open') return
        setError(MOTIVO[r.error] ?? `Kept open: ${r.error}.`)
      },
      () => setError('Kept open: could not close the pane.'),
    )
  }, [api, worker.workerId])

  const { phase, remainingMs } = useWorkerAutoClose({
    status: worker.status,
    keepOpen: !!worker.keepOpen || error !== null,
    busy,
    durationMs: durationMs ?? autoCloseDurationMs(),
    onDue,
  })

  if (worker.status !== 'done') return null
  if (worker.keepOpen && !error) return null

  const keepOpen = (): void => {
    if (!api || pidiendo) return
    setPidiendo(true)
    void api.keepOpen(worker.workerId).finally(() => setPidiendo(false))
  }

  return (
    <div
      data-testid="worker-auto-close"
      data-phase={error ? 'error' : phase}
      role="status"
      className="flex shrink-0 items-center gap-2 border-b border-border bg-card px-3 py-1 text-fs-sm"
    >
      {error ? (
        <span className="text-warn">{error}</span>
      ) : phase === 'paused' ? (
        <span className="microlabel text-muted-foreground">Auto-close paused while the agent works</span>
      ) : (
        <>
          <span className="microlabel text-muted-foreground">{phase === 'due' ? 'Closing' : 'Closing in'}</span>
          {phase !== 'due' && (
            <span className="font-mono tabular-nums text-foreground">{formatAutoCloseCountdown(remainingMs)}</span>
          )}
        </>
      )}
      {!error && (
        <Button size="xs" variant="outline" className="ml-auto" onClick={keepOpen} disabled={pidiendo || phase === 'due'}>
          Keep open
        </Button>
      )}
    </div>
  )
}
