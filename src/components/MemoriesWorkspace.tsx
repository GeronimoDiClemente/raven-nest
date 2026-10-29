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
// 2026-10-21 (spec Memory settings como pestaña): la configuración es una PESTAÑA más
// (Settings, cerrable). Con ella activa el explorer muestra las secciones y el panel derecho
// se colapsa solo; ya no hay una segunda vista ni un Back que vuelva a los nodos.
//
// 2026-10-20 (spec "Memories estilo Obsidian" §3): la vista principal pasa a tres columnas —
// explorer por carpetas a la izquierda, pestañas en el centro (Graph fija, Team thread fija
// si el repo tiene el hilo, una por nota, New memory) y a la derecha los filtros del grafo o
// el panel de la nota. Salen la lista de abajo y el cuadro del grafo. Esta pantalla y
// `MemoriesNoteTab` siguen siendo lo unico que habla con `window.memory`: los componentes de
// `memories/` entran por props y salen por callbacks.
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { Panel, PanelGroup, PanelResizeHandle, type ImperativePanelGroupHandle, type ImperativePanelHandle } from 'react-resizable-panels'
import { Settings } from 'lucide-react'
import { cn } from 'cn'
import { useMemories } from '../hooks/useMemories'
import { useCrossProjectMemories } from '../hooks/useCrossProjectMemories'
import { useMemoryGraph } from '../hooks/useMemoryGraph'
import { useGraphFilters } from '../hooks/useGraphFilters'
import { useMemoryTabs } from '../hooks/useMemoryTabs'
import { useTeamThreadSettings } from '../hooks/useTeamThreadSettings'
import { useMemoryPrefs } from '../hooks/useMemoryPrefs'
import { conFiltros, FILTROS_POR_DEFECTO, type FiltrosGuardados } from '../lib/memory-prefs'
import { armarArbol } from '../lib/memories-tree'
import { pestanaDelHilo } from '../lib/pestana-del-hilo'
import { SECCIONES_DE_SETTINGS, tabId, type MemoryTab, type SeccionDeSettings } from '../lib/memory-tabs'
import { leer, escribir } from '../lib/almacen-seguro'
import type { CandidatoDeLink } from '../lib/cm-wikilink-autocomplete'
import { ICON_SIZE } from '../lib/icons'
import NewMemoryForm from './NewMemoryForm'
import MemoriesStatusRow from './MemoriesStatusRow'
import MemorySettingsTab from './MemorySettingsTab'
import TeamThreadPanel from './TeamThreadPanel'
import MemoriesNoteTab from './MemoriesNoteTab'
import MemoriesExplorer from './memories/MemoriesExplorer'
import SettingsSectionList from './memories/settings/SettingsSectionList'
import MemoryTabs from './memories/MemoryTabs'
import MemoryGraph2D from './memories/MemoryGraph2D'
import GraphFiltersPanel from './memories/GraphFiltersPanel'
import { Button } from '@/components/ui/button'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from './ui/alert-dialog'

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
  /** La paleta ANSI del tema de terminal activo (spec §5), para colorear el grafo, el
   *  explorer y las pestañas por tipo — mismo color en todos. */
  ansi?: readonly string[]
  /** El tour "How it works" de la vista principal (Task 7). */
  onHowItWorks: () => void
  /** Sube cada vez que algo de afuera (Account → "Memory settings") pide abrir la pestaña
   *  Settings; useMemoryTabs atiende cada pedido una vez por sesión (D5). */
  pedidoDeSettings?: number
  /** La sección que trae el pedido (Keep syncing → 'sync'); sin ella conserva la actual. */
  seccionDeSettings?: SeccionDeSettings
  /** Plan & billing: cierra Memories y abre Settings › Account. */
  onPlanYFacturacion?: () => void
  /** Sube cada vez que arranca el tour de Memories: activa Graph para que sus anclas se vean
   *  (final review I2). Mismo mecanismo que `pedidoDeSettings`. */
  pedidoDelGrafo?: number
}

/** Ventana angosta (spec §3): el panel derecho arranca colapsado. */
const ANCHO_ANGOSTO = 1100

/**
 * El ancho de las tres columnas, en %. Se guarda a mano (con `onLayout`) y no con el
 * `autoSaveId` de react-resizable-panels porque hay colapsos AUTOMATICOS del panel derecho
 * (ventana angosta, pestana Team thread) que no son una eleccion de la persona y no tienen que
 * quedar guardados: con `autoSaveId`, una ventana ancha arrancaba despues con el panel cerrado.
 */
const CLAVE_COLUMNAS = 'nest:memories:columnas'
const COLUMNAS_POR_DEFECTO: [number, number, number] = [18, 60, 22]

function leerColumnas(): [number, number, number] {
  try {
    const v: unknown = JSON.parse(leer(CLAVE_COLUMNAS) ?? 'null')
    if (
      Array.isArray(v) && v.length === 3
      && v.every((n) => typeof n === 'number' && Number.isFinite(n) && n >= 0)
      && Math.abs((v as number[]).reduce((a, b) => a + b, 0) - 100) < 1
    ) return v as [number, number, number]
  } catch { /* JSON roto: por defecto */ }
  return COLUMNAS_POR_DEFECTO
}

export default function MemoriesWorkspace({
  onClose, activeRepoPath, onOpenFile, onLinkRepo, closing = false, ansi, onHowItWorks,
  pedidoDeSettings = 0, pedidoDelGrafo = 0, seccionDeSettings, onPlanYFacturacion,
}: Props) {
  const state = useMemories()

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

  const prefsMem = useMemoryPrefs()
  // Lo recordado (D14). Con las prefs ya en la caché de sesión arranca de ahí; en la primera
  // apertura llegan después y se aplican abajo, una vez.
  const recordadosAlMontar = useRef<FiltrosGuardados | null>(
    prefsMem.cargadas && prefsMem.prefs.graph.remember ? prefsMem.prefs.graph.filtros ?? null : null,
  )
  const [includeSimilar, setIncludeSimilar] = useState(recordadosAlMontar.current?.inferidas ?? FILTROS_POR_DEFECTO.inferidas)
  const grafo = useMemoryGraph(includeSimilar)
  // El mismo interruptor decide qué se le pide a main (similar) y qué se dibuja (todas las
  // inferidas): ver useGraphFilters.
  const filtros = useGraphFilters(grafo.graph, ansi, includeSimilar, recordadosAlMontar.current)

  /** true cuando lo guardado ya se aplicó: antes, guardar pisaría lo recordado con defaults
   *  (Review Focus 2). */
  const restaurado = useRef(prefsMem.cargadas)
  const aplicarFiltros = filtros.aplicar
  useEffect(() => {
    if (restaurado.current || !prefsMem.cargadas) return
    restaurado.current = true
    const g = prefsMem.prefs.graph
    if (g.remember && g.filtros) { aplicarFiltros(g.filtros); setIncludeSimilar(g.filtros.inferidas) }
  }, [prefsMem.cargadas, prefsMem.prefs.graph, aplicarFiltros])

  const guardables = useMemo<FiltrosGuardados>(() => ({
    colorBy: filtros.filtros.colorBy,
    hideOrphans: filtros.filtros.hideOrphans,
    tiposOcultos: [...filtros.filtros.tiposOcultos].sort(),
    escalaDeNodo: filtros.filtros.escalaDeNodo,
    distanciaDeLinks: filtros.filtros.distanciaDeLinks,
    inferidas: includeSimilar,
  }), [filtros.filtros, includeSimilar])
  const recordar = prefsMem.prefs.graph.remember
  const actualizarPrefs = prefsMem.actualizar
  /** Lo que falta guardar, para el flush al desmontar (cerrar el overlay dentro de los 300 ms). */
  const pendienteDeGuardar = useRef<FiltrosGuardados | null>(null)
  useEffect(() => {
    if (!restaurado.current || !recordar) { pendienteDeGuardar.current = null; return }
    pendienteDeGuardar.current = guardables
    const t = setTimeout(() => {
      pendienteDeGuardar.current = null
      actualizarPrefs((p) => conFiltros(p, guardables))
    }, 300)
    return () => clearTimeout(t)
  }, [guardables, recordar, actualizarPrefs])
  useEffect(() => () => {
    const f = pendienteDeGuardar.current
    if (f) actualizarPrefs((p) => conFiltros(p, f))
  }, [actualizarPrefs])
  const restablecerFiltros = filtros.restablecer
  const restablecerGrafo = useCallback(() => { restablecerFiltros(); setIncludeSimilar(true) }, [restablecerFiltros])

  const refrescarBusqueda = useRef(busqueda.refresh)
  refrescarBusqueda.current = busqueda.refresh
  const refrescarGrafo = grafo.refresh
  useEffect(() => {
    if (version === 0) return
    refrescarBusqueda.current()
    refrescarGrafo()
  }, [version, refrescarGrafo])

  // El estado del hilo, UNO solo para la pestaña Team thread y el toggle de Branch notes de la
  // pestaña Settings (D3): prender o apagar se ve en el acto.
  const hilo = useTeamThreadSettings(activeRepoPath)
  const conHilo = pestanaDelHilo(activeRepoPath, hilo)
  const tabs = useMemoryTabs(conHilo, pedidoDeSettings, pedidoDelGrafo, seccionDeSettings)
  const activa: MemoryTab = tabs.tabs.find((t) => tabId(t) === tabs.activeId) ?? tabs.tabs[0]
  const settingsActiva = activa.kind === 'settings'

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
      case 'settings': return { texto: 'Settings' }
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

  const { open: abrirPestana, close: cerrarPestana, replace: reemplazarPestana, openSettings: abrirSettings } = tabs

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

  /**
   * Las pestañas «New memory» con algo escrito (final review F4). Cerrarlas por cualquier
   * camino —×, click del medio, Ctrl/Cmd+W, Cancel— pregunta antes de tirar lo escrito; sin
   * nada escrito cierran directo. Un ref y no un estado: el form avisa en cada cambio y el
   * cierre sólo necesita leerlo.
   */
  const nuevasSucias = useRef(new Set<string>())
  const [descartar, setDescartar] = useState<string | null>(null)
  const cerrar = useCallback((id: string) => {
    if (nuevasSucias.current.has(id)) { setDescartar(id); return }
    cerrarPestana(id)
  }, [cerrarPestana])
  const confirmarDescarte = () => {
    const id = descartar
    setDescartar(null)
    if (!id) return
    nuevasSucias.current.delete(id)
    cerrarPestana(id)
  }

  /**
   * Foco (final review F8): Ctrl/Cmd+W y Esc se escuchan en la raíz, así que el foco tiene que
   * estar adentro. Un click en el canvas no lo mueve (d3-zoom cancela el mousedown) y cerrar
   * una pestaña desmonta el elemento que lo tenía: en los dos casos el siguiente Ctrl+W iba a
   * la ventana y escondía Nest.
   */
  const raizRef = useRef<HTMLDivElement>(null)
  useEffect(() => { raizRef.current?.focus({ preventScroll: true }) }, [])
  useEffect(() => {
    const raiz = raizRef.current
    const activo = document.activeElement
    if (raiz && (!activo || activo === document.body)) raiz.focus({ preventScroll: true })
  }, [tabs.activeId])
  /** Abrir desde un nodo del grafo: el título de la nota recibe el foco. */
  const [focoDeNota, setFocoDeNota] = useState<{ syncId: string; n: number }>({ syncId: '', n: 0 })
  const alAbrirDesdeElGrafo = useCallback((syncId: string, opts: { background: boolean }) => {
    const conectando = conectandoDesde !== null
    alAbrir(syncId, opts)
    if (!opts.background && !conectando) setFocoDeNota((f) => ({ syncId, n: f.n + 1 }))
  }, [alAbrir, conectandoDesde])

  const alConectar = useCallback((syncId: string) => {
    setConectandoDesde(syncId)
    setAvisoDeEnlace(null)
  }, [])

  // Teclado en la raíz del overlay, NO en `window` (Review Focus 1): Ctrl/Cmd+W tiene que
  // cerrar la pestaña y morir acá — nunca llegar al menú de Electron ni a otro handler que
  // cierre la ventana.
  const alTeclear = (e: KeyboardEvent<HTMLDivElement>) => {
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'w') {
      e.preventDefault()
      e.stopPropagation()
      cerrar(tabs.activeId)
      return
    }
    if (e.key === 'Escape' && conectandoDesde) {
      e.preventDefault()
      e.stopPropagation()
      cancelarConexion()
    }
  }

  // --- Columnas: tamanos guardados y colapsos automaticos del panel derecho ---------------
  const [columnas] = useState(leerColumnas)
  const grupoRef = useRef<ImperativePanelGroupHandle>(null)
  const panelDerechoRef = useRef<ImperativePanelHandle>(null)
  const [panelDerechoEl, setPanelDerechoEl] = useState<HTMLElement | null>(null)
  /** El ancho que tenia el panel derecho antes de un colapso automatico; `null` = no esta
   *  colapsado por nosotros (abierto, o cerrado a mano por la persona). */
  const anchoAntesDelAuto = useRef<number | null>(null)
  /** Por que sigue colapsado solo. Se reabre cuando no queda ningun motivo. */
  const motivosDelAuto = useRef({ angosto: false, pestana: false })
  /** true mientras el layout lo cambia un colapso/reapertura automatico: no se guarda. */
  const cambioAutomatico = useRef(false)

  // Las llamadas imperativas necesitan el layout ya calculado. En el renderer siempre lo
  // esta; no en el build "node" de react-resizable-panels (el que resuelve vitest por
  // defecto), que no corre layout effects y donde `collapse()` tira "Panel size not found".
  const hayLayout = () => (grupoRef.current?.getLayout().length ?? 0) === 3

  const colapsarSolo = useCallback((motivo: 'angosto' | 'pestana') => {
    motivosDelAuto.current[motivo] = true
    const panel = panelDerechoRef.current
    if (!panel || !hayLayout() || anchoAntesDelAuto.current !== null || panel.isCollapsed()) return
    anchoAntesDelAuto.current = panel.getSize()
    cambioAutomatico.current = true
    try { panel.collapse() } finally { cambioAutomatico.current = false }
  }, [])

  const liberarAuto = useCallback((motivo: 'angosto' | 'pestana') => {
    motivosDelAuto.current[motivo] = false
    if (motivosDelAuto.current.angosto || motivosDelAuto.current.pestana) return
    const panel = panelDerechoRef.current
    if (!panel || !hayLayout() || anchoAntesDelAuto.current === null) return
    anchoAntesDelAuto.current = null
    cambioAutomatico.current = true
    try { panel.expand() } finally { cambioAutomatico.current = false }
  }, [])

  const alCambiarColumnas = useCallback((layout: number[]) => {
    if (cambioAutomatico.current || layout.length !== 3) return
    // La persona lo abrio (arrastrando): el colapso automatico termino.
    if (anchoAntesDelAuto.current !== null && layout[2] > 0.1) {
      anchoAntesDelAuto.current = null
      motivosDelAuto.current = { angosto: false, pestana: false }
    }
    // Colapsado solo: se guarda como si estuviera abierto con el ancho de antes.
    const antes = anchoAntesDelAuto.current
    const guardar = antes === null ? layout : [layout[0], Math.max(0, layout[1] - antes), antes]
    escribir(CLAVE_COLUMNAS, JSON.stringify(guardar))
  }, [])

  // Ventana angosta: SOLO al montar el grupo, que vive mientras el overlay está abierto.
  useEffect(() => {
    if (window.innerWidth < ANCHO_ANGOSTO) colapsarSolo('angosto')
  }, [colapsarSolo])

  // Spec §3: con Team thread o Settings activa el panel derecho se oculta; al salir vuelve
  // como estaba, sin guardar ese colapso (Ruling 11).
  const pestanaSinPanel = activa.kind === 'thread' || activa.kind === 'settings'
  useEffect(() => {
    if (pestanaSinPanel) colapsarSolo('pestana')
    else liberarAuto('pestana')
  }, [pestanaSinPanel, colapsarSolo, liberarAuto])

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
        etiquetas={prefsMem.prefs.graph.labels}
        animar={prefsMem.prefs.graph.animate}
        onOpen={alAbrirDesdeElGrafo}
      />
    )
  }

  return (
    <div
      ref={raizRef}
      tabIndex={-1}
      className={`teams-workspace memories-workspace outline-none${closing ? ' closing' : ''}`}
      onKeyDown={alTeclear}
      onMouseDownCapture={(e) => {
        // Sólo si el foco está AFUERA: un click en un input o en el editor se lo queda igual.
        // Y sólo para clicks en el DOM de la raíz: los eventos de React también suben desde
        // los portales (menú «⋯», popover de «Create this memory», diálogos), y sacarles el
        // foco ahí los cerraba antes de que llegara el click.
        const raiz = raizRef.current
        if (!raiz || !(e.target instanceof Node) || !raiz.contains(e.target)) return
        if (!raiz.contains(document.activeElement)) raiz.focus({ preventScroll: true })
      }}
    >
      <div className="teams-workspace-header">
        <button className="tw-back-btn" onClick={onClose}>
          <svg width="13" height="13" viewBox="0 0 13 13" fill="none" style={{ display: 'inline-block', verticalAlign: 'middle', marginRight: 5 }}>
            <path d="M8 2L4 6.5L8 11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          Back
        </button>

        <div className="tw-header-center">
          {/* Sólo el título, como Teams y Personal. El glifo del grafo que había acá era el
              único ícono en el header de una pantalla grande, dibujado a mano y pintado con
              `--raven-blue`: un color de marca donde el resto de la app usa texto. */}
          <span className="tw-header-title">Memories</span>
        </div>

        <div className="tw-header-right">
          <Button variant="ghost" size="sm" onClick={onHowItWorks} data-tour-id="memories-how">
            How it works
          </Button>
          <Button
            variant="outline"
            size="sm"
            aria-label="Memory settings"
            onClick={() => abrirSettings()}
            data-tour-id="memories-settings"
          >
            <Settings size={ICON_SIZE.sm} aria-hidden />
            Settings
          </Button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col">
          <MemoriesStatusRow state={state} />

          <div className="teams-workspace-body min-h-0">
            <PanelGroup ref={grupoRef} direction="horizontal" onLayout={alCambiarColumnas} className="min-h-0 flex-1">
              <Panel defaultSize={columnas[0]} minSize={12} collapsible id="explorer" order={1}>
                {/* Con Settings activa, la lista de secciones. El explorer queda MONTADO (oculto):
                    carpetas abiertas/cerradas, scroll y búsqueda siguen al volver (spec §3). */}
                <div hidden={settingsActiva} className={cn('h-full', settingsActiva && 'hidden')}>
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
                </div>
                {activa.kind === 'settings' && (
                  <SettingsSectionList secciones={SECCIONES_DE_SETTINGS} activa={activa.section} onElegir={abrirSettings} />
                )}
              </Panel>
              <PanelResizeHandle className="w-px bg-border" />
              <Panel defaultSize={columnas[1]} minSize={30} id="centro" order={2} className="flex min-h-0 flex-col">
                <div data-tour-id="memories-tabs">
                  <MemoryTabs
                    tabs={tabs.tabs}
                    activeId={tabs.activeId}
                    etiqueta={etiqueta}
                    ansi={ansi}
                    onActivate={tabs.activate}
                    onClose={cerrar}
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

                  {/* Settings: se monta sólo mientras está activa, así cada vuelta relee el estado
                      de sync/cifrado/compartir (D3). Las notas siguen montadas detrás. */}
                  {activa.kind === 'settings' && (
                    <div className="min-h-0 flex-1 overflow-y-auto">
                      <MemorySettingsTab
                        seccion={activa.section}
                        onSeccion={abrirSettings}
                        activeRepoPath={activeRepoPath}
                        onLinkRepo={onLinkRepo}
                        hilo={hilo}
                        prefs={prefsMem.prefs}
                        prefsCargadas={prefsMem.cargadas}
                        onPrefs={prefsMem.actualizar}
                        onResetGraph={restablecerGrafo}
                        onPlanYFacturacion={onPlanYFacturacion}
                      />
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
                            graphData={filtros.dataCompleta}
                            pedirFoco={focoDeNota.syncId === t.syncId ? focoDeNota.n : 0}
                            ansi={ansi}
                            candidatos={candidatos}
                            titulosPorId={titulosPorId}
                            panelDerecho={esActiva ? panelDerechoEl : null}
                            prefsDelEditor={prefsMem.prefs.editor}
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
                                onClose={() => cerrar(id)}
                                onDirtyChange={(sucio) => {
                                  if (sucio) nuevasSucias.current.add(id)
                                  else nuevasSucias.current.delete(id)
                                }}
                                onSaved={(syncId) => {
                                  // Ya guardada: lo escrito no se pierde, el onClose que sigue
                                  // no pregunta.
                                  nuevasSucias.current.delete(id)
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
              <Panel ref={panelDerechoRef} defaultSize={columnas[2]} minSize={15} collapsible id="derecho" order={3}>
                {/* Con Graph activa: filtros y leyenda. Con una nota: su panel, que la
                    pestaña dibuja por portal acá. Con Team thread, Settings o New memory: vacío. */}
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
      </div>

      <AlertDialog open={descartar !== null} onOpenChange={(o) => { if (!o) setDescartar(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Discard this memory?</AlertDialogTitle>
            <AlertDialogDescription>What you wrote in this tab has not been saved.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep editing</AlertDialogCancel>
            <AlertDialogAction onClick={confirmarDescarte}>Discard</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
