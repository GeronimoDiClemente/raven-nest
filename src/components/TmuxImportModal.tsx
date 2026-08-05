import React, { useState } from 'react'
import { createPortal } from 'react-dom'
import { eventToBinding, formatBinding, type Keybindings } from '../lib/keybindings'
import type { TmuxImportPlan } from '../lib/tmux/parse'
import { toImportRows, applyPayload, conflictFor, type ImportRow } from '../lib/tmux/apply'

const ACTION_LABELS: Record<keyof Keybindings, string> = {
  voiceInput: 'Voice input',
  newPane: 'New pane',
  globalSearch: 'Global search',
  commandPalette: 'Command palette',
  nextPane: 'Next pane',
  prevPane: 'Previous pane',
  nextTab: 'Next tab',
  prevTab: 'Previous tab',
  toggleZoom: 'Zoom cell',
  fontSizeUp: 'Font size +',
  fontSizeDown: 'Font size −',
  fontSizeReset: 'Font size reset',
}

const MODIFIER_KEYS = new Set(['Control', 'Shift', 'Alt', 'Meta', 'OS'])

interface Props {
  plan: TmuxImportPlan
  current: Keybindings
  onApply: (patch: Partial<Record<keyof Keybindings, string>>) => void
  onClose: () => void
}

/**
 * Preview + edit for a parsed .tmux.conf before applying. Mappable shortcuts are
 * selectable and their combos editable; conflicts and non-importable lines are
 * surfaced so nothing is applied silently. Options are shown for reference (their
 * apply lands with the terminal-settings work).
 */
export function TmuxImportModal({ plan, current, onApply, onClose }: Props) {
  const [rows, setRows] = useState<ImportRow[]>(() => toImportRows(plan))
  const [recordingIdx, setRecordingIdx] = useState<number | null>(null)

  const unsupportedBinds = plan.keybindings.filter(kb => kb.action === null)
  const selectedCount = rows.filter(r => r.selected).length

  const toggle = (i: number) =>
    setRows(rs => rs.map((r, idx) => (idx === i ? { ...r, selected: !r.selected } : r)))

  const setCombo = (i: number, combo: string) =>
    setRows(rs =>
      rs.map((r, idx) =>
        idx === i ? { ...r, combo, conflict: conflictFor(combo, current) } : r,
      ),
    )

  const handleRecord = (i: number) => (e: React.KeyboardEvent) => {
    if (recordingIdx !== i) return
    e.preventDefault()
    e.stopPropagation()
    if (e.key === 'Escape') { setRecordingIdx(null); return }
    if (MODIFIER_KEYS.has(e.key)) return
    setCombo(i, eventToBinding(e.nativeEvent))
    setRecordingIdx(null)
  }

  const apply = () => {
    onApply(applyPayload(rows))
    onClose()
  }

  return createPortal(
    <>
      <div className="team-modal-overlay" onClick={onClose} />
      <div className="sp-modal tmux-modal">
        <div className="sp-header">
          <span className="sp-title">Import from tmux</span>
          <button className="sp-close" onClick={onClose}>×</button>
        </div>

        <div className="sp-body">
          {plan.source.confPath && <div className="tmux-source">{plan.source.confPath}</div>}

          <div className="sp-section">
            <div className="tmux-section-title">Shortcuts to import</div>
            {rows.length === 0 && (
              <div className="tmux-empty">No importable shortcuts found in this config.</div>
            )}
            {rows.map((row, i) => (
              <div key={i} className={`tmux-row${row.conflict ? ' conflict' : ''}`}>
                <input
                  type="checkbox"
                  className="tmux-check"
                  checked={row.selected}
                  onChange={() => toggle(i)}
                />
                <span className="tmux-src" title={row.source}>{row.source}</span>
                <span className="tmux-arrow">→</span>
                <span className="tmux-action">{ACTION_LABELS[row.action]}</span>
                <kbd
                  className={`sp-kbd${recordingIdx === i ? ' recording' : ''}`}
                  tabIndex={0}
                  onClick={() => setRecordingIdx(i)}
                  onKeyDown={handleRecord(i)}
                  onBlur={() => setRecordingIdx(null)}
                >
                  {recordingIdx === i ? 'Press key…' : formatBinding(row.combo)}
                </kbd>
                {row.conflict && (
                  <span className="tmux-conflict-note">
                    conflicts with {ACTION_LABELS[row.conflict as keyof Keybindings] ?? row.conflict}
                  </span>
                )}
              </div>
            ))}
          </div>

          {plan.options.length > 0 && (
            <div className="sp-section">
              <div className="tmux-section-title">Options detected</div>
              {plan.options.map((o, i) => (
                <div key={i} className="tmux-opt">
                  <span className="tmux-src">{`${o.name} ${o.value}`.trim()}</span>
                  <span className={`tmux-badge ${o.status}`}>
                    {o.status === 'direct'
                      ? `→ ${o.target}`
                      : o.status === 'covered'
                        ? 'already covered'
                        : 'not supported'}
                  </span>
                </div>
              ))}
            </div>
          )}

          {(unsupportedBinds.length > 0 || plan.unsupported.length > 0) && (
            <div className="sp-section tmux-unsupported">
              <div className="tmux-section-title">Not imported</div>
              {unsupportedBinds.map((kb, i) => (
                <div key={`b${i}`} className="tmux-skip">
                  <span className="tmux-src">{kb.source}</span>
                  <span className="tmux-skip-reason">no matching Nest action</span>
                </div>
              ))}
              {plan.unsupported.map((u, i) => (
                <div key={`u${i}`} className="tmux-skip">
                  <span className="tmux-src">{u.line}</span>
                  <span className="tmux-skip-reason">{u.reason}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="tmux-footer">
          <button className="tmux-cancel" onClick={onClose}>Cancel</button>
          <button className="tmux-apply" onClick={apply} disabled={selectedCount === 0}>
            Import {selectedCount} shortcut{selectedCount === 1 ? '' : 's'}
          </button>
        </div>
      </div>
    </>,
    document.body,
  )
}
