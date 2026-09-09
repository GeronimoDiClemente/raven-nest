// Spec §4.4 (direccion C, "el hilo es la pantalla") y §5.2. Reusa `teams-workspace` como
// cascara visual — es la misma forma de overlay a pantalla completa que Personal y Teams —
// y suma `.memories-workspace` para el z-index de arriba de todo (§5.4).
//
// SIN chips de scope (decision 3): el grafo ya dibuja las ramas con autor y fecha, asi que
// "tuyo vs del equipo" se ve por color. Ademas evita heredar el acoplamiento de
// PersonalWorkspace.tsx:306, donde elegir un equipo llama a switchTeam y cambia chat,
// presencia y stats de TODA la app.
import { useMemories } from '../hooks/useMemories'
import MemoriesStatusRow from './MemoriesStatusRow'
import MemoryVaultCard from './MemoryVaultCard'
import ShareProjectCard from './ShareProjectCard'
import TeamThreadPanel from './TeamThreadPanel'

interface Props {
  onClose: () => void
  activeRepoPath: string | null
  onOpenFile: (relPath: string) => void
}

export default function MemoriesWorkspace({ onClose, activeRepoPath, onOpenFile }: Props) {
  const state = useMemories()

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
          <p className="memories-empty">
            Open a repo to see its memory graph. Memories are captured per project.
          </p>
        )}

        <ShareProjectCard activeRepoPath={activeRepoPath} />

        <MemoryVaultCard />
      </div>
    </div>
  )
}
