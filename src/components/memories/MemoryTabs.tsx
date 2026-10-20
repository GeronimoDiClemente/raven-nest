// Barra de pestañas del centro de Memories. Presentación pura: el estado vive en el hook.
import { GitBranch, Network, X } from 'lucide-react'
import { cn } from 'cn'
import { esFija, tabId, type MemoryTab } from '../../lib/memory-tabs'
import { memoryTypeSwatch } from '../../lib/memory-type-legend'

export interface MemoryTabsProps {
  tabs: MemoryTab[]
  activeId: string
  etiqueta: (t: MemoryTab) => { texto: string; tipo?: string }
  ansi?: readonly string[]
  onActivate: (id: string) => void
  onClose: (id: string) => void
}

function Marca({ tab, tipo, ansi }: { tab: MemoryTab; tipo?: string; ansi?: readonly string[] }) {
  if (tab.kind === 'graph') return <Network className="size-3.5 shrink-0" aria-hidden="true" />
  if (tab.kind === 'thread') return <GitBranch className="size-3.5 shrink-0" aria-hidden="true" />
  const sw = tipo ? memoryTypeSwatch(tipo, ansi) : null
  return (
    <span
      aria-hidden="true"
      className={cn('size-2 shrink-0 rounded-full', !sw && 'bg-muted-foreground')}
      style={sw ? { backgroundColor: sw.color } : undefined}
    />
  )
}

export default function MemoryTabs({ tabs, activeId, etiqueta, ansi, onActivate, onClose }: MemoryTabsProps) {
  return (
    <div role="tablist" aria-label="Open memories" className="flex shrink-0 items-stretch overflow-x-auto border-b border-border">
      {tabs.map((t) => {
        const id = tabId(t)
        const activa = id === activeId
        const cerrable = !esFija(t)
        const { texto, tipo } = etiqueta(t)
        return (
          <div
            key={id}
            role="tab"
            tabIndex={0}
            aria-selected={activa}
            title={texto}
            onClick={() => onActivate(id)}
            onKeyDown={(e) => {
              if (e.target !== e.currentTarget) return
              if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onActivate(id) }
            }}
            onMouseUp={(e) => { if (e.button === 1 && cerrable) { e.preventDefault(); onClose(id) } }}
            className={cn(
              'group flex max-w-48 shrink-0 cursor-pointer items-center gap-1.5 border-r border-border px-3 py-1.5 text-fs-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50',
              activa ? 'bg-accent text-foreground' : 'text-muted-foreground hover:bg-accent/50',
            )}
          >
            <Marca tab={t} tipo={tipo} ansi={ansi} />
            <span className="truncate">{texto}</span>
            {cerrable && (
              <button
                type="button"
                aria-label="Close tab"
                onClick={(e) => { e.stopPropagation(); onClose(id) }}
                className="ml-1 inline-flex size-4 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
              >
                <X className="size-3" aria-hidden="true" />
              </button>
            )}
          </div>
        )
      })}
    </div>
  )
}
