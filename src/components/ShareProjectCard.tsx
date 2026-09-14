// Compartir la memoria de un proyecto con otras personas.
//
// **Desde el 2026-09-13 esto NO es una acción de autoservicio**, y el motivo no es de
// precios: lo compartido no se cifra de punta a punta. Cada usuario tiene su propia clave
// maestra y no existe una que dos personas compartan, así que ofrecer "conectá tu memoria con
// tu equipo" adentro del plan cuyo argumento de venta es el cifrado sería venderlo con un
// asterisco. Compartir necesita su propio despliegue, donde el dueño del servidor es el
// equipo. El día que haya cifrado de a pares, esto se reabre.
//
// La card tiene dos caras y el servidor decide cuál:
//   · sin permiso  -> explica por qué y ofrece hablar. Sin select ni botón que den 403.
//   · con permiso  -> el control real (despliegues propios, plan `team`/`enterprise`).
//
// ⚠️ Lee `teams` de useTeam() y NUNCA llama a switchTeam. Elegir un equipo acá es elegir un
// destino para compartir, no cambiar el equipo activo de la app (decisión 3 de la spec; el
// acoplamiento que se evita está en PersonalWorkspace.tsx:306).
import { useEffect, useState } from 'react'
import { useTeam } from '../hooks/useTeam'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Button } from '@/components/ui/button'

interface Props {
  activeRepoPath: string | null
}

/**
 * A dónde escribe el que quiere compartir con su equipo.
 *
 * Vacío a propósito: todavía no hay un canal decidido, y poner una dirección inventada sería
 * peor que no poner ninguna — el usuario escribe a un buzón que no existe y cree que nos
 * avisó. Mientras esté vacío la card explica sin dibujar un botón muerto. Llenar esto es una
 * línea.
 */
const CONTACTO = ''

export default function ShareProjectCard({ activeRepoPath }: Props) {
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

  // El mismo marco que MemoryEncryptionCard, para que el pie de Memories comparta la escala
  // del resto de la pantalla.
  const marco = 'flex shrink-0 flex-col gap-2 rounded-md border border-border p-3'

  /**
   * La cara que ve casi todo el mundo. Dice POR QUÉ no está, no sólo que no está: "necesitás
   * otro plan" invita a buscar el botón de pagar; la razón real es que todavía no lo podemos
   * cifrar, y eso es lo que hace que la respuesta tenga sentido.
   */
  if (puedeCompartir === false) {
    return (
      <div className={marco}>
        <h4 className="m-0 text-fs font-medium text-foreground">Share memory with your team</h4>
        <p className="text-fs-sm text-muted-foreground">
          Memory shared between people is not end-to-end encrypted yet — your key is yours
          alone, and there is no key two people share. So sharing runs on its own deployment,
          where the server belongs to your team, instead of on ours.
        </p>
        {CONTACTO ? (
          <div className="flex">
            <Button variant="outline" size="sm" asChild>
              <a href={`mailto:${CONTACTO}?subject=Nest Memory for a team`}>Talk to us</a>
            </Button>
          </div>
        ) : (
          <p className="text-fs-sm text-muted-foreground">
            Get in touch and we will set it up with you.
          </p>
        )}
      </div>
    )
  }

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
