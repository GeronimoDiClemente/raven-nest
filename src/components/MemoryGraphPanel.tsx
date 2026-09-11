// El cuadro del grafo de memorias: acotado, 3D, y una VISTA de la lista — no su reemplazo.
//
// Spec 2026-09-11 §3. Tres cosas que este archivo defiende y que son fáciles de romper sin
// darse cuenta:
//
// 1. **El cuadro no crece.** Es un cuadrado de lado fijo. El grafo que había antes ocupaba
//    toda la pantalla y el usuario lo describió como "0 intuitiva". La referencia es el
//    panel local de Obsidian: chico, al costado, mirable de reojo.
// 2. **Con cero nodos no se monta nada.** Un cuadro vacío con un borde es peor que no tener
//    cuadro: ocupa lugar y no dice nada.
// 3. **El render pesado entra por `import()` diferido.** `MemoryGraph3D` es el único archivo
//    que importa react-force-graph-3d; acá se carga tarde y una sola vez. Convertir este
//    import en estático devuelve 1.37 MB al arranque sin que nadie lo note.
import { lazy, Suspense, useEffect, useMemo, useState } from 'react'
import { useMemoryGraph } from '../hooks/useMemoryGraph'
import { countEdgeKinds, EDGE_KINDS_IN_LEGEND_ORDER, EDGE_STYLES } from '../lib/memory-graph-visuals'
import { Button } from '@/components/ui/button'

/** Una sola promesa para toda la app: el prefetch y el `lazy` comparten el módulo, así que
 *  precargar de verdad evita la espera en vez de duplicar la descarga. Mismo patrón que
 *  `monacoSetupPromise` en EditorPane.tsx:35. */
let graph3dPromise: Promise<typeof import('./MemoryGraph3D')> | null = null
function cargarGraph3D() {
  graph3dPromise ??= import('./MemoryGraph3D')
  return graph3dPromise
}

/**
 * Dispara la descarga del chunk del grafo sin montarlo. Se llama al ABRIR Memories, no al
 * montar el grafo: así el 1.37 MB viaja mientras el usuario mira la lista, que es lo primero
 * que ve, y el cuadro aparece ya cargado.
 */
export function prefetchMemoryGraph3D(): void {
  void cargarGraph3D()
}

const MemoryGraph3D = lazy(cargarGraph3D)

/** Lado del cuadro, en px. Fijo a propósito — ver el punto 1 del comentario de arriba. */
const LADO = 320

interface Props {
  /** syncId seleccionado en la lista, o null. */
  selectedId: string | null
  onSelect: (syncId: string | null) => void
}

export default function MemoryGraphPanel({ selectedId, onSelect }: Props) {
  const [includeSimilar, setIncludeSimilar] = useState(false)
  const { data, truncated, loading, error } = useMemoryGraph(includeSimilar)

  useEffect(() => { prefetchMemoryGraph3D() }, [])

  const conteos = useMemo(() => (data ? countEdgeKinds(data) : null), [data])

  // Qué mostrar del nodo elegido. Es lo que llena la columna de la derecha: sin esto,
  // seleccionar algo en la lista resaltaba el grafo y dejaba media pantalla vacía al lado.
  const seleccionado = useMemo(() => {
    if (!data || !selectedId) return null
    const nodo = data.nodes.find((n) => n.id === selectedId)
    if (!nodo) return null
    const conectadas = data.links.filter((l) => {
      const a = typeof l.source === 'string' ? l.source : (l.source as { id?: string })?.id
      const b = typeof l.target === 'string' ? l.target : (l.target as { id?: string })?.id
      return a === selectedId || b === selectedId
    })
    return { nodo, conectadas }
  }, [data, selectedId])

  // Punto 2: sin nodos no hay cuadro. Tampoco mientras carga la primera vez — un esqueleto
  // de 320px que aparece y desaparece es peor que nada.
  if (error) {
    return (
      <div className="shrink-0 rounded-md border border-border px-3 py-2 text-fs-sm text-muted-foreground">
        The memory graph could not be read: {error}
      </div>
    )
  }
  if (loading && !data) return null
  if (!data || data.nodes.length === 0) return null

  return (
    <div className="flex shrink-0 gap-4 rounded-md border border-border p-3">
      {/* El cuadrado. `shrink-0` es lo que impide que el flex lo achique cuando la columna
          de al lado crece — sin eso deja de ser cuadrado y vuelve a depender del contenido. */}
      <div
        className="shrink-0 overflow-hidden rounded-md bg-card"
        style={{ width: LADO, height: LADO }}
      >
        <Suspense fallback={<div className="h-full w-full" />}>
          <MemoryGraph3D data={data} selectedId={selectedId} onSelect={onSelect} />
        </Suspense>
      </div>

      {/* `justify-center`: la columna tiene 3 o 4 lineas contra un cuadro de 320px, asi que
          alineada arriba dejaba un vacio grande abajo que hacia ver el panel a medio hacer.
          Centrada, el bloque se lee como una pareja del cuadro. */}
      <div className="flex min-w-0 flex-1 flex-col justify-center gap-3">
        {seleccionado ? (
          <div className="min-w-0">
            <div className="flex items-baseline gap-2">
              <span
                aria-hidden
                className="size-2 shrink-0 self-center rounded-full"
                style={{ background: seleccionado.nodo.color }}
              />
              <p className="min-w-0 flex-1 truncate text-fs font-medium text-foreground">
                {seleccionado.nodo.label}
              </p>
            </div>
            <p className="text-fs-sm text-muted-foreground">
              {seleccionado.nodo.type}
              {seleccionado.nodo.superseded && ' · replaced by a newer version'}
              {' · '}
              {seleccionado.conectadas.length === 0
                ? 'not connected to anything else'
                : `${seleccionado.conectadas.length} ${seleccionado.conectadas.length === 1 ? 'connection' : 'connections'}`}
            </p>
          </div>
        ) : (
          <div>
            <p className="text-fs font-medium text-foreground">How these memories connect</p>
            <p className="text-fs-sm text-muted-foreground">
              {data.nodes.length} {data.nodes.length === 1 ? 'memory' : 'memories'}
              {truncated > 0 && ` · ${truncated} more not shown`}
              {' · click one to follow its thread'}
            </p>
          </div>
        )}

        {/* La leyenda no es decorativa: es lo que hace que las cuatro relaciones signifiquen
            algo distinto. Un tipo de arista que no aparece en ESTE grafo no se lista — una
            leyenda que nombra cosas que no están en pantalla enseña mal. */}
        <ul className="flex flex-col gap-1.5">
          {EDGE_KINDS_IN_LEGEND_ORDER.map((kind) => {
            const style = EDGE_STYLES[kind]
            const n = conteos?.[kind] ?? 0
            if (n === 0 && kind !== 'similar') return null
            return (
              <li key={kind} className="flex items-baseline gap-2 text-fs-sm">
                <span
                  aria-hidden
                  className="inline-block shrink-0 self-center rounded-full"
                  style={{ width: 18, height: Math.max(style.width, 1), background: style.color }}
                />
                <span className="text-foreground">{style.label}</span>
                <span className="min-w-0 truncate text-muted-foreground">{style.meaning}</span>
              </li>
            )
          })}
        </ul>

        <div className="mt-1">
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
    </div>
  )
}
