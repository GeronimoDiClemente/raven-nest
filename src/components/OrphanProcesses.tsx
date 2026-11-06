// La sección del popover de recursos con lo que dejaron vivo las tareas de fondo de agentes
// que ya terminaron. Se muestra sólo si hay algo: es un aviso, no una pantalla.
import { useState } from 'react'
import { X } from 'lucide-react'
import type { OrphanProcess } from '../types'
import { AILogo } from './AILogos'
import { Button } from './ui/button'
import { formatPct } from '../lib/formatMetrics'

/** `3d`, `5h`, `12m`: cuánto lleva suelto. */
export function edad(segundos: number): string {
  if (segundos >= 86_400) return `${Math.floor(segundos / 86_400)}d`
  if (segundos >= 3_600) return `${Math.floor(segundos / 3_600)}h`
  return `${Math.max(1, Math.floor(segundos / 60))}m`
}

/**
 * `python3 -c while True: pass` en vez de `/Applications/Xcode.app/…/python3 -c …`: el path
 * del ejecutable se come el ancho y lo que identifica al proceso son el nombre y los
 * argumentos. El path entero queda en el tooltip.
 */
export function comandoCorto(comando: string): string {
  const [ejecutable = '', ...args] = comando.split(' ')
  const nombre = ejecutable.slice(ejecutable.lastIndexOf('/') + 1) || ejecutable
  return [nombre, ...args].join(' ')
}

interface Props {
  huerfanos: OrphanProcess[]
  onKill: (pid: number) => Promise<{ ok: true } | { ok: false; error: string }>
}

export default function OrphanProcesses({ huerfanos, onKill }: Props) {
  const [matando, setMatando] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  if (huerfanos.length === 0) return null

  const matar = async (h: OrphanProcess) => {
    if (matando !== null) return
    if (!window.confirm(`Kill "${comandoCorto(h.comando)}" (PID ${h.pid}) and the rest of its task?`)) return
    setMatando(h.pid)
    setError(null)
    try {
      const r = await onKill(h.pid)
      if (!r.ok) setError(r.error)
    } finally {
      setMatando(null)
    }
  }

  return (
    <section aria-label="Orphaned processes" className="flex flex-col gap-1 px-3 py-2">
      <div className="flex items-center gap-1.5 text-fs-xs font-medium tracking-wide text-warn">
        <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-warn" />
        ORPHANED PROCESSES
      </div>
      <p className="m-0 text-fs-xs text-muted-foreground">
        Left running by background tasks of agent sessions that already ended.
      </p>
      {huerfanos.map((h) => (
        <div key={h.pid} className="group flex items-center gap-2 py-0.5">
          <span aria-hidden className="flex shrink-0 items-center">
            <AILogo aiType={h.agente} size={11} />
          </span>
          <div className="flex min-w-0 flex-1 flex-col">
            <span className="truncate font-mono text-fs-sm text-foreground" title={h.comando}>{comandoCorto(h.comando)}</span>
            <span className="truncate text-fs-xs text-muted-foreground">
              {h.proyecto} · PID {h.pid} · {edad(h.segundos)}
            </span>
          </div>
          <span className="shrink-0 font-mono text-fs-sm tabular-nums text-muted-foreground">{formatPct(h.cpu)}</span>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            className="shrink-0 hover:text-destructive"
            disabled={matando !== null}
            onClick={() => { void matar(h) }}
            aria-label={`Kill ${comandoCorto(h.comando)}`}
            title={matando === h.pid ? 'Killing…' : `Kill PID ${h.pid} and its task`}
          >
            <X />
          </Button>
        </div>
      ))}
      {error && <p className="m-0 text-fs-xs text-destructive">{error}</p>}
    </section>
  )
}
