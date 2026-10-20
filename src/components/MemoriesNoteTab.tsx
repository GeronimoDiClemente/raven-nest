// La pestaña de una nota de Memories: el adaptador entre `window.memory` y los componentes de
// presentación (`MemoryNoteEditor` en el centro, `MemoryNoteSidePanel` en la columna
// derecha). Es, junto con `MemoriesWorkspace`, lo único de Memories que habla con el preload:
// los componentes de `memories/` entran por props y salen por callbacks (spec §6).
import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import MemoryNoteEditor, { type MemoryNoteEditorHandle } from './memories/MemoryNoteEditor'
import MemoryNoteSidePanel from './memories/MemoryNoteSidePanel'
import { useMemoryDetail } from '../hooks/useMemoryDetail'
import type { ResultadoDeGuardado } from '../hooks/useAutosave'
import type { CandidatoDeLink } from '../lib/cm-wikilink-autocomplete'
import type { GraphData } from '../lib/memory-graph-visuals'
import type { MemoryObservationDetail } from '../types'

export interface MemoriesNoteTabProps {
  syncId: string
  /** Sube con cada `onChanged`: vuelve a leer la memoria. */
  version: number
  graphData: GraphData
  ansi?: readonly string[]
  candidatos: CandidatoDeLink[]
  titulosPorId: ReadonlyMap<string, { title: string; type: string }>
  /** Portal: el panel lateral vive en la columna derecha. `null` = esta pestaña no es la
   *  activa (o la columna no existe todavía) y no dibuja panel. */
  panelDerecho: HTMLElement | null
  onOpen: (syncId: string, opts: { background: boolean }) => void
  onCreate: (titulo: string) => void
  onConnect: (syncId: string) => void
  onDeleted: (syncId: string) => void
  /** Para la etiqueta de la pestaña. */
  onTitulo: (syncId: string, titulo: string, tipo: string) => void
}

/** Lo que identifica una versión del store: si no cambió, un `onChanged` (que avisa de
 *  CUALQUIER memoria) no es un cambio de ésta, y pasárselo al editor como externo con cambios
 *  locales le haría mostrar la banda de "versión nueva" sin que haya ninguna. */
const versionDe = (d: MemoryObservationDetail) => `${d.updatedAt}|${d.supersededBy ?? ''}`

export default function MemoriesNoteTab({
  syncId, version, graphData, ansi, candidatos, titulosPorId, panelDerecho,
  onOpen, onCreate, onConnect, onDeleted, onTitulo,
}: MemoriesNoteTabProps) {
  // `recarga` se suma a `version` para el nonce: los dos sólo suben, así que la suma cambia
  // cuando cambia cualquiera de los dos.
  const [recarga, setRecarga] = useState(0)
  const { detail, missing } = useMemoryDetail(syncId, version + recarga)

  // La primera versión que llega es el `detail` del editor; las siguientes van como `externo`
  // (el editor decide si es eco, si recarga o si muestra la banda).
  const [inicial, setInicial] = useState<MemoryObservationDetail | null>(null)
  // Remonta el editor para adoptar una versión recargada a pedido ("Open the newer version"
  // sin `supersededBy`): el editor arma su estado desde `detail` al montar.
  const [montaje, setMontaje] = useState(0)
  const adoptarProxima = useRef(false)

  useEffect(() => {
    if (!detail) return
    if (inicial === null || adoptarProxima.current) {
      if (adoptarProxima.current) setMontaje((m) => m + 1)
      adoptarProxima.current = false
      setInicial(detail)
    }
    // Sólo cuando llega una lectura nueva.
  }, [detail]) // eslint-disable-line react-hooks/exhaustive-deps

  const externo = detail && inicial && detail !== inicial && versionDe(detail) !== versionDe(inicial) ? detail : null

  const onTituloRef = useRef(onTitulo)
  onTituloRef.current = onTitulo
  useEffect(() => {
    if (detail) onTituloRef.current(syncId, detail.title, detail.type)
  }, [syncId, detail?.title, detail?.type]) // eslint-disable-line react-hooks/exhaustive-deps

  const onSave = useCallback(async (v: { title: string; content: string }): Promise<ResultadoDeGuardado> => {
    const api = window.memory?.updateFromUi
    if (!api) return { ok: false, error: 'This build cannot edit memories yet.' }
    // El resultado ENTERO, con `saved`: es lo que deja al editor reconocer el eco de su
    // propio guardado cuando vuelve por `onChanged`.
    return api({ syncId, title: v.title, content: v.content })
  }, [syncId])

  const onDelete = useCallback(async () => {
    const api = window.memory?.deleteFromUi
    if (!api) throw new Error('This build cannot delete memories yet.')
    const res = await api(syncId)
    if (!res.ok) throw new Error(res.error ?? 'Could not delete')
    onDeleted(syncId)
  }, [syncId, onDeleted])

  const editorRef = useRef<MemoryNoteEditorHandle>(null)

  if (!inicial) {
    return (
      <p className="p-6 text-fs-sm text-muted-foreground">
        {missing
          ? 'This memory is no longer there — it was deleted after the graph was drawn.'
          : 'Loading…'}
      </p>
    )
  }

  const reemplazadaPor = (detail ?? inicial).supersededBy

  return (
    <>
      <MemoryNoteEditor
        key={montaje}
        ref={editorRef}
        detail={inicial}
        ansi={ansi}
        candidatos={candidatos}
        externo={externo}
        onSave={onSave}
        onOpen={onOpen}
        onCreate={onCreate}
        onOpenNewer={() => {
          if (reemplazadaPor) { onOpen(reemplazadaPor, { background: false }); return }
          // Cambio de afuera con cambios locales: lo escrito ya se copió al portapapeles; se
          // vuelve a leer la memoria y el editor se remonta con la versión del store.
          adoptarProxima.current = true
          setRecarga((r) => r + 1)
        }}
        onConnect={() => onConnect(syncId)}
        onDelete={onDelete}
        // Ya cargada una vez y ahora la relectura no la encuentra: la borró un agente u otra
        // máquina. Sólo lectura ya, no recién cuando un guardado vuelva con 'deleted'.
        borrada={missing}
      />
      {panelDerecho && createPortal(
        <MemoryNoteSidePanel
          detail={detail ?? inicial}
          graphData={graphData}
          ansi={ansi}
          titulosPorId={titulosPorId}
          onOpen={onOpen}
          onIrALinea={(linea) => editorRef.current?.irALinea(linea)}
        />,
        panelDerecho,
      )}
    </>
  )
}
