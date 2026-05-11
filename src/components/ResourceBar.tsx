import { useCallback, useEffect, useState } from 'react'
import type { MetricsPaneInput } from '../types'
import { useMetrics } from '../hooks/useMetrics'
import ResourceBarPopover from './ResourceBarPopover'

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

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let idx = 0
  let val = bytes
  while (val >= 1024 && idx < units.length - 1) {
    val /= 1024
    idx += 1
  }
  const decimals = val < 10 ? 2 : val < 100 ? 1 : 0
  return `${val.toFixed(decimals)} ${units[idx]}`
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

  const { snapshot, refreshDisk, isDiskRefreshing } = useMetrics(panes, open)

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
        className={`resource-bar-pill${open ? ' resource-bar-pill--open' : ''}`}
        onClick={() => setOpen((v) => !v)}
        title="Resource Usage"
      >
        {pillLabel}
      </button>
      {open && (
        <ResourceBarPopover
          snapshot={snapshot}
          primary={primary}
          onPrimaryChange={setPrimary}
          onRefreshDisk={() => { void refreshDisk() }}
          isDiskRefreshing={isDiskRefreshing}
          onClose={() => setOpen(false)}
        />
      )}
    </div>
  )
}
