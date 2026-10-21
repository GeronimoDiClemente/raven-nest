// Compartir la memoria de un proyecto con un equipo.
//
// Lo que decide si se puede es el PLAN: compartir con un equipo es del plan Teams (`teamScope`
// en server/src/limits.ts), y main lo informa como `puedeCompartirMemoria` en el status.
// (Entre el 2026-09-13 y el 2026-10-15 tampoco se ofrecía porque lo compartido no se cifraba;
// desde el 15-10 el scope `team` se cifra con una clave por equipo, ver TeamEncryptionCard.)
//
// La card tiene tres caras y el servidor decide cuál:
//   · no se sabe   -> nada (spec 2026-10-21 §5, D10).
//   · sin permiso  -> una fila que dice qué plan falta, con See plans. Sin select ni botón que den 403.
//   · con permiso  -> el control real; sin equipo, sólo la línea que dice que falta uno.
//
// ⚠️ Lee `teams` de useTeam() y NUNCA llama a switchTeam. Elegir un equipo acá es elegir un
// destino para compartir, no cambiar el equipo activo de la app (decisión 3 de la spec; el
// acoplamiento que se evita está en PersonalWorkspace.tsx:306).
import { useEffect, useState } from 'react'
import { useTeam } from '../hooks/useTeam'
import { truncateWithEllipsis } from '../lib/truncate'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Button } from '@/components/ui/button'
import SettingRow from './memories/settings/SettingRow'

interface Props {
  activeRepoPath: string | null
  onSeePlans?: () => void
}

export default function ShareProjectCard({ activeRepoPath, onSeePlans }: Props) {
  const { teams } = useTeam()
  const [projectKey, setProjectKey] = useState<string | null>(null)
  const [teamId, setTeamId] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null)
  /** `undefined` mientras no se sabe: no saber no es lo mismo que saber que no. */
  const [puedeCompartir, setPuedeCompartir] = useState<boolean | undefined>(undefined)

  useEffect(() => {
    if (!activeRepoPath) { setProjectKey(null); return }
    let alive = true
    window.memory?.teamThreadProjectKeyForWorktree?.(activeRepoPath)
      .then((res) => { if (alive) setProjectKey(res?.ok ? res.projectKey ?? null : null) })
      .catch(() => { if (alive) setProjectKey(null) })
    return () => { alive = false }
  }, [activeRepoPath])

  useEffect(() => {
    let alive = true
    window.memory?.status?.()
      .then((s) => { if (alive) setPuedeCompartir(s?.puedeCompartirMemoria) })
      .catch(() => { /* sin status no se sabe, y eso lo dice `undefined` */ })
    return () => { alive = false }
  }, [])

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

  // Spec 2026-10-21 §5 (D10): sin saber todavía si la cuenta puede compartir, no se muestra.
  if (puedeCompartir === undefined) return null

  // El gate real es de plan (`teamScope` en server/src/limits.ts), no técnico. Sin callejón
  // sin salida: la fila dice qué falta y lleva a los planes (el modal es de 2b, no se toca).
  if (puedeCompartir === false) {
    return (
      <SettingRow
        nombre="Share with a team"
        descripcion="Sharing with a team needs a Teams plan."
        control={onSeePlans && <Button variant="link" size="sm" className="h-auto p-0" onClick={onSeePlans}>See plans</Button>}
      />
    )
  }

  const destino = teams.find((t) => t.id === teamId)?.name ?? 'team'
  return (
    <SettingRow
      nombre="Share with a team"
      descripcion={teams.length === 0 ? 'You are not in a team yet. Team memories need one.' : undefined}
      control={teams.length > 0 && (
        <>
          <Select value={teamId} onValueChange={setTeamId} disabled={busy}>
            {/* `size="sm"` para emparejar con el <Button size="sm"> de al lado. */}
            <SelectTrigger size="sm" aria-label="Team"><SelectValue /></SelectTrigger>
            <SelectContent>
              {teams.map((t) => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <Button size="sm" onClick={share} disabled={busy || !projectKey}>
            {busy ? 'Sharing…' : <>Share with <span className="font-mono">{truncateWithEllipsis(destino)}</span></>}
          </Button>
        </>
      )}
    >
      {/* Ruling 5: sin equipo, las cajas explicarían una acción que no se puede hacer. */}
      {teams.length > 0 && <div className="grid grid-cols-2 gap-2 text-fs-sm">
        <div className="rounded-md border border-border p-2 text-foreground">
          <p className="m-0 font-medium">The team will see</p>
          {/* IMPORTANT #7b: compartir el proyecto no mueve ninguna fila por sí solo; sólo
              viaja lo que alguien promueve (`promoteToTeam`). */}
          <p className="m-0 mt-1 text-muted-foreground">Only memories someone promotes to the team from here on. Nothing already saved moves on its own.</p>
        </div>
        <div className="rounded-md border border-border p-2 text-foreground">
          <p className="m-0 font-medium">Stays only yours</p>
          <p className="m-0 mt-1 text-muted-foreground">Everything already saved here, anything nobody promotes, your other projects and your code.</p>
        </div>
      </div>}
      {result && <p className={`m-0 text-fs-sm ${result.ok ? 'text-ok' : 'text-warn'}`}>{result.text}</p>}
    </SettingRow>
  )
}
