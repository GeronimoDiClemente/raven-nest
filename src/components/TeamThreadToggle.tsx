// Branch notes (spec 2026-10-21 §5): el toggle del hilo de equipo, en fila. El estado lo
// levanta MemoriesWorkspace y lo comparte con la pestaña Team thread (D3).
import type { UseTeamThreadSettings } from '../hooks/useTeamThreadSettings'
import SettingRow from './memories/settings/SettingRow'
import { Switch } from '@/components/ui/switch'

interface Props { hilo: UseTeamThreadSettings }

export default function TeamThreadToggle({ hilo }: Props) {
  return (
    <SettingRow
      id="branch-notes-label"
      nombre="Branch notes"
      descripcion={<>Writes a short note per branch into <code className="font-mono">.nest/team/</code>. It travels with git, so it&apos;s readable without Nest, and adds a branch map under the graph.</>}
      control={
        <Switch
          aria-labelledby="branch-notes-label"
          checked={hilo.enabled}
          disabled={!hilo.ready || !hilo.projectKey}
          onCheckedChange={(v) => void hilo.setEnabled(v)}
        />
      }
    >
      {hilo.error && <p className="m-0 text-fs-sm text-warn">{hilo.error}</p>}
    </SettingRow>
  )
}
