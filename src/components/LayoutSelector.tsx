import { useEffect, useRef, useState } from 'react'
import type { LayoutId } from '../types'
import { PRESETS } from '../layout/presets'
import { alternativesFor } from '../layout/select'

interface Props {
  current: LayoutId
  paneCount: number
  onChange: (id: LayoutId) => void
}

export function LayoutSelector({ current, paneCount, onChange }: Props) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const options = alternativesFor(paneCount)

  useEffect(() => {
    if (!open) return
    const onClick = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  // Cmd/Ctrl + L toggle
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'l') {
        e.preventDefault()
        setOpen(v => !v)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const currentPreset = PRESETS[current]

  return (
    <div className="layout-selector" ref={ref}>
      <button
        className="layout-selector-btn"
        onClick={() => setOpen(v => !v)}
        title={`Layout: ${currentPreset.label} (Ctrl+L)`}
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
          <path d={currentPreset.icon} />
        </svg>
      </button>
      {open && options.length > 0 && (
        <div className="layout-selector-popover">
          <div className="layout-selector-title">Layout — {paneCount} pane{paneCount === 1 ? '' : 's'}</div>
          <div className="layout-selector-grid">
            {options.map(id => {
              const preset = PRESETS[id]
              const active = id === current
              return (
                <button
                  key={id}
                  className={`layout-selector-option${active ? ' active' : ''}`}
                  onClick={() => { onChange(id); setOpen(false) }}
                  title={preset.label}
                >
                  <svg width="36" height="36" viewBox="0 0 16 16" fill="currentColor">
                    <path d={preset.icon} />
                  </svg>
                  <span>{preset.label}</span>
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
