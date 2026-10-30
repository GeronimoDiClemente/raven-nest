import { useState, useRef, useEffect, memo } from 'react'
import { WorkspaceTab } from '../types'
import { basename } from '../lib/path'
import { DndContext, DragEndEvent, PointerSensor, useSensor, useSensors, closestCenter } from '@dnd-kit/core'
import { SortableContext, horizontalListSortingStrategy, useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { X } from 'lucide-react'
import { ICON_SIZE } from '../lib/icons'

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

  const tabAccent = tab.accentColor ?? 'var(--primary)'
  const isActive = tab.id === activeTabId

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
      className={cn(
        // `tab` y `active` quedan: además de layout propio (global.css), el
        // scrollIntoView de TabBar los busca por selector literal (`.tab.active`).
        'tab group border-t border-x rounded-t-md text-fs-sm text-muted-foreground',
        isActive
          ? 'active bg-background border-border text-foreground'
          : 'border-transparent hover:bg-muted hover:text-foreground',
      )}
      onClick={() => onTabSelect(tab.id)}
    >
      {hasActivity && <span className="tab-activity-dot" />}
      {renamingId === tab.id ? (
        <input
          ref={renameInputRef}
          className="tab-rename-input bg-transparent text-foreground text-fs-sm"
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
        value={tab.accentColor ?? 'var(--primary)'}
        onChange={(e) => {
          e.stopPropagation()
          onTabColorChange?.(tab.id, e.target.value)
        }}
      />
      {/* El boton de cerrar es un ICONO del tamaño del glifo y sin padding: con size="sm"
          mide 31px, la mitad del nombre de una pestaña, y junto al punto de color y los
          gaps se lleva tanto ancho como el nombre entero. El area de click sigue siendo
          comoda porque toda la pestaña es clickeable y esto esta en su borde.

          En una INACTIVA no ocupa lugar: va en `absolute` y aparece al pasar el mouse.
          Invisible pero en el flujo se llevaria 24px (18 de caja y 6 de gap) de cada
          pestaña, y con muchos workspaces truncarian todas (e2e/17-pestanas.spec.ts).

          Va a la IZQUIERDA del punto de color, sobre el final del nombre y con el fondo del
          hover para taparlo, como la cruz de una pestaña de navegador. Encima del punto no
          habria forma de cambiarle el color a una inactiva. `right-[30px]` = 12 de
          padding + 12 del botón del punto + 6 de gap.

          Se centra en vertical con `inset-y-0 my-auto` y NO con `-translate-y-1/2`: el
          `active:translate-y-px` del Button reemplaza ese translate al apretar, la cruz salta
          9px, el mouseup cae en la pestaña y el click nunca llega.

          Icono lucide, con el mismo grosor que el resto de la app (src/lib/icons.ts). */}
      <Button
        variant="ghost"
        size="sm"
        className={cn(
          'size-[18px] shrink-0 rounded-sm p-0 text-muted-foreground transition-opacity hover:text-destructive',
          // En las inactivas, oculta hasta el hover de la pestaña (group-hover).
          isActive ? 'opacity-100' : 'absolute inset-y-0 right-[30px] z-10 my-auto bg-muted opacity-0 group-hover:opacity-100',
        )}
        onClick={(e) => { e.stopPropagation(); onTabClose(tab.id) }}
        title="Close workspace"
        aria-label="Close workspace"
      >
        <X size={ICON_SIZE.sm} aria-hidden />
      </Button>
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

  const tabsScrollRef = useRef<HTMLDivElement>(null)

  // Vertical mouse-wheel scrolls the tab strip horizontally (the scrollbar is
  // hidden), so far-right tabs are reachable with a plain wheel on Windows.
  const onTabsWheel = (e: React.WheelEvent) => {
    if (e.deltaY === 0) return
    const el = tabsScrollRef.current
    if (el && el.scrollWidth > el.clientWidth) el.scrollLeft += e.deltaY
  }

  // Keep the active tab in view when it changes (keyboard, palette, new tab).
  useEffect(() => {
    const active = tabsScrollRef.current?.querySelector('.tab.active')
    if (active && typeof (active as HTMLElement).scrollIntoView === 'function') {
      (active as HTMLElement).scrollIntoView({ inline: 'nearest', block: 'nearest' })
    }
  }, [activeTabId, tabs.length])

  const handleDragEnd = (e: DragEndEvent) => {
    const { active, over } = e
    if (!over || active.id === over.id) return
    onTabReorder(String(active.id), String(over.id))
  }

  return (
    <div className={cn('tabbar bg-card border-b border-border', isWin && 'tabbar-win')}>
      {!isWin && <div className="tabbar-traffic-lights" />}

      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={handleDragEnd}
      >
        <SortableContext items={tabs.map(t => t.id)} strategy={horizontalListSortingStrategy}>
          <div className="tabbar-tabs" ref={tabsScrollRef} onWheel={onTabsWheel}>
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
            {/* El "+" vive ADENTRO de .tabbar-tabs, no al lado: la tira de pestañas se
                queda con el espacio libre (ver .tabbar-tabs en global.css), y un hermano
                de afuera quedaria empujado al extremo derecho de la ventana con una sola
                pestaña. Adentro sigue siempre pegado a la ultima, que es donde lo espera
                cualquiera que venga de un navegador o de VS Code. */}
            {/* size="icon-lg" (36px): .tab mide ~35px (padding 7px + el texto de .tab-name)
                y un `sm` (28px) queda chico y desalineado al lado — icon-lg es el escalon
                del primitivo mas cercano a esa altura real. El glifo es el mismo SVG de "+"
                que el "New Terminal" del sidebar (Sidebar.tsx), para que la familia de
                iconos sea consistente. */}
            <Button
              variant="ghost"
              size="icon-lg"
              className="text-muted-foreground"
              onClick={onTabNew}
              title="New workspace"
              aria-label="New workspace"
              style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
              </svg>
            </Button>
          </div>
        </SortableContext>
      </DndContext>

      <div className="tabbar-drag" />
      {rightSlot}
    </div>
  )
}
