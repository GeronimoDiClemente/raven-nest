// El grafo de memorias: acotado en alto, ancho de verdad, y con el documento al costado.
//
// El modelo está tomado de Obsidian después de verificar qué hace (ver el comentario de
// `memory-graph-visuals.ts`, que tiene el detalle y la fuente). Lo que resuelve cada pieza,
// con datos reales:
//
// - **El filtro de huérfanas** es lo que hace la diferencia entre un grafo y una nube de
//   polvo. Con ~200 memorias y casi ninguna relación declarada, mostrarlas todas no dibuja
//   una sola línea. Va apagado por default y dice cuántas está escondiendo.
// - **Los grupos son proyectos**, con su color. Tocar uno entra en ese proyecto; adentro el
//   color pasa a ser el TIPO de memoria, que es la distinción que importa una vez que el
//   proyecto ya es uno solo.
// - **El documento al costado.** Tocar un nodo no abre otra pantalla: trae la memoria
//   entera —contenido incluido— al panel de la derecha.
//
// Lo pesado (`MemoryGraph3D`) entra por `import()` diferido: medido el 2026-09-11,
// importarlo arriba suma 1379.8 KB crudos al arranque; detrás del import() suma 1.4 KB.
import { lazy, Suspense, useEffect, useMemo, useState } from 'react'
import { ChevronLeft, Eye, EyeOff } from 'lucide-react'
import { useMemoryGraph } from '../hooks/useMemoryGraph'
import { useMemoryDetail } from '../hooks/useMemoryDetail'
import {
  countEdgeKinds, projectGroups, toGraphData,
  EDGE_KINDS_IN_LEGEND_ORDER, EDGE_STYLES,
  type ColorBy, type ProjectGroup,
} from '../lib/memory-graph-visuals'
import { MEMORY_TYPES_IN_LEGEND_ORDER, memoryTypeSwatch as swatchDe } from '../lib/memory-type-legend'
import { memoryTypeSwatch } from '../lib/memory-type-legend'
import { relativeTime } from '../lib/memories-status'
import { AILogo } from './AILogos'
import type { AIType, MemoryEdgeKind, MemoryObservationDetail } from '../types'
import { Button } from '@/components/ui/button'
import { ICON_SIZE } from '../lib/icons'

/** Una sola promesa para toda la app: el prefetch y el `lazy` comparten el módulo, así que
 *  precargar de verdad evita la espera en vez de duplicar la descarga. Mismo patrón que
 *  `monacoSetupPromise` en EditorPane.tsx:35. */
let graph3dPromise: Promise<typeof import('./MemoryGraph3D')> | null = null
function cargarGraph3D() {
  graph3dPromise ??= import('./MemoryGraph3D')
  return graph3dPromise
}

/** Dispara la descarga del chunk sin montarlo, al ABRIR Memories — así el 1.37 MB viaja
 *  mientras el usuario mira la lista y el cuadro aparece ya cargado. */
export function prefetchMemoryGraph3D(): void {
  void cargarGraph3D()
}

const MemoryGraph3D = lazy(cargarGraph3D)

/** Alto del cuadro. El ANCHO ya no es fijo: el grafo toma el ancho disponible. Acotar el
 *  alto alcanza — es lo que impide que se coma la pantalla, que era el pedido. */
const ALTO = 380

/** Arriba de esto las etiquetas de los nodos son ruido y no información. Es el equivalente
 *  del `text fade threshold` de Obsidian, resuelto por cantidad en vez de por zoom. */
const MAX_NODOS_CON_ETIQUETA = 60

interface Props {
  selectedId: string | null
  onSelect: (syncId: string | null) => void
}

export default function MemoryGraphPanel({ selectedId, onSelect }: Props) {
  const [includeSimilar, setIncludeSimilar] = useState(false)
  const [hideOrphans, setHideOrphans] = useState(true)
  const [focusProject, setFocusProject] = useState<string | null>(null)
  /**
   * Qué significa el color de un nodo. Lo elige el usuario, no nosotros.
   *
   * En Obsidian los grupos del grafo son **color por consulta de búsqueda** (`path:` para
   * una carpeta, `tag:` para una etiqueta): el color no está atado a ninguna dimensión
   * fija, lo define quien mira. Acá las dos dimensiones que tenemos son el TIPO de memoria
   * (la propiedad: decision, bugfix, architecture…) y el PROYECTO (la carpeta, que en
   * Obsidian es el lugar exclusivo de una nota).
   *
   * Default en `type`: con pocos proyectos, colorear por proyecto deja el grafo casi
   * monocromo, mientras que los siete tipos siempre dan una lectura.
   */
  const [colorBy, setColorBy] = useState<ColorBy>('type')
  const { graph, truncated, loading, error } = useMemoryGraph(includeSimilar)
  const { detail, loading: cargandoDetalle, missing } = useMemoryDetail(selectedId)

  useEffect(() => { prefetchMemoryGraph3D() }, [])

  // Adentro de UN proyecto, colorear por proyecto no dice nada: son todos el mismo. Ahí el
  // color pasa a ser el tipo aunque el control diga otra cosa.
  const colorEfectivo: ColorBy = focusProject ? 'type' : colorBy
  const data = useMemo(
    () => (graph ? toGraphData(graph, { colorBy: colorEfectivo, hideOrphans, focusProject }) : null),
    [graph, hideOrphans, focusProject, colorEfectivo],
  )

  const grupos = useMemo(() => (graph ? projectGroups(graph) : []), [graph])
  // Los tipos que de verdad aparecen en lo que se esta dibujando. La leyenda no nombra un
  // color que no esta en pantalla — eso enseña mal.
  const tiposPresentes = useMemo(
    () => (data ? [...new Set(data.nodes.map((n) => n.type))] : []),
    [data],
  )
  const conteos = useMemo(() => (data ? countEdgeKinds(data) : null), [data])

  if (error) {
    return (
      <div className="shrink-0 rounded-md border border-border px-3 py-2 text-fs-sm text-muted-foreground">
        The memory graph could not be read: {error}
      </div>
    )
  }
  // Sin nodos no hay cuadro. Tampoco mientras carga la primera vez: un esqueleto de 380px
  // que aparece y desaparece es peor que nada.
  if (loading && !graph) return null
  if (!graph || graph.nodes.length === 0 || !data) return null

  return (
    <div className="flex shrink-0 flex-col gap-2 rounded-md border border-border p-3">
      {/* La barra de filtros, en una sola línea. Es lo que Obsidian mete en un panel
          lateral; acá vive a la vista porque son tres, no veinte. */}
      <div className="flex flex-wrap items-center gap-2">
        {focusProject ? (
          <Button variant="outline" size="sm" onClick={() => { setFocusProject(null); onSelect(null) }}>
            <ChevronLeft size={ICON_SIZE.sm} aria-hidden />
            All projects
          </Button>
        ) : (
          <span className="text-fs-sm text-muted-foreground">
            {data.nodes.length} shown
            {truncated > 0 && ` · ${truncated} beyond the limit`}
          </span>
        )}

        {focusProject && (
          <span className="min-w-0 truncate font-mono text-fs-sm text-foreground">{focusProject}</span>
        )}

        <div className="ml-auto flex items-center gap-2">
          {/* Qué significa el color. Es el equivalente de los Groups de Obsidian, que son
              color por consulta: ahí el usuario decide qué agrupa el color, y acá también.
              Adentro de un proyecto no se ofrece: seria elegir entre un color y el mismo. */}
          {!focusProject && (
            <div className="flex items-center gap-1 text-fs-sm text-muted-foreground">
              <span>Color by</span>
              <Button
                variant={colorBy === 'type' ? 'secondary' : 'outline'}
                size="sm"
                aria-pressed={colorBy === 'type'}
                onClick={() => setColorBy('type')}
              >
                Type
              </Button>
              <Button
                variant={colorBy === 'project' ? 'secondary' : 'outline'}
                size="sm"
                aria-pressed={colorBy === 'project'}
                onClick={() => setColorBy('project')}
              >
                Project
              </Button>
            </div>
          )}
          {/* El filtro de Obsidian, con el nombre dicho en cristiano. Dice CUÁNTAS esconde:
              un grafo que oculta la mitad de las memorias sin avisar miente sobre lo que hay. */}
          <Button
            variant={hideOrphans ? 'secondary' : 'outline'}
            size="sm"
            aria-pressed={hideOrphans}
            onClick={() => setHideOrphans((v) => !v)}
            title="A memory with no relationship to any other — most memories start this way"
          >
            {hideOrphans
              ? <EyeOff size={ICON_SIZE.sm} aria-hidden />
              : <Eye size={ICON_SIZE.sm} aria-hidden />}
            {hideOrphans ? `${data.orphansHidden} unconnected hidden` : 'Showing unconnected'}
          </Button>
          <Button
            variant={includeSimilar ? 'secondary' : 'outline'}
            size="sm"
            aria-pressed={includeSimilar}
            onClick={() => setIncludeSimilar((v) => !v)}
          >
            {includeSimilar ? 'Hide guessed links' : 'Show guessed links'}
          </Button>
        </div>
      </div>

      <div className="flex min-h-0 gap-3" style={{ height: ALTO }}>
        {/* El grafo toma el ancho que sobra. `min-w-0` es lo que le permite encogerse en vez
            de empujar al panel de la derecha fuera de la caja. */}
        <div className="min-w-0 flex-1 overflow-hidden rounded-md bg-card">
          {data.nodes.length === 0 ? (
            <div className="flex h-full items-center justify-center px-6 text-center text-fs-sm text-muted-foreground">
              {hideOrphans
                ? 'None of these memories are connected to each other yet. Turn the filter off to see them all.'
                : 'Nothing to draw here.'}
            </div>
          ) : (
            <Suspense fallback={<div className="h-full w-full" />}>
              <MemoryGraph3D
                data={data}
                selectedId={selectedId}
                onSelect={onSelect}
                showLabels={data.nodes.length <= MAX_NODOS_CON_ETIQUETA}
              />
            </Suspense>
          )}
        </div>

        {/* El documento. Ancho fijo para que el grafo se quede con el resto y para que el
            texto no cambie de medida cada vez que se mueve la ventana. */}
        <div className="flex w-[340px] shrink-0 flex-col overflow-hidden rounded-md border border-border bg-card p-3">
          {selectedId ? (
            <DocumentoDeMemoria detail={detail} loading={cargandoDetalle} missing={missing} />
          ) : (
            <SinSeleccion
              grupos={grupos}
              focusProject={focusProject}
              onFocus={(k) => { setFocusProject(k); onSelect(null) }}
              conteos={conteos}
              colorBy={colorEfectivo}
              tiposPresentes={tiposPresentes}
            />
          )}
        </div>
      </div>
    </div>
  )
}

function SinSeleccion({
  grupos, focusProject, onFocus, conteos, colorBy, tiposPresentes,
}: {
  grupos: ProjectGroup[]
  focusProject: string | null
  onFocus: (projectKey: string) => void
  conteos: Record<MemoryEdgeKind, number> | null
  colorBy: ColorBy
  tiposPresentes: string[]
}) {
  return (
    <div className="flex min-h-0 flex-col gap-3 overflow-y-auto">
      <div>
        <p className="text-fs font-medium text-foreground">How these memories connect</p>
        <p className="text-fs-sm text-muted-foreground">Click one to read it.</p>
      </div>

      {colorBy === 'type' && tiposPresentes.length > 0 && (
        <div>
          <p className="mb-1.5 text-fs-xs uppercase tracking-wide text-muted-foreground">Types</p>
          <ul className="flex flex-wrap gap-x-3 gap-y-1">
            {MEMORY_TYPES_IN_LEGEND_ORDER.filter((t) => tiposPresentes.includes(t)).map((t) => (
              <li key={t} className="flex items-center gap-1.5 text-fs-sm">
                <span aria-hidden className="size-2 shrink-0 rounded-full" style={{ background: swatchDe(t)!.color }} />
                <span className="text-foreground">{swatchDe(t)!.label}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {!focusProject && grupos.length > 0 && (
        <div>
          <p className="mb-1.5 text-fs-xs uppercase tracking-wide text-muted-foreground">Projects</p>
          <ul className="flex flex-col gap-0.5">
            {grupos.map((g) => (
              <li key={g.projectKey}>
                {/* Botón, no fila decorativa: entrar a un proyecto es LA acción de esta
                    columna cuando no hay nada seleccionado. */}
                <button
                  type="button"
                  onClick={() => onFocus(g.projectKey)}
                  className="flex w-full items-center gap-2 rounded-sm px-1 py-0.5 text-left hover:bg-accent"
                  title={`Show only ${g.projectKey}`}
                >
                  {/* El punto solo pinta si el color del grafo ES por proyecto. Con el
                      color por tipo, un punto de proyecto no corresponde a nada de lo que
                      se ve en el grafo — seria una leyenda que miente. */}
                  <span
                    aria-hidden
                    className="size-2 shrink-0 rounded-full"
                    style={{ background: colorBy === 'project' ? g.color : 'var(--muted-foreground)' }}
                  />
                  <span className="min-w-0 flex-1 truncate text-fs-sm text-foreground">{g.projectKey}</span>
                  <span className="shrink-0 font-mono text-fs-xs tabular-nums text-muted-foreground">{g.count}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {conteos && (
        <div>
          <p className="mb-1.5 text-fs-xs uppercase tracking-wide text-muted-foreground">Relationships</p>
          <ul className="flex flex-col gap-1.5">
            {EDGE_KINDS_IN_LEGEND_ORDER.map((kind) => {
              const style = EDGE_STYLES[kind]
              const n = conteos[kind] ?? 0
              if (n === 0) return null
              return (
                <li key={kind} className="flex items-baseline gap-2 text-fs-sm">
                  <span
                    aria-hidden
                    className="inline-block shrink-0 self-center rounded-full"
                    style={{ width: 16, height: Math.max(style.width, 1), background: style.color }}
                  />
                  <span className="shrink-0 text-foreground">{style.label}</span>
                  <span className="shrink-0 font-mono text-fs-xs tabular-nums text-muted-foreground">{n}</span>
                </li>
              )
            })}
          </ul>
        </div>
      )}
    </div>
  )
}

function DocumentoDeMemoria({
  detail, loading, missing,
}: {
  detail: MemoryObservationDetail | null
  loading: boolean
  missing: boolean
}) {
  if (loading) return <p className="text-fs-sm text-muted-foreground">Loading…</p>
  if (missing || !detail) {
    return (
      <p className="text-fs-sm text-muted-foreground">
        This memory is no longer there — it was deleted after the graph was drawn.
      </p>
    )
  }

  const swatch = memoryTypeSwatch(detail.type)

  return (
    <div className="flex min-h-0 flex-col gap-2 overflow-y-auto">
      <div className="flex items-start gap-2">
        <span
          aria-hidden
          className="mt-1.5 size-2 shrink-0 rounded-full"
          style={{ background: swatch ? swatch.color : 'var(--muted-foreground)' }}
        />
        {/* `break-words`, no `truncate`: el título de una memoria es una frase entera, y
            cortarla al primer renglón es perder justo lo que viniste a leer. */}
        <p className="min-w-0 flex-1 break-words text-fs font-medium text-foreground">{detail.title}</p>
      </div>

      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-fs-xs text-muted-foreground">
        <span>{swatch ? swatch.label : detail.type}</span>
        <span aria-hidden>·</span>
        <span className="font-mono">{detail.projectKey}</span>
        {detail.gitBranch && (
          <>
            <span aria-hidden>·</span>
            <span className="font-mono">{detail.gitBranch}</span>
          </>
        )}
        <span aria-hidden>·</span>
        <span>{relativeTime(detail.updatedAt)}</span>
        {detail.originAi && <AILogo aiType={detail.originAi as AIType} size={12} />}
      </div>

      {detail.supersededBy && (
        <p className="rounded-sm bg-muted px-2 py-1 text-fs-xs text-muted-foreground">
          A newer version of this memory replaced it.
        </p>
      )}

      {/* El documento. Monoespaciado y respetando los saltos de línea: lo que guardan los
          agentes es Markdown, y aplastarlo a un párrafo lo vuelve ilegible. */}
      {detail.content ? (
        <pre className="whitespace-pre-wrap break-words font-mono text-fs-xs leading-relaxed text-foreground">
          {detail.content}
        </pre>
      ) : (
        <p className="text-fs-sm text-muted-foreground">This memory has no body — only its title.</p>
      )}

      {detail.tags.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {detail.tags.map((t) => (
            <span key={t} className="rounded-sm bg-muted px-1.5 py-0.5 font-mono text-fs-xs text-muted-foreground">
              {t}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}
