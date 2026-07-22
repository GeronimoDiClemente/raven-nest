import type { ReactNode } from 'react'
import {
  DndContext, DragOverlay, closestCenter,
  type DragStartEvent, type DragEndEvent,
  type SensorDescriptor, type SensorOptions,
} from '@dnd-kit/core'
import { SortableContext, rectSortingStrategy } from '@dnd-kit/sortable'
import { PaneLayoutEngine } from './PaneLayoutEngine'
import type { PaneNode, LayoutId } from '../types'
import type { HubFilter } from './HubGrid'

interface Props {
  panes: PaneNode[]                          // already filtered + sorted (max 12)
  layoutId: LayoutId
  splitRatios?: Record<string, number[]>
  filter: HubFilter
  counts: { all: number; active: number; pinned: number }
  hiddenCount: number
  onFilter: (f: HubFilter) => void
  onResize: (path: string, sizes: number[]) => void
  onDragStart: (e: DragStartEvent) => void
  onDragEnd: (e: DragEndEvent) => void
  draggingId: string | null
  sensors: SensorDescriptor<SensorOptions>[]
  renderPane: (pane: PaneNode) => ReactNode
}

// The Hub as a workspace: the same terminals from every workspace, rendered
// with the normal layout engine (1 = fullscreen, N = tiled, resize and
// reorder), with a thin filter bar on top. The filters are only cross-cutting
// (All / Active / Pinned): filtering per-workspace would be the same as going
// to that tab, so it doesn't exist.
export default function HubWorkspace({
  panes, layoutId, splitRatios, filter, counts, hiddenCount,
  onFilter, onResize, onDragStart, onDragEnd, draggingId, sensors, renderPane,
}: Props) {
  return (
    <div className="hub-workspace">
      <div className="hub-toolbar">
        <button className={`hub-chip${filter === 'all' ? ' on' : ''}`} onClick={() => onFilter('all')}>
          All <span className="hub-chip-n">{counts.all}</span>
        </button>
        <button className={`hub-chip${filter === 'active' ? ' on' : ''}`} onClick={() => onFilter('active')}>
          Active <span className="hub-chip-n">{counts.active}</span>
        </button>
        <button className={`hub-chip${filter === 'pinned' ? ' on' : ''}`} onClick={() => onFilter('pinned')}>
          Pinned <span className="hub-chip-n">{counts.pinned}</span>
        </button>
        {hiddenCount > 0 && <span className="hub-hidden-note">+{hiddenCount} hidden (max 12)</span>}
      </div>

      {panes.length === 0 ? (
        <div className="hub-empty">No terminals for this filter</div>
      ) : (
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
      )}
    </div>
  )
}
