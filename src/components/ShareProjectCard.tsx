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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Button } from '@/components/ui/button'

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

  /**
   * El mismo marco que `MemoryEncryptionCard`, literal.
   *
   * Esta card se escribio con clases propias en `global.css` y quedo con su propia escala:
   * el titulo en 14px y en negrita de navegador (700) contra los 13px/500 de sus vecinas, el
   * borde en 3px de radio donde el resto usa el token, y el padding en 14/16 contra 12. En
   * una columna donde todo lo demas comparte medidas, la unica distinta se lee como de otra
   * pantalla — que es exactamente lo que se veia al pie de Memories.
   */
  const marco = 'flex shrink-0 flex-col gap-2 rounded-md border border-border p-3'

  return (
    <div className={marco}>
      <h4 className="m-0 text-fs font-medium text-foreground">Share this project with a team</h4>
      {teams.length === 0 ? (
        <p className="text-fs-sm text-muted-foreground">You are not in a team yet. Team memories need one.</p>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <Select value={teamId} onValueChange={setTeamId} disabled={busy}>
              {/* `size="sm"` para que empareje con el <Button size="sm"> de al lado: el
                  trigger por default es `h-8` con texto de 14px y el boton es `h-7` con 12px,
                  asi que uno al lado del otro el select quedaba 4px mas alto y con la letra
                  mas grande. */}
              <SelectTrigger size="sm" aria-label="Team">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {teams.map((t) => (
                  <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {/* Era un <button> pelado al lado de un <Select> de shadcn: el select tenia la
                altura y el radio del sistema y el boton los del navegador, uno junto al
                otro en la misma fila. */}
            <Button size="sm" onClick={share} disabled={busy || !projectKey}>
              {busy ? 'Sharing…' : 'Share'}
            </Button>
          </div>
          {result && (
            <p className={`text-fs-sm ${result.ok ? 'text-ok' : 'text-warn'}`}>{result.text}</p>
          )}
        </>
      )}
    </div>
  )
}
