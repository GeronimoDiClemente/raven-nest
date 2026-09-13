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
  countEdgeKinds, projectGroups, tagGroups, toGraphData,
  EDGE_KINDS_IN_LEGEND_ORDER, EDGE_STYLES,
  type ColorBy, type Foco, type ProjectGroup, type TagGroup,
} from '../lib/memory-graph-visuals'
import { MEMORY_TYPES_IN_LEGEND_ORDER, memoryTypeSwatch as swatchDe } from '../lib/memory-type-legend'
import { memoryTypeSwatch } from '../lib/memory-type-legend'
import { relativeTime } from '../lib/memories-status'
import { AILogo } from './AILogos'
import type { AIType, MemoryEdgeKind, MemoryObservationDetail } from '../types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
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
  /**
   * Los ids que coinciden con la búsqueda, o null si no hay búsqueda. Se resaltan y todo lo
   * demás se atenúa, sin que el grafo cambie de forma.
   */
  resaltados?: ReadonlySet<string> | null
  onSelect: (syncId: string | null) => void
  /** Empieza el modo "conectar": el workspace toma el control porque la segunda memoria
   *  puede elegirse tanto en el grafo como en la LISTA, y la lista no la ve este panel. */
  onEmpezarAConectar?: (syncId: string) => void
  /** Una memoria se editó o se borró: la lista y el grafo tienen que volver a pedirse. */
  onCambiada?: () => void
}

export default function MemoryGraphPanel({ selectedId, onSelect, onEmpezarAConectar, onCambiada, resaltados = null }: Props) {

  /**
   * Encendido por default desde el 2026-09-13.
   *
   * Estaba apagado porque una arista por similitud es INFERENCIA (tags compartidos) y no un
   * hecho declarado como las otras tres. El razonamiento era bueno y el resultado era malo:
   * sin ellas el grafo son cadenas de revisión colgando de racimos por rama, sin un solo
   * cúmulo temático — o sea, un dibujo del linaje y no un mapa por el que se pueda navegar.
   * Y estando detrás de un botón, casi nadie las veía nunca.
   *
   * Está acotado: los 3 vecinos más parecidos por nodo, con un piso de score. No es un clique
   * —200 memorias del mismo tag darían 600 aristas y taparían todo— y se puede apagar.
   */
  const [includeSimilar, setIncludeSimilar] = useState(true)
  const [hideOrphans, setHideOrphans] = useState(true)
  // En qué está enfocado el grafo: un proyecto, un tag, o nada. Es el "abrir uno" de
  // Obsidian generalizado — un tag agrupa igual de bien que una carpeta, y de hecho es el
  // Group más fiel de los dos: allá un grupo es una CONSULTA, no un campo.
  const [foco, setFoco] = useState<Foco>(null)
  /**
   * Qué significa el color de un nodo. Lo elige el usuario, no nosotros.
   *
   * En Obsidian los grupos del grafo son **color por consulta de búsqueda** (`path:` para
   * una carpeta, `tag:` para una etiqueta): el color no está atado a ninguna dimensión
   * fija, lo define quien mira. Acá las dos dimensiones que tenemos son el TIPO de memoria
   * (la propiedad: decision, bugfix, architecture…) y el PROYECTO (la carpeta, que en
   * Obsidian es el lugar exclusivo de una nota).
   *
   * Default en `project`, y esto salió de mirar datos reales: de las 120 memorias del
   * usuario, **todas** eran de tipo `pattern`, así que colorear por tipo pintaba 120 nodos
   * del mismo rosa. Los agentes guardan casi siempre con el mismo tipo; los proyectos, en
   * cambio, son varios de entrada. La dimensión que distingue es el proyecto.
   *
   * `tag` es la tercera, y la más parecida a un Group de Obsidian de verdad: una memoria
   * puede tener VARIOS, así que el color lo decide el más usado del corpus (ver
   * `tagDominante`) — el mismo criterio de "gana el primer grupo que matchea", con el orden
   * puesto por frecuencia.
   */
  const [colorBy, setColorBy] = useState<ColorBy>('project')
  const { graph, truncated, loading, error } = useMemoryGraph(includeSimilar)
  const { detail, loading: cargandoDetalle, missing } = useMemoryDetail(selectedId)

  useEffect(() => { prefetchMemoryGraph3D() }, [])

  // Adentro de UN proyecto, colorear por proyecto no dice nada: son todos el mismo. Ahí el
  // color pasa a ser el tipo aunque el control diga otra cosa.
  // Los tipos presentes salen del grafo CRUDO, no de `data`: qué tipos hay no depende de
  // cómo se está coloreando, y hacerlo depender creaba un ciclo (data -> colorEfectivo ->
  // tiposPresentes -> data). La leyenda tampoco nombra un color que no está en pantalla.
  const tiposPresentes = useMemo(() => {
    if (!graph) return []
    const enFoco = !foco
      ? graph.nodes
      : foco.tipo === 'project'
        ? graph.nodes.filter((n) => n.projectKey === foco.valor)
        : graph.nodes.filter((n) => n.tags.includes(foco.valor))
    return [...new Set(enFoco.map((n) => n.type))]
  }, [graph, foco])

  // Si el conjunto que se está mirando tiene un solo tipo, colorear por tipo no distingue
  // nada: se cae a proyecto aunque el control diga otra cosa. Adentro de UN proyecto pasa
  // lo inverso — todos comparten proyecto, así que ahí manda el tipo.
  const colorEfectivo: ColorBy = foco?.tipo === 'project'
    ? 'type'
    : (colorBy === 'type' && tiposPresentes.length <= 1 ? 'project' : colorBy)
  const data = useMemo(
    () => (graph ? toGraphData(graph, { colorBy: colorEfectivo, hideOrphans, foco }) : null),
    [graph, hideOrphans, foco, colorEfectivo],
  )

  const grupos = useMemo(() => (graph ? projectGroups(graph) : []), [graph])
  const tags = useMemo(() => (graph ? tagGroups(graph) : []), [graph])
  const etiquetaDelFoco = !foco
    ? null
    : foco.tipo === 'project'
      ? (grupos.find((g) => g.projectKey === foco.valor)?.label ?? foco.valor)
      : `#${foco.valor}`
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
        {foco ? (
          <Button variant="outline" size="sm" onClick={() => { setFoco(null); onSelect(null) }}>
            <ChevronLeft size={ICON_SIZE.sm} aria-hidden />
            Everything
          </Button>
        ) : (
          <span className="text-fs-sm text-muted-foreground">
            {data.nodes.length} shown
            {truncated > 0 && ` · ${truncated} beyond the limit`}
          </span>
        )}

        {foco && (
          <span className="min-w-0 truncate font-mono text-fs-sm text-foreground">{etiquetaDelFoco}</span>
        )}

        <div className="ml-auto flex items-center gap-2">
          {/* Qué significa el color. Es el equivalente de los Groups de Obsidian, que son
              color por consulta: ahí el usuario decide qué agrupa el color, y acá también.
              Adentro de un proyecto no se ofrece: seria elegir entre un color y el mismo. */}
          {foco?.tipo !== 'project' && (
            <div className="flex items-center gap-1 text-fs-sm text-muted-foreground">
              <span>Color by</span>
              {/* Deshabilitado cuando hay un solo tipo: ofrecer colorear por una dimensión
                  que no distingue nada es ofrecer pintar todo del mismo color, y deja al
                  usuario creyendo que se rompió algo. Pasa de verdad — los agentes guardan
                  casi siempre con el mismo tipo, y el importador de Markdown estampaba
                  `pattern` a todo hasta el 2026-09-11. */}
              <Button
                variant={colorBy === 'type' ? 'secondary' : 'outline'}
                size="sm"
                aria-pressed={colorBy === 'type'}
                disabled={tiposPresentes.length <= 1}
                onClick={() => setColorBy('type')}
                title={
                  tiposPresentes.length <= 1
                    ? 'Every memory here has the same type, so colouring by it would paint them all alike'
                    : 'Colour each memory by its type'
                }
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
              {/* La tercera dimension. Deshabilitada si no hay tags: seria colorear por una
                  categoria que ninguna memoria tiene. */}
              <Button
                variant={colorBy === 'tag' ? 'secondary' : 'outline'}
                size="sm"
                aria-pressed={colorBy === 'tag'}
                disabled={tags.length === 0}
                onClick={() => setColorBy('tag')}
                title={tags.length === 0 ? 'None of these memories have tags' : 'Colour each memory by its tag'}
              >
                Tag
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
                resaltados={resaltados}
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
            <DocumentoDeMemoria
              detail={detail}
              loading={cargandoDetalle}
              missing={missing}
              onConectar={() => onEmpezarAConectar?.(selectedId)}
              onCambio={(borrada) => {
                // Borrada: no queda nada que mostrar, así que se deselecciona. Editada: se
                // queda seleccionada y el panel se recarga con el texto nuevo.
                if (borrada) onSelect(null)
                onCambiada?.()
              }}
            />
          ) : (
            <SinSeleccion
              grupos={grupos}
              tags={tags}
              foco={foco}
              onFocus={(f) => { setFoco(f); onSelect(null) }}
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
  grupos, tags, foco, onFocus, conteos, colorBy, tiposPresentes,
}: {
  grupos: ProjectGroup[]
  tags: TagGroup[]
  foco: Foco
  onFocus: (f: Foco) => void
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

      {/* Las RELACIONES van primero, antes de los grupos. Explican lo que estás mirando; los
          grupos son filtros. Estaban al final y la lista de tags las empujaba abajo del
          borde: el grafo dibujaba sus líneas y el panel no decía qué significaba ninguna. */}
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

      {!foco && grupos.length > 0 && (
        <div>
          <p className="mb-1.5 text-fs-xs uppercase tracking-wide text-muted-foreground">Projects</p>
          <ul className="flex flex-col gap-0.5">
            {grupos.map((g) => (
              <li key={g.projectKey}>
                {/* Botón, no fila decorativa: entrar a un proyecto es LA acción de esta
                    columna cuando no hay nada seleccionado. */}
                <button
                  type="button"
                  onClick={() => onFocus({ tipo: 'project', valor: g.projectKey })}
                  className="flex w-full items-center gap-2 rounded-sm px-1 py-0.5 text-left hover:bg-accent"
                  title={`Show only ${g.label}`}
                >
                  {/* El punto solo pinta si el color del grafo ES por proyecto. Con el
                      color por tipo, un punto de proyecto no corresponde a nada de lo que
                      se ve en el grafo — seria una leyenda que miente. */}
                  <span
                    aria-hidden
                    className="size-2 shrink-0 rounded-full"
                    style={{ background: colorBy === 'project' ? g.color : 'var(--muted-foreground)' }}
                  />
                  <span className="min-w-0 flex-1 truncate text-fs-sm text-foreground">{g.label}</span>
                  <span className="shrink-0 font-mono text-fs-xs tabular-nums text-muted-foreground">{g.count}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Los tags, con el mismo tratamiento que los proyectos: se listan, dicen cuantas
          memorias tienen, y tocar uno entra. Es el Group de Obsidian mas fiel de los tres —
          alla un grupo es una CONSULTA, no un campo, y un tag es lo mas cerca que estamos.
          Ordenados por cantidad, que es el mismo orden que decide el color de una memoria
          que tiene varios. */}
      {!foco && tags.length > 0 && (
        <div>
          <p className="mb-1.5 text-fs-xs uppercase tracking-wide text-muted-foreground">Tags</p>
          <ul className="flex flex-col gap-0.5">
            {tags.slice(0, 6).map((t) => (
              <li key={t.tag}>
                <button
                  type="button"
                  onClick={() => onFocus({ tipo: 'tag', valor: t.tag })}
                  className="flex w-full items-center gap-2 rounded-sm px-1 py-0.5 text-left hover:bg-accent"
                  title={`Show only #${t.tag}`}
                >
                  <span
                    aria-hidden
                    className="size-2 shrink-0 rounded-full"
                    style={{ background: colorBy === 'tag' ? t.color : 'var(--muted-foreground)' }}
                  />
                  <span className="min-w-0 flex-1 truncate font-mono text-fs-sm text-foreground">#{t.tag}</span>
                  <span className="shrink-0 font-mono text-fs-xs tabular-nums text-muted-foreground">{t.count}</span>
                </button>
              </li>
            ))}
          </ul>
          {tags.length > 6 && (
            <p className="mt-1 px-1 text-fs-xs text-muted-foreground">
              {tags.length - 6} more tags
            </p>
          )}
        </div>
      )}

    </div>
  )
}

function DocumentoDeMemoria({
  detail, loading, missing, onConectar, onCambio,
}: {
  detail: MemoryObservationDetail | null
  loading: boolean
  missing: boolean
  onConectar: () => void
  /** La lista y el grafo se redibujan cuando esta memoria cambió o dejó de existir. */
  onCambio: (borrada: boolean) => void
}) {
  const [editando, setEditando] = useState(false)
  const [titulo, setTitulo] = useState('')
  const [cuerpo, setCuerpo] = useState('')
  const [confirmandoBorrado, setConfirmandoBorrado] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [ocupado, setOcupado] = useState(false)

  // Al cambiar de memoria se sale de cualquier modo abierto: dejar el formulario de otra
  // fila cargado con el texto de la anterior es como poco confuso y como mucho destructivo.
  useEffect(() => {
    setEditando(false)
    setConfirmandoBorrado(false)
    setError(null)
  }, [detail?.syncId])

  async function guardar() {
    if (!detail) return
    const api = window.memory?.updateFromUi
    if (!api) { setError('This build cannot edit memories yet.'); return }
    setOcupado(true)
    try {
      const res = await api({ syncId: detail.syncId, title: titulo.trim(), content: cuerpo.trim() })
      if (!res.ok) {
        // `reason` viene del store: not_found / deleted / superseded / unchanged. Decir cuál
        // es importa: "superseded" no es un error del usuario, es que otra máquina ganó.
        setError(res.reason === 'superseded'
          ? 'Another version of this memory replaced it, so it can no longer be edited.'
          : res.reason === 'unchanged' ? null : (res.error ?? res.reason ?? 'Could not save'))
        if (res.reason !== 'unchanged') return
      }
      setEditando(false)
      onCambio(false)
    } finally { setOcupado(false) }
  }

  async function borrar() {
    if (!detail) return
    const api = window.memory?.deleteFromUi
    if (!api) { setError('This build cannot delete memories yet.'); return }
    setOcupado(true)
    try {
      const res = await api(detail.syncId)
      if (!res.ok) { setError(res.error ?? 'Could not delete'); return }
      onCambio(true)
    } finally { setOcupado(false) }
  }
  if (loading) return <p className="text-fs-sm text-muted-foreground">Loading…</p>
  if (missing || !detail) {
    return (
      <p className="text-fs-sm text-muted-foreground">
        This memory is no longer there — it was deleted after the graph was drawn.
      </p>
    )
  }

  const swatch = memoryTypeSwatch(detail.type)

  if (editando) {
    return (
      <div className="flex min-h-0 flex-col gap-2 overflow-y-auto">
        <p className="text-fs font-medium text-foreground">Edit memory</p>
        <Input
          value={titulo}
          onChange={(e) => setTitulo(e.target.value)}
          aria-label="Memory title"
          autoFocus
        />
        <textarea
          value={cuerpo}
          onChange={(e) => setCuerpo(e.target.value)}
          aria-label="Memory content"
          rows={12}
          className="w-full flex-1 resize-y rounded-md border border-input bg-transparent px-2.5 py-2 font-mono text-fs-xs leading-relaxed text-foreground focus-visible:border-ring focus-visible:outline-none"
        />
        {error && <p className="text-fs-sm text-destructive">{error}</p>}
        <div className="flex gap-2">
          <Button size="sm" disabled={ocupado || titulo.trim() === ''} onClick={() => void guardar()}>
            Save
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setEditando(false)}>Cancel</Button>
        </div>
      </div>
    )
  }

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

      {error && <p className="text-fs-sm text-destructive">{error}</p>}

      {/* Corregir y borrar. Hasta ahora esta pantalla sólo sabía GUARDAR: una memoria mal
          escrita se quedaba mal para siempre, aunque un agente sí pudiera corregirla por
          `memory_update`. Y no poder borrar lo que escribiste en tu propia memoria no es una
          falta de comodidad, es un problema. */}
      <div className="mt-1 flex flex-wrap gap-2">
        <Button variant="outline" size="sm" onClick={onConectar}>
          Connect to another memory
        </Button>
        {!detail.supersededBy && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => { setTitulo(detail.title); setCuerpo(detail.content ?? ''); setEditando(true) }}
          >
            Edit
          </Button>
        )}
        <Button variant="ghost" size="sm" onClick={() => setConfirmandoBorrado(true)}>Delete</Button>
      </div>

      {confirmandoBorrado && (
        <div className="flex flex-col gap-2 rounded-md border border-destructive/40 p-2">
          <p className="text-fs-sm text-foreground">
            Delete this memory? It also disappears from your other machines.
          </p>
          <div className="flex gap-2">
            <Button variant="destructive" size="sm" disabled={ocupado} onClick={() => void borrar()}>
              Delete
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setConfirmandoBorrado(false)}>Cancel</Button>
          </div>
        </div>
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
