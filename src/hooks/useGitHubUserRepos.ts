import { useState, useEffect, useCallback, useRef } from 'react'

export interface GitHubUserRepo {
  id: number
  name: string
  full_name: string
  private: boolean
  html_url: string
  clone_url: string
  description: string | null
  default_branch: string
  updated_at: string
  pushed_at: string
  language: string | null
  owner: { login: string; avatar_url: string }
}

export function useGitHubUserRepos(githubToken: string | null) {
  const [repos, setRepos] = useState<GitHubUserRepo[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const aliveRef = useRef(true)

  useEffect(() => {
    aliveRef.current = true
    return () => { aliveRef.current = false }
  }, [])

  const fetchRepos = useCallback(async () => {
    if (!githubToken) { setRepos([]); return }
    setLoading(true)
    setError(null)
    try {
      const all: GitHubUserRepo[] = []
      let page = 1
      while (page <= 5) {
        const res = await fetch(`https://api.github.com/user/repos?per_page=100&sort=pushed&page=${page}`, {
          headers: {
            'Authorization': `Bearer ${githubToken}`,
            'Accept': 'application/vnd.github.v3+json',
          },
        })
        if (!res.ok) throw new Error(`GitHub API ${res.status}`)
        const batch: GitHubUserRepo[] = await res.json()
        all.push(...batch)
        if (batch.length < 100) break
        page++
      }
      if (aliveRef.current) setRepos(all)
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error'
      if (aliveRef.current) setError(message)
    } finally {
      if (aliveRef.current) setLoading(false)
    }
  }, [githubToken])

  useEffect(() => { fetchRepos() }, [fetchRepos])

  return { repos, loading, error, refresh: fetchRepos }
}
