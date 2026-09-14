import { useState, useRef, useEffect } from 'react'
import { PaneNode, AI_CONFIG, COLOR_PALETTE, AIType } from '../types'
import { indicesDeIdentidad, NOMBRE_ANSI, colorDeTema, type TemaDeTerminal } from '../lib/terminal-themes'
import { ETIQUETA_DE_ESTADO, DETALLE_DE_ESTADO, ESTADOS_VISIBLES, type EstadoDePane } from '../lib/pane-state'
import { AILogo } from './AILogos'
import ConfirmDialog from './ConfirmDialog'
import { PortChipsGroup } from './PortChipsGroup'
import {
  ArrowRight, Rows3, Copy, Download, Share2, Minimize2, Maximize2, Check, RotateCw,
} from 'lucide-react'
import { ICON_SIZE } from '../lib/icons'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DragHandleProps = Record<string, any>

interface Props {
  pane: PaneNode
  /**
   * El tema de terminal activo. El selector de color ofrece SU paleta, no una rueda fija.
   * Opcional para los callers y tests que montan el header solo.
   */
  temaDeTerminal?: TemaDeTerminal
  /** En qué estado está el pane. Ver `lib/pane-state.ts`. */
  estado?: EstadoDePane
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
  ports?: number[]
  /** When true, this pane's worktree is mid worker-pipeline and a next step
   *  exists — show "Hand off →" to advance to it. */
  hasNextStep?: boolean
  onHandoff?: () => void
  onRename?: (label: string) => void  // rename the pane (sets customLabel; '' clears it back to the default)
}

export default function PaneHeader({ pane, temaDeTerminal, estado = 'idle', zoomed, onZoom, onClose, onColorChange, onNoteChange, dragHandleProps, processEnded, isBusy, onRestart, onSaveConversation, onCopyLastResponse, showBlocks, blockCount, onToggleBlocks, onShare, isSharing, repoPathDiverged, onSyncCwd, hasNextStep, onHandoff, ports = [], onRename }: Props) {
  const config = AI_CONFIG[pane.aiType]
  const displayLabel = pane.customLabel ?? config.label
  const displayColor = pane.customColor ?? config.color
  const [showPicker, setShowPicker] = useState(false)
  const [confirmingClose, setConfirmingClose] = useState(false)
  const [saved, setSaved] = useState(false)
  const [copied, setCopied] = useState(false)
  const [editingNote, setEditingNote] = useState(false)
  const [noteValue, setNoteValue] = useState(pane.note ?? '')
  const noteInputRef = useRef<HTMLInputElement>(null)
  const pickerRef = useRef<HTMLDivElement>(null)
  const [editingLabel, setEditingLabel] = useState(false)
  const [labelValue, setLabelValue] = useState(pane.customLabel ?? '')
  const labelInputRef = useRef<HTMLInputElement>(null)

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
    if (editingLabel) { labelInputRef.current?.focus(); labelInputRef.current?.select() }
  }, [editingLabel])

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

  const commitLabel = () => {
    setEditingLabel(false)
    onRename?.(labelValue.trim())
  }

  return (
    <div className="pane-header">
      {dragHandleProps && (
        <div className="pane-drag-handle" {...dragHandleProps} />
      )}
      <div className="pane-header-left">
        <div className="pane-color-btn-wrap" ref={pickerRef}>
          <button
            className={`pane-color-btn${pane.borderColor === 'transparent' ? ' off' : ''}`}
            style={pane.borderColor === 'transparent' ? undefined : { background: pane.borderColor }}
            onClick={() => setShowPicker((v) => !v)}
            title={pane.borderColor === 'transparent' ? 'Border off' : 'Change border color'}
          />
          {showPicker && (
            <div className="pane-color-popover">
              <div className="pane-color-grid">
              {/* Los colores salen de la PALETA DEL TEMA, no de una rueda fija.
                  
                  Un hex suelto ata el color al momento en que se eligió: alguien elige un
                  azul eléctrico, después importa Gruvbox —una paleta tierra— y ese azul
                  queda encima desentonando, porque no pertenece a ninguna parte. Guardando
                  el índice, el pane sigue siendo "el rojo" pero es el rojo DE TU TEMA, y al
                  cambiar de tema se reasigna solo y sigue armonizando.
                  
                  Sin tema (tests, callers viejos) cae a la paleta fija de siempre. */}
              {temaDeTerminal
                ? indicesDeIdentidad(temaDeTerminal).map((i) => {
                    const valor = colorDeTema(i)
                    return (
                      <button
                        key={valor}
                        className={`color-swatch${pane.borderColor === valor ? ' selected' : ''}`}
                        style={{ background: temaDeTerminal.ansi[i] }}
                        title={NOMBRE_ANSI[i]}
                        onClick={() => { onColorChange(valor); setShowPicker(false) }}
                      />
                    )
                  })
                : COLOR_PALETTE.map((c) => (
                    <button
                      key={c}
                      className={`color-swatch${pane.borderColor === c ? ' selected' : ''}`}
                      style={{ background: c }}
                      onClick={() => { onColorChange(c); setShowPicker(false) }}
                    />
                  ))}
              </div>
              {/* Apagar el borde sale de la grilla y pasa a ser una acción con nombre.
                  
                  Era una ✕ redonda ocupando el primer casillero, lo que dejaba 13 elementos
                  en una grilla de 6 columnas: 6, 6 y uno solo colgando abajo. Y con los doce
                  colores del tema —seis tonos y sus brillantes— ese corte partía los pares al
                  medio, así que lo que se leía era una lista desordenada con colores
                  repetidos en vez de dos filas de seis. */}
              <button
                className={`pane-color-off${pane.borderColor === 'transparent' ? ' selected' : ''}`}
                onClick={() => { onColorChange('transparent'); setShowPicker(false) }}
              >
                No border
              </button>
            </div>
          )}
        </div>

        {editingLabel && onRename ? (
          <input
            ref={labelInputRef}
            className="pane-label-input"
            value={labelValue}
            onChange={(e) => setLabelValue(e.target.value)}
            onBlur={commitLabel}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitLabel()
              if (e.key === 'Escape') { setLabelValue(pane.customLabel ?? ''); setEditingLabel(false) }
            }}
            placeholder="Rename pane…"
            maxLength={40}
          />
        ) : (
          <span
            className="pane-ai-label"
            style={{ color: displayColor }}
            title={onRename ? 'Double-click to rename' : (pane.accountName ? `${displayLabel} · ${pane.accountName}` : displayLabel)}
            onDoubleClick={onRename ? () => { setLabelValue(pane.customLabel ?? ''); setEditingLabel(true) } : undefined}
          >
            {(pane.aiType === 'terminal' || pane.aiType === 'custom')
              ? displayLabel
              : <><AILogo aiType={pane.aiType} color={displayColor} size={14} />{pane.customLabel && <span className="pane-custom-label">{pane.customLabel}</span>}</>}
          </span>
        )}

        <PortChipsGroup ports={ports} paneId={pane.id} />

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

        {/* El estado del agente: el dato que faltaba.
            
            El header sabía que hubo salida (un punto que parpadea) y que el proceso murió
            ("ended"). Con ocho panes abiertos eso no contesta la pregunta que importa —cuál
            me necesita— y las tres situaciones se veían iguales.
            
            `ended` gana: un proceso muerto no está trabajando ni esperando nada. */}
        {!editingNote && !processEnded && ESTADOS_VISIBLES.has(estado) && (
          <span
            className={`pane-estado pane-estado--${estado}`}
            title={DETALLE_DE_ESTADO[estado]}
            data-testid="pane-estado"
          >
            {ETIQUETA_DE_ESTADO[estado]}
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
            <RotateCw size={ICON_SIZE.sm} aria-hidden />
            Sync cwd
          </button>
        )}
      </div>

      {hasNextStep && (
        <button
          className="pane-handoff-btn"
          onClick={() => onHandoff?.()}
          title="Hand off to the next step in this worker pipeline"
        >
          Hand off
          <ArrowRight size={ICON_SIZE.sm} aria-hidden />
        </button>
      )}

      {/* Los tres botones que estaban acá —bloques de respuesta, copiar la última respuesta
          y guardar la conversación— salieron de la barra el 2026-09-13. Eran tres iconos
          permanentes en el encabezado de CADA pane para acciones que casi nadie usa, y lo
          que dejan es lugar para las tres que sí: compartir, agrandar y cerrar.
          Los handlers siguen llegando por props y las features no se borraron: lo que se
          quita es su lugar fijo en una barra que se repite en cada terminal abierta. */}

      {processEnded && onRestart && (
        <button className="pane-restart-btn" onClick={onRestart} title="Restart process">
          <RotateCw size={ICON_SIZE.sm} aria-hidden />
          Restart
        </button>
      )}

      {onShare && (
        <button
          className={`pane-share-btn${isSharing ? ' active' : ''}`}
          onClick={onShare}
          title={isSharing ? 'Sharing — click to manage' : 'Share terminal'}
        >
          <Share2 size={ICON_SIZE.sm} aria-hidden />
        </button>
      )}

      <button className="pane-zoom-btn" onClick={onZoom} title={zoomed ? 'Restore (Esc)' : 'Zoom'}>
        {zoomed ? (
          <Minimize2 size={ICON_SIZE.sm} aria-hidden />
        ) : (
          <Maximize2 size={ICON_SIZE.sm} aria-hidden />
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
