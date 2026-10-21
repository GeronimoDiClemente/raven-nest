// Columna izquierda de Memories: búsqueda, "New memory" y las memorias en carpetas.
// Presentación pura: no conoce `window.memory`; el padre le pasa las carpetas ya armadas.
import { useState } from 'react'
import { ChevronDown, ChevronRight, Plus, Search } from 'lucide-react'
import { cn } from 'cn'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import type { CarpetaDeMemorias } from '../../lib/memories-tree'
import { leer, escribir } from '../../lib/almacen-seguro'
import { memoryTypeSwatch } from '../../lib/memory-type-legend'

export interface MemoriesExplorerProps {
  carpetas: CarpetaDeMemorias[]
  query: string
  onQuery: (q: string) => void
  activoId: string | null
  carpetaSeleccionada: string | null
  onSeleccionarCarpeta: (id: string) => void
  onOpen: (syncId: string, opts: { background: boolean }) => void
  onNew: () => void
  truncadas: number
  ansi?: readonly string[]
  cargando: boolean
}

const CLAVE = 'nest:memories:carpetas'

// Ids de carpetas CERRADAS. Un JSON roto o de otra forma vuelve al default (todo abierto).
function leerCerradas(): Set<string> {
  try {
    const v: unknown = JSON.parse(leer(CLAVE) ?? '[]')
    return new Set(Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [])
  } catch { return new Set() }
}

export default function MemoriesExplorer(p: MemoriesExplorerProps) {
  const [cerradas, setCerradas] = useState<Set<string>>(leerCerradas)
  const buscando = p.query.trim() !== ''

  const alternar = (id: string) => {
    // Con una búsqueda activa todas las carpetas con resultados se ven abiertas: un click no
    // puede guardar un "cerrada" que la persona no ve (final review, minor de Task 9).
    if (buscando) { p.onSeleccionarCarpeta(id); return }
    const sig = new Set(cerradas)
    if (!sig.delete(id)) sig.add(id)
    setCerradas(sig)
    escribir(CLAVE, JSON.stringify([...sig]))
    p.onSeleccionarCarpeta(id)
  }

  return (
    <div data-tour-id="memories-explorer" className="flex h-full min-h-0 flex-col gap-2 p-2">
      <div className="relative">
        <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
        <Input
          aria-label="Search memories"
          placeholder="Search memories…"
          value={p.query}
          onChange={(e) => p.onQuery(e.target.value)}
          className="pl-7"
        />
      </div>
      <Button type="button" variant="outline" size="sm" data-tour-id="memories-new" onClick={p.onNew}>
        <Plus aria-hidden="true" />
        New memory
      </Button>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {p.carpetas.length === 0 ? (
          <p className="px-2 py-3 text-fs-sm text-muted-foreground">
            {p.cargando ? 'Loading…' : buscando ? 'No matches' : 'No memories yet'}
          </p>
        ) : (
          p.carpetas.map((c) => {
            const abierta = buscando || !cerradas.has(c.id)
            const Chevron = abierta ? ChevronDown : ChevronRight
            return (
              <div key={c.id}>
                <button
                  type="button"
                  aria-expanded={abierta}
                  onClick={() => alternar(c.id)}
                  className={cn(
                    // `border-0`: sin preflight, un <button> trae el borde del navegador (final review V1).
                    'flex w-full cursor-pointer items-center gap-1 rounded-md border-0 px-1.5 py-1 text-left text-fs-sm font-medium text-foreground hover:bg-accent/50',
                    p.carpetaSeleccionada === c.id && 'bg-accent',
                  )}
                >
                  <Chevron className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                  <span className="min-w-0 truncate">{c.nombre}</span>
                  {" "}
                  <span className="ml-auto pl-2 text-muted-foreground">{c.items.length}</span>
                </button>
                {abierta && c.items.map((n) => {
                  const sw = memoryTypeSwatch(n.type, p.ansi)
                  const activo = p.activoId === n.syncId
                  return (
                    <button
                      key={n.syncId}
                      type="button"
                      title={n.title}
                      aria-current={activo ? 'page' : undefined}
                      onClick={(e) => p.onOpen(n.syncId, { background: e.ctrlKey || e.metaKey })}
                      className={cn(
                        'flex w-full cursor-pointer items-center gap-2 rounded-md border-0 py-1 pl-6 pr-2 text-left text-fs-sm text-muted-foreground hover:bg-accent/50 hover:text-foreground',
                        activo && 'bg-accent text-foreground',
                      )}
                    >
                      <span
                        aria-hidden="true"
                        className={cn('size-2 shrink-0 rounded-full', !sw && 'bg-muted-foreground')}
                        style={sw ? { backgroundColor: sw.color } : undefined}
                      />
                      <span className="min-w-0 truncate">{n.title}</span>
                    </button>
                  )
                })}
              </div>
            )
          })
        )}
      </div>

      {p.truncadas > 0 && (
        <p className="px-2 text-fs-xs text-muted-foreground">{p.truncadas} more not shown</p>
      )}
    </div>
  )
}
