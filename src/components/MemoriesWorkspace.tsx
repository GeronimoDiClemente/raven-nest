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
import MemoriesStatusRow from './MemoriesStatusRow'
import MemoryVaultCard from './MemoryVaultCard'
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
}

export default function MemoriesWorkspace({ onClose, activeRepoPath, onOpenFile, onLinkRepo }: Props) {
  const state = useMemories()

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
    <div className="teams-workspace memories-workspace">
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
        {activeRepoPath ? (
          // El grafo es SIEMPRE por proyecto, nunca global: con 866 notas en 9 proyectos un
          // grafo global se degrada mucho antes de los 200 nodos que aguanta (§5.2).
          <TeamThreadPanel activeRepoPath={activeRepoPath} onOpenFile={onOpenFile} />
        ) : (
          // El estado vacio de esta pantalla (2026-09-09: "se ve vacía" — header, una tira
          // de estado, una frase suelta y 80% de negro). La card da una SALIDA en vez de
          // solo explicar, y muestra lo que si existe sin repo: los totales de la cuenta.
          //
          // Review I5: `my-auto` solo centraba en el harness de test, donde ShareProjectCard
          // y MemoryVaultCard devuelven null (sin repo / memoria no inicializada). Con
          // MemoryVaultCard renderizando de verdad (cualquier usuario con memoria activa —
          // justamente a quien la card le muestra numeros reales), el auto-margin colapsaba
          // contra el alto del hermano de abajo y la card volvia a quedar pegada arriba. El
          // wrapper de aca abajo es flex-1 DENTRO de .memories-body (column) — crece para
          // llenar el espacio que sobra en su propia caja, sin importar cuanto midan
          // ShareProjectCard/MemoryVaultCard como hermanos — y centra la Card adentro suyo
          // en las dos direcciones.
          <div className="flex flex-1 items-center justify-center">
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
                <CardTitle className="text-fs-lg">Link a repo to see its memory graph</CardTitle>
                <CardDescription className="text-fs">
                  {hub
                    ? `Memories are captured per project — you already have ${hub.itemCount} ${hub.itemCount === 1 ? 'memory' : 'memories'} across ${hub.projectCount} ${hub.projectCount === 1 ? 'project' : 'projects'}.`
                    : 'Memories are captured per project.'}
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

        <MemoryVaultCard />
      </div>
    </div>
  )
}
