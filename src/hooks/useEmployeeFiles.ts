import { useState, useEffect } from 'react'
import { topAreasFromFiles } from '../lib/employee-analytics'

const DAY_MS = 24 * 60 * 60 * 1000
const MAX_DAYS = 60

const SEARCH_QUERY = `
query($q:String!){
  search(query:$q, type:ISSUE, first:50){
    nodes{ ... on PullRequest {
      number title state createdAt mergedAt additions deletions
      repository{ nameWithOwner }
      files(first:100){ nodes{ path additions deletions } }
    } }
  }
}`

export interface EmployeePr {
  number: number; title: string; state: 'OPEN' | 'MERGED' | 'CLOSED'
  repo: string; createdAt: string; mergedAt: string | null; additions: number; deletions: number
  files: { path: string; additions: number; deletions: number }[]
}

export function useEmployeeFiles(
  repos: Array<{ repo_full_name: string }>,
  githubToken: string | null,
  login: string | null,
) {
  const [prs, setPrs] = useState<EmployeePr[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Depend on a stable string, not the array identity: the caller mints a fresh
  // `repos` array every render, so keying the effect on the object would re-fire
  // the search on every parent re-render (e.g. each presence sync). Same guard as
  // useTeamStats' `repoNames`.
  const repoKey = repos.map(r => r.repo_full_name).join(',')

  useEffect(() => {
    if (!githubToken || !login || !repoKey) { setPrs([]); return }
    let alive = true
    setLoading(true); setError(null)
    const since = new Date(Date.now() - MAX_DAYS * DAY_MS).toISOString().slice(0, 10)
    const repoQ = repoKey.split(',').filter(Boolean).map(n => `repo:${n}`).join(' ')
    const q = `author:${login} is:pr updated:>=${since} ${repoQ}`
    ;(async () => {
      try {
        const res = await fetch('https://api.github.com/graphql', {
          method: 'POST',
          headers: { Authorization: `Bearer ${githubToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ query: SEARCH_QUERY, variables: { q } }),
        })
        if (!res.ok) throw new Error(`GraphQL HTTP ${res.status}`)
        const json = (await res.json()) as { data?: { search?: { nodes?: unknown[] } }; errors?: { message: string }[] }
        if (json.errors?.length) throw new Error(json.errors[0].message)
        const nodes = (json.data?.search?.nodes ?? []) as Array<Record<string, unknown>>
        const mapped: EmployeePr[] = nodes.filter(n => n && n.number != null).map(n => ({
          number: n.number as number,
          title: (n.title as string) ?? '(no title)',
          state: n.state as EmployeePr['state'],
          repo: (n.repository as { nameWithOwner: string })?.nameWithOwner ?? '',
          createdAt: n.createdAt as string,
          mergedAt: (n.mergedAt as string) ?? null,
          additions: (n.additions as number) ?? 0,
          deletions: (n.deletions as number) ?? 0,
          files: (((n.files as { nodes?: unknown[] })?.nodes ?? []) as Array<{ path: string; additions: number; deletions: number }>),
        }))
        if (alive) setPrs(mapped)
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : 'Failed to load')
      } finally {
        if (alive) setLoading(false)
      }
    })()
    return () => { alive = false }
  }, [githubToken, login, repoKey])

  const topAreas = topAreasFromFiles(prs.map(p => ({ files: p.files })), 6)
  const mergedRecent = prs.filter(p => p.state === 'MERGED').sort((a, b) => (b.mergedAt ?? '').localeCompare(a.mergedAt ?? '')).slice(0, 5)
  return { prs, topAreas, mergedRecent, loading, error }
}
