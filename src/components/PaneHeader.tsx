import { useState, useRef, useEffect } from 'react'
import { PaneNode, AI_CONFIG, COLOR_PALETTE, AIType } from '../types'
import { ClaudeLogo, GeminiLogo, CodexLogo, CopilotLogo, OpenCodeLogo } from './AILogos'
import ConfirmDialog from './ConfirmDialog'

function AILogo({ aiType, color, size = 14 }: { aiType: AIType; color: string; size?: number }) {
  switch (aiType) {
    case 'claude':   return <ClaudeLogo size={size} />
    case 'gemini':   return <GeminiLogo size={size} />
    case 'codex':    return <CodexLogo size={size} color={color} />
    case 'copilot':  return <CopilotLogo size={size} />
    case 'opencode': return <OpenCodeLogo size={size} color={color} />
    default:         return null
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DragHandleProps = Record<string, any>

interface Props {
  pane: PaneNode
  zoomed: boolean
  onZoom: () => void
  onClose: () => void
  onColorChange: (color: string) => void
  onNoteChange: (note: string) => void
  dragHandleProps?: DragHandleProps
  processEnded?: boolean
  isBusy?: boolean
  onRestart?: () => void
  onSaveConversation?: () => Promise<void>
  onCopyLastResponse?: () => void
  showBlocks?: boolean
  blockCount?: number
  onToggleBlocks?: () => void
  onShare?: () => void
  isSharing?: boolean
  repoPathDiverged?: boolean
  onSyncCwd?: () => void
}

export default function PaneHeader({ pane, zoomed, onZoom, onClose, onColorChange, onNoteChange, dragHandleProps, processEnded, isBusy, onRestart, onSaveConversation, onCopyLastResponse, showBlocks, blockCount, onToggleBlocks, onShare, isSharing, repoPathDiverged, onSyncCwd }: Props) {
  const config = AI_CONFIG[pane.aiType]
  const displayLabel = pane.customLabel ?? config.label
  const displayColor = pane.customColor ?? config.color
  const [showPicker, setShowPicker] = useState(false)
  const [confirmingClose, setConfirmingClose] = useState(false)
  const [saved, setSaved] = useState(false)
  const [copied, setCopied] = useState(false)
  const [editingNote, setEditingNote] = useState(false)
  const [noteValue, setNoteValue] = useState(pane.note ?? '')
  const [pid, setPid] = useState<number | undefined>()
  const noteInputRef = useRef<HTMLInputElement>(null)
  const pickerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!showPicker) return
    const handler = (e: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        setShowPicker(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [showPicker])

  useEffect(() => {
    if (editingNote) noteInputRef.current?.focus()
  }, [editingNote])

  useEffect(() => {
    if (!isBusy || processEnded) return
    window.pty.getPid(pane.id).then((p) => setPid(p))
  }, [isBusy, processEnded, pane.id])

  const handleSave = async () => {
    await onSaveConversation?.()
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  const handleCopy = () => {
    onCopyLastResponse?.()
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const commitNote = () => {
    setEditingNote(false)
    onNoteChange(noteValue)
  }

  return (
    <div
      className="pane-header"
      style={{ borderBottom: `1px solid ${pane.borderColor}44` }}
    >
      {dragHandleProps && (
        <div className="pane-drag-handle" {...dragHandleProps} />
      )}
      <div className="pane-header-left">
        <div className="pane-color-btn-wrap" ref={pickerRef}>
          <button
            className="pane-color-btn"
            style={{ background: pane.borderColor }}
            onClick={() => setShowPicker((v) => !v)}
            title="Change border color"
          />
          {showPicker && (
            <div className="pane-color-popover">
              {COLOR_PALETTE.map((c) => (
                <button
                  key={c}
                  className={`color-swatch${pane.borderColor === c ? ' selected' : ''}`}
                  style={{ background: c }}
                  onClick={() => { onColorChange(c); setShowPicker(false) }}
                />
              ))}
            </div>
          )}
        </div>

        <span className="pane-ai-label" style={{ color: displayColor }} title={pane.accountName ? `${displayLabel} · ${pane.accountName}` : displayLabel}>
          {(pane.aiType === 'terminal' || pane.aiType === 'custom')
            ? displayLabel
            : <AILogo aiType={pane.aiType} color={displayColor} size={14} />}
        </span>

        {isBusy && pid !== undefined && (
          <span className="pane-pid-chip">PID {pid}</span>
        )}

        {editingNote ? (
          <input
            ref={noteInputRef}
            className="pane-note-input"
            value={noteValue}
            onChange={(e) => setNoteValue(e.target.value)}
            onBlur={commitNote}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitNote()
              if (e.key === 'Escape') { setNoteValue(pane.note ?? ''); setEditingNote(false) }
            }}
            placeholder="Add note…"
            maxLength={60}
          />
        ) : (
          <span
            className={`pane-note${noteValue ? ' has-note' : ''}`}
            onClick={() => setEditingNote(true)}
            title="Click to edit note"
          >
            {noteValue || '+ note'}
          </span>
        )}

        {!editingNote && processEnded && (
          <span className="pane-ended-badge">ended</span>
        )}

        {repoPathDiverged && onSyncCwd && (
          <button
            className="pane-sync-cwd-btn"
            onClick={onSyncCwd}
            title={`Live cwd is ${pane.runningRepoPath ?? 'unset'} but the active repo is ${pane.repoPath ?? 'unset'}. Restart the pane to apply.`}
          >
            <svg width="10" height="10" viewBox="0 0 12 12" fill="none">
              <path d="M10 6A4 4 0 1 1 6 2a4 4 0 0 1 2.83 1.17L10 4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
              <path d="M10 1v3H7" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            Sync cwd
          </button>
        )}
      </div>

      {onToggleBlocks && (
        <button
          className={`pane-blocks-btn${showBlocks ? ' active' : ''}`}
          onClick={onToggleBlocks}
          title={showBlocks ? 'Show terminal' : 'Show response blocks'}
        >
          <svg width="11" height="11" viewBox="0 0 12 12" fill="none">
            <rect x="1" y="1" width="10" height="3" rx="1" stroke="currentColor" strokeWidth="1.3"/>
            <rect x="1" y="5" width="10" height="3" rx="1" stroke="currentColor" strokeWidth="1.3"/>
            <rect x="1" y="9" width="10" height="2" rx="1" stroke="currentColor" strokeWidth="1.3"/>
          </svg>
          {blockCount !== undefined && blockCount > 0 && (
            <span className="pane-blocks-count">{blockCount}</span>
          )}
        </button>
      )}

      {onCopyLastResponse && (
        <button className="pane-copy-btn" onClick={handleCopy} title="Copy last response">
          {copied ? (
            <svg width="11" height="11" viewBox="0 0 12 12" fill="none">
              <path d="M2 6l3 3 5-5" stroke="var(--color-success)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          ) : (
            <svg width="11" height="11" viewBox="0 0 12 12" fill="none">
              <rect x="4" y="1" width="7" height="8" rx="1" stroke="currentColor" strokeWidth="1.3"/>
              <path d="M1 4v7h7" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          )}
        </button>
      )}

      {onSaveConversation && (
        <button className="pane-save-btn" onClick={handleSave} title="Save conversation to history">
          {saved ? (
            <svg width="11" height="11" viewBox="0 0 12 12" fill="none">
              <path d="M2 6l3 3 5-5" stroke="var(--color-success)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          ) : (
            <svg width="11" height="11" viewBox="0 0 12 12" fill="none">
              <path d="M6 1v7M3 5l3 3 3-3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
              <path d="M1 10h10" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
            </svg>
          )}
        </button>
      )}

      {processEnded && onRestart && (
        <button className="pane-restart-btn" onClick={onRestart} title="Restart process">
          <svg width="11" height="11" viewBox="0 0 12 12" fill="none">
            <path d="M10 6A4 4 0 1 1 6 2a4 4 0 0 1 2.83 1.17L10 4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
            <path d="M10 1v3H7" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          Restart
        </button>
      )}

      {onShare && (
        <button
          className={`pane-share-btn${isSharing ? ' active' : ''}`}
          onClick={onShare}
          title={isSharing ? 'Sharing — click to manage' : 'Share terminal'}
        >
          <svg width="11" height="11" viewBox="0 0 12 12" fill="none">
            <circle cx="10" cy="2" r="1.5" stroke="currentColor" strokeWidth="1.3"/>
            <circle cx="2" cy="6" r="1.5" stroke="currentColor" strokeWidth="1.3"/>
            <circle cx="10" cy="10" r="1.5" stroke="currentColor" strokeWidth="1.3"/>
            <path d="M3.5 5.2L8.5 2.8M3.5 6.8L8.5 9.2" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
          </svg>
        </button>
      )}

      <button className="pane-zoom-btn" onClick={onZoom} title={zoomed ? 'Restore (Esc)' : 'Zoom'}>
        {zoomed ? (
          <svg width="11" height="11" viewBox="0 0 12 12" fill="none">
            <path d="M2 5h3V2M10 7H7v3M7 2v3h3M2 7h3v3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        ) : (
          <svg width="11" height="11" viewBox="0 0 12 12" fill="none">
            <path d="M1 4V1h3M8 1h3v3M11 8v3H8M4 11H1V8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        )}
      </button>
      <button className="pane-close-btn" onClick={() => setConfirmingClose(true)} title="Close pane">
        ×
      </button>

      {confirmingClose && (
        <ConfirmDialog
          title="Close pane?"
          message="The process running in this pane will be terminated."
          confirmLabel="Close"
          confirmDanger
          onConfirm={() => { setConfirmingClose(false); onClose() }}
          onCancel={() => setConfirmingClose(false)}
        />
      )}
    </div>
  )
}
