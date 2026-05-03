import { useEffect, useState } from 'react'
import type { DetectedIDE } from '../types'

interface Props {
  worktreePath: string
  position: { x: number; y: number }
  onClose: () => void
}

export function IDEPickerMenu({ worktreePath, position, onClose }: Props) {
  const [ides, setIdes] = useState<DetectedIDE[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    void window.ide.detect().then((list) => {
      if (!cancelled) { setIdes(list); setLoading(false) }
    }).catch(() => { if (!cancelled) setLoading(false) })
    const close = () => onClose()
    window.addEventListener('click', close)
    return () => { cancelled = true; window.removeEventListener('click', close) }
  }, [onClose])

  const handleOpen = async (bin: string) => {
    try { await window.ide.open(bin, worktreePath) }
    catch (err) { alert(`Open IDE failed: ${err instanceof Error ? err.message : String(err)}`) }
    onClose()
  }

  const handleRedetect = async () => {
    setLoading(true)
    try {
      await window.ide.clearCache()
      const list = await window.ide.detect(true)
      setIdes(list)
    } finally { setLoading(false) }
  }

  return (
    <div
      className="ide-picker-menu"
      style={{ top: position.y, left: position.x }}
      onClick={(e) => e.stopPropagation()}
    >
      {loading && <div className="ide-picker-empty">Detecting…</div>}
      {!loading && ides.length === 0 && (
        <div className="ide-picker-empty">No IDEs found in PATH.</div>
      )}
      {!loading && ides.map((ide) => (
        <button key={ide.id + ide.binPath} className="ide-picker-item" onClick={() => handleOpen(ide.binPath)}>
          <span className="ide-picker-name">{ide.name}</span>
          <span className="ide-picker-path">{ide.binPath}</span>
        </button>
      ))}
      <div className="ide-picker-divider" />
      <button className="ide-picker-item ide-picker-redetect" onClick={handleRedetect}>Re-detect</button>
    </div>
  )
}
