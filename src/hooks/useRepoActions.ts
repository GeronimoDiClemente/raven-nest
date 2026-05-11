import { useState, useEffect, useCallback, useRef } from 'react'
import { getProvider, type NormalizedRun, type ProviderId, type LatestStatus } from '../lib/ci'

interface UseRepoActionsArgs {
  repoFullName: string | null
  provider: ProviderId
  token: string | null
  branch?: string
  enabled: boolean
}

interface UseRepoActionsResult {
  runs: NormalizedRun[]
  loading: boolean
  error: string | null
  latestStatus: LatestStatus
  refresh: () => Promise<void>
}

export function useRepoActions({
  repoFullName, provider, token, branch, enabled,
}: UseRepoActionsArgs): UseRepoActionsResult {
  const [runs, setRuns] = useState<NormalizedRun[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const aliveRef = useRef(true)
  const runsRef = useRef<NormalizedRun[]>([])

  const fetchOnce = useCallback(async () => {
    if (!repoFullName || !token) return
    setLoading(true)
    setError(null)
    try {
      const p = getProvider(provider)
      const result = await p.fetchRuns(repoFullName, token, { branch, perPage: 5 })
      if (aliveRef.current) setRuns(result)
    } catch (e: unknown) {
      if (aliveRef.current) setError(e instanceof Error ? e.message : 'Unknown error')
    } finally {
      if (aliveRef.current) setLoading(false)
    }
  }, [repoFullName, provider, token, branch])

  useEffect(() => {
    aliveRef.current = true
    return () => { aliveRef.current = false }
  }, [])

  useEffect(() => { runsRef.current = runs }, [runs])

  useEffect(() => {
    if (!enabled) return
    fetchOnce()
    const tick = () => {
      const hasInProgress = runsRef.current.some(r => r.status === 'in_progress' || r.status === 'queued')
      return hasInProgress ? 30_000 : 120_000
    }
    let timer: ReturnType<typeof setTimeout>
    const schedule = () => {
      timer = setTimeout(async () => {
        await fetchOnce()
        if (aliveRef.current && enabled) schedule()
      }, tick())
    }
    schedule()
    return () => clearTimeout(timer)
  }, [enabled, fetchOnce])

  const latestStatus: LatestStatus = (() => {
    const latest = runs[0]
    if (!latest) return 'unknown'
    if (latest.status === 'in_progress' || latest.status === 'queued') return 'running'
    if (latest.status === 'success') return 'success'
    if (latest.status === 'failure') return 'failure'
    return 'unknown'
  })()

  return { runs, loading, error, latestStatus, refresh: fetchOnce }
}
