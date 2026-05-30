import { useState, useEffect, useRef } from 'react'
import { getHistory, subscribe } from '../lib/commandHistory'
import { useFixedPopover } from '../hooks/useFixedPopover'

interface Props {
  onRun?: (cmd: string) => void
}

export default function CommandHistoryPanel({ onRun }: Props) {
  const [open, setOpen] = useState(false)
  const [history, setHistory] = useState(getHistory)
  const [search, setSearch] = useState('')
  const panelRef = useRef<HTMLDivElement>(null)
  const popoverRef = useRef<HTMLDivElement>(null)
  const popPos = useFixedPopover(panelRef, open, popoverRef)

  useEffect(() => subscribe(() => setHistory(getHistory())), [])

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  const filtered = search.trim()
    ? history.filter((cmd) => cmd.toLowerCase().includes(search.toLowerCase()))
    : history

  const handleRun = (cmd: string) => {
    onRun?.(cmd)
    setOpen(false)
  }

  return (
    <div className="snippet-wrap" ref={panelRef}>
      <button
        className={`titlebar-btn${open ? ' active' : ''}`}
        onClick={() => setOpen((v) => !v)}
        title="Command history"
      >
        <svg width="13" height="13" viewBox="0 0 14 14" fill="none">
          <circle cx="7" cy="7" r="5.5" stroke="currentColor" strokeWidth="1.3"/>
          <polyline points="7,4 7,7 9,9" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
        </svg>
        History
      </button>

      {open && popPos && (
        <div ref={popoverRef} className="snippet-panel" style={{ position: 'fixed', top: popPos.top, left: popPos.left, right: 'auto' }}>
          <div className="snippet-panel-header">
            <span style={{ fontSize: 12, fontWeight: 600 }}>Command History</span>
          </div>
          <div style={{ padding: '6px 8px' }}>
            <input
              className="snippet-input"
              placeholder="Search…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              autoFocus
              style={{ width: '100%', boxSizing: 'border-box' }}
            />
          </div>
          {filtered.length === 0 && (
            <p className="snippet-empty">{history.length === 0 ? 'No commands yet.' : 'No match.'}</p>
          )}
          <div className="snippet-list" style={{ maxHeight: 300, overflowY: 'auto' }}>
            {filtered.map((cmd, i) => (
              <div key={i} className="snippet-item">
                <span
                  className="snippet-name"
                  title={cmd}
                  style={{ fontFamily: 'var(--font-mono)', fontSize: 11, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                >
                  {cmd}
                </span>
                <button
                  className="snippet-send-btn"
                  onClick={() => handleRun(cmd)}
                  title="Run in active pane"
                >
                  Run
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
