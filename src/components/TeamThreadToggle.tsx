// Task 2 (mirar vs. configurar): el toggle del hilo de equipo, separado del grafo (antes
// vivia adentro de TeamThreadGraph como el boton "Turn on"/"Turn off"). Se monta en la
// vista de settings (Task 5), no en el panel que mira el grafo. El estado lo levanta
// MemoriesWorkspace (lo comparte con la pestaña Team thread).
import type { UseTeamThreadSettings } from '../hooks/useTeamThreadSettings'

interface Props {
  hilo: UseTeamThreadSettings
}

export default function TeamThreadToggle({ hilo: t }: Props) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-3">
        <span id="branch-notes-label" className="text-fs font-medium">Branch notes in the repo</span>
        <button
          type="button" role="switch" aria-checked={t.enabled} aria-labelledby="branch-notes-label"
          disabled={!t.ready || !t.projectKey}
          onClick={() => void t.setEnabled(!t.enabled)}
          className="ml-auto h-5 w-9 rounded-full border border-border bg-muted aria-checked:bg-foreground"
        >
          <span className="block h-4 w-4 translate-x-0.5 rounded-full bg-background transition-transform data-[on=true]:translate-x-4" data-on={t.enabled} />
        </button>
      </div>
      <p className="text-fs-sm text-muted-foreground">
        Writes a short note per branch into <code className="font-mono">.nest/team/</code> inside this repo: who is on it,
        what they changed and what they found. It travels with git, so the team reads it even without Nest — and a map
        of the branches shows up under the graph in Memories.
      </p>
      {t.error && <p className="text-fs-sm text-warn">{t.error}</p>}
    </div>
  )
}
