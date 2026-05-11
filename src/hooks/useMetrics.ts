import { useCallback, useEffect, useRef, useState } from 'react'
import type { MetricsPaneInput, MetricsSnapshot } from '../types'

const FAST_INTERVAL_MS = 2000
const SLOW_INTERVAL_MS = 10_000

interface UseMetricsResult {
  snapshot: MetricsSnapshot | null
  refreshDisk: () => Promise<void>
  isLoading: boolean
  isDiskRefreshing: boolean
}

/**
 * Polls the metrics IPC every 2s when `fast` is true (popover open) and
 * every 10s otherwise (just the titlebar pill). Caller passes the current
 * panes payload; this hook keeps a ref so a tight in-flight poll never
 * stomps on a fresh panes list.
 */
export function useMetrics(panes: MetricsPaneInput[], fast: boolean): UseMetricsResult {
  const [snapshot, setSnapshot] = useState<MetricsSnapshot | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [isDiskRefreshing, setIsDiskRefreshing] = useState(false)

  const panesRef = useRef(panes)
  panesRef.current = panes

  const inFlightRef = useRef(false)
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  const tick = useCallback(async () => {
    if (inFlightRef.current) return
    inFlightRef.current = true
    try {
      const snap = await window.metrics.snapshot(panesRef.current)
      if (mountedRef.current) setSnapshot(snap)
    } catch (err) {
      console.warn('[useMetrics] snapshot failed', err)
    } finally {
      inFlightRef.current = false
      if (mountedRef.current) setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    setIsLoading(true)
    // Fire one immediately so the pill never shows stale data right after the
    // user opens the popover (which switches us to fast cadence).
    void tick()
    const interval = setInterval(() => { void tick() }, fast ? FAST_INTERVAL_MS : SLOW_INTERVAL_MS)
    return () => clearInterval(interval)
  }, [fast, tick])

  const refreshDisk = useCallback(async () => {
    setIsDiskRefreshing(true)
    try {
      // We need the current worktree list, so snapshot first to pick up any
      // newly opened repos, then call refreshDisk with all those paths, then
      // snapshot once more so the popover re-renders with diskBytes populated.
      const fresh = await window.metrics.snapshot(panesRef.current)
      if (mountedRef.current) setSnapshot(fresh)
      const allWorktrees = fresh.repos.flatMap((r) => r.worktrees.map((w) => w.worktreePath))
      if (allWorktrees.length > 0) {
        await window.metrics.refreshDisk(allWorktrees)
      }
      const after = await window.metrics.snapshot(panesRef.current)
      if (mountedRef.current) setSnapshot(after)
    } catch (err) {
      console.warn('[useMetrics] refreshDisk failed', err)
    } finally {
      if (mountedRef.current) setIsDiskRefreshing(false)
    }
  }, [])

  return { snapshot, refreshDisk, isLoading, isDiskRefreshing }
}
