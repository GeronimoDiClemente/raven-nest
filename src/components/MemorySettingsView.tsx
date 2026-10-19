// Task 5 (vista de Memory settings): el rail de 4 secciones numeradas que reemplaza el
// viejo Settings disperso. Cada sección agrupa cards ya existentes (Tasks 2-4); este
// componente sólo arma el rail, el header y decide qué mostrar.
import { useEffect, useState } from 'react'
import { CircleHelp } from 'lucide-react'
import WorkspaceNavButton from './WorkspaceNavButton'
import CloudMemoryCard from './CloudMemoryCard'
import LinkDeviceCard from './LinkDeviceCard'
import SyncServiceCard from './SyncServiceCard'
import MemoryEncryptionCard from './MemoryEncryptionCard'
import TeamEncryptionCard from './TeamEncryptionCard'
import ShareProjectCard from './ShareProjectCard'
import TeamThreadToggle from './TeamThreadToggle'
import MemoryVaultCard from './MemoryVaultCard'
import { useTeam } from '../hooks/useTeam'
import { Button } from '@/components/ui/button'
import { ICON_SIZE } from '../lib/icons'

export type SeccionDeMemoria = 'sync' | 'encryption' | 'project' | 'disk'

const SECCIONES: Array<{ id: SeccionDeMemoria; n: string; titulo: string; bajada: string }> = [
  { id: 'sync', n: '01', titulo: 'Sync', bajada: 'Same memory on every machine you work on.' },
  { id: 'encryption', n: '02', titulo: 'Encryption', bajada: "The server keeps your memory but can't read it — not even us." },
  { id: 'project', n: '03', titulo: 'This project & team', bajada: 'Nothing here is shared until you turn it on.' },
  { id: 'disk', n: '04', titulo: 'Notes on disk', bajada: 'Your memories as Markdown files you can open in any editor.' },
]

/**
 * Cada fila del rail lleva `data-tour-id="memory-settings-<id>"` vía la prop
 * dinámica `dataTourId` de `WorkspaceNavButton` (no un literal en el JSX), así
 * que el scraper por regex de `section-tours.test.ts` no la ve sola — igual
 * que `teams-nav-${section}` en `teamSections.ts`. Exportada para que ese test
 * la expanda en vez de confiar en un literal que no está.
 */
export const SECCIONES_DE_MEMORIA_IDS: SeccionDeMemoria[] = SECCIONES.map((s) => s.id)

export const EVENTO_SECCION = 'nest:memory-settings-seccion'

interface Props {
  activeRepoPath: string | null
  onLinkRepo?: () => void
  seccionInicial?: SeccionDeMemoria
  onHowItWorks: () => void
}

export default function MemorySettingsView({ activeRepoPath, onLinkRepo, seccionInicial = 'sync', onHowItWorks }: Props) {
  const [seccion, setSeccion] = useState<SeccionDeMemoria>(seccionInicial)
  const { activeTeam } = useTeam()

  // El tour (Task 7) navega el rail disparando este evento en vez de simular clicks.
  useEffect(() => {
    const alCambiar = (e: Event) => {
      const id = (e as CustomEvent<SeccionDeMemoria>).detail
      if (SECCIONES.some((s) => s.id === id)) setSeccion(id)
    }
    window.addEventListener(EVENTO_SECCION, alCambiar)
    return () => window.removeEventListener(EVENTO_SECCION, alCambiar)
  }, [])

  const actual = SECCIONES.find((s) => s.id === seccion)!
  return (
    <div className="flex min-h-0 flex-1">
      <nav className="teams-workspace-nav flex flex-col">
        {SECCIONES.map((s) => (
          <WorkspaceNavButton
            key={s.id}
            icon={<span className="font-mono text-fs-xs text-muted-foreground">{s.n}</span>}
            label={s.titulo}
            active={seccion === s.id}
            onClick={() => setSeccion(s.id)}
            dataTourId={`memory-settings-${s.id}`}
          />
        ))}
        <Button variant="outline" size="sm" className="mt-auto justify-start" onClick={onHowItWorks}>
          <CircleHelp size={ICON_SIZE.sm} aria-hidden />
          How Memories works
        </Button>
      </nav>
      <div className="flex min-w-0 flex-1 flex-col gap-4 overflow-y-auto p-6">
        <header className="flex flex-col gap-1">
          <h2 className="flex items-baseline gap-2 text-fs-lg font-semibold">
            <span className="font-mono text-fs-sm text-muted-foreground">{actual.n}</span>{actual.titulo}
          </h2>
          <p className="text-fs-sm text-muted-foreground">{actual.bajada}</p>
        </header>
        {seccion === 'sync' && (<><CloudMemoryCard /><LinkDeviceCard /><SyncServiceCard /></>)}
        {seccion === 'encryption' && (<><MemoryEncryptionCard />{activeTeam && <TeamEncryptionCard />}</>)}
        {seccion === 'project' && (activeRepoPath ? (
          <><ShareProjectCard activeRepoPath={activeRepoPath} /><TeamThreadToggle activeRepoPath={activeRepoPath} /></>
        ) : (
          <div className="flex items-center gap-3 rounded-md border border-border p-4">
            <span className="flex-1 text-fs-sm text-muted-foreground">Open a repo in this tab to share it or keep branch notes.</span>
            {onLinkRepo && <Button variant="outline" size="sm" onClick={onLinkRepo}>Link a repo</Button>}
          </div>
        ))}
        {seccion === 'disk' && <MemoryVaultCard />}
      </div>
    </div>
  )
}
