// La pestaña Settings de Memories (spec 2026-10-21 §3-§5): una sección por vez (D1). Vive
// FUERA de components/memories/ porque monta las tarjetas que hablan con window.memory; las
// piezas puras (fila, sección, Editor & graph) sí están allá y entran por props.
import CloudMemoryCard from './CloudMemoryCard'
import LinkDeviceCard from './LinkDeviceCard'
import SyncServiceCard from './SyncServiceCard'
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
  return path.split(/[\/]/).filter(Boolean).pop() ?? path
}

export default function MemorySettingsTab(p: MemorySettingsTabProps) {
  const { activeTeam } = useTeam()
  switch (p.seccion) {
    case 'sync':
      return (
        <SettingsSection titulo="Sync" bajada="Your memory on every machine you sign in to.">
          <CloudMemoryCard />
          <LinkDeviceCard />
        </SettingsSection>
      )
    case 'encryption':
      return (
        <SettingsSection titulo="Encryption" bajada="The server stores your memory without being able to read it.">
          <MemoryEncryptionCard />
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
          <ShareProjectCard activeRepoPath={p.activeRepoPath} />
          <TeamThreadToggle hilo={p.hilo} />
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
        </SettingsSection>
      )
  }
}
