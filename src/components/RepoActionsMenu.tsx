import { useEffect, useRef, useState, type ReactNode } from 'react'

export interface RepoAction {
  label: string
  icon?: ReactNode
  onClick: () => void
  danger?: boolean
  disabled?: boolean
}

interface Props {
  actions: RepoAction[]
}

export default function RepoActionsMenu({ actions }: Props) {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDocClick = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDocClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDocClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  if (actions.length === 0) return null

  return (
    <div className="repo-menu-wrap" ref={wrapRef}>
      <button
        type="button"
        className="repo-action-btn repo-menu-trigger"
        onClick={() => setOpen(v => !v)}
        title="More actions"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
          <circle cx="3" cy="8" r="1.4" />
          <circle cx="8" cy="8" r="1.4" />
          <circle cx="13" cy="8" r="1.4" />
        </svg>
      </button>
      {open && (
        <div className="repo-menu-pop" role="menu">
          {actions.map((a, i) => (
            <button
              key={i}
              type="button"
              className={`repo-menu-item${a.danger ? ' danger' : ''}`}
              onClick={() => { setOpen(false); a.onClick() }}
              disabled={a.disabled}
              role="menuitem"
            >
              {a.icon && <span className="repo-menu-icon">{a.icon}</span>}
              <span>{a.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
