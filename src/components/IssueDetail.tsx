import { useState, useEffect } from 'react'
import type { GitHubIssue } from './IssueList'

interface IssueComment {
  id: number
  user: { login: string; avatar_url: string }
  created_at: string
  body: string
}

interface IssueDetailProps {
  repoFullName: string
  issue: GitHubIssue
  githubToken: string
  localPath?: string | null
  onOpenRepoTerminal?: (repoFullName: string, localPath: string) => void
  onBack: () => void
}

function toSlug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 40)
    .replace(/-$/, '')
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

export default function IssueDetail({ repoFullName, issue: initialIssue, githubToken, localPath, onOpenRepoTerminal, onBack }: IssueDetailProps) {
  const [issue, setIssue] = useState<GitHubIssue>(initialIssue)
  const [comments, setComments] = useState<IssueComment[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [newComment, setNewComment] = useState('')
  const [posting, setPosting] = useState(false)
  const [postError, setPostError] = useState<string | null>(null)
  const [toggling, setToggling] = useState(false)
  const [creatingBranch, setCreatingBranch] = useState(false)
  const [createdBranchName, setCreatedBranchName] = useState<string | null>(null)
  const [branchError, setBranchError] = useState<string | null>(null)

  const ghHeaders = {
    Authorization: `Bearer ${githubToken}`,
    Accept: 'application/vnd.github.v3+json',
  }

  useEffect(() => {
    let alive = true
    setLoading(true)
    setError(null)

    const load = async () => {
      try {
        const res = await fetch(
          `https://api.github.com/repos/${repoFullName}/issues/${issue.number}/comments`,
          { headers: ghHeaders }
        )
        if (!res.ok) throw new Error(`GitHub API error: ${res.status}`)
        const data: IssueComment[] = await res.json()
        if (alive) setComments(data)
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : 'Failed to load comments')
      } finally {
        if (alive) setLoading(false)
      }
    }

    load()
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repoFullName, issue.number, githubToken])

  const postComment = async () => {
    if (!newComment.trim()) return
    setPosting(true)
    setPostError(null)
    try {
      const res = await fetch(
        `https://api.github.com/repos/${repoFullName}/issues/${issue.number}/comments`,
        {
          method: 'POST',
          headers: { ...ghHeaders, 'Content-Type': 'application/json' },
          body: JSON.stringify({ body: newComment }),
        }
      )
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}))
        throw new Error(errData.message ?? `Error ${res.status}`)
      }
      const comment: IssueComment = await res.json()
      setComments(prev => [...prev, comment])
      setNewComment('')
    } catch (e) {
      setPostError(e instanceof Error ? e.message : 'Failed to post comment')
    } finally {
      setPosting(false)
    }
  }

  const toggleState = async () => {
    setToggling(true)
    const newState = issue.state === 'open' ? 'closed' : 'open'
    try {
      const res = await fetch(
        `https://api.github.com/repos/${repoFullName}/issues/${issue.number}`,
        {
          method: 'PATCH',
          headers: { ...ghHeaders, 'Content-Type': 'application/json' },
          body: JSON.stringify({ state: newState }),
        }
      )
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}))
        throw new Error(errData.message ?? `Error ${res.status}`)
      }
      const updated: GitHubIssue = await res.json()
      setIssue(updated)
    } catch (e) {
      console.error(e)
    } finally {
      setToggling(false)
    }
  }

  const createBranch = async () => {
    setCreatingBranch(true)
    setBranchError(null)
    try {
      // 1. Obtener el default branch del repo
      const repoRes = await fetch(
        `https://api.github.com/repos/${repoFullName}`,
        { headers: ghHeaders }
      )
      if (!repoRes.ok) {
        const errData = await repoRes.json().catch(() => ({}))
        throw new Error(errData.message ?? `Error ${repoRes.status}`)
      }
      const repoData = await repoRes.json()
      const defaultBranch: string = repoData.default_branch

      // 2. Obtener el SHA del default branch
      const refRes = await fetch(
        `https://api.github.com/repos/${repoFullName}/git/refs/heads/${defaultBranch}`,
        { headers: ghHeaders }
      )
      if (!refRes.ok) {
        const errData = await refRes.json().catch(() => ({}))
        throw new Error(errData.message ?? `Error ${refRes.status}`)
      }
      const refData = await refRes.json()
      const sha: string = refData.object.sha

      // 3. Crear el branch
      const slug = toSlug(issue.title)
      const branchName = `issue-${issue.number}-${slug}`
      const createRes = await fetch(
        `https://api.github.com/repos/${repoFullName}/git/refs`,
        {
          method: 'POST',
          headers: { ...ghHeaders, 'Content-Type': 'application/json' },
          body: JSON.stringify({ ref: `refs/heads/${branchName}`, sha }),
        }
      )
      if (!createRes.ok) {
        const errData = await createRes.json().catch(() => ({}))
        throw new Error(errData.message ?? `Error ${createRes.status}`)
      }
      setCreatedBranchName(branchName)
    } catch (e) {
      setBranchError(e instanceof Error ? e.message : 'Failed to create branch')
    } finally {
      setCreatingBranch(false)
    }
  }

  return (
    <div className="issue-detail-container">
      {/* Header */}
      <div className="pr-review-header">
        <button className="pr-back-btn" onClick={onBack}>← Back</button>
        <div className="pr-review-title-block">
          <span className={`pr-badge ${issue.state}`}>{issue.state === 'open' ? 'Open' : 'Closed'}</span>
          <span className="pr-review-title">{issue.title}</span>
        </div>
        <div className="pr-review-meta">
          <img src={issue.user.avatar_url} alt={issue.user.login} className="pr-avatar" />
          <span>{issue.user.login}</span>
          <span> · </span>
          <span className="pr-time">{timeAgo(issue.created_at)}</span>
          {issue.labels.length > 0 && (
            <>
              <span> · </span>
              {issue.labels.map(l => (
                <span
                  key={l.name}
                  className="issue-label-chip"
                  style={{ background: `#${l.color}33`, color: `#${l.color}`, borderColor: `#${l.color}55` }}
                >
                  {l.name}
                </span>
              ))}
            </>
          )}
          {issue.assignees.length > 0 && (
            <>
              <span> · </span>
              {issue.assignees.map(a => (
                <img key={a.login} src={a.avatar_url} alt={a.login} className="pr-avatar" title={a.login} />
              ))}
            </>
          )}
        </div>
      </div>

      <div className="issue-detail-body">
        {/* Issue body */}
        {issue.body && (
          <div className="issue-body-block">
            <p className="issue-body-text">{issue.body}</p>
          </div>
        )}

        {/* Comments */}
        <div className="issue-comments">
          {loading && (
            <div className="pr-skeleton">
              {[1, 2].map(i => <div key={i} className="pr-skeleton-item" style={{ height: 60 }} />)}
            </div>
          )}
          {!loading && error && <p className="snippet-empty" style={{ color: '#EF4444' }}>{error}</p>}
          {!loading && !error && comments.map(c => (
            <div key={c.id} className="issue-comment">
              <div className="issue-comment-header">
                <img src={c.user.avatar_url} alt={c.user.login} className="pr-avatar" />
                <span className="pr-review-author">{c.user.login}</span>
                <span className="pr-time">{timeAgo(c.created_at)}</span>
              </div>
              <p className="issue-comment-body">{c.body}</p>
            </div>
          ))}
        </div>

        {/* New comment */}
        <div className="issue-new-comment">
          <textarea
            className="snippet-textarea"
            style={{ width: '100%', minHeight: 72 }}
            placeholder="Write a comment…"
            value={newComment}
            onChange={e => setNewComment(e.target.value)}
            disabled={posting}
          />
          {postError && <p style={{ color: '#EF4444', fontSize: 11, marginBottom: 6 }}>{postError}</p>}
          {branchError && <p style={{ color: '#EF4444', fontSize: 11, marginBottom: 6 }}>{branchError}</p>}
          {createdBranchName && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 11, color: '#22c55e' }}>✓ Branch created:</span>
              <code style={{ fontSize: 11, background: 'var(--bg-secondary)', padding: '2px 6px', borderRadius: 4, color: 'var(--text-primary)' }}>
                {createdBranchName}
              </code>
              {localPath && onOpenRepoTerminal && (
                <button
                  className="snippet-save-btn"
                  style={{ fontSize: 11, padding: '3px 10px' }}
                  onClick={() => onOpenRepoTerminal(repoFullName, localPath)}
                >
                  Open terminal
                </button>
              )}
            </div>
          )}
          <div className="pr-review-actions">
            <button
              className="snippet-save-btn"
              disabled={posting || !newComment.trim()}
              onClick={postComment}
            >
              {posting ? '…' : 'Comment'}
            </button>
            {issue.state === 'open' && !createdBranchName && (
              <button
                className="snippet-cancel-btn"
                disabled={creatingBranch}
                onClick={createBranch}
              >
                {creatingBranch ? 'Creating…' : 'Create branch'}
              </button>
            )}
            <button
              className={`snippet-cancel-btn${issue.state === 'closed' ? ' issue-reopen-btn' : ''}`}
              disabled={toggling}
              onClick={toggleState}
            >
              {toggling ? '…' : issue.state === 'open' ? 'Close issue' : 'Reopen issue'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
