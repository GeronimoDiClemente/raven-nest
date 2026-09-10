import { useCallback, useEffect, useState } from 'react'
import type { MetricsPaneInput } from '../types'
import { useMetrics } from '../hooks/useMetrics'
import ResourceBarPopover from './ResourceBarPopover'
import { formatBytes } from '../lib/formatMetrics'
import { cn } from '@/lib/utils'

type PrimaryMetric = 'memory' | 'cpu'
const STORAGE_KEY = 'nest-metrics-primary'

function readPrimary(): PrimaryMetric {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw === 'cpu' ? 'cpu' : 'memory'
  } catch {
    return 'memory'
  }
}

interface Props {
  panes: MetricsPaneInput[]
}

export default function ResourceBar({ panes }: Props) {
  const [open, setOpen] = useState(false)
  const [primary, setPrimaryState] = useState<PrimaryMetric>(() => readPrimary())

  const setPrimary = useCallback((next: PrimaryMetric) => {
    setPrimaryState(next)
    try { localStorage.setItem(STORAGE_KEY, next) } catch { /* private mode etc. */ }
  }, [])

  const { snapshot, ports, refreshDisk, refresh, isDiskRefreshing } = useMetrics(panes, open)

  // Close on Escape while open.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setOpen(false) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  const pillLabel = (() => {
    if (!snapshot) return primary === 'cpu' ? '— CPU' : '— MEM'
    if (primary === 'cpu') return `${snapshot.totals.cpuPercent.toFixed(1)}% CPU`
    return formatBytes(snapshot.totals.memBytes)
  })()

  return (
    <div className="resource-bar-wrap">
      <button
        className={cn(
          // `resource-bar-pill(--open)` quedan: layout (position via el wrap),
          // el fondo blanco translúcido al 3% (no es --bg-surface ni
          // --bg-elevated, no tiene equivalencia en la tabla) y las
          // transiciones siguen en global.css. Color, borde, radio, tamaño y
          // tipografía de dato salen de acá.
          'resource-bar-pill',
          open && 'resource-bar-pill--open',
          'border rounded-md text-fs-sm font-mono tabular-nums',
          'text-muted-foreground hover:text-foreground',
          open && 'text-foreground',
        )}
        onClick={() => setOpen((v) => !v)}
        title="Resource Usage"
      >
        {pillLabel}
      </button>
      {open && (
        <ResourceBarPopover
          snapshot={snapshot}
          ports={ports}
          primary={primary}
          onPrimaryChange={setPrimary}
          onRefreshDisk={() => { void refreshDisk() }}
          onRefresh={refresh}
          isDiskRefreshing={isDiskRefreshing}
          onClose={() => setOpen(false)}
        />
      )}
    </div>
  )
}
