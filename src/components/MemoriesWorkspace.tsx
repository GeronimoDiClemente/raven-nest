// Spec §4.4 (direccion C, "el hilo es la pantalla") y §5.2. Reusa `teams-workspace` como
// cascara visual — es la misma forma de overlay a pantalla completa que Personal y Teams —
// y suma `.memories-workspace` para el z-index de arriba de todo (§5.4).
//
// SIN chips de scope (decision 3): el grafo ya dibuja las ramas con autor y fecha, asi que
// "tuyo vs del equipo" se ve por color. Ademas evita heredar el acoplamiento de
// PersonalWorkspace.tsx:306, donde elegir un equipo llama a switchTeam y cambia chat,
// presencia y stats de TODA la app.
import { useEffect, useState } from 'react'
import { useMemories } from '../hooks/useMemories'
import MemoriesList from './MemoriesList'
import MemoryGraphPanel from './MemoryGraphPanel'
import MemoriesStatusRow from './MemoriesStatusRow'
import ShareProjectCard from './ShareProjectCard'
import TeamThreadPanel from './TeamThreadPanel'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

interface HubStats {
  itemCount: number
  projectCount: number
}

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
}

export default function MemoriesWorkspace({ onClose, activeRepoPath, onOpenFile, onLinkRepo, closing = false }: Props) {
  const state = useMemories()

  // Spec §3: el grafo es una VISTA de la lista, no su reemplazo — seleccionar una memoria
  // en la lista la resalta en el grafo y viceversa. La seleccion vive aca, que es el unico
  // lugar que ve a los dos.
  const [selectedId, setSelectedId] = useState<string | null>(null)

  // El estado vacio (sin repo) no tiene la memoria __global__ disponible en el renderer
  // (MemoriesState no trae ningun campo de scope, y window.memory no expone una lectura de
  // memorias por proyecto — construirla es feature nueva, fuera de alcance de esta
  // migracion de UI). En su lugar se muestra lo que SI existe sin repo: los totales de la
  // cuenta via hubStats(). Review M1: `hubStats` es REQUERIDO en window.memory
  // (src/types.ts) — no opcional como decia este comentario antes; el `?.` de abajo es
  // encadenado igual (cortocircuita entero si faltara, sin `.then` de `undefined`) para
  // sobrevivir a un preload viejo en dev/tests, y el catch evita que un fallo de IPC
  // rompa la card — se muestra sin los numeros en vez de reventar el arbol.
  const [hub, setHub] = useState<HubStats | null>(null)
  useEffect(() => {
    if (activeRepoPath) return
    let alive = true
    window.memory?.hubStats?.()
      .then((stats) => { if (alive) setHub(stats) })
      .catch(() => { /* la card se muestra sin los numeros, no revienta el arbol */ })
    return () => { alive = false }
  }, [activeRepoPath])

  return (
    <div className={`teams-workspace memories-workspace${closing ? ' closing' : ''}`}>
      <div className="teams-workspace-header">
        <button className="tw-back-btn" onClick={onClose}>
          <svg width="13" height="13" viewBox="0 0 13 13" fill="none" style={{ display: 'inline-block', verticalAlign: 'middle', marginRight: 5 }}>
            <path d="M8 2L4 6.5L8 11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          Back
        </button>

        <div className="tw-header-center">
          <svg width="15" height="15" viewBox="0 0 16 16" fill="none" style={{ color: 'var(--raven-blue)', flexShrink: 0 }}>
            <circle cx="8" cy="4" r="2" stroke="currentColor" strokeWidth="1.3" />
            <circle cx="3.5" cy="12" r="2" stroke="currentColor" strokeWidth="1.3" />
            <circle cx="12.5" cy="12" r="2" stroke="currentColor" strokeWidth="1.3" />
            <path d="M6.7 5.7 4.8 10.2M9.3 5.7l1.9 4.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
          </svg>
          <span>Memories</span>
        </div>
      </div>

      <MemoriesStatusRow state={state} />

      <div className="teams-workspace-body memories-body">
        {/* Spec 2026-09-11 §1: la lista es lo primero y lo que ocupa el espacio
            principal — cross-project (decision 1 de la spec), no depende de
            activeRepoPath. `flex-1 min-h-0` (adentro de MemoriesList) es lo que le
            da a la fila virtualizada una altura acotada real dentro de esta caja de
            altura ya acotada (.teams-workspace-body's flex:1 + overflow:hidden), en
            vez de crecer con el contenido y forzar el scroll de la pagina entera. */}
        <MemoriesList selectedId={selectedId} onSelect={setSelectedId} />

        {/* El grafo de MEMORIAS (spec §3): cuadrado acotado, 3D, debajo de la lista. No se
            monta con cero nodos, asi que en una cuenta vacia esta linea no ocupa nada. */}
        <MemoryGraphPanel selectedId={selectedId} onSelect={setSelectedId} />

        {activeRepoPath ? (
          // El grafo de ramas (TeamThreadGraph) es otro grafo, fuera de alcance de esta
          // pasada — sigue existiendo, pero ya no es lo primero que se ve: pasa a un
          // cuadro acotado y secundario, debajo de la lista de memorias real.
          <div className="max-h-64 shrink-0 overflow-y-auto rounded-md border border-border p-3">
            <TeamThreadPanel activeRepoPath={activeRepoPath} onOpenFile={onOpenFile} />
          </div>
        ) : (
          // Igual que el grafo de ramas de arriba: este card es sobre ESE grafo (no
          // sobre las memorias, que ya tienen su propio estado vacio en MemoriesList),
          // asi que pasa a secundario y compacto en vez de hero centrado.
          <div className="flex shrink-0 items-center justify-center py-2">
            <Card className="w-full max-w-md text-center">
              <CardHeader>
                {/* CardTitle/CardDescription stock traen 16px/14px (text-base/text-sm),
                    fuera de la escala --fs-*. Antes de Task 8b pisarlos desde acá no
                    servía: cn() clasificaba text-fs-* como color, así que colisionaba
                    con el text-muted-foreground de CardDescription en vez de con su
                    tamaño — perdía el pisado en silencio. Con cn() arreglado (misma
                    escala, mismo grupo que text-base/text-sm), el último className gana
                    de verdad. Se redondea al escalón más cercano: 16->text-fs-lg (15,
                    -1), 14->text-fs (13, -1) — mismo criterio que Sidebar.tsx:366. */}
                {/* 2026-09-11: decía "Link a repo to see its memory graph". Desde que
                    MemoryGraphPanel existe, el grafo DE MEMORIAS ya está en pantalla arriba
                    de esta card, así que ese texto se contradecía con lo que el usuario
                    estaba viendo. Lo que falta sin repo es el otro grafo, el de RAMAS. */}
                <CardTitle className="text-fs-lg">Link a repo to see its branches</CardTitle>
                <CardDescription className="text-fs">
                  {/* El contador sólo si el dato está Y tiene sentido: con memorias pero
                      projectCount en 0 la frase decía "6 memories across 0 projects", que
                      es la clase de número que hace desconfiar de toda la pantalla. */}
                  {hub && hub.projectCount > 0
                    ? `With a repo linked you also see who changed what, and when — you have ${hub.itemCount} ${hub.itemCount === 1 ? 'memory' : 'memories'} across ${hub.projectCount} ${hub.projectCount === 1 ? 'project' : 'projects'}.`
                    : 'With a repo linked you also see who changed what, and when.'}
                </CardDescription>
              </CardHeader>
              {onLinkRepo && (
                <CardContent>
                  <Button onClick={onLinkRepo}>Link a repo</Button>
                </CardContent>
              )}
            </Card>
          </div>
        )}

        <ShareProjectCard activeRepoPath={activeRepoPath} />
      </div>
    </div>
  )
}
