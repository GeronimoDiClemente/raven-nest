// El editor de una nota de Memories, estilo Obsidian: título grande editable y el cuerpo en
// live preview sobre CodeMirror 6 (el documento es SIEMPRE el Markdown; la vista sólo
// decide cómo se ve). Se guarda solo (`useAutosave`, 1500 ms). Es de presentación pura: los
// datos y las acciones llegan por props — el adaptador (MemoriesNoteTab) es el que habla
// con `window.memory`.
import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState, type ForwardedRef } from 'react'
import { Compartment, EditorState } from '@codemirror/state'
import { EditorView, keymap } from '@codemirror/view'
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import { markdown } from '@codemirror/lang-markdown'
import { MoreHorizontal } from 'lucide-react'
import type { AIType, MemoryObservationDetail } from '../../types'
import { livePreview, refrescarLivePreview, type Resolver } from '../../lib/cm-live-preview'
import { autocompletadoDeWikilinks, type CandidatoDeLink } from '../../lib/cm-wikilink-autocomplete'
import { memoryTypeSwatch } from '../../lib/memory-type-legend'
import { relativeTime } from '../../lib/memories-status'
import { nombreDeProyecto } from '../../lib/nombre-de-proyecto'
import { useAutosave, type ResultadoDeGuardado } from '../../hooks/useAutosave'
import { AILogo } from '../AILogos'
import { Button, buttonVariants } from '../ui/button'
import { Popover, PopoverAnchor, PopoverContent } from '../ui/popover'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '../ui/dropdown-menu'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '../ui/alert-dialog'

export interface MemoryNoteEditorHandle { irALinea: (linea: number) => void }
export interface MemoryNoteEditorProps {
  detail: MemoryObservationDetail
  /** Los `[[links]]` resueltos de la ÚLTIMA lectura (final review F1): pueden cambiar sin que
   *  cambie la versión de la nota — escribir la memoria de un hueco no toca a ésta —, así que
   *  no viajan con `externo`. Sin la prop, los de `detail`/`externo`. */
  links?: MemoryObservationDetail['links']
  /** Sube cuando hay que darle el foco al título (la nota se abrió desde el grafo, donde el
   *  canvas no mueve el foco y Ctrl+W iría a la ventana). 0 = no. */
  pedirFoco?: number
  ansi?: readonly string[]
  candidatos: CandidatoDeLink[]
  /** Vino un cambio de afuera (onChanged) para esta memoria: la versión nueva del store. */
  externo: MemoryObservationDetail | null
  onSave: (v: { title: string; content: string }) => Promise<ResultadoDeGuardado>
  onOpen: (syncId: string, opts: { background: boolean }) => void
  onCreate: (titulo: string) => void
  onOpenNewer: () => void
  onConnect: () => void
  onDelete: () => Promise<void>
  /** La memoria ya no está en el store (la borró un agente u otra máquina): sólo lectura con
   *  la banda de borrada, sin esperar a que un guardado lo descubra. */
  borrada?: boolean
}

type Valor = { title: string; content: string }
type Medible = { getBoundingClientRect: () => DOMRect }

const igual = (a: Valor, b: Valor) => a.title === b.title && a.content === b.content
const igualConTrim = (a: Valor, b: Valor) => a.title.trim() === b.title.trim() && a.content.trim() === b.content.trim()

/** Un guardado nuestro del que todavia puede llegar el eco por onChanged: lo que mandamos y
 *  lo que main dice que quedo (trim + `redact()`; null si todavia no respondio, o si es un
 *  main viejo que no lo devuelve). */
interface MarcaDeEco { enviado: Valor; saved: Valor | null }

/** Copiar al portapapeles sin que un fallo (permiso, jsdom, ventana sin foco) rompa nada. */
function copiar(v: Valor, alTerminar: () => void) {
  try {
    const p = navigator.clipboard?.writeText(`${v.title}\n\n${v.content}`)
    if (p) p.then(alTerminar).catch(() => {})
  } catch {
    // Sin portapapeles: el texto sigue en el editor.
  }
}

/** Una memoria por instancia: cambiar de memoria es montar otra (key = syncId), así el
 *  autoguardado y el EditorView nunca mezclan el texto de una con el id de otra. */
const MemoryNoteEditor = forwardRef<MemoryNoteEditorHandle, MemoryNoteEditorProps>(function MemoryNoteEditor(props, ref) {
  return <EditorDeNota key={props.detail.syncId} {...props} handleRef={ref} />
})
export default MemoryNoteEditor

function EditorDeNota({
  detail, links: linksDeProp, pedirFoco = 0, ansi, candidatos, externo, onSave, onOpen, onCreate, onOpenNewer, onConnect, onDelete, borrada = false, handleRef,
}: MemoryNoteEditorProps & { handleRef: ForwardedRef<MemoryNoteEditorHandle> }) {
  const [titulo, setTitulo] = useState(detail.title)
  const [contenido, setContenido] = useState(detail.content ?? '')
  const [base, setBase] = useState<Valor>({ title: detail.title, content: detail.content ?? '' })
  // La última versión del store que se aplicó desde afuera (links, supersededBy).
  const [externoAplicado, setExternoAplicado] = useState<MemoryObservationDetail | null>(null)
  const [bandaExterna, setBandaExterna] = useState(false)
  const [copiado, setCopiado] = useState(false)
  const [borrando, setBorrando] = useState(false)
  const [errorAlBorrar, setErrorAlBorrar] = useState(false)
  const [confirmarBorrado, setConfirmarBorrado] = useState(false)
  const [pendiente, setPendiente] = useState<string | null>(null)

  const fuente = externoAplicado ?? detail
  const reemplazadaDeOrigen = fuente.supersededBy !== null
  const habilitado = !reemplazadaDeOrigen && !bandaExterna && !borrando && !borrada
  // Reconocer el eco de nuestros propios guardados (Fix round 1, Important #1). Cuando el
  // store devuelve por onChanged lo que acabamos de guardar NO es un cambio de otro, aunque
  // mientras tanto se haya seguido escribiendo, y aunque no sea igual a lo que mandamos: main
  // hace trim y `redact()`. Tomarlo por ajeno bloqueaba la nota y copiaba al portapapeles el
  // texto SIN redactar.
  const marcasRef = useRef<MarcaDeEco[]>([])
  const enVueloRef = useRef(0)
  // Un `externo` que llego con un guardado en vuelo: se decide cuando main responda, que es
  // cuando se sabe que quedo guardado (el evento puede llegar antes que la respuesta).
  const diferidoRef = useRef<MemoryObservationDetail | null>(null)
  // La version (updatedAt) del ultimo eco consumido: un segundo aviso de la misma version
  // tambien es eco.
  const ecoConsumidoRef = useRef<number | null>(null)
  const procesarExternoRef = useRef<(ext: MemoryObservationDetail) => void>(() => {})
  // Un guardado que vuelve después de cerrar la pestaña no tiene que procesar un externo
  // diferido: no hay banda que mostrar y escribiría al portapapeles sin que nadie lo vea.
  const montadoRef = useRef(true)
  useEffect(() => {
    montadoRef.current = true
    return () => { montadoRef.current = false }
  }, [])
  const guardar = async (v: Valor): Promise<ResultadoDeGuardado> => {
    const marca: MarcaDeEco = { enviado: v, saved: null }
    marcasRef.current = [...marcasRef.current, marca].slice(-3)
    enVueloRef.current++
    try {
      const r = await onSave(v)
      // Sin `ok` (unchanged, error, rechazo) no hay fila nueva y no va a venir eco.
      if (r.ok) marca.saved = r.saved ?? null
      else marcasRef.current = marcasRef.current.filter((m) => m !== marca)
      return r
    } catch (e) {
      marcasRef.current = marcasRef.current.filter((m) => m !== marca)
      throw e
    } finally {
      enVueloRef.current--
      const d = diferidoRef.current
      if (enVueloRef.current === 0 && d && montadoRef.current) {
        diferidoRef.current = null
        procesarExternoRef.current(d)
      }
    }
  }
  const auto = useAutosave({ valor: { title: titulo, content: contenido }, base, guardar, habilitado })
  const soloLectura = !habilitado || auto.estado === 'reemplazada' || auto.estado === 'borrada'

  const viewRef = useRef<EditorView | null>(null)
  const cuerpoRef = useRef<HTMLDivElement | null>(null)
  const anclaRef = useRef<Medible | null>(null)
  const ultimoLinkRef = useRef<HTMLElement | null>(null)
  const soloLecturaComp = useRef(new Compartment()).current
  const tituloRef = useRef(titulo)
  const contenidoRef = useRef(contenido)
  const sucioRef = useRef(auto.sucio)
  const soloLecturaRef = useRef(soloLectura)
  const candidatosRef = useRef(candidatos)
  const onOpenRef = useRef(onOpen)
  tituloRef.current = titulo
  contenidoRef.current = contenido
  sucioRef.current = auto.sucio
  soloLecturaRef.current = soloLectura
  candidatosRef.current = candidatos
  onOpenRef.current = onOpen

  // Links por nombre (en minúsculas). La clave en texto evita refrescar la vista cuando el
  // padre manda un array nuevo con lo mismo adentro.
  const linksKey = JSON.stringify(linksDeProp ?? fuente.links ?? [])
  const linksPorNombre = useMemo(() => {
    const links = JSON.parse(linksKey) as Array<{ name: string; syncId: string | null }>
    return new Map(links.map((l) => [l.name.toLowerCase(), l.syncId]))
  }, [linksKey])
  const resolverRef = useRef<Resolver>(() => 'desconocido')
  resolverRef.current = (nombre) => {
    const l = linksPorNombre.get(nombre.toLowerCase())
    return l === undefined ? 'desconocido' : l === null ? 'pendiente' : { syncId: l }
  }

  // Navegación segura (Review Focus 5): sólo se abre lo que el store resolvió a un syncId.
  // Un `[[javascript:...]]` o cualquier nombre que no está en `links` no hace nada.
  const onWikilinkRef = useRef((nombre: string, background: boolean) => {
    const r = resolverRef.current(nombre)
    if (r === 'desconocido') return
    if (r === 'pendiente') {
      const el = ultimoLinkRef.current
      if (el) {
        const rect = el.getBoundingClientRect()
        anclaRef.current = { getBoundingClientRect: () => (el.isConnected ? el.getBoundingClientRect() : rect) }
      } else {
        anclaRef.current = null
      }
      setPendiente(nombre)
      return
    }
    onOpenRef.current(r.syncId, { background })
  })

  // El EditorView: uno por memoria (este componente se monta por syncId).
  useEffect(() => {
    const parent = cuerpoRef.current
    if (!parent) return
    const view = new EditorView({
      parent,
      state: EditorState.create({
        doc: contenidoRef.current,
        extensions: [
          markdown(),
          // Deshacer (final review F2): sin historial, un borrado sin querer no tenía vuelta
          // y el autoguardado lo persistía en 1,5 s.
          history(),
          keymap.of([...defaultKeymap, ...historyKeymap]),
          EditorView.lineWrapping,
          livePreview({ resolver: () => resolverRef.current, onWikilink: (n, bg) => onWikilinkRef.current(n, bg) }),
          autocompletadoDeWikilinks(() => candidatosRef.current),
          EditorView.updateListener.of((u) => { if (u.docChanged) setContenido(u.state.doc.toString()) }),
          soloLecturaComp.of(EditorState.readOnly.of(soloLecturaRef.current)),
          EditorView.contentAttributes.of({ 'aria-label': 'Memory content' }),
        ],
      }),
    })
    viewRef.current = view
    return () => { view.destroy(); viewRef.current = null }
  }, [soloLecturaComp])

  useEffect(() => {
    viewRef.current?.dispatch({ effects: soloLecturaComp.reconfigure(EditorState.readOnly.of(soloLectura)) })
  }, [soloLectura, soloLecturaComp])

  useEffect(() => {
    viewRef.current?.dispatch({ effects: refrescarLivePreview.of(null) })
  }, [linksPorNombre])

  // Cambio de afuera (un agente, otra máquina). Sin cambios locales: se recarga. Con cambios
  // locales (Review Focus 3): no se pisa lo escrito — banda, solo lectura, y el texto al
  // portapapeles para que tampoco se pierda al cerrar.
  procesarExternoRef.current = (ext) => {
    if (!montadoRef.current || ext.syncId !== detail.syncId) return
    const nuevo: Valor = { title: ext.title, content: ext.content ?? '' }
    setExternoAplicado(ext)
    if (ecoConsumidoRef.current !== null && ecoConsumidoRef.current === ext.updatedAt) return
    const i = marcasRef.current.findIndex((m) => (m.saved ? igual(m.saved, nuevo) : igualConTrim(m.enviado, nuevo)))
    if (i >= 0) {
      // Eco: ni banda ni tocar el documento. La referencia del autoguardado pasa a lo que
      // MANDAMOS, para que el trim/redact del store no deje la pestana en "Unsaved".
      setBase(marcasRef.current[i].enviado)
      marcasRef.current = marcasRef.current.slice(i + 1)
      ecoConsumidoRef.current = ext.updatedAt
      return
    }
    // Un cambio de otro: las marcas viejas ya no valen (si un agente vuelve la nota a
    // nuestro v1, eso no es nuestro eco).
    marcasRef.current = []
    ecoConsumidoRef.current = null
    const actual: Valor = { title: tituloRef.current, content: contenidoRef.current }
    if (igual(actual, nuevo)) { setBase(nuevo); return }
    if (sucioRef.current) {
      setBandaExterna(true)
      copiar(actual, () => setCopiado(true))
      return
    }
    setBase(nuevo)
    setTitulo(nuevo.title)
    const view = viewRef.current
    if (view) view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: nuevo.content } })
    else setContenido(nuevo.content)
  }

  useEffect(() => {
    if (!externo || externo.syncId !== detail.syncId) return
    if (enVueloRef.current > 0) { diferidoRef.current = externo; return }
    procesarExternoRef.current(externo)
    // Se dispara por versión, no por identidad del objeto.
  }, [externo?.updatedAt, externo?.syncId]) // eslint-disable-line react-hooks/exhaustive-deps

  // Un guardado rechazado porque otra versión la reemplazó: el texto no se pierde.
  useEffect(() => {
    if (auto.estado === 'reemplazada') copiar({ title: tituloRef.current, content: contenidoRef.current }, () => setCopiado(true))
  }, [auto.estado])

  // Borrada desde afuera con cambios sin guardar: ya no hay dónde guardarlos, así que van al
  // portapapeles, igual que con una versión nueva.
  useEffect(() => {
    if (borrada && sucioRef.current) copiar({ title: tituloRef.current, content: contenidoRef.current }, () => setCopiado(true))
  }, [borrada])

  const tituloInputRef = useRef<HTMLInputElement | null>(null)
  useEffect(() => {
    if (pedirFoco > 0) tituloInputRef.current?.focus({ preventScroll: true })
  }, [pedirFoco])

  useImperativeHandle(handleRef, () => ({
    irALinea: (n: number) => {
      const view = viewRef.current
      if (!view) return
      const entero = Number.isFinite(n) ? Math.trunc(n) : 1
      const l = view.state.doc.line(Math.max(1, Math.min(entero, view.state.doc.lines)))
      view.dispatch({ selection: { anchor: l.from }, scrollIntoView: true })
      view.focus()
    },
  }), [])

  const borrar = async () => {
    setBorrando(true) // corta el autoguardado: nada de re-guardar lo que se está borrando
    setErrorAlBorrar(false)
    try {
      await onDelete()
    } catch {
      setBorrando(false)
      setErrorAlBorrar(true)
    }
  }

  const swatch = memoryTypeSwatch(fuente.type, ansi)
  const mostrarReemplazada = reemplazadaDeOrigen || bandaExterna || auto.estado === 'reemplazada'
  const tituloVacio = titulo.trim() === ''
  const avisoDeTitulo = !soloLectura && tituloVacio
  const textoDeEstado = avisoDeTitulo ? 'Title required' : auto.estado === 'guardando' ? 'Saving…' : auto.estado === 'guardado' ? 'Saved' : auto.estado === 'pendiente' ? 'Unsaved' : null
  const banda = 'rounded-md border border-border bg-accent px-3 py-2 text-fs-sm'

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <div className="mx-auto w-full max-w-[720px] px-10 py-9">
        <div className="mb-4 flex items-center gap-2 text-fs-xs text-muted-foreground">
          <span aria-hidden className="size-2 shrink-0 rounded-full" style={{ background: swatch ? swatch.color : 'var(--muted-foreground)' }} />
          <span>{swatch ? swatch.label : fuente.type}</span>
          <span aria-hidden>·</span>
          <span className="font-mono">{nombreDeProyecto(fuente.projectKey, null)}</span>
          {fuente.gitBranch && (
            <>
              <span aria-hidden>·</span>
              <span className="font-mono">{fuente.gitBranch}</span>
            </>
          )}
          <span aria-hidden>·</span>
          <span>{relativeTime(fuente.updatedAt)}</span>
          {fuente.originAi && <AILogo aiType={fuente.originAi as AIType} size={12} />}
          <span className={avisoDeTitulo ? 'ml-auto text-destructive' : 'ml-auto'} aria-live="polite">{textoDeEstado}</span>
          {!soloLectura && (
            <DropdownMenu modal={false}>
              {/* El disparador ES el botón (con las clases de Button), no un `<Button>` hijo con
                  `asChild`: Button es un componente función de React 18 sin forwardRef, así que
                  Radix no recibía el ancla y el menú quedaba sin posicionar, fuera de la pantalla. */}
              <DropdownMenuTrigger className={buttonVariants({ variant: 'ghost', size: 'icon-sm' })} aria-label="More actions">
                <MoreHorizontal />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={() => onConnect()}>Connect to another memory…</DropdownMenuItem>
                <DropdownMenuItem variant="destructive" onSelect={() => setConfirmarBorrado(true)}>Delete</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>

        {mostrarReemplazada && (
          <div role="status" className={`${banda} mb-3 flex flex-wrap items-center gap-2`}>
            <span>A newer version replaced this one.</span>
            {copiado && <span className="text-muted-foreground">Your text was copied to the clipboard.</span>}
            <Button size="sm" variant="outline" className="ml-auto" onClick={onOpenNewer}>Open the newer version</Button>
          </div>
        )}
        {(auto.estado === 'borrada' || borrada) && (
          <div role="status" className={`${banda} mb-3 flex flex-wrap items-center gap-2`}>
            <span>This memory was deleted.</span>
            {copiado && !mostrarReemplazada && <span className="text-muted-foreground">Your text was copied to the clipboard.</span>}
          </div>
        )}
        {errorAlBorrar && (
          <div role="status" className={`${banda} mb-3 text-destructive`}>Could not delete this memory.</div>
        )}
        {auto.estado === 'error' && (
          <div role="status" className={`${banda} mb-3 flex items-center gap-2 text-destructive`}>
            <span>{auto.error ?? 'Could not save'}</span>
            <Button size="sm" variant="outline" className="ml-auto" onClick={auto.reintentar}>Retry</Button>
          </div>
        )}

        <input
          ref={tituloInputRef}
          aria-label="Memory title"
          value={titulo}
          readOnly={soloLectura}
          aria-invalid={tituloVacio}
          placeholder="Untitled"
          onChange={(e) => setTitulo(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { e.preventDefault(); viewRef.current?.focus() }
          }}
          className="mb-4 w-full border-0 border-b border-solid border-transparent bg-transparent p-0 text-fs-2xl font-semibold text-foreground outline-none placeholder:text-muted-foreground aria-invalid:border-destructive aria-invalid:placeholder:text-destructive"
        />

        {/* La captura guarda qué link se tocó, para anclar el popover: el handler de
            CodeMirror sólo pasa el nombre. */}
        <div
          ref={cuerpoRef}
          onMouseDownCapture={(e) => {
            const t = e.target as HTMLElement | null
            ultimoLinkRef.current = (t?.closest?.('[data-wikilink]') as HTMLElement | null) ?? null
          }}
        />

        <Popover open={pendiente !== null} onOpenChange={(o) => { if (!o) setPendiente(null) }}>
          <PopoverAnchor virtualRef={anclaRef} />
          <PopoverContent align="start" className="flex w-60 flex-col gap-2">
            <p className="text-fs-sm text-muted-foreground">Not written yet</p>
            <Button
              size="sm"
              onClick={() => {
                const n = pendiente
                setPendiente(null)
                if (n) onCreate(n)
              }}
            >
              Create this memory
            </Button>
          </PopoverContent>
        </Popover>
      </div>

      <AlertDialog open={confirmarBorrado} onOpenChange={setConfirmarBorrado}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this memory?</AlertDialogTitle>
            <AlertDialogDescription>This cannot be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => void borrar()}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
