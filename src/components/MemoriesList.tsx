// Spec 2026-09-11 §1 y §5 (pantalla de Memories legible): "lo primero y lo que ocupa
// el espacio principal es la lista de lo que se guardo, de todos los proyectos, lo mas
// reciente primero" — con busqueda como accion principal, y la capacidad del MCP
// (los agentes escriben aca solos) dicha en una linea, sin jerga.
//
// Virtualizado con @tanstack/react-virtual (unica dependencia nueva autorizada para
// esta tarea): la lista es cross-project y puede tener miles de filas — sin virtualizar
// la pantalla se traba al abrirse.
import type React from 'react'
import { useEffect, useRef } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { AILogo } from './AILogos'
import { Input } from '@/components/ui/input'
import { memoryTypeSwatch } from '../lib/memory-type-legend'
import { relativeTime } from '../lib/memories-status'
import { useCrossProjectMemories } from '../hooks/useCrossProjectMemories'
import type { AIType } from '../types'
import type { CrossProjectObservation } from '../types'

/** Alto de fila fijo — escala vigente 24/28/32/36px (RECETA-MIGRACION-UI.md). Una fila
 *  es una sola linea (titulo + metadatos), asi que no hace falta medicion dinamica. */
const ROW_HEIGHT = 32

interface Props {
  /** syncId seleccionado, compartido con el grafo. Spec §3: seleccionar una memoria en la
   *  lista la resalta en el grafo y viceversa. Opcional para que los callers y tests que
   *  montan la lista sola sigan andando. */
  selectedId?: string | null
  onSelect?: (syncId: string | null) => void
}

export default function MemoriesList({ selectedId = null, onSelect }: Props = {}) {
  const { status, items, error, hasMore, loadingMore, loadMore, query, setQuery } =
    useCrossProjectMemories()

  return (
    // `min-h-[200px]`: la lista es LO PRINCIPAL de esta pantalla (spec §1). Sin un piso, el
    // grafo (380px) y la card de abajo la aplastaban a dos filas y media — la pantalla
    // pasaba a ser el grafo con un resto arriba, que es al reves de lo que tiene que ser.
    <div className="flex min-h-[200px] flex-1 flex-col gap-2">
      <div className="flex items-center gap-2">
        <Input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search memories…"
          aria-label="Search memories"
          className="max-w-sm"
        />
      </div>

      {/* Spec §5 — "que la capacidad deje de ser invisible": una frase, sin jerga, no un
          tutorial. El logo de cada fila (abajo) es la prueba; esto es el contexto. */}
      <p className="text-fs-xs text-muted-foreground">
        Your AI agents read and save memories here on their own, while they work — nothing to set up.
      </p>

      {status === 'unavailable' && (
        <MemoriesNotice
          title="Memory list unavailable"
          detail="This build doesn't support the memories list yet."
        />
      )}

      {status === 'error' && (
        <MemoriesNotice title="Couldn't load memories" detail={error ?? 'Unknown error.'} destructive />
      )}

      {status === 'loading' && items.length === 0 && (
        <div className="flex flex-1 items-center justify-center text-fs-sm text-muted-foreground">
          Loading…
        </div>
      )}

      {status === 'ready' && items.length === 0 && (
        <MemoriesNotice
          compact={Boolean(query)}
          title={query ? 'No memories match that search' : 'No memories yet'}
          detail={
            query
              ? 'Try a different word, or clear the search to see everything.'
              : 'Your agents save memories here on their own while they work in a repo — nothing to set up.'
          }
        />
      )}

      {items.length > 0 && (
        <MemoriesRows
          items={items}
          hasMore={hasMore}
          loadingMore={loadingMore}
          onLoadMore={loadMore}
          selectedId={selectedId}
          onSelect={onSelect}
        />
      )}
    </div>
  )
}

function MemoriesNotice({
  title, detail, destructive = false, compact = false,
}: { title: string; detail: string; destructive?: boolean; compact?: boolean }) {
  return (
    // `compact` es para cuando el vacio es TEMPORAL — una busqueda que no encontro nada.
    // Sin eso el aviso se estira a toda la altura disponible y empuja lo que viene abajo
    // (el grafo) fuera de la vista, con la pantalla mayormente en negro: parece rota.
    // El vacio de verdad (no hay ni una memoria) si merece la pantalla entera.
    <div className={`flex flex-col items-center justify-center gap-1 text-center ${
      compact ? 'py-6' : 'flex-1 py-10'
    }`}>
      <p className={`text-fs-lg font-medium ${destructive ? 'text-destructive' : 'text-foreground'}`}>{title}</p>
      <p className="max-w-sm text-fs text-muted-foreground">{detail}</p>
    </div>
  )
}

interface RowsProps {
  items: CrossProjectObservation[]
  hasMore: boolean
  loadingMore: boolean
  onLoadMore: () => void
  selectedId: string | null
  onSelect?: (syncId: string | null) => void
}

function MemoriesRows({ items, hasMore, loadingMore, onLoadMore, selectedId, onSelect }: RowsProps) {
  const parentRef = useRef<HTMLDivElement>(null)
  const rowVirtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 12,
  })

  const virtualRows = rowVirtualizer.getVirtualItems()
  const lastIndex = virtualRows.length > 0 ? virtualRows[virtualRows.length - 1].index : -1

  // La lista puede tener miles de filas (spec: "no se traen todas") — se pide la
  // pagina siguiente cuando el usuario se acerca al final de lo ya cargado.
  const loadMoreRef = useRef(onLoadMore)
  loadMoreRef.current = onLoadMore
  useEffect(() => {
    if (hasMore && !loadingMore && lastIndex >= items.length - 1) {
      loadMoreRef.current()
    }
  }, [hasMore, loadingMore, lastIndex, items.length])

  return (
    <div
      ref={parentRef}
      className="min-h-0 flex-1 overflow-y-auto rounded-md border border-border"
    >
      <div style={{ height: rowVirtualizer.getTotalSize(), position: 'relative' }}>
        {virtualRows.map((virtualRow) => {
          const item = items[virtualRow.index]
          return (
            <div
              key={item.syncId}
              data-index={virtualRow.index}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                height: virtualRow.size,
                transform: `translateY(${virtualRow.start}px)`,
              }}
            >
              <MemoryRow
                item={item}
                selected={item.syncId === selectedId}
                onSelect={onSelect}
              />
            </div>
          )
        })}
      </div>
      {loadingMore && (
        <div className="py-2 text-center text-fs-xs text-muted-foreground">Loading more…</div>
      )}
    </div>
  )
}

function MemoryRow({
  item, selected, onSelect,
}: { item: CrossProjectObservation; selected: boolean; onSelect?: (syncId: string | null) => void }) {
  const swatch = memoryTypeSwatch(item.type)
  // Sin `onSelect` la fila NO es un boton: un role interactivo en algo que no hace nada es
  // peor que texto plano para quien navega por teclado o con lector de pantalla.
  const interactiva = Boolean(onSelect)
  return (
    <div
      className={`flex h-8 w-full items-center gap-2 border-b border-border px-2 text-left text-fs-sm${
        interactiva ? ' cursor-pointer hover:bg-accent' : ''
      }${selected ? ' bg-accent' : ''}`}
      title={item.title}
      {...(interactiva
        ? {
            role: 'button' as const,
            tabIndex: 0,
            'aria-pressed': selected,
            // Click en la fila ya seleccionada deselecciona — es la unica forma de volver
            // a ver el grafo entero sin ir a buscar el fondo del canvas.
            onClick: () => onSelect?.(selected ? null : item.syncId),
            onKeyDown: (e: React.KeyboardEvent) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                onSelect?.(selected ? null : item.syncId)
              }
            },
          }
        : {})}
    >
      {/* El tipo se distingue sin leer (spec §1) — leyenda categorica de 7 valores
          fijos, ver src/lib/memory-type-legend.ts. */}
      <span
        aria-hidden="true"
        title={swatch ? swatch.label : item.type}
        className="size-2 shrink-0 rounded-full"
        style={{ background: swatch ? swatch.color : 'var(--muted-foreground)' }}
      />
      <span className="min-w-0 flex-1 truncate text-foreground">{item.title}</span>
      {/* AILogo devuelve null para un aiType sin logo conocido — sin fallback
          generico, a proposito (spec: "un aiType sin logo conocido no renderiza
          icono"). Sin originAi (memoria vieja o escrita por un humano) no se
          renderiza nada, no un icono gris. */}
      {item.originAi && <AILogo aiType={item.originAi as AIType} size={14} />}
      <span className="max-w-32 shrink-0 truncate text-fs-xs text-muted-foreground">
        {item.projectDisplayName ?? item.projectKey}
      </span>
      <span className="shrink-0 font-mono text-fs-xs tabular-nums text-muted-foreground">
        {relativeTime(item.updatedAt)}
      </span>
    </div>
  )
}
