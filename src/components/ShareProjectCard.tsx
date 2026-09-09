// D6 de las respuestas de Bauti (2026-09-09): el endpoint POST /v1/projects/share existe
// desde Layer 1 y nunca tuvo UI. Sin ella, `scope: 'team'` se retiene en silencio del lado
// del servidor con `project_not_shared_with_team`, que es reversible: se destraba
// compartiendo el proyecto, y hasta entonces el equipo cree que comparte y no comparte.
//
// ⚠️ Lee `teams` de useTeam() y NUNCA llama a switchTeam. Elegir un equipo aca es elegir un
// destino para compartir, no cambiar el equipo activo de la app (decision 3 de la spec; el
// acoplamiento que se evita esta en PersonalWorkspace.tsx:306).
import { useEffect, useState } from 'react'
import { useTeam } from '../hooks/useTeam'

interface Props {
  activeRepoPath: string | null
}

export default function ShareProjectCard({ activeRepoPath }: Props) {
  const { teams } = useTeam()
  const [projectKey, setProjectKey] = useState<string | null>(null)
  const [teamId, setTeamId] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null)

  useEffect(() => {
    if (!activeRepoPath) { setProjectKey(null); return }
    let alive = true
    window.memory?.teamThreadProjectKeyForWorktree?.(activeRepoPath)
      .then((res) => { if (alive) setProjectKey(res?.ok ? res.projectKey ?? null : null) })
      .catch(() => { if (alive) setProjectKey(null) })
    return () => { alive = false }
  }, [activeRepoPath])

  useEffect(() => {
    if (!teamId && teams.length > 0) setTeamId(teams[0].id)
  }, [teams, teamId])

  // Sin repo abierto no hay proyecto que compartir. Self-contained como MemoryVaultCard: no
  // se inventa un estado vacio.
  if (!activeRepoPath) return null

  const share = async (): Promise<void> => {
    if (!projectKey || !teamId) return
    setBusy(true)
    setResult(null)
    try {
      const res = await window.memory?.shareProjectWithTeam?.(projectKey, teamId)
      const team = teams.find((t) => t.id === teamId)
      if (res?.ok) {
        setResult({
          ok: true,
          text: `Shared with ${team?.name ?? 'the team'}. Team memories will sync from now on.`,
        })
      } else {
        setResult({ ok: false, text: `Couldn't share this project: ${res?.error ?? 'unknown error'}` })
      }
    } catch (err) {
      setResult({
        ok: false,
        text: `Couldn't share this project: ${err instanceof Error ? err.message : String(err)}`,
      })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="memories-share">
      <h4>Share this project with a team</h4>
      {teams.length === 0 ? (
        <p className="memories-muted">You are not in a team yet. Team memories need one.</p>
      ) : (
        <>
          <div className="memories-share-row">
            <select
              aria-label="Team"
              value={teamId}
              onChange={(e) => setTeamId(e.target.value)}
              disabled={busy}
            >
              {teams.map((t) => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
            <button onClick={share} disabled={busy || !projectKey}>
              {busy ? 'Sharing...' : 'Share'}
            </button>
          </div>
          {result && (
            <p className={result.ok ? 'memories-ok' : 'memories-warn'}>{result.text}</p>
          )}
        </>
      )}
    </div>
  )
}
