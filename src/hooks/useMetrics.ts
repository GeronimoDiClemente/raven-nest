import { useCallback, useEffect, useRef, useState } from 'react'
import type { MetricsPaneInput, MetricsSnapshot } from '../types'

const FAST_INTERVAL_MS = 2000
const SLOW_INTERVAL_MS = 10_000
// Ports rarely change second-to-second and scanning them is expensive (netstat
// -ano on Windows + per-pid wmic walk). Run it every 5th tick so the chips
// refresh ~10s in fast mode and ~50s in slow mode.
const PORTS_REFRESH_EVERY_N_TICKS = 5

interface UseMetricsResult {
  snapshot: MetricsSnapshot | null
  ports: Record<number, number[]>
  refreshDisk: () => Promise<void>
  refresh: () => Promise<void>
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
  const [ports, setPorts] = useState<Record<number, number[]>>({})
  const [isLoading, setIsLoading] = useState(false)
  const [isDiskRefreshing, setIsDiskRefreshing] = useState(false)

  const panesRef = useRef(panes)
  panesRef.current = panes

  const inFlightRef = useRef(false)
  const mountedRef = useRef(true)
  const tickCountRef = useRef(0)
  const portsInFlightRef = useRef(false)

  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  const fetchPortsFor = useCallback(async (snap: MetricsSnapshot) => {
    if (portsInFlightRef.current) return
    const uniquePids = new Set<number>()
    for (const repo of snap.repos) {
      for (const wt of repo.worktrees) {
        for (const pane of wt.panes) {
          if (pane.pid > 0) uniquePids.add(pane.pid)
        }
      }
    }
    if (uniquePids.size === 0) {
      if (mountedRef.current) setPorts({})
      return
    }
    portsInFlightRef.current = true
    try {
      const result = await window.metrics.portsByPids(Array.from(uniquePids))
      if (mountedRef.current) setPorts(result ?? {})
    } catch (err) {
      console.warn('[useMetrics] portsByPids failed', err)
    } finally {
      portsInFlightRef.current = false
    }
  }, [])

  const tick = useCallback(async (opts?: { forcePorts?: boolean }) => {
    if (inFlightRef.current) return
    inFlightRef.current = true
    try {
      const snap = await window.metrics.snapshot(panesRef.current)
      if (mountedRef.current) setSnapshot(snap)
      tickCountRef.current += 1
      // Skip ports on the very first tick so the popover opens fast — the
      // snapshot alone is enough to render the tree. After that, refresh
      // every N ticks (or immediately when caller forces it).
      const shouldRefreshPorts = opts?.forcePorts === true
        || (tickCountRef.current > 1 && tickCountRef.current % PORTS_REFRESH_EVERY_N_TICKS === 0)
      if (shouldRefreshPorts) {
        void fetchPortsFor(snap)
      }
    } catch (err) {
      console.warn('[useMetrics] snapshot failed', err)
    } finally {
      inFlightRef.current = false
      if (mountedRef.current) setIsLoading(false)
    }
  }, [fetchPortsFor])

  useEffect(() => {
    setIsLoading(true)
    // Reset tick counter when cadence flips so opening the popover doesn't
    // immediately fire a ports scan piggy-backing on the previous count.
    tickCountRef.current = 0
    // Fire one immediately so the pill never shows stale data right after the
    // user opens the popover (which switches us to fast cadence).
    void tick()
    const interval = setInterval(() => { void tick() }, fast ? FAST_INTERVAL_MS : SLOW_INTERVAL_MS)
    return () => clearInterval(interval)
  }, [fast, tick])

  const refresh = useCallback(async () => {
    // Manual refresh after a kill — force a fresh snapshot AND a fresh ports
    // read so a freed port disappears from the chips immediately.
    await tick({ forcePorts: true })
  }, [tick])

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

  return { snapshot, ports, refreshDisk, refresh, isLoading, isDiskRefreshing }
}
