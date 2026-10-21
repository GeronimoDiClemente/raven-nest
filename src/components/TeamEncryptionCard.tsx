// Hermana de MemoryEncryptionCard.tsx para scope 'team': mismos estados, más uno que el
// personal no necesita — "sólo el leader puede activar/autorizar esto" (spec §3/§5).
import { useCallback, useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import SettingRow from './memories/settings/SettingRow'
import { truncateWithEllipsis } from '../lib/truncate'
import { useTeam } from '../hooks/useTeam'

interface EstadoCifradoEquipo {
  activated: boolean
  wrap: { wrapped: string; wrapMeta: Record<string, unknown> | null } | null
  pendingDevices: Array<{ deviceId: string; name: string; publicKey: string }>
  hasMaster: boolean
  estadoRemotoLeido?: boolean
  huellaPropia?: string | null
  huellasPorDevice?: Record<string, string>
  /** Spec §2: sin cifrado personal este device no publica su clave pública y nunca aparece
   * entre las máquinas que el leader puede autorizar. `undefined` = preload viejo. */
  hasPersonalKey?: boolean
  /** Filas de equipo que el SERVIDOR todavía tiene en claro (sólo lo ve el leader con la
   * clave; `null` = no se pudo leer). La migración no está terminada hasta que da 0. */
  recryptPending?: number | null
  /** La envoltura de esta máquina abre una maestra que no es la del equipo (C2). */
  keyMismatch?: boolean
  /** Memorias de este equipo guardadas en ESTA máquina que esperan sin subir porque le falta
   * la clave de equipo (`team_key_missing` / `team_encryption_required`). */
  heldCount?: number
}

interface ResultadoMigracion {
  applied: number
  remaining: number
  error?: string
}

export default function TeamEncryptionCard() {
  const { activeTeam, userId, members } = useTeam()
  const [estado, setEstado] = useState<EstadoCifradoEquipo | null>(null)
  const [codigo, setCodigo] = useState<string | null>(null)
  const [confirmado, setConfirmado] = useState(false)
  const [recuperando, setRecuperando] = useState(false)
  const [codigoTipeado, setCodigoTipeado] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [ocupado, setOcupado] = useState(false)
  const [migracion, setMigracion] = useState<ResultadoMigracion | null>(null)
  const [migrando, setMigrando] = useState(false)
  const [buscandoAutorizacion, setBuscandoAutorizacion] = useState(false)

  const esLeader = members.some((m) => m.user_id === userId && m.role === 'leader')
  const api = window.memory

  const refrescar = useCallback(async () => {
    if (!api?.teamEncryptionStatus || !activeTeam) return
    try { setEstado(await api.teamEncryptionStatus(activeTeam.id)) } catch { /* sin red */ }
  }, [api, activeTeam])

  useEffect(() => { void refrescar() }, [refrescar])

  /**
   * Gemelo del `useEffect` de adopción automática de `MemoryEncryptionCard.tsx` (líneas 69-81):
   * si el equipo ya tiene clave y esta máquina no, intenta tomar la envoltura que el leader
   * pueda haber dejado publicada. Sin esto, autorizar desde la máquina del leader no tendría
   * ningún efecto visible en la del recién autorizado hasta que alguien reabra la app.
   */
  const adoptar = api?.teamEncryptionAdopt
  const necesitaClave = Boolean(activeTeam && estado && estado.activated && !estado.hasMaster)
  useEffect(() => {
    if (!necesitaClave || !adoptar || !activeTeam) return
    let vivo = true
    void (async () => {
      try {
        const res = await adoptar(activeTeam.id)
        if (vivo && res.ok && res.adoptada) await refrescar()
        // Una clave que no es la del equipo (C2) se rechaza en main.ts; acá sólo se avisa.
        else if (vivo && !res.ok) setError(res.error)
      } catch { /* sin red: se reintenta al reabrir, o con el botón de abajo */ }
    })()
    return () => { vivo = false }
  }, [necesitaClave, adoptar, activeTeam, refrescar])

  if (!api?.teamEncryptionStatus || !activeTeam || !estado) return null

  // No se ofrece activar a ciegas: si el estado no se pudo leer, no sabemos si el equipo
  // ya tiene cifrado activado en otro lado. Activar sin saber es crear una época paralela
  // y quedarse sin acceso a lo que otros subieron con la clave verdadera.
  if (estado.estadoRemotoLeido === false) {
    return (
      <SettingRow
        nombre={<>Encrypt what <span className="font-mono">{truncateWithEllipsis(activeTeam.name)}</span> shares</>}
        descripcion={<>Could not read this team&rsquo;s encryption state. Come back when you are online.</>}
      />
    )
  }

  async function conBloqueo(fn: () => Promise<void>) {
    setOcupado(true); setError(null)
    try { await fn() } finally { setOcupado(false) }
  }

  /**
   * La migración de lo que ya estaba en claro. main.ts la deduplica: si `activate` ya la
   * disparó, esto se cuelga de la misma corrida y trae su resultado.
   */
  const migrar = async () => {
    if (!api?.teamEncryptionRecrypt) return
    setMigrando(true)
    try {
      setMigracion(await api.teamEncryptionRecrypt(activeTeam.id))
    } catch (err) {
      setMigracion({ applied: 0, remaining: estado.recryptPending ?? 0, error: err instanceof Error ? err.message : String(err) })
    } finally {
      setMigrando(false)
    }
    await refrescar()
  }

  const activar = () => conBloqueo(async () => {
    const res = await api?.teamEncryptionActivate?.(activeTeam.id)
    if (!res) return
    if (res.ok) {
      setCodigo(res.recoveryCode)
      // I3: lo que ya estaba compartido se migra solo, sin esperar a que alguien encuentre el
      // botón. Corre en segundo plano mientras el leader anota el código.
      void migrar()
    } else setError(res.error)
    await refrescar()
  })

  const autorizar = (deviceId: string) => conBloqueo(async () => {
    // I4: la huella que el leader comparó viaja con el pedido; main.ts no envuelve si la
    // pública que vuelve a pedir no da esta misma huella.
    const res = await api?.teamEncryptionAuthorize?.(activeTeam.id, deviceId, estado.huellasPorDevice?.[deviceId] ?? '')
    if (res && !res.ok) setError(res.error ?? 'Could not authorise.')
    await refrescar()
  })

  const recuperar = () => conBloqueo(async () => {
    const res = await api?.teamEncryptionRecover?.(activeTeam.id, codigoTipeado)
    if (res && !res.ok) { setError(res.error ?? 'Could not recover.'); return }
    setRecuperando(false); setCodigoTipeado(''); await refrescar()
  })

  const sinCifradoPersonal = estado.hasPersonalKey === false
  // Lo que dice el servidor manda; el resultado de la última corrida es el respaldo mientras
  // el estado no se pudo leer.
  const pendientes = estado.recryptPending ?? migracion?.remaining ?? null

  const nombre = <>Encrypt what <span className="font-mono">{truncateWithEllipsis(activeTeam.name)}</span> shares</>
  const soloElLeader = 'Only the team leader can turn it on.'

  // Lo que el gate del push retiene por falta de clave: sin decirlo, la máquina sin autorizar
  // no sabía que tenía memorias sin subir.
  const retenidas = estado.heldCount ?? 0
  const avisoRetenidas = retenidas > 0 && (
    <p className="m-0 text-fs-sm text-foreground">
      <span className="font-mono tabular-nums">{retenidas}</span>{' '}
      {retenidas === 1 ? 'team memory is' : 'team memories are'} waiting on this machine until it is authorised.
    </p>
  )

  if (codigo) {
    return (
      <SettingRow
        nombre="Save this team code"
        descripcion={<>It is the only thing that recovers this team&rsquo;s memories if you lose every leader machine.</>}
      >
        <p className="m-0 select-all rounded-md border border-border bg-muted/30 px-3 py-2 text-center font-mono text-fs tracking-[0.08em] text-foreground">
          {codigo}
        </p>
        <label className="flex items-center gap-2 text-fs-sm text-foreground">
          <input type="checkbox" checked={confirmado} onChange={(e) => setConfirmado(e.target.checked)} />
          I have saved it somewhere safe
        </label>
        <div><Button size="sm" disabled={!confirmado} onClick={() => setCodigo(null)}>Done</Button></div>
      </SettingRow>
    )
  }

  if (!estado.activated && !esLeader) {
    // Final review M2: la bajada ya lo dice; una línea abajo con lo mismo era repetir.
    return <SettingRow nombre={nombre} descripcion={soloElLeader} />
  }

  if (!estado.activated && esLeader) {
    return (
      <SettingRow
        nombre={nombre}
        descripcion={soloElLeader}
        control={<Button size="sm" disabled={ocupado || sinCifradoPersonal} onClick={() => void activar()}>Turn on team encryption</Button>}
      >
        <p className="m-0 text-fs-sm text-muted-foreground">
          Once it&rsquo;s on, nobody who runs the server can read this team&rsquo;s shared memory — us included.
          Everything already shared gets re-encrypted too.
        </p>
        {sinCifradoPersonal && (
          <p className="m-0 text-fs-sm text-foreground">
            Turn on memory encryption for your account first — team encryption uses this machine&rsquo;s key.
          </p>
        )}
        {error && <p className="m-0 text-fs-sm text-destructive">{error}</p>}
      </SettingRow>
    )
  }

  if (!estado.hasMaster && sinCifradoPersonal) {
    // Sin cifrado personal esta máquina no publica su clave pública, así que nunca aparece en
    // la lista del leader: decirle "pedile al leader" era mandarlo a esperar algo imposible.
    return (
      <SettingRow
        nombre={<>This machine can&rsquo;t read team memory yet</>}
        descripcion="Turn on memory encryption for your account first. After that, your team leader can authorise this machine."
      >
        {avisoRetenidas}
      </SettingRow>
    )
  }

  if (!estado.hasMaster) {
    return (
      <SettingRow
        nombre="This machine is not authorised yet"
        descripcion={esLeader
          ? 'Ask your team leader to authorise this machine, or use the team recovery code.'
          : 'Ask your team leader to authorise this machine.'}
        control={!recuperando && adoptar && (
          // Reintentar a mano, igual que MemoryEncryptionCard: el intento automático de arriba
          // corre al abrir la tarjeta, pero si el leader autoriza MIENTRAS esta pantalla ya
          // está abierta, hace falta una forma de decir "ya está" sin cerrar y reabrir.
          <Button
            size="sm"
            disabled={buscandoAutorizacion}
            onClick={() => void (async () => {
              setBuscandoAutorizacion(true); setError(null)
              try {
                const res = await adoptar(activeTeam.id)
                if (res.ok && res.adoptada) await refrescar()
                else if (res.ok) setError('No authorisation for this machine yet.')
                else setError(res.error ?? 'Could not check.')
              } finally { setBuscandoAutorizacion(false) }
            })()}
          >
            {buscandoAutorizacion ? 'Checking…' : "I've been authorised"}
          </Button>
        )}
      >
        {avisoRetenidas}
        {estado.keyMismatch && (
          <p className="m-0 text-fs-sm text-destructive">
            The key offered to this machine is not this team&rsquo;s key, so it was not used. Ask your team leader to authorise this machine again.
          </p>
        )}
        {estado.huellaPropia && (
          <div className="rounded-md border border-border bg-muted/30 px-2 py-1.5">
            <p className="m-0 text-fs-xs text-muted-foreground">
              Before authorising from the other machine, check that it shows this same code:
            </p>
            <p className="m-0 select-all text-center font-mono text-fs tracking-[0.08em] text-foreground">
              {estado.huellaPropia}
            </p>
          </div>
        )}
        {error && <p className="m-0 text-fs-sm text-destructive">{error}</p>}
        {/* Recuperar termina en autorizarse a sí misma, y eso el servidor sólo se lo deja a un
            leader: a un member el código le abriría la clave y después fallaría. */}
        {!esLeader ? null : recuperando ? (
          <div className="flex flex-col gap-2">
            <Input value={codigoTipeado} onChange={(e) => setCodigoTipeado(e.target.value)}
              placeholder="XXXX-XXXX-XXXX-XXXX-XXXX-XXXX" aria-label="Team recovery code" className="font-mono" />
            <div className="flex gap-2">
              <Button size="sm" disabled={ocupado} onClick={() => void recuperar()}>Recover</Button>
              <Button size="sm" variant="ghost" onClick={() => setRecuperando(false)}>Cancel</Button>
            </div>
          </div>
        ) : (
          <div><Button size="sm" variant="outline" onClick={() => setRecuperando(true)}>Use the team recovery code</Button></div>
        )}
      </SettingRow>
    )
  }

  return (
    <SettingRow
      nombre={nombre}
      descripcion={soloElLeader}
      control={<span className="text-fs-sm text-ok">Team encryption on</span>}
    >
      {error && <p className="m-0 text-fs-sm text-destructive">{error}</p>}
      {esLeader && estado.pendingDevices.length > 0 && (
        <div className="flex flex-col gap-1">
          <p className="m-0 text-fs-sm text-foreground">Machines waiting for authorisation:</p>
          {estado.pendingDevices.map((d) => (
            <div key={d.deviceId} className="flex flex-col gap-1 rounded-md border border-border p-2">
              <p className="m-0 text-fs-sm text-foreground">{d.name}</p>
              {/* La huella de la clave que el SERVIDOR dice que es de esa máquina. Que el
                  usuario la compare es lo único que detecta una sustitución: sin esto,
                  autorizar es confiar en que quien dice de quién es cada clave no miente. */}
              {estado.huellasPorDevice?.[d.deviceId] && (
                <>
                  <p className="m-0 text-fs-xs text-muted-foreground">
                    Authorise it only if that machine shows exactly this code:
                  </p>
                  <p className="m-0 select-all text-center font-mono text-fs tracking-[0.08em] text-foreground">
                    {estado.huellasPorDevice[d.deviceId]}
                  </p>
                </>
              )}
              <div>
                <Button size="sm" variant="outline" disabled={ocupado} onClick={() => void autorizar(d.deviceId)}>They match — authorise</Button>
              </div>
            </div>
          ))}
        </div>
      )}
      {esLeader && (
        <div className="flex flex-col gap-1">
          {/* "Terminado" sólo con 0 en el SERVIDOR (C1): lo que un member compartió desde su
              copia también cuenta, y antes la tarjeta lo daba por cifrado sin mirarlo. */}
          {pendientes === 0 && !migrando && !migracion?.error && (
            <p className="m-0 text-fs-sm text-muted-foreground">All shared memories are encrypted on the server.</p>
          )}
          {pendientes !== null && pendientes > 0 && (
            <p className="m-0 text-fs-sm text-foreground">
              <span className="font-mono tabular-nums">{pendientes}</span>{' '}
              {pendientes === 1 ? 'shared memory is' : 'shared memories are'} still unencrypted on the server.
            </p>
          )}
          {migracion?.error && <p className="m-0 text-fs-sm text-destructive">{migracion.error}</p>}
          {migracion !== null && migracion.applied > 0 && (
            <p className="m-0 text-fs-sm text-muted-foreground">
              <span className="font-mono tabular-nums text-foreground">{migracion.applied}</span> re-encrypted
            </p>
          )}
          {(migrando || (pendientes !== null && pendientes > 0) || migracion?.error) && (
            <div>
              <Button size="sm" variant="outline" disabled={ocupado || migrando} onClick={() => void migrar()}>
                {migrando ? 'Encrypting…' : 'Encrypt them now'}
              </Button>
            </div>
          )}
        </div>
      )}
    </SettingRow>
  )
}
