import React from 'react'

interface Props {
  port: number
  paneId?: string
}

export function PortChip({ port, paneId }: Props) {
  const url = `http://localhost:${port}`
  const onClick = (e: React.MouseEvent<HTMLButtonElement>) => {
    if (e.shiftKey) {
      window.electronShell.openExternal(url)
      return
    }
    window.dispatchEvent(new CustomEvent('nest:pty-url', {
      detail: { paneId: paneId ?? 'port-chip', url }
    }))
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
