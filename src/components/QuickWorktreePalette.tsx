import { useEffect, useRef, useState } from 'react'
import type { WorktreeMeta } from '../types'

interface Props {
  open: boolean
  repoPath: string
  onClose: () => void
  onCreated: (meta: WorktreeMeta) => void
}

export function QuickWorktreePalette({ open, repoPath, onClose, onCreated }: Props) {
  const [branch, setBranch] = useState('')
  const [creating, setCreating] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (open) inputRef.current?.focus()
  }, [open])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  const handleCreate = async () => {
    if (!branch.trim()) return
    setCreating(true)
    try {
      const meta = await window.worktree.create({
        repoPath,
        branch: branch.trim(),
      })
      onCreated(meta)
      setBranch('')
      onClose()
    } catch (err) {
      console.error('worktree quick-create failed', err)
    } finally {
      setCreating(false)
    }
  }

  return (
    <div className="dialog-overlay" onClick={creating ? undefined : onClose}>
      <div className="quick-worktree" onClick={(e) => e.stopPropagation()}>
        <div className="qw-label">New worktree from main →</div>
        <input
          ref={inputRef}
          className="qw-input"
          value={branch}
          onChange={(e) => setBranch(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') void handleCreate() }}
          placeholder="branch name (e.g. feat/billing)"
          disabled={creating}
        />
        <div className="qw-hint">Enter to create · Esc to cancel</div>
      </div>
    </div>
  )
}
