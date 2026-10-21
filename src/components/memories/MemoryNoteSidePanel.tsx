// Panel derecho de una nota abierta: grafo local, quién la nombra, a quién nombra,
// propiedades y outline. Presentación pura: no conoce `window.memory`.
import { useMemo, useState, type ReactNode } from 'react'
import { ChevronRight } from 'lucide-react'
import { cn } from 'cn'
import { Button, buttonVariants } from '../ui/button'
import MemoryGraph2D from './MemoryGraph2D'
import { subgrafoLocal } from '../../lib/memory-graph-2d'
import type { GraphData } from '../../lib/memory-graph-visuals'
import { memoryTypeSwatch } from '../../lib/memory-type-legend'
import { nombreDeProyecto } from '../../lib/nombre-de-proyecto'
import { relativeTime } from '../../lib/memories-status'
import { outlineDe } from '../../lib/memory-outline'
import type { MemoryObservationDetail } from '../../types'

export interface MemoryNoteSidePanelProps {
  detail: MemoryObservationDetail
  /** El grafo entero, SIN los filtros de la pestaña Graph (huérfanas, foco, tipos): de ahí
   *  sale el local. Con esos filtros una memoria suelta no tenía grafo local (final review F5). */
  graphData: GraphData
  ansi?: readonly string[]
  titulosPorId: ReadonlyMap<string, { title: string; type: string }>
  onOpen: (syncId: string, opts: { background: boolean }) => void
  onIrALinea: (linea: number) => void
}

function Seccion({ titulo, children }: { titulo: string; children: ReactNode }) {
  return (
    <details open className="group border-b border-border px-3 py-2">
      {/* Sin el triángulo nativo: el mismo chevron que las carpetas del explorer. */}
      <summary className="flex cursor-pointer select-none list-none items-center gap-1 py-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground [&::-webkit-details-marker]:hidden">
        <ChevronRight className="size-3.5 shrink-0 transition-transform group-open:rotate-90" aria-hidden="true" />
        {titulo}
      </summary>
      <div className="pt-1">{children}</div>
    </details>
  )
}

// Con las clases de Button (que traen `border-transparent`): Tailwind va sin preflight y un
// `<button>` pelado se queda con el borde gris del navegador (final review V1).
const FILA = cn(buttonVariants({ variant: 'ghost', size: 'sm' }), 'w-full justify-start gap-2 px-1.5 text-left text-foreground')

export default function MemoryNoteSidePanel({ detail, graphData, ansi, titulosPorId, onOpen, onIrALinea }: MemoryNoteSidePanelProps) {
  const [saltos, setSaltos] = useState<1 | 2>(1)
  const estaEnElGrafo = useMemo(() => graphData.nodes.some((n) => n.id === detail.syncId), [graphData, detail.syncId])
  const local = useMemo(() => subgrafoLocal(graphData, detail.syncId, saltos), [graphData, detail.syncId, saltos])
  const outline = useMemo(() => outlineDe(detail.content ?? ''), [detail.content])

  const abrir = (id: string) => (e: React.MouseEvent) => onOpen(id, { background: e.ctrlKey || e.metaKey })
  const punto = (type: string | undefined) => {
    const sw = type ? memoryTypeSwatch(type, ansi) : null
    return sw
      ? <span aria-hidden className="size-2 shrink-0 rounded-full" style={{ backgroundColor: sw.color }} />
      : null
  }
  const menorNivel = outline.length ? Math.min(...outline.map((h) => h.nivel)) : 1
  const propiedades: Array<[string, string]> = [
    ['Type', detail.type],
    ['Project', nombreDeProyecto(detail.projectKey, null)],
    ['Branch', detail.gitBranch ?? '—'],
    ['Written by', detail.authorDisplay ?? detail.originAi ?? '—'],
    ['Updated', relativeTime(detail.updatedAt)],
    ['Created', relativeTime(detail.createdAt)],
    ['Tags', detail.tags.length ? detail.tags.join(', ') : '—'],
    ['Scope', detail.scope],
    ['Revisions', String(detail.revisionCount)],
  ]
  const mencionada = detail.mentionedIn ?? []
  const enlaces = detail.links ?? []

  return (
    <div className="flex h-full flex-col overflow-y-auto text-foreground">
      <Seccion titulo="Local graph">
        <div className="mb-1 flex gap-1">
          <Button type="button" size="xs" variant={saltos === 1 ? 'secondary' : 'ghost'} aria-pressed={saltos === 1} onClick={() => setSaltos(1)}>1 hop</Button>
          <Button type="button" size="xs" variant={saltos === 2 ? 'secondary' : 'ghost'} aria-pressed={saltos === 2} onClick={() => setSaltos(2)}>2 hops</Button>
        </div>
        <div className="h-[180px] overflow-hidden rounded border border-border">
          {estaEnElGrafo
            ? <MemoryGraph2D modo="local" data={local} foco={detail.syncId} onOpen={onOpen} />
            : <p className="p-3 text-sm text-muted-foreground">Not in the loaded graph.</p>}
        </div>
      </Seccion>

      <Seccion titulo="Mentioned in">
        {mencionada.length === 0
          ? <p className="text-sm text-muted-foreground">Nothing links here yet.</p>
          : mencionada.map((m) => (
              <button key={m.syncId} type="button" className={FILA} onClick={abrir(m.syncId)}>
                {punto(titulosPorId.get(m.syncId)?.type)}
                <span className="min-w-0 truncate">{m.title}</span>
              </button>
            ))}
      </Seccion>

      <Seccion titulo="Links to">
        {enlaces.length === 0
          ? <p className="text-sm text-muted-foreground">No links in this memory.</p>
          : enlaces.map((l, i) => {
              if (l.syncId === null) {
                return <div key={`hueco-${i}`} className="px-1.5 py-1 text-sm italic text-muted-foreground opacity-60">{l.name} — not written yet</div>
              }
              const t = titulosPorId.get(l.syncId)
              return (
                <button key={`${l.syncId}-${i}`} type="button" className={FILA} onClick={abrir(l.syncId)}>
                  {punto(t?.type)}
                  <span className="min-w-0 truncate">{t?.title ?? l.name}</span>
                </button>
              )
            })}
      </Seccion>

      <Seccion titulo="Properties">
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
          {propiedades.map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="text-muted-foreground">{k}</dt>
              <dd className="m-0 break-words">{v}</dd>
            </div>
          ))}
        </dl>
      </Seccion>

      <Seccion titulo="Outline">
        {outline.length === 0
          ? <p className="text-sm text-muted-foreground">No headings in this memory.</p>
          : outline.map((h) => (
              <button key={h.linea} type="button" className={FILA} style={{ paddingLeft: `${0.375 + (h.nivel - menorNivel) * 0.75}rem` }}
                onClick={() => onIrALinea(h.linea)}>
                <span className="min-w-0 truncate">{h.texto}</span>
              </button>
            ))}
      </Seccion>
    </div>
  )
}
