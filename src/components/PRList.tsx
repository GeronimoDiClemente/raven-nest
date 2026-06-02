import { useState, useEffect } from 'react'

export interface GitHubPR {
  number: number
  title: string
  user: { login: string; avatar_url: string }
  state: 'open' | 'closed'
  created_at: string
  head: { ref: string }
  base: { ref: string }
  body: string | null
}

interface PRListProps {
  repoFullName: string
  githubToken: string
  onSelectPR: (pr: GitHubPR, stackedOnPR?: GitHubPR) => void
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 60) return `${mins}m`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h`
  const days = Math.floor(hrs / 24)
  if (days < 30) return `${days}d`
  return `${Math.floor(days / 30)}mo`
}

export default function PRList({ repoFullName, githubToken, onSelectPR }: PRListProps) {
  const [prs, setPrs] = useState<GitHubPR[]>([])
  const [stackMap, setStackMap] = useState<Map<number, GitHubPR>>(new Map())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState<'open' | 'closed'>('open')
  const [creating, setCreating] = useState(false)
  const [branches, setBranches] = useState<string[]>([])
  const [prTitle, setPrTitle] = useState('')
  const [prBody, setPrBody] = useState('')
  const [prHead, setPrHead] = useState('')
  const [prBase, setPrBase] = useState('main')
  const [createError, setCreateError] = useState<string | null>(null)
  const [creating2, setCreating2] = useState(false)

  const ghHeaders = {
    Authorization: `Bearer ${githubToken}`,
    Accept: 'application/vnd.github.v3+json',
  }

  useEffect(() => {
    let alive = true
    setLoading(true)
    setError(null)
    setPrs([])

    const load = async () => {
      try {
        const res = await fetch(
          `https://api.github.com/repos/${repoFullName}/pulls?state=${filter}&per_page=30`,
          { headers: ghHeaders }
        )
        if (!res.ok) throw new Error(`GitHub API error: ${res.status}`)
        const data: GitHubPR[] = await res.json()
        if (alive) {
          setPrs(data)
          // Detect stacks only for open PRs
          if (filter === 'open') {
            const headMap = new Map<string, GitHubPR>()
            for (const pr of data) headMap.set(pr.head.ref, pr)
            const newStackMap = new Map<number, GitHubPR>()
            for (const pr of data) {
              const parent = headMap.get(pr.base.ref)
              if (parent && parent.number !== pr.number) {
                newStackMap.set(pr.number, parent)
              }
            }
            setStackMap(newStackMap)
          } else {
            setStackMap(new Map())
          }
        }
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : 'Failed to load PRs')
      } finally {
        if (alive) setLoading(false)
      }
    }

    load()
    return () => { alive = false }
  }, [repoFullName, githubToken, filter])

  const openCreateForm = async () => {
    setCreating(true)
    setPrTitle('')
    setPrBody('')
    setPrHead('')
    setPrBase('')
    setBranches([])
    setCreateError(null)
    try {
      const [repoRes, branchRes] = await Promise.all([
        fetch(`https://api.github.com/repos/${repoFullName}`, { headers: ghHeaders }),
        fetch(`https://api.github.com/repos/${repoFullName}/branches?per_page=100`, { headers: ghHeaders }),
      ])
      if (!branchRes.ok) {
        const errBody = await branchRes.json().catch(() => ({} as { message?: string }))
        let msg = errBody.message || `GitHub /branches returned ${branchRes.status}`
        if (branchRes.status === 403 && /oauth app/i.test(errBody.message ?? '')) {
          const org = repoFullName.split('/')[0]
          msg = `${msg} — autorizá la OAuth App en github.com/organizations/${org}/settings/oauth_application_policy`
        } else if (branchRes.status === 404) {
          msg = `${msg} — repo no visible con este token (privado y sin acceso, o nombre incorrecto)`
        }
        setCreateError(msg)
        const repoData = repoRes.ok ? await repoRes.json() : {}
        setPrBase(repoData.default_branch ?? 'main')
        return
      }
      const [branchData, repoData] = await Promise.all([
        branchRes.json(),
        repoRes.ok ? repoRes.json() : Promise.resolve({}),
      ])
      const names: string[] = (branchData as { name: string }[]).map((b) => b.name)
      const defaultBranch: string = repoData.default_branch ?? names[0] ?? 'main'
      setBranches(names)
      setPrBase(defaultBranch)
    } catch (e) {
      setCreateError(e instanceof Error ? e.message : 'Failed to load branches')
    }
  }

  const submitPR = async () => {
    if (!prTitle.trim() || !prHead.trim() || !prBase.trim()) {
      setCreateError('Title, head branch and base branch are required.')
      return
    }
    if (prHead === prBase) {
      setCreateError('Head and base branches must be different.')
      return
    }
    setCreating2(true)
    setCreateError(null)
    try {
      const res = await fetch(`https://api.github.com/repos/${repoFullName}/pulls`, {
        method: 'POST',
        headers: { ...ghHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: prTitle.trim(), body: prBody.trim(), head: prHead, base: prBase }),
      })
      const data = await res.json()
      if (!res.ok) {
        const detail = data.errors?.map((e: { message?: string }) => e.message).filter(Boolean).join(', ')
        throw new Error(detail || data.message || `GitHub error: ${res.status}`)
      }
      setPrs((prev) => [data as GitHubPR, ...prev])
      setCreating(false)
    } catch (e) {
      setCreateError(e instanceof Error ? e.message : 'Failed to create PR')
    } finally {
      setCreating2(false)
    }
  }

  return (
    <div className="pr-list-container">
      <div className="pr-list-toolbar">
        <span className="pr-list-repo">{repoFullName}</span>
        <div className="pr-filter-btns">
          <button
            className={`pr-filter-btn${filter === 'open' ? ' active' : ''}`}
            onClick={() => setFilter('open')}
          >
            Open
          </button>
          <button
            className={`pr-filter-btn${filter === 'closed' ? ' active' : ''}`}
            onClick={() => setFilter('closed')}
          >
            Closed
          </button>
          <button className="pr-filter-btn" onClick={openCreateForm} title="Create new PR">+ New PR</button>
        </div>
      </div>

      {creating && (
        <div className="pr-create-form">
          <input
            className="snippet-input"
            placeholder="Title"
            value={prTitle}
            onChange={(e) => setPrTitle(e.target.value)}
            autoFocus
            style={{ marginBottom: 6 }}
          />
          <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
            {branches.length > 0 ? (
              <>
                <select
                  className="snippet-input"
                  value={prHead}
                  onChange={(e) => setPrHead(e.target.value)}
                  style={{ flex: 1 }}
                >
                  <option value="">head branch…</option>
                  {branches.map((b) => <option key={b} value={b}>{b}</option>)}
                </select>
                <span style={{ lineHeight: '28px', color: 'var(--text-muted)', fontSize: 12 }}>→</span>
                <select
                  className="snippet-input"
                  value={prBase}
                  onChange={(e) => setPrBase(e.target.value)}
                  style={{ flex: 1 }}
                >
                  {branches.map((b) => <option key={b} value={b}>{b}</option>)}
                </select>
              </>
            ) : (
              <>
                <input className="snippet-input" placeholder="head branch" value={prHead} onChange={(e) => setPrHead(e.target.value)} style={{ flex: 1 }} />
                <span style={{ lineHeight: '28px', color: 'var(--text-muted)', fontSize: 12 }}>→</span>
                <input className="snippet-input" placeholder="base branch" value={prBase} onChange={(e) => setPrBase(e.target.value)} style={{ flex: 1 }} />
              </>
            )}
          </div>
          <textarea
            className="snippet-textarea"
            placeholder="Description (optional)"
            value={prBody}
            onChange={(e) => setPrBody(e.target.value)}
            rows={3}
            style={{ marginBottom: 6 }}
          />
          {createError && <p style={{ color: '#EF4444', fontSize: 11, margin: '0 0 6px' }}>{createError}</p>}
          <div className="snippet-form-actions">
            <button className="snippet-save-btn" onClick={submitPR} disabled={creating2}>
              {creating2 ? 'Creating…' : 'Create PR'}
            </button>
            <button className="snippet-cancel-btn" onClick={() => setCreating(false)}>Cancel</button>
          </div>
        </div>
      )}

      {loading && (
        <div className="pr-state-msg">
          <div className="pr-skeleton">
            {[1, 2, 3].map(i => (
              <div key={i} className="pr-skeleton-item" />
            ))}
          </div>
        </div>
      )}

      {!loading && error && (
        <div className="pr-state-msg">
          <p className="snippet-empty" style={{ color: '#EF4444' }}>{error}</p>
        </div>
      )}

      {!loading && !error && prs.length === 0 && !creating && (
        <p className="snippet-empty">No {filter} pull requests.</p>
      )}

      {!loading && !error && prs.length > 0 && (
        <div className="pr-list">
          {prs.map(pr => {
            const parentPR = stackMap.get(pr.number)
            return (
              <button
                key={pr.number}
                className={`pr-item${parentPR ? ' pr-item-stacked' : ''}`}
                onClick={() => onSelectPR(pr, parentPR)}
              >
                <div className="pr-item-left">
                  <span className={`pr-state-dot ${pr.state}`} title={pr.state} />
                  <div className="pr-item-info">
                    <span className="pr-item-title">
                      {parentPR && (
                        <span className="pr-stack-label">↳ #{parentPR.number}</span>
                      )}
                      {pr.title}
                    </span>
                    <span className="pr-item-meta">
                      <span className="pr-number">#{pr.number}</span>
                      {' · '}
                      <img src={pr.user.avatar_url} alt={pr.user.login} className="pr-avatar" />
                      <span>{pr.user.login}</span>
                      {' · '}
                      <span className="pr-branch">{pr.head.ref}</span>
                      <span className="pr-arrow"> → </span>
                      <span className="pr-branch">{pr.base.ref}</span>
                      {' · '}
                      <span className="pr-time">{timeAgo(pr.created_at)}</span>
                    </span>
                  </div>
                </div>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
