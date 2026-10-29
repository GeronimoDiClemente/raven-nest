import React, { useState, useEffect, useCallback, useRef } from 'react'
import { createPortal } from 'react-dom'
import { supabase } from '../lib/supabase'
import { useSettings } from '../hooks/useSettings'
import { useGitHub } from '../hooks/useGitHub'
import { useGitlab } from '../hooks/useGitlab'
import { useMemory } from '../hooks/useMemory'
import type { UserPreferencesApi } from '../hooks/useUserPreferences'
import { formatBinding, eventToBinding, Keybindings } from '../lib/keybindings'
import type { EditorPreferences, EditorTheme } from '../lib/ide-config-mappings'
import { BUNDLED_THEMES } from '../lib/shiki-monaco'
import { matchThemeName } from '../lib/theme-registry'
import type { InstalledThemeInfo, ScannedThemeInfo, OpenVSXThemeResult } from '../types'
import { PresetEditor } from './PresetEditor'
import { BenchmarkDashboard } from './BenchmarkDashboard'
import MemoryAdoptionDialog from './MemoryAdoptionDialog'
import AccountPlanSection from './account/AccountPlanSection'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  X, User, Keyboard, Mic, FileCode, Terminal as TerminalIcon, RefreshCw, GraduationCap,
  ChartColumn, ChevronLeft, Plug, Zap, type LucideIcon,
} from 'lucide-react'
import { ICON_SIZE } from '../lib/icons'
import WorkspaceNavButton from './WorkspaceNavButton'
import { TEMAS, TEMA_NEST, temaPorId, ajustarContraste, peorContraste, CONTRASTE_MINIMO, type TemaDeTerminal } from '../lib/terminal-themes'
import { importarTema } from '../lib/terminal-theme-import'
import type { SeccionDeSettings } from '../lib/memory-tabs'


interface KeybindRowProps {
  label: string
  action: keyof Keybindings
  binding: string
  onUpdate: (action: keyof Keybindings, key: string) => void
}

const isModifierKey = (k: string) =>
  k === 'Control' || k === 'Shift' || k === 'Alt' || k === 'Meta' || k === 'OS'

const collectMods = (e: React.KeyboardEvent | KeyboardEvent): string[] => {
  const mods: string[] = []
  if (e.ctrlKey) mods.push('Ctrl')
  if (e.metaKey) mods.push('Meta')
  if (e.altKey) mods.push('Alt')
  if (e.shiftKey) mods.push('Shift')
  return mods
}

function KeybindRow({ label, action, binding, onUpdate }: KeybindRowProps) {
  const [recording, setRecording] = useState(false)
  const [activeMods, setActiveMods] = useState<string[]>([])

  const stopRecording = () => { setRecording(false); setActiveMods([]) }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!recording) return
    e.preventDefault()
    e.stopPropagation()
    if (e.key === 'Escape') { stopRecording(); return }
    if (isModifierKey(e.key)) { setActiveMods(collectMods(e)); return }
    const newBinding = eventToBinding(e.nativeEvent)
    onUpdate(action, newBinding)
    stopRecording()
  }

  const handleKeyUp = (e: React.KeyboardEvent) => {
    if (!recording) return
    if (isModifierKey(e.key)) setActiveMods(collectMods(e))
  }

  const displayValue = recording
    ? (activeMods.length > 0 ? `${activeMods.join(' + ')} + …` : 'Press key…')
    : formatBinding(binding)

  return (
    <div
      className={`sp-keybind-row${recording ? ' recording' : ''}`}
      onClick={() => setRecording(true)}
      onKeyDown={handleKeyDown}
      onKeyUp={handleKeyUp}
      onBlur={stopRecording}
      tabIndex={0}
    >
      <span className="sp-keybind-label">{label}</span>
      <kbd className={`sp-kbd${recording ? ' recording' : ''}`}>
        {displayValue}
      </kbd>
    </div>
  )
}

interface Props {
  updateState: 'idle' | 'checking' | 'up-to-date' | 'update-found' | 'error'
  onCheckUpdates: () => void
  userEmail: string
  activeRepoPath?: string
  onOpenTutorial?: (tourId: import('../tutorial/types').TourId) => void
  // Lifted from App.tsx (the single shared instance) — see UserPreferencesApi's
  // doc comment for why this must not be a local useUserPreferences() call.
  userPrefs: UserPreferencesApi
  // Task 10 (team thread panel): same path the file explorer already uses to open a file
  // in the editor (App.tsx's openFileInEditor, threaded down through Sidebar's onFileOpen).
  // Optional so existing callers/tests that don't care about the team thread panel keep
  // compiling unchanged.
  onFileOpen?: (relPath: string) => void
  /**
   * Spec 2026-09-09 §4: la memoria dejo de vivir en Settings. Queda la puerta.
   *
   * Task 3 (plan "memorias vista y settings"): el botón de Account abre la vista de
   * Memories ya posicionada en `'settings'` — la pestaña que trae CloudMemoryCard (Task 5),
   * no la de `'memorias'` (el default). El argumento es opcional para no romper otro
   * llamador que sólo quiera abrir la vista por default.
   */
  onOpenMemories?: (vista?: 'memorias' | 'settings', seccion?: SeccionDeSettings) => void
  /** Sube cada vez que algo de afuera pide abrir Account (Plan & billing); cada subida, una vez. */
  pedidoDeCuenta?: number
}

/**
 * Las secciones, en orden. De acá sale el rail de la izquierda, y el contenido de abajo está
 * apilado en ESTE mismo orden — si no coincidieran, el índice mentiría sobre lo que vas a
 * encontrar al bajar.
 *
 * El orden es por uso, no alfabético ni histórico: Account y los atajos son lo que la gente
 * viene a tocar; Benchmarks y Tutorial se visitan una vez.
 */
const SECCIONES: Array<{ id: string; titulo: string; icono: LucideIcon }> = [
  { id: 'account', titulo: 'Account', icono: User },
  { id: 'connections', titulo: 'Connections', icono: Plug },
  { id: 'keybinds', titulo: 'Keyboard shortcuts', icono: Keyboard },
  { id: 'voice', titulo: 'Voice', icono: Mic },
  { id: 'editor', titulo: 'Editor', icono: FileCode },
  { id: 'terminal', titulo: 'Terminal', icono: TerminalIcon },
  /**
   * `Zap` y no `TerminalIcon`: el `>_` lo usa la sección Terminal, y dos filas con el mismo
   * ícono en la misma lista son dos filas que hay que LEER para distinguir — que es
   * exactamente lo que un ícono existe para evitar.
   *
   * Y es más preciso: un preset no es una terminal, es un comando que disparás sin volver a
   * tipearlo.
   */
  { id: 'presets', titulo: 'Command presets', icono: Zap },
  { id: 'updates', titulo: 'Updates', icono: RefreshCw },
  { id: 'tutorial', titulo: 'Tutorial', icono: GraduationCap },
  { id: 'benchmarks', titulo: 'Benchmarks', icono: ChartColumn },
]

/**
 * La vista previa del tema: los dieciseis colores sobre su propio fondo.
 *
 * Existe porque un NOMBRE no dice nada. "Everforest Dark Hard" no se parece a nada hasta que
 * lo ves, y elegir a ciegas entre trece nombres es peor que no poder elegir.
 *
 * Muestra el peor contraste de la paleta al lado, que es el numero que decide si un tema es
 * legible de verdad o solo bonito en una captura — y que cambia en vivo al prender el ajuste,
 * para que se vea QUE hace en vez de tener que creerle a la etiqueta.
 */
function VistaPreviaDelTema(
  { temaId, importados, ajustar }:
  { temaId: string; importados: TemaDeTerminal[]; ajustar: boolean },
) {
  const base = temaPorId(temaId, importados)
  const tema = ajustar ? ajustarContraste(base) : base
  const peor = peorContraste(tema)
  const [, red, green, yellow, blue, magenta, cyan] = tema.ansi
  const gris = tema.ansi[8]

  return (
    <div className="my-2 overflow-hidden rounded-md border border-border">
      <div
        className="p-3 font-mono text-fs-sm leading-relaxed"
        style={{ background: tema.background, color: tema.foreground }}
      >
        <div><span style={{ color: gris }}>$</span> git status</div>
        <div style={{ color: green }}>  modified:  src/auth/session.ts</div>
        <div style={{ color: red }}>  deleted:   src/auth/legacy.ts</div>
        <div style={{ color: gris }}>// the refresh token rotated too early</div>
        <div style={{ color: yellow }}>⚠ 1 MCP server needs authentication</div>
        <div>
          <span style={{ color: blue }}>→</span>{' '}
          <span style={{ color: cyan }}>memory_search</span>
          (<span style={{ color: magenta }}>&quot;auth&quot;</span>)
        </div>
      </div>
      <div className="flex items-center gap-2 border-t border-border px-3 py-2">
        <div className="flex flex-1 gap-0.5">
          {tema.ansi.map((c, i) => (
            <span key={i} className="h-2 flex-1 rounded-[1px]" style={{ background: c }} />
          ))}
        </div>
        <span
          className="font-mono text-fs-xs"
          style={{ color: peor >= CONTRASTE_MINIMO ? 'var(--ok)' : 'var(--warn)' }}
          title="Worst contrast in this palette against its own background"
        >
          {peor.toFixed(2)}:1
        </span>
      </div>
    </div>
  )
}

/**
 * Una sección del panel: título, una línea que dice para qué sirve, y el contenido.
 *
 * El filtro del buscador vive acá y es deliberadamente GRUESO — matchea contra el título, la
 * descripción y el texto que la sección renderiza. Filtrar fila por fila daría un resultado
 * más fino pero dejaría controles sueltos sin su contexto, que es justo lo que este panel
 * tenía de más: un `<select>` de idioma flotando bajo el título "Keybinds".
 */
function Seccion({
  id, titulo, descripcion, busqueda, activa, children,
}: {
  id: string
  titulo: string
  descripcion: string
  busqueda: string
  /**
   * Si es la seccion elegida en el rail. Sin busqueda, es la UNICA que se dibuja.
   *
   * Con busqueda se ignora: ahi mandan las coincidencias, cruzando el limite de la seccion
   * activa. Si no, buscar "theme" estando en Account no encontraria nada.
   */
  activa: boolean
  children: React.ReactNode
}) {
  const ref = useRef<HTMLElement | null>(null)
  /**
   * El contenido se monta cuando la sección ENTRA en pantalla, no al abrir el panel.
   *
   * Con una sola página, todas las secciones montan a la vez — y algunas no son inertes:
   * `BenchmarkDashboard` arranca un `setInterval` de 2s contra el proceso principal. Sin
   * esto, abrir Settings para cambiar un atajo dejaba corriendo un polling que nadie estaba
   * mirando. El encabezado y la descripción SÍ se dibujan siempre, que es lo que hace que
   * saltar desde el rail y buscar por título sigan funcionando.
   */
  // Arranca en `true` donde no hay IntersectionObserver (jsdom, y cualquier entorno que no
  // lo traiga): sin el observador no hay forma de saber cuándo entra en pantalla, y ante la
  // duda es mejor montar todo que no montar nada.
  const [vista, setVista] = useState(() => typeof IntersectionObserver === 'undefined')
  useEffect(() => {
    const el = ref.current
    if (!el || vista || typeof IntersectionObserver === 'undefined') return
    const io = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) setVista(true)
    }, { rootMargin: '200px' })
    io.observe(el)
    return () => io.disconnect()
  }, [vista])

  const q = busqueda.trim().toLowerCase()
  // El texto propio de la sección alcanza para el título y la descripción; para el contenido
  // se lee del DOM ya renderizado, que es la única forma de buscar adentro de subcomponentes
  // (PresetEditor, BenchmarkDashboard) sin obligarlos a declarar sus propias palabras clave.
  const propio = `${titulo} ${descripcion}`.toLowerCase()
  const contenido = ref.current?.textContent?.toLowerCase() ?? ''
  const coincide = !q || propio.includes(q) || contenido.includes(q)
  // Sin busqueda manda el rail; con busqueda mandan las coincidencias.
  const matchea = q ? coincide : activa

  return (
    <section
      ref={ref}
      id={`settings-${id}`}
      className="sp-seccion"
      hidden={!matchea}
      aria-hidden={!matchea}
    >
      <h3 className="sp-seccion-titulo">{titulo}</h3>
      <p className="sp-seccion-desc">{descripcion}</p>
      {vista && children}
    </section>
  )
}

export default function SettingsPanel({ updateState, onCheckUpdates, userEmail, activeRepoPath, onOpenTutorial, userPrefs, onFileOpen, onOpenMemories, pedidoDeCuenta = 0 }: Props) {
  const [open, setOpen] = useState(false)
  const [busqueda, setBusqueda] = useState('')
  /**
   * Una seccion por vez, en vez de las nueve en un scroll.
   *
   * Eran nueve apiladas y `Account` sola mide 215 lineas — las ultimas cinco juntas suman
   * menos que ella, asi que para llegar a `Terminal` habia que pasar por todo eso. El rail ya
   * existia pero sólo hacía `scrollIntoView`: un indice de un documento largo, no una
   * navegacion.
   *
   * **El buscador es la excepcion, y es la razon por la que esto no pierde nada.** Mientras
   * hay algo escrito se muestran TODAS las secciones que matchean, cruzando el limite de la
   * seccion activa: si no, buscar "theme" estando en Account no encontraria nada y el
   * buscador pasaria a servir sólo adentro de lo que ya estas mirando, que es justo cuando no
   * lo necesitas.
   */
  const [seccionActiva, setSeccionActiva] = useState<string>(SECCIONES[0].id)
  // Sólo un valor MÁS ALTO que el último visto abre: el inicial (aunque no sea 0) no cuenta.
  const cuentaVista = useRef(pedidoDeCuenta)
  useEffect(() => {
    if (pedidoDeCuenta <= cuentaVista.current) return
    cuentaVista.current = pedidoDeCuenta
    setOpen(true)
    setSeccionActiva('account')
    setBusqueda('')
  }, [pedidoDeCuenta])
  const [errorDeTema, setErrorDeTema] = useState<string | null>(null)

  const importados = userPrefs.prefs.ui_settings.terminalThemesImportados ?? []
  const temaElegido = userPrefs.prefs.ui_settings.terminalTheme ?? TEMA_NEST.id
  const esImportado = importados.some((t) => t.id === temaElegido)

  /**
   * Traer un tema de Ghostty o de Warp.
   *
   * El main devuelve el TEXTO crudo y el parseo pasa aca, que es donde vive probado contra
   * archivos reales de los dos formatos. Un error se muestra tal cual lo escribio el parser:
   * dice que le falta al archivo, no "no se pudo importar".
   */
  const importarTemaDeArchivo = useCallback(async () => {
    setErrorDeTema(null)
    const res = await window.themes?.readTerminalThemeFile?.()
    if (res === null || res === undefined) return   // cancelado
    if (!res.ok) { setErrorDeTema(res.error); return }
    const parseado = importarTema(res.texto, res.nombre)
    if (!parseado.ok) { setErrorDeTema(parseado.error); return }
    userPrefs.addTerminalTheme(parseado.tema)
  }, [userPrefs])
  const { settings, updateKeybinding, updateVoiceLanguage } = useSettings()
  const { isConnected: githubConnected, githubLogin, connectGitHub, disconnectGitHub } = useGitHub()
  const { isConnected: gitlabConnected, gitlabLogin, connectGitlab, disconnectGitlab } = useGitlab()
  // La nube de memoria (conectar/desconectar, cuota, upgrade) se mudó a CloudMemoryCard
  // (Task 3). Lo único que se queda acá es `useMemory()` para MemoryAdoptionDialog, que no
  // depende de `open` y tiene que verse aunque Settings esté cerrado.
  const memory = useMemory()
  const [importPreview, setImportPreview] = useState<{ source: 'vscode' | 'intellij'; options: EditorPreferences; theme?: EditorTheme; unmappedTheme?: string } | null>(null)
  const [importError, setImportError] = useState<string | null>(null)
  const kb = settings.keybindings

  // --- Sistema de temas del editor ---------------------------------------
  const [installedThemes, setInstalledThemes] = useState<InstalledThemeInfo[]>([])
  const [scannedThemes, setScannedThemes] = useState<ScannedThemeInfo[] | null>(null)
  const [themeError, setThemeError] = useState<string | null>(null)
  const [vsxOpen, setVsxOpen] = useState(false)
  const [vsxQuery, setVsxQuery] = useState('')
  const [vsxResults, setVsxResults] = useState<OpenVSXThemeResult[] | null>(null)
  const [vsxError, setVsxError] = useState<string | null>(null)
  const [vsxBusy, setVsxBusy] = useState(false)

  const refreshInstalledThemes = useCallback(async () => {
    try {
      setInstalledThemes(await window.themes.listInstalled())
    } catch {
      // sin bridge (o falla IPC): el selector muestra solo built-in + bundled
    }
  }, [])

  useEffect(() => {
    // Antes esto esperaba a que entraras a la pestaña Editor. Con una sola pagina esa
    // pestaña no existe: se carga al abrir el panel.
    if (open) void refreshInstalledThemes()
  }, [open, refreshInstalledThemes])

  const handleScanVSCodeThemes = useCallback(async () => {
    setThemeError(null)
    setScannedThemes(null)
    const res = await window.themes.scanVSCode()
    if (!res.ok) { setThemeError(res.error); return }
    setScannedThemes(res.themes)
  }, [])

  const handleInstallScanned = useCallback(async (path: string) => {
    setThemeError(null)
    const res = await window.themes.importVSCode(path)
    if (!res.ok) { setThemeError(res.error); return }
    await refreshInstalledThemes()
  }, [refreshInstalledThemes])

  const handleLoadThemeFile = useCallback(async () => {
    setThemeError(null)
    const res = await window.themes.loadFromFile()
    if (res === null) return  // diálogo cancelado
    if (!res.ok) { setThemeError(res.error); return }
    await refreshInstalledThemes()
  }, [refreshInstalledThemes])

  const handleVsxSearch = useCallback(async () => {
    setVsxError(null)
    setVsxResults(null)
    setVsxBusy(true)
    try {
      const res = await window.themes.searchOpenVSX(vsxQuery)
      if (!res.ok) { setVsxError(res.error); return }
      setVsxResults(res.results)
    } finally {
      setVsxBusy(false)
    }
  }, [vsxQuery])

  const handleVsxInstall = useCallback(async (namespace: string, name: string) => {
    setVsxError(null)
    setVsxBusy(true)
    try {
      const res = await window.themes.installOpenVSX(namespace, name)
      if (!res.ok) { setVsxError(res.error); return }
      await refreshInstalledThemes()
    } finally {
      setVsxBusy(false)
    }
  }, [refreshInstalledThemes])

  const handleImportEditorConfig = useCallback(async (source: 'vscode' | 'intellij') => {
    setImportError(null)
    setImportPreview(null)
    const result = await window.ideConfig.import(source)
    if (!result.ok) {
      setImportError(result.error)
      return
    }
    setImportPreview({ source, options: result.options, theme: result.theme, unmappedTheme: result.unmappedTheme })
  }, [])

  const confirmImportEditorConfig = useCallback(() => {
    if (!importPreview) return
    // unmappedTheme (workbench.colorTheme que no era vs/vs-dark): si matchea
    // un tema bundled o instalado, se aplica directo — cierra el loop que el
    // import de config dejaba abierto.
    // Match EXACTO primero (bundled/instalados); el heurístico vs/vs-dark de
    // parseVSCodeSettings es solo el fallback — al revés degradaba temas que
    // SÍ existen ("One Dark Pro" terminaba en vs-dark genérico).
    const exact = importPreview.unmappedTheme
      ? matchThemeName(importPreview.unmappedTheme, [...BUNDLED_THEMES, ...installedThemes])
      : undefined
    const theme = exact ?? importPreview.theme
    userPrefs.setEditorOptions(importPreview.options, theme)
    setImportPreview(null)
  }, [importPreview, userPrefs, installedThemes])

  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [open])

  const keybindRows: Array<{ label: string; action: keyof Keybindings }> = [
    { label: 'Voice input', action: 'voiceInput' },
    { label: 'New pane', action: 'newPane' },
    { label: 'Global search', action: 'globalSearch' },
    { label: 'Command palette', action: 'commandPalette' },
    { label: 'Next pane', action: 'nextPane' },
    { label: 'Previous pane', action: 'prevPane' },
    { label: 'Next tab', action: 'nextTab' },
    { label: 'Previous tab', action: 'prevTab' },
    { label: 'Zoom cell', action: 'toggleZoom' },
    { label: 'Font size +', action: 'fontSizeUp' },
    { label: 'Font size −', action: 'fontSizeDown' },
    { label: 'Font size reset', action: 'fontSizeReset' },
  ]

  const updateLabel = updateState === 'checking' ? 'Checking…'
    : updateState === 'up-to-date' ? '✓ Up to date'
    : updateState === 'update-found' ? 'Downloading…'
    : updateState === 'error' ? 'Error checking'
    : 'Check for updates'

  return (
    <>
      <button className="titlebar-btn" onClick={() => setOpen(v => !v)} title="Settings" />

      {/* Task 2 (adopción con aviso): no depende de `open` — el login que lo dispara puede
          pasar con el panel de Settings cerrado, y el usuario tiene que verlo igual. */}
      {memory.pendingAdoption && createPortal(
        <MemoryAdoptionDialog
          count={memory.pendingAdoption.count}
          projects={memory.pendingAdoption.projects}
          onAdopt={() => memory.resolveAdoption(true)}
          onDecline={() => memory.resolveAdoption(false)}
        />,
        document.body
      )}

      {open && createPortal(
        <>
          {/* La MISMA cáscara que Personal, Teams y Memories, no un modal aparte.
              Settings era lo único que se abría como un flotante sobre la app mientras las
              otras tres pantallas grandes eran overlays a pantalla completa con su nav a la
              izquierda — tres cosas que hacen lo mismo, presentadas de tres formas. Con
              `.teams-workspace` se lleva gratis la animación de entrada y el z-index que las
              otras ya tenían. */}
          <div className="teams-workspace settings-workspace">
            <div className="teams-workspace-header">
              <button className="tw-back-btn" onClick={() => setOpen(false)}>
                <ChevronLeft size={ICON_SIZE.lg} aria-hidden />
                Back
              </button>
              <div className="tw-header-center">
                <span>Settings</span>
              </div>
            </div>

            <div className="teams-workspace-body">
              {/* El rail. Es el mismo componente de fila que usa Personal, no una lista
                  propia: era justamente lo que hacía que estas pantallas se vieran de
                  stacks distintos. Tocar una sección la trae a la vista en vez de
                  esconder las demás — con el buscador ya hay una forma de filtrar. */}
              {/* El rail es NAVEGACION, no un indice: cada seccion es su propia pantalla. */}
              <nav className="teams-workspace-nav">
                {SECCIONES.map((sec) => (
                  <WorkspaceNavButton
                    key={sec.id}
                    icon={<sec.icono size={ICON_SIZE.lg} aria-hidden />}
                    label={sec.titulo}
                    active={!busqueda && seccionActiva === sec.id}
                    onClick={() => {
                      setSeccionActiva(sec.id)
                      // Al cambiar de seccion, el buscador deja de aplicar: lo que tenias
                      // escrito filtraba OTRA cosa, y dejarlo puesto mostraria la seccion nueva
                      // vacia sin decir por que.
                      setBusqueda('')
                    }}
                  />
                ))}
              </nav>

              <div className="teams-workspace-content settings-content">
            <div className="sp-search-row">
              <Input
                type="search"
                value={busqueda}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setBusqueda(e.target.value)}
                placeholder="Search settings…"
                aria-label="Search settings"
                autoFocus
              />
            </div>

            {/* Body */}

              <Seccion
                id="account"
                titulo="Account"
                descripcion="Who you&apos;re signed in as."
                busqueda={busqueda}
                activa={seccionActiva === 'account'}
              >
                <div className="sp-section">
                  <p className="sp-email">{userEmail || '—'}</p>

                  {/* Spec 2b-3 §3: Plan, Usage y Machines. */}
                  <AccountPlanSection memory={memory} onOpenMemorySync={() => onOpenMemories?.('settings', 'sync')} />


                  {/* La memoria no vive en Settings: su configuración es la pestaña
                      Settings del workspace de Memories (spec 2026-10-21). Esto abre
                      Memories con esa pestaña activa. */}
                  {onOpenMemories && (
                    <Button variant="outline" size="sm" onClick={() => onOpenMemories('settings')}>
                      Memory settings
                    </Button>
                  )}

                  <Button variant="outline" size="sm" onClick={() => supabase.auth.signOut()}>
                    Sign out
                  </Button>
                </div>
              </Seccion>

              <Seccion
                id="connections"
                titulo="Connections"
                descripcion="The services signed in alongside your account."
                busqueda={busqueda}
                activa={seccionActiva === 'connections'}
              >
                <div className="sp-section">
                  <div className="sp-card">
                    <div className="sp-card-row">
                      <div className="sp-card-left">
                        <svg width="15" height="15" viewBox="0 0 16 16" fill="currentColor" style={{ opacity: 0.6 }}>
                          <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/>
                        </svg>
                        <span className="sp-card-label">GitHub</span>
                        {githubConnected && githubLogin && (
                          <span className="sp-avatar-inline">
                            <img src={`https://github.com/${githubLogin}.png?size=48`} alt="" loading="lazy" />
                          </span>
                        )}
                      </div>
                      {githubConnected ? (
                        <Button variant="destructive" size="sm" onClick={disconnectGitHub}>Disconnect</Button>
                      ) : (
                        <Button size="sm" onClick={connectGitHub}>Connect</Button>
                      )}
                    </div>
                  </div>

                  <div className="sp-card">
                    <div className="sp-card-row">
                      <div className="sp-card-left">
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="#FC6D26" style={{ opacity: 0.85 }}>
                          <path d="M23.6 9.6L20.3.3a.8.8 0 00-1.5 0l-3 9.4H8.2L5.2.3a.8.8 0 00-1.5 0L.4 9.6c-.3 1 .1 2 .9 2.6L12 22l10.7-9.8c.8-.6 1.2-1.6.9-2.6z"/>
                        </svg>
                        <span className="sp-card-label">GitLab</span>
                        {gitlabLogin && (
                          <span className="sp-avatar-inline" title={`@${gitlabLogin}`}>
                            <img src={`https://gitlab.com/${gitlabLogin}.png?width=48`} alt="" loading="lazy" />
                          </span>
                        )}
                        {gitlabLogin && !gitlabConnected && (
                          <span style={{ fontSize: 10, color: '#f59e0b', marginLeft: 6 }}>
                            sign-in only — connect for repo access
                          </span>
                        )}
                      </div>
                      {gitlabConnected ? (
                        <Button variant="destructive" size="sm" onClick={disconnectGitlab}>Disconnect</Button>
                      ) : (
                        <Button size="sm" onClick={connectGitlab}>Connect</Button>
                      )}
                    </div>
                  </div>
                </div>
              </Seccion>

              <Seccion
                id="keybinds"
                titulo="Keyboard shortcuts"
                descripcion="Click a shortcut to record a new one."
                busqueda={busqueda}
                activa={seccionActiva === 'keybinds'}
              >
                <div className="sp-section">
                  {keybindRows.map(row => (
                    <KeybindRow
                      key={row.action}
                      label={row.label}
                      action={row.action}
                      binding={kb[row.action]}
                      onUpdate={updateKeybinding}
                    />
                  ))}
                </div>
              </Seccion>

              <Seccion
                id="voice"
                titulo="Voice"
                descripcion="Dictation into the prompt. Needs openai-whisper installed; without it the mic button simply doesn't transcribe."
                busqueda={busqueda}
                activa={seccionActiva === 'voice'}
              >
                <div className="sp-section">
                  <div className="sp-row">
                    <span className="sp-row-label">Voice language</span>
                    <select
                      className="sp-select"
                      value={settings.voiceLanguage ?? 'es'}
                      onChange={e => updateVoiceLanguage(e.target.value)}
                    >
                      <option value="es">Español</option>
                      <option value="en">English</option>
                      <option value="pt">Português</option>
                      <option value="fr">Français</option>
                      <option value="de">Deutsch</option>
                      <option value="it">Italiano</option>
                      <option value="zh">中文</option>
                      <option value="ja">日本語</option>
                    </select>
                  </div>
                </div>
              </Seccion>

              <Seccion
                id="editor"
                titulo="Editor"
                descripcion="Theme and behaviour of the built-in editor."
                busqueda={busqueda}
                activa={seccionActiva === 'editor'}
              >
                <div className="sp-section">
                  <div className="sp-row">
                    <span className="sp-row-label">Theme</span>
                    <select
                      className="sp-select"
                      data-testid="theme-select"
                      value={userPrefs.prefs.ui_settings.editorTheme ?? 'vs-dark'}
                      onChange={e => userPrefs.setEditorTheme(e.target.value)}
                    >
                      <optgroup label="Built-in">
                        <option value="vs-dark">Dark (Monaco)</option>
                        <option value="vs">Light (Monaco)</option>
                      </optgroup>
                      <optgroup label="Bundled">
                        {BUNDLED_THEMES.map(t => (
                          <option key={t.name} value={t.name}>{t.displayName}</option>
                        ))}
                      </optgroup>
                      <optgroup label="Installed">
                        {installedThemes.map(t => (
                          <option key={t.name} value={t.name}>{t.displayName}</option>
                        ))}
                      </optgroup>
                    </select>
                  </div>
                  <div style={{ display: 'flex', gap: 8, margin: '10px 0' }}>
                    <Button variant="outline" size="sm" onClick={handleScanVSCodeThemes}>Import themes from VS Code</Button>
                    <Button variant="outline" size="sm" onClick={handleLoadThemeFile}>Load theme file…</Button>
                    <Button variant="outline" size="sm" onClick={() => setVsxOpen(v => !v)}>Browse Open VSX…</Button>
                  </div>
                  {themeError && <p style={{ color: '#ef4444', fontSize: 12 }}>{themeError}</p>}
                  {scannedThemes && (
                    <div data-testid="scanned-themes">
                      {scannedThemes.length === 0 && (
                        <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>No themes found in your VS Code extensions.</p>
                      )}
                      {scannedThemes.map(t => (
                        <div key={t.path} className="sp-row">
                          <span className="sp-row-label">{t.label}</span>
                          <Button variant="outline" size="sm" onClick={() => handleInstallScanned(t.path)}>Install</Button>
                        </div>
                      ))}
                    </div>
                  )}
                  {vsxOpen && (
                    <div data-testid="openvsx-browser">
                      <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                        <input
                          className="sp-select"
                          style={{ flex: 1 }}
                          placeholder="Search themes on Open VSX"
                          value={vsxQuery}
                          onChange={e => setVsxQuery(e.target.value)}
                          onKeyDown={e => { if (e.key === 'Enter') void handleVsxSearch() }}
                        />
                        <Button variant="outline" size="sm" onClick={handleVsxSearch} disabled={vsxBusy}>Search</Button>
                      </div>
                      {vsxError && <p style={{ color: '#ef4444', fontSize: 12 }}>{vsxError}</p>}
                      {vsxResults && vsxResults.length === 0 && (
                        <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>No theme extensions matched your search.</p>
                      )}
                      {vsxResults?.map(r => (
                        <div key={`${r.namespace}.${r.name}`} className="sp-row">
                          <span className="sp-row-label" title={r.description}>{r.displayName}</span>
                          <Button
                            variant="outline" size="sm"
                            disabled={vsxBusy}
                            onClick={() => handleVsxInstall(r.namespace, r.name)}
                          >Install</Button>
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="sp-divider" />
                  <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '0 0 12px' }}>
                    Import your editor preferences from VS Code or IntelliJ.
                  </p>
                  <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
                    <Button variant="outline" size="sm" onClick={() => handleImportEditorConfig('vscode')}>Import from VS Code</Button>
                    <Button variant="outline" size="sm" onClick={() => handleImportEditorConfig('intellij')}>Import from IntelliJ</Button>
                  </div>
                  {importError && <p style={{ color: '#ef4444', fontSize: 12 }}>{importError}</p>}
                  {importPreview && (
                    <div data-testid="ide-config-preview">
                      <ul>
                        {Object.entries(importPreview.options).map(([key, value]) => (
                          <li key={key}>{key}: {JSON.stringify(value)}</li>
                        ))}
                      </ul>
                      <Button variant="outline" size="sm" onClick={confirmImportEditorConfig}>Apply</Button>
                      <Button variant="destructive" size="sm" onClick={() => setImportPreview(null)}>Cancel</Button>
                    </div>
                  )}
                </div>
              </Seccion>

              <Seccion
                id="terminal"
                titulo="Terminal"
                descripcion="Colours of the terminal itself — the sixteen your shell and your agents paint with."
                busqueda={busqueda}
                activa={seccionActiva === 'terminal'}
              >
                <div className="sp-section">
                  <div className="sp-row">
                    <span className="sp-row-label">Theme</span>
                    <select
                      className="sp-select"
                      data-testid="terminal-theme-select"
                      value={userPrefs.prefs.ui_settings.terminalTheme ?? TEMA_NEST.id}
                      onChange={(e) => userPrefs.setTerminalTheme(e.target.value)}
                    >
                      {/* Los del catalogo y los tuyos, separados. Un tema importado no es una
                          version peor de uno nuestro: es EL que ya tenias configurado, y
                          mezclarlos en una lista plana lo esconde entre trece nombres. */}
                      <optgroup label="Built in">
                        {TEMAS.map((t) => (
                          <option key={t.id} value={t.id}>{t.nombre}</option>
                        ))}
                      </optgroup>
                      {importados.length > 0 && (
                        <optgroup label="Imported">
                          {importados.map((t) => (
                            <option key={t.id} value={t.id}>{t.nombre}</option>
                          ))}
                        </optgroup>
                      )}
                    </select>
                  </div>

                  {/* La vista previa muestra los dieciseis colores del tema elegido sobre su
                      propio fondo. Un nombre de tema no dice nada: "Everforest Dark Hard" no
                      se parece a nada hasta que lo ves. */}
                  <VistaPreviaDelTema
                    temaId={temaElegido}
                    importados={importados}
                    ajustar={userPrefs.prefs.ui_settings.terminalThemeAutoContrast ?? false}
                  />

                  <div className="sp-row">
                    <span className="sp-row-label">Lift low-contrast colours</span>
                    <input
                      type="checkbox"
                      data-testid="terminal-theme-contrast"
                      checked={userPrefs.prefs.ui_settings.terminalThemeAutoContrast ?? false}
                      onChange={(e) => userPrefs.setTerminalThemeAutoContrast(e.target.checked)}
                    />
                  </div>
                  <p className="text-fs-sm text-muted-foreground">
                    Some themes dim comments so far they stop being readable — eight of these
                    thirteen have a colour below 3:1 against their own background. This lifts
                    only those, and only to the floor, keeping each colour&apos;s hue.
                  </p>

                  <div className="flex flex-wrap items-center gap-2">
                    <Button variant="outline" size="sm" onClick={importarTemaDeArchivo}>
                      Import a Ghostty or Warp theme…
                    </Button>
                    {esImportado && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => userPrefs.removeTerminalTheme(temaElegido)}
                      >
                        Remove this theme
                      </Button>
                    )}
                  </div>
                  {errorDeTema && <p className="text-fs-sm text-warn">{errorDeTema}</p>}
                  <p className="text-fs-sm text-muted-foreground">
                    Already have a theme set up? Bring the file you use in Ghostty or Warp —
                    Nest reads both, and keeps a copy so it works even if you move or uninstall
                    them.
                  </p>
                </div>
              </Seccion>

              <Seccion
                id="presets"
                titulo="Command presets"
                descripcion="Commands you can fire at a pane without retyping them."
                busqueda={busqueda}
                activa={seccionActiva === 'presets'}
              >
                <div className="sp-section">
                  <PresetEditor repoPath={activeRepoPath ?? null} />
                </div>
              </Seccion>

              <Seccion
                id="updates"
                titulo="Updates"
                descripcion="Which version you are on, and whether there is a newer one."
                busqueda={busqueda}
                activa={seccionActiva === 'updates'}
              >
                <div className="sp-section">
                  <Button
                    variant="outline" size="sm"
                    onClick={onCheckUpdates}
                    disabled={updateState === 'checking' || updateState === 'update-found'}
                  >
                    {updateLabel}
                  </Button>
                </div>
              </Seccion>

              <Seccion
                id="tutorial"
                titulo="Tutorial"
                descripcion="Walk through Nest with demo data, without touching your repos."
                busqueda={busqueda}
                activa={seccionActiva === 'tutorial'}
              >
                <div className="sp-section">
                  <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '0 0 12px' }}>
                    Recorré las secciones de Nest con datos de demostración, sin tocar tus repos.
                  </p>
                  <Button variant="outline" size="sm" onClick={() => onOpenTutorial?.('worktrees')}>
                    Tutorial: Worktrees
                  </Button>
                </div>
              </Seccion>

              <Seccion
                id="benchmarks"
                titulo="Benchmarks"
                descripcion="How long your agents take, measured across runs."
                busqueda={busqueda}
                activa={seccionActiva === 'benchmarks'}
              >
                <div className="sp-section">
                  <BenchmarkDashboard />
                </div>
              </Seccion>
              </div>
            </div>
          </div>
        </>,
        document.body
      )}
    </>
  )
}
