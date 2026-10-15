// Hermana de MemoryEncryptionCard.tsx para scope 'team': mismos estados, más uno que el
// personal no necesita — "sólo el leader puede activar/autorizar esto" (spec §3/§5).
import { useCallback, useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ShieldCheck, ShieldAlert, ShieldQuestion } from 'lucide-react'
import { ICON_SIZE } from '../lib/icons'
import { useTeam } from '../hooks/useTeam'

interface EstadoCifradoEquipo {
  activated: boolean
  wrap: { wrapped: string; wrapMeta: Record<string, unknown> | null } | null
  pendingDevices: Array<{ deviceId: string; name: string; publicKey: string }>
  hasMaster: boolean
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
  const [reencriptadas, setReencriptadas] = useState<number | null>(null)
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
      } catch { /* sin red: se reintenta al reabrir, o con el botón de abajo */ }
    })()
    return () => { vivo = false }
  }, [necesitaClave, adoptar, activeTeam, refrescar])

  if (!api?.teamEncryptionStatus || !activeTeam || !estado) return null

  async function conBloqueo(fn: () => Promise<void>) {
    setOcupado(true); setError(null)
    try { await fn() } finally { setOcupado(false) }
  }

  const activar = () => conBloqueo(async () => {
    const res = await api?.teamEncryptionActivate?.(activeTeam.id)
    if (!res) return
    if (res.ok) setCodigo(res.recoveryCode)
    else setError(res.error)
    await refrescar()
  })

  const autorizar = (deviceId: string) => conBloqueo(async () => {
    const res = await api?.teamEncryptionAuthorize?.(activeTeam.id, deviceId)
    if (res && !res.ok) setError(res.error ?? 'Could not authorise.')
    await refrescar()
  })

  const recuperar = () => conBloqueo(async () => {
    const res = await api?.teamEncryptionRecover?.(activeTeam.id, codigoTipeado)
    if (res && !res.ok) { setError(res.error ?? 'Could not recover.'); return }
    setRecuperando(false); setCodigoTipeado(''); await refrescar()
  })

  const reencriptar = () => conBloqueo(async () => {
    const res = await api?.teamEncryptionRecrypt?.(activeTeam.id)
    if (res) setReencriptadas(res.applied)
    await refrescar()
  })

  const marco = 'flex shrink-0 flex-col gap-2 rounded-md border border-border p-3'

  if (codigo) {
    return (
      <div className={marco}>
        <div className="flex items-center gap-2">
          <ShieldCheck size={ICON_SIZE.md} className="text-ok" aria-hidden />
          <p className="text-fs font-medium text-foreground">Save this team code</p>
        </div>
        <p className="text-fs-sm text-muted-foreground">
          It is the only thing that recovers this team&rsquo;s memories if you lose every leader machine.
        </p>
        <p className="select-all rounded-md border border-border bg-muted/30 px-3 py-2 text-center font-mono text-fs tracking-[0.08em] text-foreground">
          {codigo}
        </p>
        <label className="flex items-center gap-2 text-fs-sm text-foreground">
          <input type="checkbox" checked={confirmado} onChange={(e) => setConfirmado(e.target.checked)} />
          I have saved it somewhere safe
        </label>
        <div><Button size="sm" disabled={!confirmado} onClick={() => setCodigo(null)}>Done</Button></div>
      </div>
    )
  }

  if (!estado.activated && !esLeader) {
    return (
      <div className={marco}>
        <div className="flex items-center gap-2">
          <ShieldQuestion size={ICON_SIZE.md} className="text-muted-foreground" aria-hidden />
          <p className="text-fs font-medium text-foreground">Team encryption</p>
        </div>
        <p className="text-fs-sm text-muted-foreground">
          Ask your team leader to turn on encryption for this team — only they can activate it.
        </p>
      </div>
    )
  }

  if (!estado.activated && esLeader) {
    return (
      <div className={marco}>
        <div className="flex items-center gap-2">
          <ShieldQuestion size={ICON_SIZE.md} className="text-muted-foreground" aria-hidden />
          <p className="text-fs font-medium text-foreground">Team encryption</p>
        </div>
        <p className="text-fs-sm text-muted-foreground">
          Once it&rsquo;s on, nobody who runs the server can read this team&rsquo;s shared memory — us included.
          Everything already shared gets re-encrypted too.
        </p>
        {error && <p className="text-fs-sm text-destructive">{error}</p>}
        <div><Button size="sm" disabled={ocupado} onClick={() => void activar()}>Turn on team encryption</Button></div>
      </div>
    )
  }

  if (!estado.hasMaster) {
    return (
      <div className={marco}>
        <div className="flex items-center gap-2">
          <ShieldAlert size={ICON_SIZE.md} className="text-warn" aria-hidden />
          <p className="text-fs font-medium text-foreground">This machine is not authorised yet</p>
        </div>
        <p className="text-fs-sm text-muted-foreground">
          Ask your team leader to authorise this machine, or use the team recovery code.
        </p>
        {error && <p className="text-fs-sm text-destructive">{error}</p>}
        {/* Reintentar a mano, igual que MemoryEncryptionCard: el intento automático de arriba
            corre al abrir la tarjeta, pero si el leader autoriza MIENTRAS esta pantalla ya
            está abierta, hace falta una forma de decir "ya está" sin cerrar y reabrir. */}
        {!recuperando && adoptar && (
          <div>
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
          </div>
        )}
        {recuperando ? (
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
      </div>
    )
  }

  return (
    <div className={marco}>
      <div className="flex items-center gap-2">
        <ShieldCheck size={ICON_SIZE.md} className="text-ok" aria-hidden />
        <p className="text-fs font-medium text-foreground">Team encryption on</p>
      </div>
      {error && <p className="text-fs-sm text-destructive">{error}</p>}
      {esLeader && estado.pendingDevices.length > 0 && (
        <div className="flex flex-col gap-1">
          <p className="text-fs-sm text-foreground">Machines waiting for authorisation:</p>
          {estado.pendingDevices.map((d) => (
            <div key={d.deviceId} className="flex items-center justify-between rounded-md border border-border p-2">
              <p className="text-fs-sm text-foreground">{d.name}</p>
              <Button size="sm" variant="outline" disabled={ocupado} onClick={() => void autorizar(d.deviceId)}>Authorise</Button>
            </div>
          ))}
        </div>
      )}
      {esLeader && (
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" disabled={ocupado} onClick={() => void reencriptar()}>
            Re-upload what was already there
          </Button>
          {reencriptadas !== null && (
            <span className="text-fs-sm text-muted-foreground">
              <span className="font-mono tabular-nums text-foreground">{reencriptadas}</span> re-encrypted
            </span>
          )}
        </div>
      )}
    </div>
  )
}
