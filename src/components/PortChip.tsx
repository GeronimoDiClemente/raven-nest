import React from 'react'

interface Props {
  port: number
  paneId?: string
  onActivate?: () => void
}

export function PortChip({ port, paneId, onActivate }: Props) {
  const url = `http://localhost:${port}`
  const onClick = (e: React.MouseEvent<HTMLButtonElement>) => {
    if (e.shiftKey) {
      window.electronShell.openExternal(url)
    } else {
      window.dispatchEvent(new CustomEvent('nest:pty-url', {
        detail: { paneId: paneId ?? 'port-chip', url }
      }))
    }
    onActivate?.()
  }
  return (
    <button
      type="button"
      className="port-chip"
      onClick={onClick}
      title={`Open localhost:${port} as pane (Shift+click for system browser)`}
    >
      :{port} ↗
    </button>
  )
}
