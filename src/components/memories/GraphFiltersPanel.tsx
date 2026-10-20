// Panel de filtros del grafo (columna derecha de Memories, pestaña Graph). Sólo DOM y props:
// el estado vive en `useGraphFilters`, que lo arma el workspace.
import { useMemo } from 'react'
import { Eye, EyeOff } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { useGraphFilters } from '../../hooks/useGraphFilters'
import {
  countEdgeKinds, projectGroups, tagGroups, EDGE_KINDS_IN_LEGEND_ORDER, EDGE_STYLES,
  type ColorBy,
} from '../../lib/memory-graph-visuals'
import { MEMORY_TYPES_IN_LEGEND_ORDER, memoryTypeSwatch } from '../../lib/memory-type-legend'
import { esInferida } from '../../lib/memory-graph-2d'
import { ICON_SIZE } from '../../lib/icons'
import type { MemoryGraph } from '../../types'

export interface GraphFiltersPanelProps {
  graph: MemoryGraph | null
  ansi?: readonly string[]
  filtros: ReturnType<typeof useGraphFilters>
  includeSimilar: boolean
  onIncludeSimilar: (v: boolean) => void
}

function Titulo({ children }: { children: string }) {
  return <p className="mb-1.5 text-fs-xs uppercase tracking-wide text-muted-foreground">{children}</p>
}

export default function GraphFiltersPanel({ graph, ansi, filtros, includeSimilar, onIncludeSimilar }: GraphFiltersPanelProps) {
  const { filtros: f, data, conteoPorTipo } = filtros
  const grupos = useMemo(() => (graph ? projectGroups(graph) : []), [graph])
  const tags = useMemo(() => (graph ? tagGroups(graph) : []), [graph])
  const conteos = useMemo(() => countEdgeKinds(data), [data])

  // Tipos presentes dentro del foco, igual que el hook, para saber si "Type" distingue algo.
  const tiposPresentes = useMemo(() => {
    if (!graph) return 0
    const foco = f.foco
    const enFoco = !foco
      ? graph.nodes
      : foco.tipo === 'project'
        ? graph.nodes.filter((n) => n.projectKey === foco.valor)
        : graph.nodes.filter((n) => n.tags.includes(foco.valor))
    return new Set(enFoco.filter((n) => !n.pending).map((n) => n.type)).size
  }, [graph, f.foco])
  const colorEfectivo: ColorBy = f.foco?.tipo === 'project'
    ? 'type'
    : f.colorBy === 'type' && tiposPresentes <= 1 ? 'project' : f.colorBy

  const tipos = [
    ...MEMORY_TYPES_IN_LEGEND_ORDER.filter((t) => conteoPorTipo.has(t)),
    ...[...conteoPorTipo.keys()].filter((t) => !(MEMORY_TYPES_IN_LEGEND_ORDER as string[]).includes(t)),
  ]

  return (
    <div className="flex min-h-0 flex-col gap-4 overflow-y-auto p-3 text-fs-sm">
      {f.foco?.tipo !== 'project' && (
        <section>
          <Titulo>Color by</Titulo>
          <div className="flex gap-1">
            <Button
              variant={colorEfectivo === 'type' ? 'secondary' : 'ghost'} size="sm"
              aria-pressed={colorEfectivo === 'type'} disabled={tiposPresentes <= 1}
              onClick={() => filtros.setColorBy('type')}
            >Type</Button>
            <Button
              variant={colorEfectivo === 'project' ? 'secondary' : 'ghost'} size="sm"
              aria-pressed={colorEfectivo === 'project'} onClick={() => filtros.setColorBy('project')}
            >Project</Button>
            <Button
              variant={colorEfectivo === 'tag' ? 'secondary' : 'ghost'} size="sm"
              aria-pressed={colorEfectivo === 'tag'} disabled={tags.length === 0}
              onClick={() => filtros.setColorBy('tag')}
            >Tag</Button>
          </div>
        </section>
      )}

      {tipos.length > 0 && (
        <section>
          <Titulo>Types</Titulo>
          <div className="flex flex-wrap gap-1.5">
            {tipos.map((t) => {
              const swatch = memoryTypeSwatch(t, ansi)
              const oculto = f.tiposOcultos.has(t)
              return (
                <Button
                  key={t} variant="outline" size="sm" aria-pressed={!oculto}
                  className={oculto ? 'opacity-40' : ''}
                  onClick={() => filtros.toggleTipo(t)}
                >
                  <span
                    aria-hidden className="size-2 shrink-0 rounded-full bg-muted-foreground"
                    style={swatch ? { background: swatch.color } : undefined}
                  />
                  <span>{swatch ? swatch.label : t}</span>
                  <span className="font-mono text-fs-xs tabular-nums text-muted-foreground">{conteoPorTipo.get(t) ?? 0}</span>
                </Button>
              )
            })}
          </div>
        </section>
      )}

      <section>
        <Titulo>Links</Titulo>
        <ul className="mb-2 flex flex-col gap-1.5">
          {EDGE_KINDS_IN_LEGEND_ORDER.filter((k) => conteos[k] > 0).map((k) => (
            <li key={k} className="flex items-center gap-2">
              <span
                aria-hidden
                className={`w-4 shrink-0 border-t border-muted-foreground ${esInferida(k) ? 'border-dashed' : 'border-solid'}`}
              />
              <span className="text-foreground">{EDGE_STYLES[k].label}</span>
              <span className="font-mono text-fs-xs tabular-nums text-muted-foreground">{conteos[k]}</span>
            </li>
          ))}
        </ul>
        <div className="flex flex-wrap gap-1.5">
          <Button
            variant={includeSimilar ? 'secondary' : 'outline'} size="sm" aria-pressed={includeSimilar}
            onClick={() => onIncludeSimilar(!includeSimilar)}
          >
            {includeSimilar ? 'Hide guessed links' : 'Show guessed links'}
          </Button>
          <Button
            variant={f.hideOrphans ? 'secondary' : 'outline'} size="sm" aria-pressed={f.hideOrphans}
            onClick={() => filtros.setHideOrphans(!f.hideOrphans)}
            title="A memory with no relationship to any other"
          >
            {f.hideOrphans ? <EyeOff size={ICON_SIZE.sm} aria-hidden /> : <Eye size={ICON_SIZE.sm} aria-hidden />}
            {f.hideOrphans ? `${data.orphansHidden} unconnected hidden` : 'Showing unconnected'}
          </Button>
        </div>
      </section>

      <section className="flex flex-col gap-2">
        <label className="flex flex-col gap-1 text-muted-foreground">
          Node size
          <input
            type="range" min={0.5} max={2} step={0.1} value={f.escalaDeNodo}
            onChange={(e) => filtros.setEscalaDeNodo(Number(e.target.value))}
          />
        </label>
        <label className="flex flex-col gap-1 text-muted-foreground">
          Link distance
          <input
            type="range" min={20} max={120} step={5} value={f.distanciaDeLinks}
            onChange={(e) => filtros.setDistanciaDeLinks(Number(e.target.value))}
          />
        </label>
      </section>

      {(f.foco || grupos.length > 0) && (
        <section>
          <Titulo>Projects</Titulo>
          <ul className="flex flex-col gap-0.5">
            <li>
              <Button
                variant={f.foco ? 'ghost' : 'secondary'} size="sm" aria-pressed={!f.foco}
                onClick={() => filtros.setFoco(null)}
              >Everything</Button>
            </li>
            {grupos.map((g) => (
              <li key={g.projectKey}>
                <Button
                  variant={f.foco?.tipo === 'project' && f.foco.valor === g.projectKey ? 'secondary' : 'ghost'}
                  size="sm" className="w-full justify-start"
                  onClick={() => filtros.setFoco({ tipo: 'project', valor: g.projectKey })}
                >
                  <span className="min-w-0 flex-1 truncate text-left">{g.label}</span>
                  <span className="font-mono text-fs-xs tabular-nums text-muted-foreground">{g.count}</span>
                </Button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {tags.length > 0 && (
        <section>
          <Titulo>Tags</Titulo>
          <ul className="flex flex-col gap-0.5">
            {tags.map((t) => (
              <li key={t.tag}>
                <Button
                  variant={f.foco?.tipo === 'tag' && f.foco.valor === t.tag ? 'secondary' : 'ghost'}
                  size="sm" className="w-full justify-start font-mono"
                  onClick={() => filtros.setFoco({ tipo: 'tag', valor: t.tag })}
                >
                  <span className="min-w-0 flex-1 truncate text-left">#{t.tag}</span>
                  <span className="text-fs-xs tabular-nums text-muted-foreground">{t.count}</span>
                </Button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}
