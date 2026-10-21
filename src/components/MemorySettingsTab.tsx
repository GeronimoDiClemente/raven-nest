// La pestaña Settings de Memories (spec 2026-10-21 §3-§5): una sección por vez (D1). Vive
// FUERA de components/memories/ porque monta las tarjetas que hablan con window.memory; las
// piezas puras (fila, sección, Editor & graph) sí están allá y entran por props.
import { useState } from 'react'
import { createPortal } from 'react-dom'
import CloudMemoryCard from './CloudMemoryCard'
import UpgradeModal from './UpgradeModal'
import { useProfile } from '../hooks/useProfile'
import SyncServiceCard from './SyncServiceCard'
import SyncTokenRow from './SyncTokenRow'
import MemoryEncryptionCard from './MemoryEncryptionCard'
import TeamEncryptionCard from './TeamEncryptionCard'
import ShareProjectCard from './ShareProjectCard'
import TeamThreadToggle from './TeamThreadToggle'
import MemoryVaultCard from './MemoryVaultCard'
import SettingsSection from './memories/settings/SettingsSection'
import SettingRow from './memories/settings/SettingRow'
import EditorGraphSection from './memories/settings/EditorGraphSection'
import { useTeam } from '../hooks/useTeam'
import type { UseTeamThreadSettings } from '../hooks/useTeamThreadSettings'
import type { SeccionDeSettings } from '../lib/memory-tabs'
import type { MemoryPrefs } from '../lib/memory-prefs'
import { Button } from '@/components/ui/button'

export interface MemorySettingsTabProps {
  seccion: SeccionDeSettings
  onSeccion: (s: SeccionDeSettings) => void
  activeRepoPath: string | null
  onLinkRepo?: () => void
  /** El estado del hilo del workspace: el mismo que decide la pestaña Team thread. */
  hilo: UseTeamThreadSettings
  prefs: MemoryPrefs
  prefsCargadas: boolean
  onPrefs: (cambio: (p: MemoryPrefs) => MemoryPrefs) => void
  onResetGraph: () => void
}

/** D19: el nombre de la carpeta del repo, que es como lo reconoce la persona. */
function nombreDelRepo(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path
}

/** El UpgradeModal de siempre (spec §5: no se toca, es 2b). Se monta sólo abierto, así la
 *  lectura del perfil no corre en cada vuelta a This project. */
function PlanesModal({ onClose }: { onClose: () => void }) {
  const { plan } = useProfile()
  return createPortal(<UpgradeModal currentPlan={plan} onClose={onClose} />, document.body)
}

export default function MemorySettingsTab(p: MemorySettingsTabProps) {
  const { activeTeam } = useTeam()
  const [planes, setPlanes] = useState(false)
  switch (p.seccion) {
    case 'sync':
      return (
        <SettingsSection titulo="Sync" bajada="Your memory on every machine you sign in to.">
          <CloudMemoryCard />
        </SettingsSection>
      )
    case 'encryption':
      return (
        <SettingsSection titulo="Encryption" bajada="The server stores your memory without being able to read it.">
          <MemoryEncryptionCard onSetUpSync={() => p.onSeccion('sync')} />
          {activeTeam && <TeamEncryptionCard />}
        </SettingsSection>
      )
    case 'editor':
      return (
        <SettingsSection titulo="Editor & graph">
          <EditorGraphSection prefs={p.prefs} disabled={!p.prefsCargadas} onChange={p.onPrefs} onResetGraph={p.onResetGraph} />
        </SettingsSection>
      )
    case 'project':
      return p.activeRepoPath ? (
        <SettingsSection titulo="This project" bajada={<>Settings for <span className="font-mono">{nombreDelRepo(p.activeRepoPath)}</span>.</>}>
          <ShareProjectCard activeRepoPath={p.activeRepoPath} onSeePlans={() => setPlanes(true)} />
          <TeamThreadToggle hilo={p.hilo} />
          {planes && <PlanesModal onClose={() => setPlanes(false)} />}
        </SettingsSection>
      ) : (
        <SettingsSection titulo="This project">
          <SettingRow
            nombre="Open a repo in this tab to see its settings."
            control={p.onLinkRepo && <Button variant="outline" size="sm" onClick={p.onLinkRepo}>Link a repo</Button>}
          />
        </SettingsSection>
      )
    case 'disk':
      return (
        <SettingsSection titulo="Notes on disk">
          <MemoryVaultCard />
        </SettingsSection>
      )
    case 'advanced':
      return (
        <SettingsSection titulo="Advanced" bajada="Only if your company runs its own Nest server.">
          <SyncServiceCard />
          <SyncTokenRow />
        </SettingsSection>
      )
  }
}
