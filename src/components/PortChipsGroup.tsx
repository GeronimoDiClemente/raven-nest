import { useState, useRef, useEffect } from 'react'
import { PortChip } from './PortChip'

interface Props {
  ports: number[]
  paneId?: string
}

export function PortChipsGroup({ ports, paneId }: Props) {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  if (ports.length === 0) return null
  if (ports.length === 1) return <PortChip port={ports[0]!} paneId={paneId} />

  return (
    <div className="port-chips-group" ref={wrapRef}>
      <button
        type="button"
        className="port-chip port-chip-collapsed"
        onClick={() => setOpen(v => !v)}
        title={`${ports.length} ports detected — click to expand`}
      >
        {ports.length} ports ▾
      </button>
      {open && (
        <div className="port-chips-popover">
          {ports.map(port => (
            <PortChip key={port} port={port} paneId={paneId} onActivate={() => setOpen(false)} />
          ))}
        </div>
      )}
    </div>
  )
}
