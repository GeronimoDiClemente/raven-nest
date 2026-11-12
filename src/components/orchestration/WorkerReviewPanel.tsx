// Spec §6.7 — "una lista de workers terminados del tab (rama, etiqueta, color, diffstat) con las
// tres acciones". Vive arriba del grid del tab, como la fila de estado de Memories: una fila chica
// que dice cuántas ramas esperan, y que se abre en la lista. Cada rama es una SettingRow (qué es
// a la izquierda, las acciones a la derecha, el detalle abajo). Nada se decide solo: cada acción
// es un click de Gero, y Merge into main / Discard piden confirmación.
import { useEffect, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { cn } from '@/lib/utils'
import SettingRow from '../memories/settings/SettingRow'
import { DiffViewerPanel } from '../DiffViewerPanel'
import { useBridge } from '../../lib/bridge'
import type { OrchestrationReviewEntry, OrchestrationReviewResult } from '../../types'
import { CLASE_DE_WORKER, ETIQUETA_DE_WORKER } from '../../orchestration/worker-status'
import WorkerDot from './WorkerDot'

interface Props {
  /** Ya filtradas al repo del tab (`reviewEntriesForTab`). */
  entries: OrchestrationReviewEntry[]
  ansi?: readonly string[]
  /** Abierta de entrada (capturas y tests). */
  defaultOpen?: boolean
}

type Accion = 'merge' | 'openPr' | 'discard'

/** El texto en línea para cada error que devuelve main. */
export function reviewErrorText(e: OrchestrationReviewEntry, r: Extract<OrchestrationReviewResult, { ok: false }>): string {
  switch (r.error) {
    case 'coordinator_dirty': return `Can't merge: ${e.baseBranch} has uncommitted changes. Commit or stash them first.`
    case 'merge_conflict': return `Merge conflict with ${e.baseBranch}. The merge was aborted; nothing changed.`
    case 'base_not_checked_out': return `Can't merge: ${e.baseBranch} isn't checked out in any worktree.`
    case 'detached_head': return 'Base branch unknown (detached HEAD).'
    case 'worker_dirty': return "The worker's worktree has uncommitted changes. Nothing was merged or removed."
    case 'no_github_remote': return 'No GitHub remote: origin is not a github.com repository.'
    case 'push_failed': return `Push failed${r.detail ? `: ${r.detail}` : '.'}`
    case 'remove_failed': return `Merged, but the worktree couldn't be removed${r.detail ? `: ${r.detail}` : '.'}`
    case 'busy': return 'Another action on this branch is still running.'
    case 'unknown_worker': return 'This branch is no longer in the review list.'
    default: return r.detail ? `${r.error}: ${r.detail}` : `Failed: ${r.error}.`
  }
}

function Diffstat({ e }: { e: OrchestrationReviewEntry }) {
  const bridge = useBridge()
  const [st, setSt] = useState<{ additions: number; deletions: number; filesChanged: number } | null>(null)
  useEffect(() => {
    let vivo = true
    const base = e.baseBranch === 'HEAD' ? undefined : e.baseBranch
    void bridge.git.shortstat(e.worktreePath, base).then((r) => { if (vivo) setSt(r) }, () => {})
    return () => { vivo = false }
  }, [bridge, e.worktreePath, e.baseBranch])
  if (!st) return null
  return (
    <span className="font-mono tabular-nums" data-testid="worker-review-diffstat">
      +{st.additions} −{st.deletions} · {st.filesChanged} file{st.filesChanged === 1 ? '' : 's'}
    </span>
  )
}

function ReviewRow({ e, ansi, onDiff }: { e: OrchestrationReviewEntry; ansi?: readonly string[]; onDiff: () => void }) {
  const [corriendo, setCorriendo] = useState<Accion | null>(null)
  const [mensaje, setMensaje] = useState<string | null>(null)
  const [confirmar, setConfirmar] = useState<'merge' | 'discard' | null>(null)
  const detached = e.baseBranch === 'HEAD'
  const enMain = e.baseBranch === 'main'

  const correr = async (accion: Accion): Promise<void> => {
    const api = window.orchestration
    if (!api || corriendo) return
    setCorriendo(accion)
    setMensaje(null)
    try {
      const r = await api[accion](e.workerId)
      if (!r.ok) setMensaje(reviewErrorText(e, r))
    } catch (err) {
      setMensaje(err instanceof Error ? err.message : String(err))
    } finally {
      setCorriendo(null)
    }
  }

  const ocupado = corriendo !== null
  return (
    <div data-testid="worker-review-row" data-worker={e.workerId}>
      <SettingRow
        nombre={
          <span className="flex min-w-0 items-center gap-2">
            <WorkerDot colorIndex={e.colorIndex} ansi={ansi} />
            <span className="truncate">{e.label}</span>
            <Badge variant="outline" className={cn('gap-1.5', CLASE_DE_WORKER[e.status])}>{ETIQUETA_DE_WORKER[e.status]}</Badge>
          </span>
        }
        descripcion={
          <span className="flex flex-wrap items-center gap-x-2">
            <span className="font-mono">{e.branch}</span>
            <span className="microlabel text-muted-foreground">into</span>
            <span className="font-mono">{detached ? 'unknown' : e.baseBranch}</span>
            <Diffstat e={e} />
          </span>
        }
        control={
          <>
            <Button size="xs" variant="outline" onClick={onDiff}>View diff</Button>
            <Button
              size="xs"
              variant="outline"
              disabled={detached || ocupado}
              title={detached ? 'Base branch unknown (detached HEAD)' : `Merge ${e.branch} into ${e.baseBranch} (local, no push)`}
              onClick={() => (enMain ? setConfirmar('merge') : void correr('merge'))}
            >
              {corriendo === 'merge' ? 'Merging…' : enMain ? 'Merge into main' : 'Merge'}
            </Button>
            <Button size="xs" variant="outline" disabled={ocupado} onClick={() => void correr('openPr')}>
              {corriendo === 'openPr' ? 'Pushing…' : 'Open PR'}
            </Button>
            <Button
              size="xs"
              variant="outline"
              className="text-destructive"
              disabled={ocupado}
              onClick={() => setConfirmar('discard')}
            >
              Discard
            </Button>
          </>
        }
      >
        {detached && <p className="m-0 text-fs-sm text-muted-foreground">Base branch unknown (detached HEAD). Merge is off; Open PR and Discard still work.</p>}
        {mensaje && <p role="alert" className="m-0 text-fs-sm text-destructive">{mensaje}</p>}
      </SettingRow>

      <AlertDialog open={confirmar !== null} onOpenChange={(o) => { if (!o) setConfirmar(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirmar === 'merge' ? `Merge ${e.label} into main?` : `Discard ${e.label}?`}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirmar === 'merge'
                ? `This merges ${e.branch} into your local main with a merge commit and removes the worker's worktree. Nothing is pushed.`
                : `This deletes the worktree and the branch ${e.branch}, including any commits that aren't merged anywhere. This can't be undone.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant={confirmar === 'merge' ? 'default' : 'destructive'}
              onClick={() => {
                const a = confirmar
                setConfirmar(null)
                if (a) void correr(a)
              }}
            >
              {confirmar === 'merge' ? 'Merge into main' : 'Discard branch'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

export default function WorkerReviewPanel({ entries, ansi, defaultOpen = false }: Props) {
  const [open, setOpen] = useState(defaultOpen)
  const [diffDe, setDiffDe] = useState<string | null>(null)
  if (entries.length === 0) return null
  const n = entries.length

  return (
    <div data-testid="worker-review" className="shrink-0 border-b border-border bg-card">
      <div className="memories-status-row text-fs-sm">
        <Badge variant="outline" className="gap-1.5">
          <span className="font-mono tabular-nums">{n}</span>
          worker branch{n === 1 ? '' : 'es'} to review
        </Badge>
        <div className="memories-status-cell flex-wrap">
          {entries.map((e) => (
            <span key={e.workerId} className="flex items-center gap-1.5">
              <WorkerDot colorIndex={e.colorIndex} ansi={ansi} />
              <span className="microlabel text-muted-foreground">{e.label}</span>
            </span>
          ))}
        </div>
        <Button size="xs" variant="outline" className="ml-auto" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
          {open ? 'Hide' : 'Review'}
        </Button>
      </div>
      {open && (
        <div className="max-h-[45vh] overflow-y-auto border-t border-border px-4" data-testid="worker-review-list">
          {entries.map((e) => (
            <ReviewRow key={e.workerId} e={e} ansi={ansi} onDiff={() => setDiffDe(e.worktreePath)} />
          ))}
        </div>
      )}
      <DiffViewerPanel open={diffDe !== null} worktreePath={diffDe} onClose={() => setDiffDe(null)} />
    </div>
  )
}
