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
  panes: PaneNode[]                          // ya filtrados + ordenados (máx. 12)
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

// El Hub como workspace: mismas terminales de todos los workspaces, renderizadas
// con el motor de layout normal (1 = pantalla completa, N = tileadas, resize y
// reorder), con una barra de filtros delgada arriba. Los filtros son solo
// transversales (Todas / Activas / Pineadas): filtrar por-workspace sería lo
// mismo que ir a esa pestaña, así que no existe.
export default function HubWorkspace({
  panes, layoutId, splitRatios, filter, counts, hiddenCount,
  onFilter, onResize, onDragStart, onDragEnd, draggingId, sensors, renderPane,
}: Props) {
  return (
    <div className="hub-workspace">
      <div className="hub-toolbar">
        <button className={`hub-chip${filter === 'all' ? ' on' : ''}`} onClick={() => onFilter('all')}>
          Todas <span className="hub-chip-n">{counts.all}</span>
        </button>
        <button className={`hub-chip${filter === 'active' ? ' on' : ''}`} onClick={() => onFilter('active')}>
          Activas <span className="hub-chip-n">{counts.active}</span>
        </button>
        <button className={`hub-chip${filter === 'pinned' ? ' on' : ''}`} onClick={() => onFilter('pinned')}>
          Pineadas <span className="hub-chip-n">{counts.pinned}</span>
        </button>
        {hiddenCount > 0 && <span className="hub-hidden-note">+{hiddenCount} sin mostrar (máx. 12)</span>}
      </div>

      {panes.length === 0 ? (
        <div className="hub-empty">No hay terminales para este filtro</div>
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
