import { useState, useEffect, useCallback, useRef } from 'react'

export interface CIRun {
  id: number
  name: string
  status: 'queued' | 'in_progress' | 'completed'
  conclusion: 'success' | 'failure' | 'cancelled' | 'skipped' | null
  html_url: string
  created_at: string
  head_branch: string
}

export type CIStatus = 'success' | 'failure' | 'running' | 'unknown'

export function useRepoCI(repoFullName: string | null, githubToken: string | null) {
  const [runs, setRuns] = useState<CIRun[]>([])
  const [loading, setLoading] = useState(false)
  const [latestStatus, setLatestStatus] = useState<CIStatus>('unknown')
  const aliveRef = useRef(true)

  useEffect(() => {
    aliveRef.current = true
    return () => { aliveRef.current = false }
  }, [])

  const refresh = useCallback(async () => {
    if (!repoFullName || !githubToken) return
    setLoading(true)
    try {
      const res = await fetch(
        `https://api.github.com/repos/${repoFullName}/actions/runs?per_page=5`,
        {
          headers: {
            Authorization: `Bearer ${githubToken}`,
            Accept: 'application/vnd.github.v3+json',
          },
        }
      )
      if (!res.ok) return
      const data = await res.json()
      if (!aliveRef.current) return
      const workflowRuns: CIRun[] = data.workflow_runs ?? []
      setRuns(workflowRuns)

      const latest = workflowRuns[0]
      if (!latest) {
        setLatestStatus('unknown')
        return
      }
      if (latest.status === 'in_progress' || latest.status === 'queued') {
        setLatestStatus('running')
      } else if (latest.conclusion === 'success') {
        setLatestStatus('success')
      } else if (latest.conclusion === 'failure') {
        setLatestStatus('failure')
      } else {
        setLatestStatus('unknown')
      }
    } finally {
      if (aliveRef.current) setLoading(false)
    }
  }, [repoFullName, githubToken])

  useEffect(() => {
    refresh()
    const interval = setInterval(refresh, 120_000)
    return () => clearInterval(interval)
  }, [refresh])

  return { runs, loading, latestStatus, refresh }
}
