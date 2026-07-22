import { useState, useRef, useEffect, memo } from 'react'
import { WorkspaceTab } from '../types'
import { basename } from '../lib/path'
import { DndContext, DragEndEvent, PointerSensor, useSensor, useSensors, closestCenter } from '@dnd-kit/core'
import { SortableContext, horizontalListSortingStrategy, useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'

interface Props {
  tabs: WorkspaceTab[]
  activeTabId: string
  onTabSelect: (id: string) => void
  onTabClose: (id: string) => void
  onTabNew: () => void
  onTabRename: (id: string, name: string) => void
  onTabReorder: (fromId: string, toId: string) => void
  onTabColorChange?: (tabId: string, color: string) => void
  isWin: boolean
  tabActivity?: Map<string, Set<string>>
  rightSlot?: React.ReactNode
}

interface SortableTabProps {
  tab: WorkspaceTab
  activeTabId: string
  onTabSelect: (id: string) => void
  onTabClose: (id: string) => void
  onTabRename: (id: string, name: string) => void
  renamingId: string | null
  renameValue: string
  setRenamingId: (id: string | null) => void
  setRenameValue: (v: string) => void
  hasActivity: boolean
  onTabColorChange?: (tabId: string, color: string) => void
}

const SortableTab = memo(function SortableTab({
  tab, activeTabId, onTabSelect, onTabClose, onTabRename, renamingId, renameValue,
  setRenamingId, setRenameValue, hasActivity, onTabColorChange
}: SortableTabProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: tab.id })
  const renameInputRef = useRef<HTMLInputElement>(null)
  const colorInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (renamingId === tab.id && renameInputRef.current) {
      renameInputRef.current.focus()
      renameInputRef.current.select()
    }
  }, [renamingId, tab.id])

  const startRename = () => {
    setRenamingId(tab.id)
    setRenameValue(tab.name)
  }

  const commitRename = () => {
    if (renamingId === tab.id && renameValue.trim()) {
      onTabRename(tab.id, renameValue.trim())
    }
    setRenamingId(null)
  }

  const tabAccent = tab.accentColor ?? '#0066FF'

  // Only apply transition while actively dragging — otherwise React re-renders
  // (from upstream metrics polling) re-attach the style and trigger CSS
  // transitions on transform: none → none, which paints as a flicker.
  const style: React.CSSProperties = {
    transform: CSS.Translate.toString(transform),
    transition: isDragging ? transition : undefined,
    opacity: isDragging ? 0.4 : 1,
    '--tab-accent': tabAccent,
  } as React.CSSProperties & { '--tab-accent': string }

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`tab${tab.id === activeTabId ? ' active' : ''}`}
      onClick={() => onTabSelect(tab.id)}
    >
      {hasActivity && <span className="tab-activity-dot" />}
      {renamingId === tab.id ? (
        <input
          ref={renameInputRef}
          className="tab-rename-input"
          value={renameValue}
          onChange={(e) => setRenameValue(e.target.value)}
          onBlur={commitRename}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commitRename()
            if (e.key === 'Escape') setRenamingId(null)
            e.stopPropagation()
          }}
          onClick={(e) => e.stopPropagation()}
        />
      ) : (
        <span
          className="tab-name"
          onDoubleClick={(e) => { e.stopPropagation(); startRename() }}
          {...listeners}
          {...attributes}
          style={{ cursor: 'grab' }}
        >
          {tab.isHub && (
            <span className="tab-hub-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                <rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" />
                <rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" />
              </svg>
            </span>
          )}
          {tab.name}
          {tab.repoPath && basename(tab.repoPath) !== tab.name && (
            <span className="tab-repo-badge" title={tab.repoPath}>{basename(tab.repoPath)}</span>
          )}
        </span>
      )}
      <button
        className="tab-color-btn"
        onClick={(e) => { e.stopPropagation(); colorInputRef.current?.click() }}
        title="Change tab color"
      >
        <span className="tab-color-dot" style={{ background: tab.accentColor ?? 'var(--raven-blue)' }} />
      </button>
      <input
        ref={colorInputRef}
        type="color"
        className="tab-color-picker-hidden"
        value={tab.accentColor ?? '#0066FF'}
        onChange={(e) => {
          e.stopPropagation()
          onTabColorChange?.(tab.id, e.target.value)
        }}
      />
      <button
        className="tab-close"
        onClick={(e) => { e.stopPropagation(); onTabClose(tab.id) }}
        title="Close workspace"
      >
        ✕
      </button>
    </div>
  )
})

export default function TabBar({
  tabs, activeTabId, onTabSelect, onTabClose, onTabNew, onTabRename, onTabReorder, onTabColorChange, isWin, tabActivity, rightSlot
}: Props) {
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } })
  )

  const handleDragEnd = (e: DragEndEvent) => {
    const { active, over } = e
    if (!over || active.id === over.id) return
    onTabReorder(String(active.id), String(over.id))
  }

  return (
    <div className={`tabbar${isWin ? ' tabbar-win' : ''}`}>
      {!isWin && <div className="tabbar-traffic-lights" />}

      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={handleDragEnd}
      >
        <SortableContext items={tabs.map(t => t.id)} strategy={horizontalListSortingStrategy}>
          <div className="tabbar-tabs">
            {tabs.map((tab) => {
              const activity = tabActivity?.get(tab.id)
              const hasActivity = activity && activity.size > 0
              return (
                <SortableTab
                  key={tab.id}
                  tab={tab}
                  activeTabId={activeTabId}
                  onTabSelect={onTabSelect}
                  onTabClose={onTabClose}
                  onTabRename={onTabRename}
                  renamingId={renamingId}
                  renameValue={renameValue}
                  setRenamingId={setRenamingId}
                  setRenameValue={setRenameValue}
                  hasActivity={!!hasActivity}
                  onTabColorChange={onTabColorChange}
                />
              )
            })}
          </div>
        </SortableContext>
      </DndContext>

      <button className="tab-new" onClick={onTabNew} title="New workspace">
        +
      </button>

      <div className="tabbar-drag" />
      {rightSlot}
    </div>
  )
}
