// La tarjeta de cifrado, en el overlay Memories junto a MemoryVaultCard.
//
// Cuatro estados y ninguno decorativo: se puede activar, está activo, esta máquina espera
// autorización, y esta máquina puede autorizar a otra. Self-contained como MemoryVaultCard:
// si el puente no está, no se muestra nada — no hay un estado "cargando" que ocupe lugar
// para después desaparecer.
//
// Escrita con shadcn + utilidades y SIN clases nuevas en `global.css`, que es lo que manda
// CLAUDE.md para un componente nuevo.
import { useCallback, useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import SettingRow from './memories/settings/SettingRow'

interface EstadoCifrado {
  available: boolean
  active: boolean
  keyEpoch: number
  pendingDevices: Array<{ deviceId: string; name: string }>
  undecryptable: number
  estadoRemotoLeido?: boolean
  huellaPropia?: string | null
  huellasPorDevice?: Record<string, string>
  huellaDeLaClave?: string | null
}

/** Lo que el §5.2 deja en claro a propósito. Va en la tarjeta y no sólo en la landing: es
 *  la mitad honesta de la promesa, y el usuario la tiene que leer donde activa. */
const LO_QUE_QUEDA_EN_CLARO =
  'Your titles, content, tags and project names are encrypted. Type, scope and branch travel in the clear: the server needs them to order and to decide permissions.'
const NOMBRE = 'Encrypt your memory'
const QUE_HACE = 'Only your machines hold the key. On this machine it stays readable, so search and agents work as usual.'

export default function MemoryEncryptionCard({ onSetUpSync }: { onSetUpSync?: () => void } = {}) {
  const [estado, setEstado] = useState<EstadoCifrado | null>(null)
  const [codigo, setCodigo] = useState<string | null>(null)
  const [avisoDeCodigo, setAvisoDeCodigo] = useState<string | null>(null)
  const [confirmado, setConfirmado] = useState(false)
  const [recuperando, setRecuperando] = useState(false)
  const [codigoTipeado, setCodigoTipeado] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [reencriptadas, setReencriptadas] = useState<number | null>(null)
  const [ocupado, setOcupado] = useState(false)
  const [buscandoAutorizacion, setBuscandoAutorizacion] = useState(false)

  const api = window.memory
  const leerEstado = api?.encryptionStatus

  const refrescar = useCallback(async () => {
    if (!leerEstado) return
    try {
      setEstado(await leerEstado())
    } catch {
      // Sin red la tarjeta se queda con lo último que supo, que es mejor que un error.
    }
  }, [leerEstado])

  useEffect(() => { void refrescar() }, [refrescar])

  /**
   * Si la cuenta ya tiene clave y esta máquina no, se intenta tomar la envoltura que la otra
   * pueda haber dejado publicada. Automático a propósito: después de que alguien toca
   * "Autorizar esta máquina" en la otra, acá no tendría que hacer falta hacer nada.
   *
   * Es el único camino de adopción en este estado —el botón de activar no se muestra—: sin
   * esto una máquina autorizada nunca tomaría su clave y la única salida sería quemar el
   * código de recuperación.
   */
  const adoptar = api?.encryptionAdopt
  const necesitaClave = Boolean(estado && !estado.active && estado.keyEpoch > 0)
  useEffect(() => {
    if (!necesitaClave || !adoptar) return
    let vivo = true
    void (async () => {
      try {
        const res = await adoptar()
        if (vivo && res.ok && res.adoptada) await refrescar()
      } catch { /* sin red: se reintenta al volver a abrir, o con el botón */ }
    })()
    return () => { vivo = false }
  }, [necesitaClave, adoptar, refrescar])

  // Un preload viejo no tiene estos handlers. No se muestra nada: una tarjeta que no puede
  // hacer nada es peor que ninguna.
  if (!leerEstado) return null
  if (!estado) return null

  async function conBloqueo(fn: () => Promise<void>) {
    setOcupado(true)
    setError(null)
    try { await fn() } finally { setOcupado(false) }
  }

  const activar = () => conBloqueo(async () => {
    const res = await api?.encryptionActivate?.()
    if (!res) return
    if (res.ok) { setCodigo(res.recoveryCode); setAvisoDeCodigo(res.aviso ?? null); setConfirmado(false) }
    else setError(res.error)
    await refrescar()
  })

  const autorizar = (deviceId: string) => conBloqueo(async () => {
    // La huella que el usuario comparó viaja con el pedido. main.ts vuelve a pedir la
    // lista y, si la pública ya no da esta huella, no envuelve nada.
    const res = await api?.encryptionAuthorize?.(deviceId, estado?.huellasPorDevice?.[deviceId] ?? '')
    if (res && !res.ok) setError(res.error ?? 'Could not authorise.')
    await refrescar()
  })

  const recuperar = () => conBloqueo(async () => {
    const res = await api?.encryptionRecover?.(codigoTipeado)
    if (res && !res.ok) {
      setError(res.error ?? 'Could not recover.')
      return // El formulario queda abierto: el usuario tiene que poder corregir el código.
    }
    setRecuperando(false)
    setCodigoTipeado('')
    await refrescar()
  })

  const reencriptar = () => conBloqueo(async () => {
    const res = await api?.encryptionReencrypt?.()
    if (res) setReencriptadas(res.total)
    await refrescar()
  })

  const epoca = <span className="font-mono text-fs-sm tabular-nums text-muted-foreground">On · key #{estado.keyEpoch}</span>
  const huellaGrande = (h: string) => (
    <p className="m-0 select-all text-center font-mono text-fs tracking-[0.08em] text-foreground">{h}</p>
  )
  const fallo = error && <p className="m-0 text-fs-sm text-destructive">{error}</p>

  // ── El código de recuperación, una sola vez ────────────────────────────────
  if (codigo) {
    return (
      <SettingRow nombre="Save this code" descripcion="It is the only thing that recovers your memories if you lose every machine. You will not see it again.">
        {/* Spec §5: el aviso del código va en ESTE paso, no antes de activar. */}
        <p className="m-0 rounded-md border border-warn/40 px-2 py-1 text-fs-sm text-warn">
          Keep it somewhere safe: if you lose every machine and the code, the cloud copy can never be opened again.
        </p>
        {avisoDeCodigo && <p className="m-0 rounded-md border border-warn/40 px-2 py-1 text-fs-sm text-warn">{avisoDeCodigo}</p>}
        <p className="m-0 select-all rounded-md border border-border bg-muted/30 px-3 py-2 text-center font-mono text-fs tracking-[0.08em] text-foreground">{codigo}</p>
        <label className="flex items-center gap-2 text-fs-sm text-foreground">
          <input type="checkbox" checked={confirmado} onChange={(e) => setConfirmado(e.target.checked)} />
          I have saved it somewhere safe
        </label>
        <div><Button size="sm" disabled={!confirmado} onClick={() => setCodigo(null)}>Done</Button></div>
      </SettingRow>
    )
  }

  // ── Sin nube conectada: no hay nada que cifrar todavía ─────────────────────
  if (!estado.available) {
    return (
      <SettingRow
        nombre={NOMBRE}
        descripcion="Needs cloud sync"
        control={onSetUpSync && <Button size="sm" variant="outline" onClick={onSetUpSync}>Set up sync</Button>}
      />
    )
  }

  // ── Hay una clave en la cuenta pero esta máquina no la tiene ───────────────
  if (!estado.active && estado.keyEpoch > 0) {
    return (
      <>
        <SettingRow nombre={NOMBRE} descripcion={QUE_HACE} control={epoca} />
        <SettingRow
          nombre="This machine is not authorised yet"
          descripcion="Authorise it from another machine that already has the key, or use your recovery code."
          control={!recuperando && adoptar && (
            <Button
              size="sm"
              disabled={buscandoAutorizacion}
              onClick={() => void (async () => {
                setBuscandoAutorizacion(true)
                setError(null)
                try {
                  const res = await adoptar()
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
          {estado.undecryptable > 0 && (
            <p className="m-0 text-fs-sm text-muted-foreground">
              <span className="font-mono tabular-nums text-foreground">{estado.undecryptable}</span> {estado.undecryptable === 1 ? 'memory' : 'memories'} cannot be read from here.
            </p>
          )}
          {estado.huellaPropia && (
            <div className="rounded-md border border-border bg-muted/30 px-2 py-1.5">
              <p className="m-0 text-fs-xs text-muted-foreground">Before authorising from the other machine, check that it shows this same code:</p>
              {huellaGrande(estado.huellaPropia)}
            </div>
          )}
          {fallo}
          {recuperando ? (
            <div className="flex flex-col gap-2">
              <Input value={codigoTipeado} onChange={(e) => setCodigoTipeado(e.target.value)} placeholder="XXXX-XXXX-XXXX-XXXX-XXXX-XXXX" aria-label="Recovery code" className="font-mono" />
              <div className="flex gap-2">
                <Button size="sm" disabled={ocupado} onClick={() => void recuperar()}>Recover</Button>
                <Button size="sm" variant="ghost" onClick={() => setRecuperando(false)}>Cancel</Button>
              </div>
            </div>
          ) : (
            <div><Button size="sm" variant="outline" onClick={() => setRecuperando(true)}>Use the recovery code</Button></div>
          )}
        </SettingRow>
      </>
    )
  }

  // ── Activo ────────────────────────────────────────────────────────────────
  if (estado.active) {
    return (
      <>
        <SettingRow nombre={NOMBRE} descripcion={QUE_HACE} control={epoca}>
          {/* Lo que viaja en claro, UNA vez y donde ya está activo (spec §5). */}
          <p className="m-0 text-fs-sm text-muted-foreground">{LO_QUE_QUEDA_EN_CLARO}</p>
          {/* La marca de la clave: dos máquinas de la misma cuenta muestran la misma. */}
          {estado.huellaDeLaClave && (
            <p className="m-0 text-fs-xs text-muted-foreground">
              This account key:{' '}
              <span className="select-all font-mono text-foreground">{estado.huellaDeLaClave}</span>
              {' '}— must be the same on all your machines.
            </p>
          )}
          {fallo}
        </SettingRow>

        {/* Una fila por máquina que espera. Comparar la huella es la única defensa contra
            una clave pública sustituida en el servidor. */}
        {estado.pendingDevices.map((d) => (
          <SettingRow
            key={d.deviceId}
            nombre={d.name}
            descripcion="Waiting for authorisation"
            control={<Button size="sm" variant="outline" disabled={ocupado} onClick={() => void autorizar(d.deviceId)}>They match — authorise</Button>}
          >
            {estado.huellasPorDevice?.[d.deviceId] && (
              <div className="rounded-md border border-border bg-muted/30 px-2 py-1.5">
                <p className="m-0 text-fs-xs text-muted-foreground">Authorise it only if that machine shows exactly this code:</p>
                {huellaGrande(estado.huellasPorDevice[d.deviceId])}
              </div>
            )}
          </SettingRow>
        ))}

        <SettingRow
          nombre="Re-upload old memories"
          descripcion="Encrypts and uploads again what reached the cloud before encryption was on."
          control={<Button size="sm" variant="outline" disabled={ocupado} onClick={() => void reencriptar()}>Re-upload</Button>}
        >
          {reencriptadas !== null && (
            <p className="m-0 text-fs-sm text-muted-foreground">
              <span className="font-mono tabular-nums text-foreground">{reencriptadas}</span> memories queued
            </p>
          )}
        </SettingRow>
      </>
    )
  }

  // ── No sabemos en qué estado está la cuenta ───────────────────────────────
  // No se ofrece activar a ciegas: activar desde una máquina sin clave rota la época y borra
  // las envolturas de todas las demás, incluida la de recuperación.
  if (estado.estadoRemotoLeido === false) {
    return (
      <SettingRow nombre={NOMBRE} descripcion={<>Could not read this account&rsquo;s encryption state. Come back when you are online.</>} />
    )
  }

  // ── Se puede activar ──────────────────────────────────────────────────────
  return (
    <SettingRow
      nombre={NOMBRE}
      descripcion={QUE_HACE}
      control={<Button size="sm" aria-label="Turn on encryption" disabled={ocupado} onClick={() => void activar()}>Turn on</Button>}
    >
      {fallo}
    </SettingRow>
  )
}
