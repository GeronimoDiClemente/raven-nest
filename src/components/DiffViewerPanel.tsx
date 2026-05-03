import { useEffect, useState } from 'react'
import type { DiffFile, DiffResult } from '../types'

interface Props {
  open: boolean
  worktreePath: string | null
  onClose: () => void
}

export function DiffViewerPanel({ open, worktreePath, onClose }: Props) {
  const [data, setData] = useState<DiffResult | null>(null)
  const [selectedPath, setSelectedPath] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open || !worktreePath) return
    let cancelled = false
    setLoading(true); setError(null)
    void window.diff.get(worktreePath).then((res) => {
      if (cancelled) return
      setData(res)
      setSelectedPath(res.files[0]?.path ?? null)
    }).catch((err) => {
      if (cancelled) return
      setError(err instanceof Error ? err.message : String(err))
    }).finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [open, worktreePath])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  const selectedFile: DiffFile | undefined = data?.files.find((f) => f.path === selectedPath)

  return (
    <div className="diff-drawer" onClick={onClose}>
      <div className="diff-panel" onClick={(e) => e.stopPropagation()}>
        <div className="diff-header">
          <span className="diff-title">Diff · {worktreePath?.split(/[\\/]/).pop()}</span>
          <button className="diff-close" onClick={onClose}>×</button>
        </div>
        {loading && <div className="diff-loading">Loading…</div>}
        {error && <div className="modal-error">{error}</div>}
        {data && data.files.length === 0 && (
          <div className="diff-empty">No changes since {data.base}</div>
        )}
        {data && data.files.length > 0 && (
          <div className="diff-body">
            <div className="diff-files">
              {data.files.map((f) => (
                <button
                  key={f.path}
                  className={`diff-file ${selectedPath === f.path ? 'diff-file-active' : ''}`}
                  onClick={() => setSelectedPath(f.path)}
                  title={f.path}
                >
                  <span className="diff-file-name">{f.path.split('/').pop()}</span>
                  <span className="diff-file-stats">
                    <span className="diff-add">+{f.additions}</span>{' '}
                    <span className="diff-del">−{f.deletions}</span>
                  </span>
                </button>
              ))}
            </div>
            <div className="diff-content">
              {selectedFile?.oversized && (
                <div className="diff-warn">Diff too large to render fully. Open in your IDE for the full diff.</div>
              )}
              {selectedFile?.binary && <div className="diff-warn">Binary file</div>}
              {selectedFile?.hunks.map((h, hi) => (
                <div key={hi} className="diff-hunk">
                  <div className="diff-hunk-header">{h.header}</div>
                  {h.lines.map((l, li) => (
                    <div key={li} className={`diff-line diff-line-${l.type}`}>
                      <span className="diff-num">{l.oldNum ?? ''}</span>
                      <span className="diff-num">{l.newNum ?? ''}</span>
                      <span className="diff-text">
                        {l.type === 'add' ? '+ ' : l.type === 'del' ? '− ' : '  '}
                        {l.text}
                      </span>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
