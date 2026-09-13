// La tarjeta de cifrado, en el overlay Memories junto a MemoryVaultCard.
//
// Cuatro estados y ninguno decorativo: se puede activar, está activo, esta máquina espera
// autorización, y esta máquina puede autorizar a otra. Self-contained como MemoryVaultCard:
// si el puente no está, no se muestra nada — no hay un estado "cargando" que ocupe lugar
// para después desaparecer.
//
// Escrita con shadcn + utilidades y SIN clases nuevas en `global.css`, que es lo que manda
// CLAUDE.md para un componente nuevo. (El plan sugería agregar `.memory-encryption-*` allá;
// se resolvió acá con utilidades, que es la regla vigente del proyecto.)
import { useCallback, useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ShieldCheck, ShieldAlert, ShieldQuestion } from 'lucide-react'
import { ICON_SIZE } from '../lib/icons'

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

export default function MemoryEncryptionCard() {
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
   * Hasta el 2026-09-12 este camino no existía en la UI —el único llamador de la adopción era
   * el botón de activar, que en este estado no se muestra— así que una máquina autorizada
   * nunca tomaba su clave y la única salida era quemar el código de recuperación.
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
    const res = await api?.encryptionAuthorize?.(deviceId)
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

  const marco = 'flex shrink-0 flex-col gap-2 rounded-md border border-border p-3'

  // ── El código de recuperación, una sola vez ────────────────────────────────
  if (codigo) {
    return (
      <div className={marco}>
        <div className="flex items-center gap-2">
          <ShieldCheck size={ICON_SIZE.md} className="text-ok" aria-hidden />
          <p className="text-fs font-medium text-foreground">Save this code</p>
        </div>
        <p className="text-fs-sm text-muted-foreground">
          It is the only thing that recovers your memories if you lose every machine. You will not see it again.
        </p>
        {avisoDeCodigo && (
          <p className="rounded-md border border-warn/40 px-2 py-1 text-fs-sm text-warn">{avisoDeCodigo}</p>
        )}
        <p className="select-all rounded-md border border-border bg-muted/30 px-3 py-2 text-center font-mono text-fs tracking-[0.08em] text-foreground">
          {codigo}
        </p>
        <label className="flex items-center gap-2 text-fs-sm text-foreground">
          <input type="checkbox" checked={confirmado} onChange={(e) => setConfirmado(e.target.checked)} />
          I have saved it somewhere safe
        </label>
        <div>
          <Button size="sm" disabled={!confirmado} onClick={() => setCodigo(null)}>
            Done
          </Button>
        </div>
      </div>
    )
  }

  // ── Sin nube conectada ─────────────────────────────────────────────────────
  if (!estado.available) {
    return (
      <div className={marco}>
        <div className="flex items-center gap-2">
          <ShieldQuestion size={ICON_SIZE.md} className="text-muted-foreground" aria-hidden />
          <p className="text-fs font-medium text-foreground">Encryption</p>
        </div>
        <p className="text-fs-sm text-muted-foreground">
          Connect cloud memory to encrypt it. What lives only on this machine never travels anywhere.
        </p>
      </div>
    )
  }

  // ── Hay una clave en la cuenta pero esta máquina no la tiene ───────────────
  if (!estado.active && estado.keyEpoch > 0) {
    return (
      <div className={marco}>
        <div className="flex items-center gap-2">
          <ShieldAlert size={ICON_SIZE.md} className="text-warn" aria-hidden />
          <p className="text-fs font-medium text-foreground">This machine is not authorised yet</p>
        </div>
        <p className="text-fs-sm text-muted-foreground">
          Authorise it from another machine that already has the key, or use your recovery code.
          {estado.undecryptable > 0 && (
            <> <span className="font-mono tabular-nums text-foreground">{estado.undecryptable}</span> memories cannot be read from here.</>
          )}
        </p>
        {estado.huellaPropia && (
          <div className="rounded-md border border-border bg-muted/30 px-2 py-1.5">
            <p className="text-fs-xs text-muted-foreground">
              Before authorising from the other machine, check that it shows this same code:
            </p>
            <p className="select-all text-center font-mono text-fs tracking-[0.08em] text-foreground">
              {estado.huellaPropia}
            </p>
          </div>
        )}

        {error && <p className="text-fs-sm text-destructive">{error}</p>}
        {/* Reintentar a mano. El intento automático corre al abrir la tarjeta, pero si el
            usuario está mirando ESTA pantalla mientras autoriza en la otra, necesita una
            forma de decir "ya está" sin cerrar y volver a abrir. */}
        {!recuperando && adoptar && (
          <div>
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
          </div>
        )}

        {recuperando ? (
          <div className="flex flex-col gap-2">
            <Input
              value={codigoTipeado}
              onChange={(e) => setCodigoTipeado(e.target.value)}
              placeholder="XXXX-XXXX-XXXX-XXXX-XXXX-XXXX"
              aria-label="Recovery code"
              className="font-mono"
            />
            <div className="flex gap-2">
              <Button size="sm" disabled={ocupado} onClick={() => void recuperar()}>Recover</Button>
              <Button size="sm" variant="ghost" onClick={() => setRecuperando(false)}>Cancel</Button>
            </div>
          </div>
        ) : (
          <div>
            <Button size="sm" variant="outline" onClick={() => setRecuperando(true)}>
              Use the recovery code
            </Button>
          </div>
        )}
      </div>
    )
  }

  // ── Activo ────────────────────────────────────────────────────────────────
  if (estado.active) {
    return (
      <div className={marco}>
        <div className="flex items-center gap-2">
          <ShieldCheck size={ICON_SIZE.md} className="text-ok" aria-hidden />
          <p className="text-fs font-medium text-foreground">Encryption on</p>
          <span className="font-mono text-fs-xs tabular-nums text-muted-foreground">key #{estado.keyEpoch}</span>
        </div>
        <p className="text-fs-sm text-muted-foreground">{LO_QUE_QUEDA_EN_CLARO}</p>

        {/* La marca de la clave que esta máquina tiene. Dos máquinas de la misma cuenta
            muestran la misma; si no coinciden, alguien puso una clave que no es la tuya.
            Envolver no requiere ningún secreto, así que quien pueda escribir en la base del
            servicio puede sellar la SUYA para tu clave pública — y el sobre no lo detecta. */}
        {estado.huellaDeLaClave && (
          <p className="text-fs-xs text-muted-foreground">
            This account key:{' '}
            <span className="select-all font-mono text-foreground">{estado.huellaDeLaClave}</span>
            {' '}— must be the same on all your machines.
          </p>
        )}

        {error && <p className="text-fs-sm text-destructive">{error}</p>}

        {estado.pendingDevices.length > 0 && (
          <div className="flex flex-col gap-1">
            <p className="text-fs-sm text-foreground">Machines waiting for authorisation:</p>
            {estado.pendingDevices.map((d) => (
              <div key={d.deviceId} className="flex flex-col gap-1 rounded-md border border-border p-2">
                <p className="text-fs-sm text-foreground">{d.name}</p>
                {/* La huella de la clave que el SERVIDOR dice que es de esa máquina. Que el
                    usuario la compare es lo único que detecta una sustitución: sin esto,
                    autorizar es confiar en que quien dice de quién es cada clave no miente. */}
                {estado.huellasPorDevice?.[d.deviceId] && (
                  <>
                    <p className="text-fs-xs text-muted-foreground">
                      Authorise it only if that machine shows exactly this code:
                    </p>
                    <p className="select-all text-center font-mono text-fs tracking-[0.08em] text-foreground">
                      {estado.huellasPorDevice[d.deviceId]}
                    </p>
                  </>
                )}
                <div>
                  <Button size="sm" variant="outline" disabled={ocupado} onClick={() => void autorizar(d.deviceId)}>
                    They match — authorise
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" disabled={ocupado} onClick={() => void reencriptar()}>
            Re-upload what was already there
          </Button>
          {reencriptadas !== null && (
            <span className="text-fs-sm text-muted-foreground">
              <span className="font-mono tabular-nums text-foreground">{reencriptadas}</span> memories queued
            </span>
          )}
        </div>
      </div>
    )
  }

  // ── No sabemos en qué estado está la cuenta ───────────────────────────────
  // No se ofrece activar a ciegas: si el estado no se pudo leer, `keyEpoch` vale 0 y eso es
  // indistinguible de "esta cuenta no tiene cifrado". Activar desde una máquina sin clave
  // rota la época y borra las envolturas de todas las demás, incluida la de recuperación.
  if (estado.estadoRemotoLeido === false) {
    return (
      <div className={marco}>
        <div className="flex items-center gap-2">
          <ShieldQuestion size={ICON_SIZE.md} className="text-muted-foreground" aria-hidden />
          <p className="text-fs font-medium text-foreground">Encryption</p>
        </div>
        <p className="text-fs-sm text-muted-foreground">
          Could not read this account&rsquo;s encryption state. Come back when you are online.
        </p>
      </div>
    )
  }

  // ── Se puede activar ──────────────────────────────────────────────────────
  return (
    <div className={marco}>
      <div className="flex items-center gap-2">
        <ShieldQuestion size={ICON_SIZE.md} className="text-muted-foreground" aria-hidden />
        <p className="text-fs font-medium text-foreground">Encryption</p>
      </div>
      <p className="text-fs-sm text-muted-foreground">{LO_QUE_QUEDA_EN_CLARO}</p>
      <p className="text-fs-sm text-muted-foreground">
        Once it\u2019s on, nobody who runs the server can read what you wrote \u2014 us included.
      </p>
      {error && <p className="text-fs-sm text-destructive">{error}</p>}
      <div>
        <Button size="sm" disabled={ocupado} onClick={() => void activar()}>Turn on encryption</Button>
      </div>
    </div>
  )
}
