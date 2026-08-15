import type { ReactNode } from 'react'
import {
  DndContext, DragOverlay, closestCenter,
  type DragStartEvent, type DragEndEvent,
  type SensorDescriptor, type SensorOptions,
} from '@dnd-kit/core'
import { SortableContext, rectSortingStrategy } from '@dnd-kit/sortable'
import { PaneLayoutEngine } from './PaneLayoutEngine'
import type { PaneNode, LayoutId } from '../types'

interface Props {
  panes: PaneNode[]                          // the curated subset (max 12), in order
  layoutId: LayoutId
  splitRatios?: Record<string, number[]>
  hiddenCount: number                        // curated beyond the 12-pane cap
  onResize: (path: string, sizes: number[]) => void
  onDragStart: (e: DragStartEvent) => void
  onDragEnd: (e: DragEndEvent) => void
  draggingId: string | null
  sensors: SensorDescriptor<SensorOptions>[]
  renderPane: (pane: PaneNode) => ReactNode
}

// The Hub renders EXACTLY like a normal workspace — same layout engine, same real
// TerminalPane (zoom / notes / PR / resize / close) — the only difference is that
// its panes are a curated subset the user pulled from across every workspace (the
// terminals they use most). Curation happens in the sidebar; this is just the
// workspace view of the chosen set.
export default function HubWorkspace({
  panes, layoutId, splitRatios, hiddenCount,
  onResize, onDragStart, onDragEnd, draggingId, sensors, renderPane,
}: Props) {
  if (panes.length === 0) {
    return (
      <div className="hub-workspace hub-workspace--empty">
        <div className="hub-empty">
          <svg className="hub-empty-icon" width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4">
            <rect x="3" y="4" width="18" height="16" rx="2" />
            <path d="M7 9l3 3-3 3M13 15h4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <div className="hub-empty-title">Your Hub is empty</div>
          <div className="hub-empty-sub">Pin the terminals you use most from the sidebar to gather them here.</div>
        </div>
      </div>
    )
  }

  return (
    <div className="hub-workspace">
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
      >
        <SortableContext items={panes.map(p => p.id)} strategy={rectSortingStrategy}>
          <PaneLayoutEngine
            layoutId={layoutId}
            panes={panes}
            splitRatios={splitRatios}
            onResize={onResize}
            renderPane={renderPane}
            renderEmpty={() => <div className="hub-empty-slot" />}
          />
        </SortableContext>
        <DragOverlay>
          {draggingId ? <div className="drag-overlay-pane hub-drag-overlay" /> : null}
        </DragOverlay>
      </DndContext>
      {hiddenCount > 0 && (
        <div className="hub-cap-note">+{hiddenCount} more pinned — the Hub shows up to 12 at a time</div>
      )}
    </div>
  )
}
