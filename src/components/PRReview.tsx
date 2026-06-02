import { useState, useEffect } from 'react'
import type { GitHubPR } from './PRList'
import { getRepoSettings } from '../hooks/useRepoSettings'

interface PRFile {
  filename: string
  additions: number
  deletions: number
  patch?: string
}

interface PRReviewEntry {
  id: number
  user: { login: string; avatar_url: string }
  state: 'APPROVED' | 'CHANGES_REQUESTED' | 'COMMENTED' | 'PENDING' | 'DISMISSED'
  body: string
  submitted_at: string
}

interface PRReviewProps {
  repoFullName: string
  pr: GitHubPR
  githubToken: string
  canReview: boolean
  canMerge?: boolean
  onBack: () => void
  stackedOnPR?: GitHubPR
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

function renderPatch(patch: string) {
  return patch.split('\n').map((line, i) => {
    let cls = 'pr-diff-line'
    if (line.startsWith('+') && !line.startsWith('+++')) cls += ' added'
    else if (line.startsWith('-') && !line.startsWith('---')) cls += ' removed'
    else if (line.startsWith('@@')) cls += ' hunk'
    return (
      <div key={`${i}-${line.slice(0, 20)}`} className={cls}>
        {line}
      </div>
    )
  })
}

const REVIEW_STATE_LABEL: Record<string, string> = {
  APPROVED: 'Approved',
  CHANGES_REQUESTED: 'Changes requested',
  COMMENTED: 'Commented',
  PENDING: 'Pending',
  DISMISSED: 'Dismissed',
}

const ANTHROPIC_KEY_STORAGE = 'raven:anthropicKey'

async function getAnthropicKey(): Promise<string | null> {
  return (window as unknown as { safeStorage?: { decrypt: (k: string) => Promise<string | null> } }).safeStorage?.decrypt(ANTHROPIC_KEY_STORAGE) ?? null
}
async function saveAnthropicKey(key: string): Promise<void> {
  await (window as unknown as { safeStorage?: { encrypt: (k: string, v: string) => Promise<void> } }).safeStorage?.encrypt(ANTHROPIC_KEY_STORAGE, key)
}

export default function PRReview({ repoFullName, pr, githubToken, canReview, canMerge, onBack, stackedOnPR }: PRReviewProps) {
  const [tab, setTab] = useState<'files' | 'conversation'>('files')
  const [files, setFiles] = useState<PRFile[]>([])
  const [reviews, setReviews] = useState<PRReviewEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [reviewBody, setReviewBody] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [submitOk, setSubmitOk] = useState(false)
  const [merging, setMerging] = useState(false)
  const [mergeError, setMergeError] = useState<string | null>(null)
  const [merged, setMerged] = useState(false)
  const [updatingBranch, setUpdatingBranch] = useState(false)
  const [updateOk, setUpdateOk] = useState(false)

  // Release state (leaders only, post-merge)
  const [releaseVersion, setReleaseVersion] = useState('')
  const [releasing, setReleasing] = useState(false)
  const [releaseError, setReleaseError] = useState<string | null>(null)
  const [releaseOk, setReleaseOk] = useState(false)
  const [buildTriggered, setBuildTriggered] = useState(false)

  // AI review state
  const [aiReview, setAiReview] = useState<string | null>(null)
  const [aiLoading, setAiLoading] = useState(false)
  const [aiError, setAiError] = useState<string | null>(null)
  const [showKeyInput, setShowKeyInput] = useState(false)
  const [keyDraft, setKeyDraft] = useState('')

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
        const [filesRes, reviewsRes] = await Promise.all([
          fetch(`https://api.github.com/repos/${repoFullName}/pulls/${pr.number}/files`, { headers: ghHeaders }),
          fetch(`https://api.github.com/repos/${repoFullName}/pulls/${pr.number}/reviews`, { headers: ghHeaders }),
        ])
        if (!filesRes.ok) throw new Error(`Failed to load files: ${filesRes.status}`)
        if (!reviewsRes.ok) throw new Error(`Failed to load reviews: ${reviewsRes.status}`)
        const [filesData, reviewsData] = await Promise.all([filesRes.json(), reviewsRes.json()])
        if (alive) {
          setFiles(filesData)
          setReviews(reviewsData)
        }
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : 'Failed to load PR')
      } finally {
        if (alive) setLoading(false)
      }
    }

    load()
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repoFullName, pr.number, githubToken])

  const submitReview = async (event: 'APPROVE' | 'REQUEST_CHANGES' | 'COMMENT') => {
    setSubmitting(true)
    setSubmitError(null)
    setSubmitOk(false)
    try {
      const res = await fetch(
        `https://api.github.com/repos/${repoFullName}/pulls/${pr.number}/reviews`,
        {
          method: 'POST',
          headers: { ...ghHeaders, 'Content-Type': 'application/json' },
          body: JSON.stringify({ event, body: reviewBody }),
        }
      )
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}))
        throw new Error(errData.message ?? `Error ${res.status}`)
      }
      const newReview: PRReviewEntry = await res.json()
      setReviews(prev => [...prev, newReview])
      setReviewBody('')
      setSubmitOk(true)
      setTimeout(() => setSubmitOk(false), 2000)
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : 'Failed to submit review')
    } finally {
      setSubmitting(false)
    }
  }

  const runAiReview = async (apiKey: string) => {
    setAiLoading(true)
    setAiError(null)
    setAiReview(null)
    setShowKeyInput(false)

    try {
      const diffText = files
        .filter((f) => f.patch)
        .map((f) => `### ${f.filename} (+${f.additions} -${f.deletions})\n\`\`\`diff\n${f.patch}\n\`\`\``)
        .join('\n\n')

      if (!diffText) throw new Error('No diff available to review.')

      const cappedDiff = diffText.length > 40000
        ? diffText.slice(0, 40000) + '\n\n[Diff truncated to 40000 chars due to size]'
        : diffText

      const prompt = `You are a senior software engineer reviewing a pull request.

PR title: ${pr.title}
${pr.body ? `PR description: ${pr.body}\n` : ''}
Repository: ${repoFullName}

Here is the diff:

${cappedDiff}

Please provide a concise code review. Focus on:
1. Potential bugs or logic errors
2. Security concerns
3. Performance issues
4. Code quality and readability

Be specific and actionable. Keep it short.`

      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 1024,
          messages: [{ role: 'user', content: prompt }],
        }),
      })

      const data = await res.json()
      if (!res.ok) throw new Error(data.error?.message ?? `API error ${res.status}`)
      const text = data.content?.[0]?.text ?? ''
      setAiReview(text)
      setTab('conversation')
    } catch (e) {
      setAiError(e instanceof Error ? e.message : 'AI review failed')
    } finally {
      setAiLoading(false)
    }
  }

  // Fetch latest release version cuando se mergea (para sugerir la siguiente)
  useEffect(() => {
    if (!merged || !canMerge) return
    const headers = { Authorization: `Bearer ${githubToken}`, Accept: 'application/vnd.github.v3+json' }
    fetch(`https://api.github.com/repos/${repoFullName}/releases/latest`, { headers })
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data?.tag_name) {
          const match = data.tag_name.replace(/^v/, '').match(/^(\d+)\.(\d+)\.(\d+)$/)
          if (match) {
            setReleaseVersion(`${match[1]}.${match[2]}.${parseInt(match[3]) + 1}`)
          } else {
            setReleaseVersion(data.tag_name.replace(/^v/, ''))
          }
        } else {
          setReleaseVersion('0.1.0')
        }
      })
      .catch(() => setReleaseVersion('0.1.0'))
  }, [merged, canMerge])

  const createRelease = async () => {
    const version = releaseVersion.trim()
    if (!version) return
    setReleasing(true)
    setReleaseError(null)
    setReleaseOk(false)
    setBuildTriggered(false)
    try {
      // 1. Crear el release tag en GitHub
      const tagName = version.startsWith('v') ? version : `v${version}`
      const relRes = await fetch(`https://api.github.com/repos/${repoFullName}/releases`, {
        method: 'POST',
        headers: { ...ghHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tag_name: tagName,
          name: tagName,
          target_commitish: pr.base.ref,
          generate_release_notes: true,
        }),
      })
      const relData = await relRes.json()
      if (!relRes.ok) throw new Error(relData.message ?? `Error ${relRes.status}`)

      // 2. Trigger the build workflow configured by the leader
      const { releaseWorkflow } = getRepoSettings(repoFullName)
      const safeWorkflow = /^[\w.-]+\.ya?ml$/.test(releaseWorkflow ?? '') ? releaseWorkflow : null
      if (safeWorkflow) {
        const wfRes = await fetch(
          `https://api.github.com/repos/${repoFullName}/actions/workflows/${safeWorkflow}/dispatches`,
          {
            method: 'POST',
            headers: { ...ghHeaders, 'Content-Type': 'application/json' },
            body: JSON.stringify({ ref: pr.base.ref }),
          }
        )
        if (wfRes.status === 204) {
          setBuildTriggered(true)
        } else {
          const wfErr = await wfRes.json().catch(() => ({}))
          setReleaseError(`Release created but workflow failed: ${wfErr.message ?? wfRes.status}`)
        }
      }

      setReleaseOk(true)
    } catch (e) {
      setReleaseError(e instanceof Error ? e.message : 'Release failed')
    } finally {
      setReleasing(false)
    }
  }

  const mergePR = async () => {
    setMerging(true)
    setMergeError(null)
    try {
      const res = await fetch(
        `https://api.github.com/repos/${repoFullName}/pulls/${pr.number}/merge`,
        {
          method: 'PUT',
          headers: { ...ghHeaders, 'Content-Type': 'application/json' },
          body: JSON.stringify({ merge_method: getRepoSettings(repoFullName).mergeMethod }),
        }
      )
      const data = await res.json()
      if (!res.ok) throw new Error(data.message ?? `Error ${res.status}`)
      setMerged(true)
    } catch (e) {
      setMergeError(e instanceof Error ? e.message : 'Merge failed')
    } finally {
      setMerging(false)
    }
  }

  const updateBranch = async () => {
    setUpdatingBranch(true)
    setUpdateOk(false)
    try {
      const res = await fetch(
        `https://api.github.com/repos/${repoFullName}/pulls/${pr.number}/update-branch`,
        {
          method: 'PUT',
          headers: { ...ghHeaders, 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        }
      )
      if (res.status === 202) {
        setUpdateOk(true)
        setTimeout(() => setUpdateOk(false), 3000)
      } else {
        const errData = await res.json().catch(() => ({}))
        throw new Error(errData.message ?? `Error ${res.status}`)
      }
    } catch (e) {
      console.error('Update branch failed:', e)
    } finally {
      setUpdatingBranch(false)
    }
  }

  const handleAiReviewClick = async () => {
    const stored = await getAnthropicKey()
    if (stored) {
      runAiReview(stored)
    } else {
      setShowKeyInput(true)
      setKeyDraft('')
    }
  }

  const saveKeyAndReview = async () => {
    if (!keyDraft.trim()) return
    await saveAnthropicKey(keyDraft.trim())
    runAiReview(keyDraft.trim())
  }

  return (
    <div className="pr-review-container">
      {/* Header */}
      <div className="pr-review-header">
        <button className="pr-back-btn" onClick={onBack}>← Back</button>
        <div className="pr-review-title-block">
          <span className={`pr-badge ${pr.state}`}>{pr.state === 'open' ? 'Open' : 'Closed'}</span>
          <span className="pr-review-title">{pr.title}</span>
        </div>
        <div className="pr-review-meta">
          <img src={pr.user.avatar_url} alt={pr.user.login} className="pr-avatar" />
          <span>{pr.user.login}</span>
          <span className="pr-arrow"> · </span>
          <span className="pr-branch">{pr.head.ref}</span>
          <span className="pr-arrow"> → </span>
          <span className="pr-branch">{pr.base.ref}</span>
          <span className="pr-arrow"> · </span>
          <span className="pr-time">{timeAgo(pr.created_at)}</span>
        </div>
      </div>

      {/* Stack banner */}
      {stackedOnPR && (
        <div className="pr-stack-banner">
          <span>↳ stacked on <strong>#{stackedOnPR.number}</strong>: {stackedOnPR.title}</span>
          {updateOk ? (
            <span style={{ color: '#22c55e', fontWeight: 600 }}>Branch updated ✓</span>
          ) : (
            <button
              className="pr-update-branch-btn"
              onClick={updateBranch}
              disabled={updatingBranch}
            >
              {updatingBranch ? 'Updating…' : 'Update branch'}
            </button>
          )}
        </div>
      )}

      {/* Merge bar — leaders only, open PR */}
      {canMerge && pr.state === 'open' && !merged && (
        <div style={{ padding: '8px 14px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 10 }}>
          <button
            className="btn-primary-violet"
            style={{ minWidth: 110 }}
            onClick={mergePR}
            disabled={merging}
          >
            {merging ? 'Merging…' : 'Merge PR'}
          </button>
          {mergeError && <span style={{ fontSize: 11, color: '#EF4444' }}>{mergeError}</span>}
        </div>
      )}
      {merged && (
        <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--border)' }}>
          <p style={{ fontSize: 12, color: '#22c55e', margin: '0 0 8px' }}>
            PR merged successfully.
          </p>
          {canMerge && !releaseOk && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Create release:</span>
              <input
                className="snippet-input"
                placeholder="version (e.g. 1.2.0)"
                value={releaseVersion}
                onChange={e => setReleaseVersion(e.target.value)}
                style={{ width: 120 }}
                disabled={releasing}
              />
              <button
                className="btn-primary-violet"
                onClick={createRelease}
                disabled={releasing || !releaseVersion.trim()}
              >
                {releasing ? 'Creating…' : 'Create Release'}
              </button>
              {releaseError && <span style={{ fontSize: 11, color: '#EF4444' }}>{releaseError}</span>}
            </div>
          )}
          {releaseOk && (
            <div style={{ fontSize: 12, color: '#22c55e' }}>
              Release <strong>v{releaseVersion}</strong> created.
              {buildTriggered && ' Build workflow triggered.'}
            </div>
          )}
        </div>
      )}

      {/* Tabs */}
      <div className="pr-tabs">
        <button className={`pr-tab${tab === 'files' ? ' active' : ''}`} onClick={() => setTab('files')}>
          Files {!loading && `(${files.length})`}
        </button>
        <button className={`pr-tab${tab === 'conversation' ? ' active' : ''}`} onClick={() => setTab('conversation')}>
          Conversation {!loading && `(${reviews.length})`}
        </button>
        {!loading && !error && (
          <button
            className="pr-tab pr-ai-review-btn"
            onClick={handleAiReviewClick}
            disabled={aiLoading}
            title="Review with Claude AI"
            style={{ marginLeft: 'auto', opacity: aiLoading ? 0.6 : 1 }}
          >
            {aiLoading ? '⟳ Reviewing…' : '✦ AI Review'}
          </button>
        )}
      </div>

      {/* API key prompt */}
      {showKeyInput && (
        <div style={{ padding: '10px 12px', background: 'var(--bg-secondary)', borderBottom: '1px solid var(--border)' }}>
          <p style={{ fontSize: 11, color: 'var(--text-muted)', margin: '0 0 6px' }}>
            Enter your Anthropic API key to use AI Review (saved locally):
          </p>
          <div style={{ display: 'flex', gap: 6 }}>
            <input
              className="snippet-input"
              type="password"
              placeholder="sk-ant-…"
              value={keyDraft}
              autoFocus
              onChange={(e) => setKeyDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') saveKeyAndReview(); if (e.key === 'Escape') setShowKeyInput(false) }}
              style={{ flex: 1 }}
            />
            <button className="snippet-save-btn" onClick={saveKeyAndReview}>Review</button>
            <button className="snippet-cancel-btn" onClick={() => setShowKeyInput(false)}>Cancel</button>
          </div>
        </div>
      )}

      {/* Body */}
      <div className="pr-review-body">
        {loading && (
          <div className="pr-skeleton">
            {[1, 2, 3].map(i => <div key={i} className="pr-skeleton-item" style={{ height: 48 }} />)}
          </div>
        )}

        {!loading && error && (
          <p className="snippet-empty" style={{ color: '#EF4444' }}>{error}</p>
        )}

        {!loading && !error && tab === 'files' && (
          <div className="pr-files-list">
            {files.length === 0 && <p className="snippet-empty">No changed files.</p>}
            {files.map(f => (
              <div key={f.filename} className="pr-file-block">
                <div className="pr-file-header">
                  <span className="pr-file-name">{f.filename}</span>
                  <span className="pr-additions">+{f.additions}</span>
                  <span className="pr-deletions">−{f.deletions}</span>
                </div>
                {f.patch && (
                  <pre className="pr-diff-pre">
                    {renderPatch(f.patch)}
                  </pre>
                )}
              </div>
            ))}
          </div>
        )}

        {!loading && !error && tab === 'conversation' && (
          <div className="pr-conversation">
            {aiError && (
              <div style={{ padding: '10px 12px', background: '#2a0a0a', borderRadius: 6, marginBottom: 10, fontSize: 12, color: '#EF4444' }}>
                AI Review error: {aiError}
              </div>
            )}

            {aiReview && (
              <div className="pr-review-entry" style={{ borderLeft: '3px solid var(--raven-blue)', paddingLeft: 10 }}>
                <div className="pr-review-entry-header" style={{ marginBottom: 6 }}>
                  <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--raven-blue)' }}>✦ Claude AI Review</span>
                </div>
                <pre style={{ whiteSpace: 'pre-wrap', fontSize: 12, lineHeight: 1.5, margin: 0, fontFamily: 'inherit' }}>{aiReview}</pre>
              </div>
            )}

            {reviews.length === 0 && !aiReview && <p className="snippet-empty">No reviews yet.</p>}
            {reviews.map(r => (
              <div key={r.id} className="pr-review-entry">
                <div className="pr-review-entry-header">
                  <img src={r.user.avatar_url} alt={r.user.login} className="pr-avatar" />
                  <span className="pr-review-author">{r.user.login}</span>
                  <span className={`pr-review-state ${r.state.toLowerCase()}`}>
                    {REVIEW_STATE_LABEL[r.state] ?? r.state}
                  </span>
                  <span className="pr-time">{timeAgo(r.submitted_at)}</span>
                </div>
                {r.body && <p className="pr-review-body-text">{r.body}</p>}
              </div>
            ))}

            {canReview && (
              <div className="pr-submit-review">
                <textarea
                  className="snippet-textarea"
                  style={{ width: '100%', minHeight: 72 }}
                  placeholder="Write your review comment…"
                  value={reviewBody}
                  onChange={e => setReviewBody(e.target.value)}
                  disabled={submitting}
                />
                {submitError && <p style={{ color: '#EF4444', fontSize: 11, marginBottom: 6 }}>{submitError}</p>}
                {submitOk && <p style={{ color: '#22c55e', fontSize: 11, marginBottom: 6 }}>Review submitted.</p>}
                <div className="pr-review-actions">
                  <button
                    className="btn-soft success"
                    disabled={submitting}
                    onClick={() => submitReview('APPROVE')}
                  >
                    Approve
                  </button>
                  <button
                    className="btn-soft warning"
                    disabled={submitting}
                    onClick={() => submitReview('REQUEST_CHANGES')}
                  >
                    Request changes
                  </button>
                  <button
                    className="btn-soft neutral"
                    disabled={submitting}
                    onClick={() => submitReview('COMMENT')}
                  >
                    Comment
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
