import { useEffect, useState, useCallback } from 'react'

interface GitFile {
  status: string
  path: string
}

interface GitStatus {
  files: GitFile[]
  ahead: number
  behind: number
}

interface GitInfo {
  branch: string | null
  remoteUrl: string | null
  githubUrl: string | null
  isDirty: boolean
}

interface Props {
  localPath: string
  repoFullName: string
  onClose: () => void
}

function statusColor(s: string): string {
  if (s === 'M' || s === 'MM') return '#f59e0b'
  if (s === 'A') return '#22c55e'
  if (s === 'D') return '#ef4444'
  if (s === '??' || s === '?') return '#888'
  if (s === 'R') return 'var(--primary)'
  return '#e8e8e8'
}

function statusLabel(s: string): string {
  if (s.startsWith('M')) return 'M'
  if (s.startsWith('A')) return 'A'
  if (s.startsWith('D')) return 'D'
  if (s === '??') return '?'
  if (s.startsWith('R')) return 'R'
  return s.charAt(0)
}

export default function RepoStatusPanel({ localPath, repoFullName, onClose }: Props) {
  const [info, setInfo] = useState<GitInfo | null>(null)
  const [status, setStatus] = useState<GitStatus | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [i, s] = await Promise.all([
        window.git.info(localPath),
        window.git.status(localPath),
      ])
      setInfo(i)
      setStatus(s)
    } finally {
      setLoading(false)
    }
  }, [localPath])

  useEffect(() => { load() }, [load])

  const isDirty = info?.isDirty ?? false

  return (
    <div className="repo-status-panel">
      <div className="rsp-header">
        <span className="rsp-title">{repoFullName}</span>
        <button className="rsp-close" onClick={onClose} title="Close">✕</button>
      </div>

      {loading && <div className="rsp-loading">Loading…</div>}

      {!loading && info && (
        <>
          <div className="rsp-meta">
            <span className="rsp-branch">
              <span
                className="rsp-dot"
                style={{ background: isDirty ? '#f59e0b' : '#22c55e' }}
              />
              {info.branch ?? '(detached)'}
            </span>
            {status && (
              <span className="rsp-sync">
                <span className="rsp-ahead" title="Ahead">↑{status.ahead}</span>
                {' '}
                <span className="rsp-behind" title="Behind">↓{status.behind}</span>
              </span>
            )}
          </div>

          {status && status.files.length > 0 ? (
            <ul className="rsp-file-list">
              {status.files.map((f, i) => (
                <li key={i} className="rsp-file-item">
                  <span
                    className="rsp-file-status"
                    style={{ color: statusColor(f.status) }}
                  >
                    {statusLabel(f.status)}
                  </span>
                  <span className="rsp-file-path" title={f.path}>{f.path}</span>
                </li>
              ))}
            </ul>
          ) : (
            !loading && <div className="rsp-clean">Working tree clean</div>
          )}
        </>
      )}

      <div className="rsp-footer">
        <button className="rsp-refresh" onClick={load} disabled={loading}>
          {loading ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>
    </div>
  )
}
