import { useState, useRef, useEffect, ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useFixedPopover } from '../hooks/useFixedPopover'

interface Props {
  icon: ReactNode
  label: string
  title?: string
  badge?: ReactNode
  children: ReactNode
}

/**
 * A nav-item trigger that opens an anchored floating popover to the right of
 * the clicked item (rendered into a portal so the sidebar's overflow can't clip
 * it). The popover body is only mounted while open. Outside-click and Escape
 * close the popover — the docked panel bodies inside disable their own close
 * handlers, so this wrapper owns that behavior.
 */
export default function NavPopover({ icon, label, title, badge, children }: Props) {
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const popoverRef = useRef<HTMLDivElement>(null)
  const pos = useFixedPopover(triggerRef, open, popoverRef)

  useEffect(() => {
    if (!open) return
    const onMouseDown = (e: MouseEvent) => {
      const target = e.target as Node
      if (triggerRef.current?.contains(target)) return
      if (popoverRef.current?.contains(target)) return
      setOpen(false)
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onMouseDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onMouseDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  return (
    <>
      <button
        ref={triggerRef}
        className={`nav-item${open ? ' active' : ''}`}
        onClick={() => setOpen((v) => !v)}
        title={title ?? label}
      >
        {icon}
        <span className="nav-item-label">{label}</span>
        {badge}
      </button>

      {open &&
        pos &&
        createPortal(
          <div
            ref={popoverRef}
            className="nav-popover"
            style={{ position: 'fixed', top: pos.top, left: pos.left }}
          >
            {children}
          </div>,
          document.body,
        )}
    </>
  )
}
