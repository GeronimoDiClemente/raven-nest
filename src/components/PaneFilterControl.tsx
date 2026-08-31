import { useEffect, useRef, useState } from 'react'
import PaneFilterChips, { GROUP_LABELS } from './PaneFilterChips'
import { groupCounts, type PaneFilter } from '../lib/pane-filter'
import { useFixedPopover } from '../hooks/useFixedPopover'
import type { PaneNode } from '../types'

interface Props {
  panes: readonly PaneNode[]
  filter: PaneFilter
  onChange: (filter: PaneFilter) => void
  expanded: boolean
}

// Trigger del filtro de panes en la columna del sidebar: embudo + popover
// con los chips. Vive en la columna de íconos (visible aun con el sidebar
// colapsado) porque en la tabbar competía con las tabs de workspace. Con
// filtro activo el trigger queda resaltado y muestra el grupo — un filtro
// activo invisible parece "perdí mis panes". Popover position:fixed por el
// overflow del sidebar (mismo patrón que el layout selector).
export default function PaneFilterControl({ panes, filter, onChange, expanded }: Props) {
  const triggerRef = useRef<HTMLButtonElement>(null)
  const popoverRef = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const pos = useFixedPopover(triggerRef, open, popoverRef)

  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => {
      const t = e.target as Node
      if (popoverRef.current?.contains(t) || triggerRef.current?.contains(t)) return
      setOpen(false)
    }
    // Escape cierra, como todos los popovers hermanos del sidebar.
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', close)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  if (groupCounts(panes).length < 2) return null
  const active = filter !== 'all'

  return (
    <>
      <button
        ref={triggerRef}
        className={`sidebar-item pane-filter-trigger${active ? ' active' : ''}`}
        title="Filter panes"
        onClick={() => setOpen(o => !o)}
      >
        <span className="sidebar-icon">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path d="M2 3h12L9.5 8.5V13l-3-1.5V8.5L2 3z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
          </svg>
        </span>
        {expanded && <span className="sidebar-label">Filter panes</span>}
        {filter !== 'all' && <span className="pane-filter-badge">{GROUP_LABELS[filter]}</span>}
      </button>
      {open && pos && (
        <div
          ref={popoverRef}
          className="pane-filter-popover"
          style={{ position: 'fixed', top: pos.top, left: pos.left, zIndex: 200 }}
        >
          <PaneFilterChips
            panes={panes}
            filter={filter}
            onChange={(f) => { onChange(f); setOpen(false) }}
          />
        </div>
      )}
    </>
  )
}
