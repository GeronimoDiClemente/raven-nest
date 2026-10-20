// Spec §4.4 (direccion C, "el hilo es la pantalla"), §5.2 y §7 (2026-10-19). Reusa
// `teams-workspace` como cascara visual — es la misma forma de overlay a pantalla completa
// que Personal y Teams — y suma `.memories-workspace` para el z-index de arriba de todo
// (§5.4).
//
// SIN chips de scope (decision 3): el grafo ya dibuja las ramas con autor y fecha, asi que
// "tuyo vs del equipo" se ve por color. Ademas evita heredar el acoplamiento de
// PersonalWorkspace.tsx:306, donde elegir un equipo llama a switchTeam y cambia chat,
// presencia y stats de TODA la app.
//
// 2026-10-19: la vista principal YA NO tiene configuracion. Las tarjetas de sync, cifrado,
// vinculo de equipo y notas en disco se mudaron a `MemorySettingsView` (§7 de la spec), que
// esta pantalla abre como una SEGUNDA vista detras del boton "Settings" del header — no una
// pantalla aparte, para no duplicar el shell de overlay. `vista` decide cual de las dos se
// dibuja; las dos comparten el mismo header con Back/titulo.
//
// 2026-10-20 (spec "Memories estilo Obsidian" §3): la vista principal pasa a tres columnas —
// explorer por carpetas a la izquierda, pestañas en el centro (Graph fija, Team thread fija
// si el repo tiene el hilo, una por nota, New memory) y a la derecha los filtros del grafo o
// el panel de la nota. Salen la lista de abajo y el cuadro del grafo. Esta pantalla y
// `MemoriesNoteTab` siguen siendo lo unico que habla con `window.memory`: los componentes de
// `memories/` entran por props y salen por callbacks.
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { Panel, PanelGroup, PanelResizeHandle, type ImperativePanelHandle } from 'react-resizable-panels'
import { Settings } from 'lucide-react'
import { cn } from 'cn'
import { useMemories } from '../hooks/useMemories'
import { useCrossProjectMemories } from '../hooks/useCrossProjectMemories'
import { useMemoryGraph } from '../hooks/useMemoryGraph'
import { useGraphFilters } from '../hooks/useGraphFilters'
import { useMemoryTabs } from '../hooks/useMemoryTabs'
import { useTeamThreadEnabled } from '../hooks/useTeamThreadEnabled'
import { armarArbol } from '../lib/memories-tree'
import { tabId, type MemoryTab } from '../lib/memory-tabs'
import { almacenDePaneles } from '../lib/almacen-seguro'
import type { CandidatoDeLink } from '../lib/cm-wikilink-autocomplete'
import { ICON_SIZE } from '../lib/icons'
import NewMemoryForm from './NewMemoryForm'
import MemoriesStatusRow from './MemoriesStatusRow'
import MemorySettingsView from './MemorySettingsView'
import TeamThreadPanel from './TeamThreadPanel'
import MemoriesNoteTab from './MemoriesNoteTab'
import MemoriesExplorer from './memories/MemoriesExplorer'
import MemoryTabs from './memories/MemoryTabs'
import MemoryGraph2D from './memories/MemoryGraph2D'
import GraphFiltersPanel from './memories/GraphFiltersPanel'
import { Button } from '@/components/ui/button'

interface Props {
  onClose: () => void
  activeRepoPath: string | null
  onOpenFile: (relPath: string) => void
  /**
   * Task 8 (migracion Tailwind/shadcn, resolucion 2): abre el dialogo NATIVO de carpeta
   * (App.tsx: handleRepoLink) y setea el repo activo de la pestaña — el grafo aparece sin
   * salir de esta pantalla, sin pelear con el z-index del overlay. Opcional: sin ella el
   * boton del estado vacio no se renderiza, para que el arbol siga montando en callers
   * y tests viejos que no la pasan.
   */
  onLinkRepo?: () => void
  /** workspace-shell-design §1: true while App.tsx holds this mounted after onClose so the zoomOut exit animation can play. See TeamsWorkspaceProps.closing (same shared shell, same mechanism). */
  closing?: boolean
  /** Con que vista abre. `App.tsx` la pasa cuando "Account" en Settings pide ir directo a
   *  Memory settings en vez de a los nodos (Task 3/6). */
  vistaInicial?: 'memorias' | 'settings'
  /** La paleta ANSI del tema de terminal activo (spec §5), para colorear el grafo, el
   *  explorer y las pestañas por tipo — mismo color en todos. */
  ansi?: readonly string[]
  /** El tour "How it works" de la vista principal (Task 7). */
  onHowItWorks: () => void
  /** El tour de Memory settings (Task 7) — distinto del de arriba: navega el rail de
   *  secciones en vez de los nodos. */
  onMemorySettingsTour: () => void
  /**
   * Avisa cuando `vista` cambia — INCLUIDO el valor inicial, al montar. Review final de
   * rama, IMPORTANT #5: `App.tsx` decidía si mostrar la bienvenida de Memories mirando
   * `vistaInicial` (la prop, que solo se lee una vez), no la vista que esta pantalla
   * dibuja AHORA. Repro: Account → Memory settings → Back a "Memories" (navegación
   * INTERNA, `setVista`, que `App.tsx` nunca se entera) → "How it works" → `forced` queda
   * en `true` pero el predicado seguía leyendo `vistaInicial === 'settings'` y no
   * mostraba nada — así que `forced` tampoco se resetea (eso lo hace `onSkip`/`onTour` de
   * `MemoriesWelcome`, que nunca llega a montarse) y la bienvenida se auto-abre la
   * PRÓXIMA vez que se abre Memories, sin que nadie la haya pedido.
   */
  onVistaChange?: (vista: 'memorias' | 'settings') => void
}

/** Ventana angosta (spec §3): el panel derecho arranca colapsado. */
const ANCHO_ANGOSTO = 1100

export default function MemoriesWorkspace({
  onClose, activeRepoPath, onOpenFile, onLinkRepo, closing = false, vistaInicial, ansi,
  onHowItWorks, onMemorySettingsTour, onVistaChange,
}: Props) {
  const state = useMemories()

  /** Cual de las dos vistas se dibuja — spec §7. Memory settings vive DETRAS del boton
   *  "Settings" del header, no en una pantalla propia: comparten header y shell. */
  const [vista, setVista] = useState<'memorias' | 'settings'>(vistaInicial ?? 'memorias')

  // Incluye el valor inicial a proposito (sin arreglo de dependencias que lo salte): el
  // caller necesita saber la vista real desde el primer render, no solo las navegaciones
  // que vengan despues.
  useEffect(() => { onVistaChange?.(vista) }, [vista, onVistaChange])

  /**
   * La búsqueda vive acá y no adentro del explorer, porque no es sólo del explorer: el grafo
   * resalta lo que coincide. Un solo estado, una sola consulta.
   */
  const busqueda = useCrossProjectMemories()

  /**
   * Cambia cuando la base cambió —un agente escribió, se guardó, se conectó o se borró algo—:
   * el grafo, la búsqueda y cada nota abierta se vuelven a pedir.
   */
  const [version, setVersion] = useState(0)

  /**
   * Un agente escribió una memoria desde la terminal: todo se vuelve a pedir solo.
   *
   * Es la mitad interesante del producto —que lo escriban ellos mientras trabajás— y hasta
   * ahora la pantalla no se enteraba: sólo se refrescaba por acciones tuyas, así que una
   * memoria nueva no aparecía hasta cerrar y reabrir el overlay.
   */
  // `state` es un objeto nuevo en cada render, así que un efecto que dependa de él se
  // re-suscribe y se da de baja en cada uno. La suscripción se hace UNA vez, al montar, y el
  // callback lee el `refresh` vigente desde un ref.
  const refrescarEstado = useRef(state.refresh)
  refrescarEstado.current = state.refresh

  useEffect(() => {
    const suscribir = window.memory?.onChanged
    if (!suscribir) return
    return suscribir(() => {
      setVersion((v) => v + 1)
      void refrescarEstado.current()
    })
  }, [])

  const [includeSimilar, setIncludeSimilar] = useState(true)
  const grafo = useMemoryGraph(includeSimilar)
  const filtros = useGraphFilters(grafo.graph, ansi)

  const refrescarBusqueda = useRef(busqueda.refresh)
  refrescarBusqueda.current = busqueda.refresh
  const refrescarGrafo = grafo.refresh
  useEffect(() => {
    if (version === 0) return
    refrescarBusqueda.current()
    refrescarGrafo()
  }, [version, refrescarGrafo])

  const conHilo = useTeamThreadEnabled(activeRepoPath)
  const tabs = useMemoryTabs(conHilo)
  const activa: MemoryTab = tabs.tabs.find((t) => tabId(t) === tabs.activeId) ?? tabs.tabs[0]

  /**
   * Los ids a resaltar. `null` sin búsqueda = grafo a color pleno y explorer completo.
   *
   * Son los que la búsqueda tiene cargados, que es una página de 100: con más coincidencias
   * que eso, el grafo resalta las mismas que el explorer muestra.
   */
  const resaltados = useMemo(
    () => (busqueda.query.trim() ? new Set(busqueda.items.map((i) => i.syncId)) : null),
    [busqueda.query, busqueda.items],
  )

  // El explorer sale del grafo CRUDO, no de `filtros.data`: los filtros (tipos, foco,
  // huérfanas) son del grafo. Decisión del 20-10: apagar un tipo no esconde memorias del
  // explorer.
  const carpetas = useMemo(() => armarArbol(grafo.graph?.nodes ?? [], resaltados), [grafo.graph, resaltados])

  const { candidatos, titulosPorId } = useMemo(() => {
    const c: CandidatoDeLink[] = []
    const t = new Map<string, { title: string; type: string }>()
    for (const n of grafo.graph?.nodes ?? []) {
      if (n.pending) continue
      t.set(n.syncId, { title: n.title, type: n.type })
      // Un `[[...]]` a una versión reemplazada no se ofrece: nombraría algo que ya no vale.
      if (!n.superseded) c.push({ syncId: n.syncId, title: n.title, topicKey: n.topicKey, aliases: n.aliases })
    }
    return { candidatos: c, titulosPorId: t }
  }, [grafo.graph])

  /** El título de cada pestaña de nota según su detalle (más fresco que el del grafo, y el
   *  único que hay para una memoria recién escrita que el grafo todavía no trae). */
  const [titulosDeTabs, setTitulosDeTabs] = useState<ReadonlyMap<string, { title: string; type: string }>>(new Map())
  const alTitulo = useCallback((syncId: string, title: string, type: string) => {
    setTitulosDeTabs((prev) => {
      const ya = prev.get(syncId)
      if (ya && ya.title === title && ya.type === type) return prev
      const next = new Map(prev)
      next.set(syncId, { title, type })
      return next
    })
  }, [])

  const etiqueta = (t: MemoryTab): { texto: string; tipo?: string } => {
    switch (t.kind) {
      case 'graph': return { texto: 'Graph' }
      case 'thread': return { texto: 'Team thread' }
      case 'new': return { texto: 'New memory' }
      case 'note': {
        const x = titulosDeTabs.get(t.syncId) ?? titulosPorId.get(t.syncId)
        return { texto: x?.title || 'Untitled', tipo: x?.type }
      }
    }
  }

  /** La carpeta elegida en el explorer: decide a qué proyecto va una memoria nueva. */
  const [carpeta, setCarpeta] = useState<string | null>(null)

  /**
   * Cuando estás conectando dos memorias, guarda la PRIMERA (la de la pestaña cuyo menú «⋯»
   * dijo "Connect to another memory…"). Dos clicks y no un formulario: conectar es decir
   * "esta va con esta", y lo natural es señalar las dos — un diálogo con dos selectores te
   * obligaría a buscar por título lo que ya estás viendo en pantalla.
   */
  const [conectandoDesde, setConectandoDesde] = useState<string | null>(null)
  const [avisoDeEnlace, setAvisoDeEnlace] = useState<string | null>(null)
  const cancelarConexion = useCallback(() => { setConectandoDesde(null); setAvisoDeEnlace(null) }, [])

  const conectar = useCallback(async (desde: string, id: string) => {
    const api = window.memory?.link
    if (!api) {
      setAvisoDeEnlace('This build cannot connect memories yet.')
      setConectandoDesde(null)
      return
    }
    setConectandoDesde(null)
    let res: { ok: boolean; error?: string }
    try {
      res = await api(desde, id)
    } catch {
      res = { ok: false }
    }
    if (!res.ok) {
      setAvisoDeEnlace(res.error === 'memory_not_found'
        ? 'One of those memories is no longer there.'
        : 'Could not connect them.')
      return
    }
    setAvisoDeEnlace(null)
    // La línea nueva se tiene que VER: el grafo y las notas abiertas se vuelven a pedir.
    setVersion((v) => v + 1)
  }, [])

  const { open: abrirPestana, close: cerrarPestana, replace: reemplazarPestana } = tabs

  /** Un click en una memoria (explorer, nodo, `[[link]]`, backlink) la abre — salvo que
   *  estés conectando: ahí ese click CIERRA la relación. */
  const alAbrir = useCallback((syncId: string, opts: { background: boolean }) => {
    if (conectandoDesde) {
      if (syncId !== conectandoDesde) void conectar(conectandoDesde, syncId)
      return
    }
    abrirPestana({ kind: 'note', syncId }, { background: opts.background })
  }, [conectandoDesde, conectar, abrirPestana])

  // A qué repo va cada pestaña «New memory», decidido al abrirla. El form sólo sabe escribir
  // en el repo activo o en Global: la carpeta Global elige Global y cualquier otra el repo
  // activo (el spec no pide crear en un repo que no está abierto).
  const repoDeNuevas = useRef(new Map<string, string | null>())
  const contadorDeNuevas = useRef(0)
  const abrirNueva = useCallback((titulo: string) => {
    contadorDeNuevas.current += 1
    const key = `${Date.now()}-${contadorDeNuevas.current}`
    repoDeNuevas.current.set(key, carpeta === 'global' ? null : activeRepoPath)
    abrirPestana({ kind: 'new', key, titulo })
  }, [carpeta, activeRepoPath, abrirPestana])

  const alBorrar = useCallback((syncId: string) => {
    cerrarPestana(tabId({ kind: 'note', syncId }))
    setVersion((v) => v + 1)
    void refrescarEstado.current()
  }, [cerrarPestana])

  const alConectar = useCallback((syncId: string) => {
    setConectandoDesde(syncId)
    setAvisoDeEnlace(null)
  }, [])

  // Teclado en la raíz del overlay, NO en `window` (Review Focus 1): Ctrl/Cmd+W tiene que
  // cerrar la pestaña y morir acá — nunca llegar al menú de Electron ni a otro handler que
  // cierre la ventana.
  const alTeclear = (e: KeyboardEvent<HTMLDivElement>) => {
    if (vista !== 'memorias') return
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'w') {
      e.preventDefault()
      e.stopPropagation()
      cerrarPestana(tabs.activeId)
      return
    }
    if (e.key === 'Escape' && conectandoDesde) {
      e.preventDefault()
      e.stopPropagation()
      cancelarConexion()
    }
  }

  const panelDerechoRef = useRef<ImperativePanelHandle>(null)
  const [panelDerechoEl, setPanelDerechoEl] = useState<HTMLElement | null>(null)
  useEffect(() => {
    if (vista !== 'memorias' || window.innerWidth >= ANCHO_ANGOSTO) return
    try {
      panelDerechoRef.current?.collapse()
    } catch {
      // Sin layout calculado (el build "node" de react-resizable-panels, que es el que
      // resuelve vitest, no corre los layout effects): el panel queda con su ancho por
      // defecto, que es peor pero no rompe nada.
    }
  }, [vista])

  const memoriasReales = grafo.graph ? grafo.graph.nodes.filter((n) => !n.pending).length : 0
  const sinMemorias = !grafo.loading && !grafo.error && memoriasReales === 0
  const nadaConectado = filtros.data.nodes.length === 0 && filtros.filtros.hideOrphans && filtros.data.orphansHidden > 0

  const contenidoDelGrafo = () => {
    if (grafo.error) return <p className="p-6 text-fs-sm text-muted-foreground">{grafo.error}</p>
    if (!grafo.graph && grafo.loading) return <p className="p-6 text-fs-sm text-muted-foreground">Loading…</p>
    if (sinMemorias) return <p className="p-6 text-fs-sm text-muted-foreground">No memories yet</p>
    if (nadaConectado) {
      return (
        <div className="flex flex-col items-start gap-2 p-6">
          <p className="text-fs-sm text-muted-foreground">
            Nothing is connected yet — show unconnected to see every memory.
          </p>
          <Button variant="outline" size="sm" onClick={() => filtros.setHideOrphans(false)}>Show unconnected</Button>
        </div>
      )
    }
    return (
      <MemoryGraph2D
        modo="global"
        data={filtros.data}
        resaltados={resaltados}
        escalaDeNodo={filtros.filtros.escalaDeNodo}
        distanciaDeLinks={filtros.filtros.distanciaDeLinks}
        onOpen={alAbrir}
      />
    )
  }

  return (
    <div className={`teams-workspace memories-workspace${closing ? ' closing' : ''}`} onKeyDown={alTeclear}>
      <div className="teams-workspace-header">
        <button
          className="tw-back-btn"
          onClick={() => (vista === 'settings' ? setVista('memorias') : onClose())}
        >
          <svg width="13" height="13" viewBox="0 0 13 13" fill="none" style={{ display: 'inline-block', verticalAlign: 'middle', marginRight: 5 }}>
            <path d="M8 2L4 6.5L8 11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          {vista === 'settings' ? 'Memories' : 'Back'}
        </button>

        <div className="tw-header-center">
          {/* Sólo el título, como Teams y Personal. El glifo del grafo que había acá era el
              único ícono en el header de una pantalla grande, dibujado a mano y pintado con
              `--raven-blue`: un color de marca donde el resto de la app usa texto. */}
          <span className="tw-header-title">{vista === 'settings' ? 'Memory settings' : 'Memories'}</span>
        </div>

        {vista === 'memorias' && (
          <div className="tw-header-right">
            <Button variant="ghost" size="sm" onClick={onHowItWorks} data-tour-id="memories-how">
              How it works
            </Button>
            <Button
              variant="outline"
              size="sm"
              aria-label="Memory settings"
              onClick={() => setVista('settings')}
              data-tour-id="memories-settings"
            >
              <Settings size={ICON_SIZE.sm} aria-hidden />
              Settings
            </Button>
          </div>
        )}
      </div>

      {vista === 'settings' ? (
        <MemorySettingsView
          activeRepoPath={activeRepoPath}
          onLinkRepo={onLinkRepo}
          onHowItWorks={onMemorySettingsTour}
        />
      ) : (
        <>
          <MemoriesStatusRow state={state} />

          <div className="teams-workspace-body min-h-0">
            <PanelGroup direction="horizontal" autoSaveId="nest:memories:columnas" storage={almacenDePaneles} className="min-h-0 flex-1">
              <Panel defaultSize={18} minSize={12} collapsible id="explorer" order={1}>
                <MemoriesExplorer
                  carpetas={carpetas}
                  query={busqueda.query}
                  onQuery={busqueda.setQuery}
                  activoId={activa.kind === 'note' ? activa.syncId : null}
                  carpetaSeleccionada={carpeta}
                  onSeleccionarCarpeta={setCarpeta}
                  onOpen={alAbrir}
                  onNew={() => abrirNueva('')}
                  truncadas={grafo.truncated}
                  ansi={ansi}
                  cargando={grafo.loading && !grafo.graph}
                />
              </Panel>
              <PanelResizeHandle className="w-px bg-border" />
              <Panel minSize={30} id="centro" order={2} className="flex min-h-0 flex-col">
                <div data-tour-id="memories-tabs">
                  <MemoryTabs
                    tabs={tabs.tabs}
                    activeId={tabs.activeId}
                    etiqueta={etiqueta}
                    ansi={ansi}
                    onActivate={tabs.activate}
                    onClose={cerrarPestana}
                  />
                </div>

                {conectandoDesde && (
                  <div className="m-2 flex shrink-0 items-center gap-2 rounded-md border border-border bg-accent px-3 py-2">
                    <span className="min-w-0 flex-1 text-fs-sm text-foreground">
                      Pick the memory this one goes with — in the explorer or in the graph.
                    </span>
                    <Button variant="ghost" size="sm" onClick={cancelarConexion}>Cancel</Button>
                  </div>
                )}
                {avisoDeEnlace && <p className="mx-3 my-2 shrink-0 text-fs-sm text-muted-foreground">{avisoDeEnlace}</p>}

                <div className="relative flex min-h-0 flex-1 flex-col">
                  {activa.kind === 'graph' && (
                    <div data-tour-id="memories-graph" className="relative min-h-0 flex-1">
                      {contenidoDelGrafo()}
                    </div>
                  )}

                  {/* Sin la caja de 16rem que el panel trae para cuando vivía apilado al pie:
                      acá es la pestaña entera. */}
                  {activa.kind === 'thread' && activeRepoPath && (
                    <div className="min-h-0 flex-1 overflow-y-auto p-3 [&_.team-thread-panel]:max-h-none">
                      <TeamThreadPanel activeRepoPath={activeRepoPath} onOpenFile={onOpenFile} />
                    </div>
                  )}

                  {/* Las pestañas de nota y de New memory quedan TODAS montadas, ocultas salvo
                      la activa: cambiar de pestaña no desmonta el editor (ni corta su
                      autoguardado) ni pierde lo escrito en un formulario. Cerrar la pestaña sí
                      desmonta, y el desmontaje guarda lo pendiente. */}
                  {tabs.tabs.map((t) => {
                    if (t.kind !== 'note' && t.kind !== 'new') return null
                    const id = tabId(t)
                    const esActiva = id === tabs.activeId
                    return (
                      <div
                        key={id}
                        hidden={!esActiva}
                        className={cn('min-h-0 flex-1 flex-col', esActiva ? 'flex' : 'hidden')}
                      >
                        {t.kind === 'note' ? (
                          <MemoriesNoteTab
                            syncId={t.syncId}
                            version={version}
                            graphData={filtros.data}
                            ansi={ansi}
                            candidatos={candidatos}
                            titulosPorId={titulosPorId}
                            panelDerecho={esActiva ? panelDerechoEl : null}
                            onOpen={alAbrir}
                            onCreate={abrirNueva}
                            onConnect={alConectar}
                            onDeleted={alBorrar}
                            onTitulo={alTitulo}
                          />
                        ) : (
                          <div className="min-h-0 flex-1 overflow-y-auto p-4">
                            <div className="mx-auto w-full max-w-[720px]">
                              <NewMemoryForm
                                activeRepoPath={repoDeNuevas.current.has(t.key) ? repoDeNuevas.current.get(t.key) ?? null : activeRepoPath}
                                tituloInicial={t.titulo}
                                onClose={() => cerrarPestana(id)}
                                onSaved={(syncId) => {
                                  if (syncId) reemplazarPestana(id, { kind: 'note', syncId })
                                  else cerrarPestana(id)
                                  setVersion((v) => v + 1)
                                  // La fila de estado tiene su propio ciclo de lectura: sin
                                  // esto decia "0 items" al lado de la memoria recien escrita.
                                  void state.refresh()
                                }}
                              />
                            </div>
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              </Panel>
              <PanelResizeHandle className="w-px bg-border" />
              <Panel ref={panelDerechoRef} defaultSize={22} minSize={15} collapsible id="derecho" order={3}>
                {/* Con Graph activa: filtros y leyenda. Con una nota: su panel, que la
                    pestaña dibuja por portal acá. Con Team thread o New memory: vacío. */}
                <aside ref={setPanelDerechoEl} aria-label="Side panel" className="h-full overflow-y-auto">
                  {activa.kind === 'graph' && (
                    <GraphFiltersPanel
                      graph={grafo.graph}
                      ansi={ansi}
                      filtros={filtros}
                      includeSimilar={includeSimilar}
                      onIncludeSimilar={setIncludeSimilar}
                    />
                  )}
                </aside>
              </Panel>
            </PanelGroup>
          </div>
        </>
      )}
    </div>
  )
}
