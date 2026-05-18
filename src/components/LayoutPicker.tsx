import { useState, useRef, useEffect } from 'react'
import { GridLayout } from '../types'
import { useFixedPopover } from '../hooks/useFixedPopover'

// Clamp the picker grid so the user can't choose a layout that exceeds
// MAX_PANES from types.ts (currently 12). 3×4 = 12; 4×4 = 16 would let
// the user request more panes than the layout engine supports.
const MAX_ROWS = 3
const MAX_COLS = 4

interface Props {
  current: GridLayout
  onChange: (layout: GridLayout) => void
}

export default function LayoutPicker({ current, onChange }: Props) {
  const [open, setOpen] = useState(false)
  const [hover, setHover] = useState({ rows: current.rows, cols: current.cols })
  const ref = useRef<HTMLDivElement>(null)
  const popoverRef = useRef<HTMLDivElement>(null)
  const popPos = useFixedPopover(ref, open, popoverRef)

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  function apply(rows: number, cols: number) {
    onChange({ rows, cols })
    setOpen(false)
  }

  return (
    <div className="layout-picker-wrap" ref={ref}>
      <button
        className="titlebar-btn"
        onClick={() => { setHover({ rows: current.rows, cols: current.cols }); setOpen((v) => !v) }}
        title="Change grid layout"
      >
        <GridPreviewIcon rows={current.rows} cols={current.cols} />
        <span style={{ fontSize: 11, marginLeft: 4 }}>{current.rows}×{current.cols}</span>
      </button>

      {open && popPos && (
        <div ref={popoverRef} className="layout-popover" style={{ position: 'fixed', top: popPos.top, left: popPos.left, right: 'auto' }}>
          <p className="layout-popover-label">
            {hover.rows}×{hover.cols} grid
          </p>
          <div
            className="layout-grid"
            onMouseLeave={() => setHover({ rows: current.rows, cols: current.cols })}
          >
            {Array.from({ length: MAX_ROWS }).map((_, r) =>
              Array.from({ length: MAX_COLS }).map((_, c) => {
                const active = r < hover.rows && c < hover.cols
                return (
                  <button
                    key={`${r}-${c}`}
                    className={`layout-cell${active ? ' active' : ''}`}
                    onMouseEnter={() => setHover({ rows: r + 1, cols: c + 1 })}
                    onClick={() => apply(r + 1, c + 1)}
                  />
                )
              })
            )}
          </div>

          {/* Quick presets */}
          <div className="layout-presets">
            {([
              [1,1],[1,2],[2,1],[2,2],[1,3],[3,1],[2,3],[3,2]
            ] as [number,number][]).map(([r,c]) => (
              <button
                key={`${r}x${c}`}
                className={`layout-preset${current.rows === r && current.cols === c ? ' active' : ''}`}
                onClick={() => apply(r, c)}
              >
                {r}×{c}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function GridPreviewIcon({ rows, cols }: { rows: number; cols: number }) {
  const size = 16
  const pad = 1
  const gap = 1
  const cellW = (size - pad * 2 - gap * (cols - 1)) / cols
  const cellH = (size - pad * 2 - gap * (rows - 1)) / rows

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} fill="currentColor">
      {Array.from({ length: rows }).map((_, r) =>
        Array.from({ length: cols }).map((_, c) => (
          <rect
            key={`${r}-${c}`}
            x={pad + c * (cellW + gap)}
            y={pad + r * (cellH + gap)}
            width={cellW}
            height={cellH}
            rx={0.5}
            fillOpacity={0.75}
          />
        ))
      )}
    </svg>
  )
}
