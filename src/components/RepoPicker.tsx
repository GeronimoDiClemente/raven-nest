import { useState, useMemo, useEffect } from 'react'
import { useGitHubUserRepos, GitHubUserRepo } from '../hooks/useGitHubUserRepos'

type Provider = 'github' | 'gitlab'

interface NormalizedRepo {
  id: string
  full_name: string
  name: string
  description: string | null
  default_branch: string
  clone_url: string
  html_url: string
  private: boolean
  language: string | null
  pushed_at: string
}

interface GitlabProject {
  id: number
  name: string
  path_with_namespace: string
  description: string | null
  default_branch: string | null
  http_url_to_repo: string
  web_url: string
  visibility: 'private' | 'internal' | 'public'
  last_activity_at: string
}

interface RepoPickerProps {
  githubToken: string | null
  gitlabToken: string | null
  excludedFullNames: Set<string>  // repos already added — hide them
  onAdd: (repoFullName: string, provider: Provider, localPath: string | null) => Promise<void>
  onClose: () => void
}

function normalizeGitHub(repo: GitHubUserRepo): NormalizedRepo {
  return {
    id: `github:${repo.id}`,
    full_name: repo.full_name,
    name: repo.name,
    description: repo.description,
    default_branch: repo.default_branch,
    clone_url: repo.clone_url,
    html_url: repo.html_url,
    private: repo.private,
    language: repo.language,
    pushed_at: repo.pushed_at,
  }
}

function normalizeGitlab(p: GitlabProject): NormalizedRepo {
  return {
    id: `gitlab:${p.id}`,
    full_name: p.path_with_namespace,
    name: p.name,
    description: p.description,
    default_branch: p.default_branch ?? 'main',
    clone_url: p.http_url_to_repo,
    html_url: p.web_url,
    private: p.visibility !== 'public',
    language: null,
    pushed_at: p.last_activity_at,
  }
}

export default function RepoPicker({ githubToken, gitlabToken, excludedFullNames, onAdd, onClose }: RepoPickerProps) {
  const hasGithub = !!githubToken
  const hasGitlab = !!gitlabToken
  const showSelector = hasGithub && hasGitlab

  // Default tab: GitHub if available, else GitLab
  const initialProvider: Provider = hasGithub ? 'github' : (hasGitlab ? 'gitlab' : 'github')
  const [provider, setProvider] = useState<Provider>(initialProvider)

  const { repos: githubRepos, loading: ghLoading, error: ghError } = useGitHubUserRepos(githubToken)

  const [gitlabRepos, setGitlabRepos] = useState<NormalizedRepo[]>([])
  const [glLoading, setGlLoading] = useState(false)
  const [glError, setGlError] = useState<string | null>(null)

  useEffect(() => {
    if (provider !== 'gitlab' || !gitlabToken) return
    let cancelled = false
    const run = async () => {
      setGlLoading(true)
      setGlError(null)
      try {
        const res = await fetch(
          'https://gitlab.com/api/v4/projects?membership=true&per_page=100&order_by=last_activity_at',
          { headers: { Authorization: `Bearer ${gitlabToken}` } }
        )
        if (!res.ok) throw new Error(`GitLab API ${res.status}`)
        const batch: GitlabProject[] = await res.json()
        if (!cancelled) setGitlabRepos(batch.map(normalizeGitlab))
      } catch (err: unknown) {
        if (!cancelled) setGlError(err instanceof Error ? err.message : 'Unknown error')
      } finally {
        if (!cancelled) setGlLoading(false)
      }
    }
    run()
    return () => { cancelled = true }
  }, [provider, gitlabToken])

  const [filter, setFilter] = useState('')
  const [busyId, setBusyId] = useState<string | null>(null)
  const [busyAction, setBusyAction] = useState<'link' | 'clone' | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  const sourceRepos: NormalizedRepo[] = useMemo(() => {
    if (provider === 'github') return githubRepos.map(normalizeGitHub)
    return gitlabRepos
  }, [provider, githubRepos, gitlabRepos])

  const loading = provider === 'github' ? ghLoading : glLoading
  const error = provider === 'github' ? ghError : glError

  const visible = useMemo(() => {
    const f = filter.trim().toLowerCase()
    return sourceRepos.filter(r => {
      if (excludedFullNames.has(r.full_name)) return false
      if (!f) return true
      return r.full_name.toLowerCase().includes(f) || (r.description ?? '').toLowerCase().includes(f)
    })
  }, [sourceRepos, filter, excludedFullNames])

  const handleLink = async (repo: NormalizedRepo) => {
    setActionError(null)
    setBusyId(repo.id)
    setBusyAction('link')
    try {
      // Pass the repo's HTML URL so pickRepoFolder validates the picked
      // folder's `origin` remote matches. Without this, the user could link
      // any random folder to the wrong repo and the link sticks silently
      // (the sti-travel-console → algoritmos bug reopens here otherwise).
      const folder = await window.git.pickRepoFolder(repo.html_url)
      if (!folder) return
      await onAdd(repo.full_name, provider, folder)
    } catch (err: unknown) {
      setActionError(err instanceof Error ? err.message : 'Error')
    } finally {
      setBusyId(null)
      setBusyAction(null)
    }
  }

  const handleClone = async (repo: NormalizedRepo) => {
    setActionError(null)
    setBusyId(repo.id)
    setBusyAction('clone')
    try {
      const result = await window.git.clone(repo.clone_url, repo.full_name)
      if (!result.ok) {
        setActionError(result.error ?? 'Clone failed')
        return
      }
      await onAdd(repo.full_name, provider, result.path ?? null)
    } catch (err: unknown) {
      setActionError(err instanceof Error ? err.message : 'Error')
    } finally {
      setBusyId(null)
      setBusyAction(null)
    }
  }

  const showGitlabConnectMessage = provider === 'gitlab' && !gitlabToken

  return (
    <div className="repo-picker-overlay" onClick={onClose}>
      <div className="repo-picker-modal" onClick={e => e.stopPropagation()}>
        <div className="repo-picker-header">
          <h3>Add {provider === 'gitlab' ? 'GitLab' : 'GitHub'} repo</h3>
          <button className="repo-picker-close" onClick={onClose} title="Close">×</button>
        </div>

        {showSelector && (
          <div className="repo-picker-tabs" style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
            <button
              className={`repo-picker-tab${provider === 'github' ? ' active' : ''}`}
              onClick={() => setProvider('github')}
              style={{
                padding: '4px 12px',
                fontSize: 12,
                borderRadius: 12,
                border: '1px solid var(--border-color, #ccc)',
                background: provider === 'github' ? 'var(--raven-blue, #0066FF)' : 'transparent',
                color: provider === 'github' ? '#fff' : 'inherit',
                cursor: 'pointer',
              }}
            >
              GitHub
            </button>
            <button
              className={`repo-picker-tab${provider === 'gitlab' ? ' active' : ''}`}
              onClick={() => setProvider('gitlab')}
              style={{
                padding: '4px 12px',
                fontSize: 12,
                borderRadius: 12,
                border: '1px solid var(--border-color, #ccc)',
                background: provider === 'gitlab' ? 'var(--raven-blue, #0066FF)' : 'transparent',
                color: provider === 'gitlab' ? '#fff' : 'inherit',
                cursor: 'pointer',
              }}
            >
              GitLab
            </button>
          </div>
        )}

        <input
          className="repo-picker-search"
          placeholder="Search by name or description…"
          value={filter}
          onChange={e => setFilter(e.target.value)}
          autoFocus
        />

        {actionError && <p className="repo-picker-error">{actionError}</p>}

        <div className="repo-picker-list">
          {showGitlabConnectMessage && (
            <p className="snippet-empty">Connect GitLab from Settings → Account first</p>
          )}
          {!showGitlabConnectMessage && loading && <p className="snippet-empty">Loading repos…</p>}
          {!showGitlabConnectMessage && error && <p className="repo-picker-error">{error}</p>}
          {!showGitlabConnectMessage && !loading && !error && visible.length === 0 && (
            <p className="snippet-empty">{filter ? 'No results' : 'No repos available'}</p>
          )}
          {!showGitlabConnectMessage && !loading && visible.map(repo => (
            <div key={repo.id} className="repo-picker-item">
              <div className="repo-picker-item-info">
                <div className="repo-picker-item-name">
                  {repo.full_name}
                  {repo.private && <span className="repo-picker-badge">private</span>}
                  {repo.language && <span className="repo-picker-lang">{repo.language}</span>}
                </div>
                {repo.description && <div className="repo-picker-item-desc">{repo.description}</div>}
              </div>
              <div className="repo-picker-item-actions">
                <button
                  className="repo-picker-action-btn"
                  onClick={() => handleLink(repo)}
                  disabled={busyId !== null}
                  title="Pick a local folder that already has this repo cloned"
                >
                  {busyId === repo.id && busyAction === 'link' ? '…' : 'Link folder'}
                </button>
                <button
                  className="repo-picker-action-btn primary"
                  onClick={() => handleClone(repo)}
                  disabled={busyId !== null}
                  title="Clone the repo into ~/RavenProjects/"
                >
                  {busyId === repo.id && busyAction === 'clone' ? 'Cloning…' : 'Clone'}
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
