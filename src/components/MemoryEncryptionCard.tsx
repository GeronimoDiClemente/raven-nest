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
}

/** Lo que el §5.2 deja en claro a propósito. Va en la tarjeta y no sólo en la landing: es
 *  la mitad honesta de la promesa, y el usuario la tiene que leer donde activa. */
const LO_QUE_QUEDA_EN_CLARO =
  'Se cifran el título, el contenido, los tags y el nombre del proyecto. El tipo, el scope y la rama viajan en claro: el servidor los necesita para ordenar y para decidir permisos.'

export default function MemoryEncryptionCard() {
  const [estado, setEstado] = useState<EstadoCifrado | null>(null)
  const [codigo, setCodigo] = useState<string | null>(null)
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
    if (res.ok) { setCodigo(res.recoveryCode); setConfirmado(false) }
    else setError(res.error)
    await refrescar()
  })

  const autorizar = (deviceId: string) => conBloqueo(async () => {
    const res = await api?.encryptionAuthorize?.(deviceId)
    if (res && !res.ok) setError(res.error ?? 'No se pudo autorizar.')
    await refrescar()
  })

  const recuperar = () => conBloqueo(async () => {
    const res = await api?.encryptionRecover?.(codigoTipeado)
    if (res && !res.ok) {
      setError(res.error ?? 'No se pudo recuperar.')
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
          <p className="text-fs font-medium text-foreground">Guardá este código</p>
        </div>
        <p className="text-fs-sm text-muted-foreground">
          Es lo único que recupera tus memorias si perdés todas tus máquinas. No lo vas a volver a ver.
        </p>
        <p className="select-all rounded-md border border-border bg-muted/30 px-3 py-2 text-center font-mono text-fs tracking-[0.08em] text-foreground">
          {codigo}
        </p>
        <label className="flex items-center gap-2 text-fs-sm text-foreground">
          <input type="checkbox" checked={confirmado} onChange={(e) => setConfirmado(e.target.checked)} />
          Lo guardé en un lugar seguro
        </label>
        <div>
          <Button size="sm" disabled={!confirmado} onClick={() => setCodigo(null)}>
            Ya lo guardé
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
          <p className="text-fs font-medium text-foreground">Cifrado</p>
        </div>
        <p className="text-fs-sm text-muted-foreground">
          Conectá la memoria en la nube para poder cifrarla. Lo que está guardado sólo en esta máquina no viaja a ningún lado.
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
          <p className="text-fs font-medium text-foreground">Esta máquina todavía no está autorizada</p>
        </div>
        <p className="text-fs-sm text-muted-foreground">
          Autorizala desde otra máquina que ya tenga la clave, o usá el código de recuperación.
          {estado.undecryptable > 0 && (
            <> Hay <span className="font-mono tabular-nums text-foreground">{estado.undecryptable}</span> memorias que no se pueden leer desde acá.</>
          )}
        </p>
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
                  else if (res.ok) setError('Todavía no hay una autorización para esta máquina.')
                  else setError(res.error ?? 'No se pudo consultar.')
                } finally { setBuscandoAutorizacion(false) }
              })()}
            >
              {buscandoAutorizacion ? 'Buscando…' : 'Ya me autorizaron'}
            </Button>
          </div>
        )}

        {recuperando ? (
          <div className="flex flex-col gap-2">
            <Input
              value={codigoTipeado}
              onChange={(e) => setCodigoTipeado(e.target.value)}
              placeholder="XXXX-XXXX-XXXX-XXXX-XXXX-XXXX"
              aria-label="Código de recuperación"
              className="font-mono"
            />
            <div className="flex gap-2">
              <Button size="sm" disabled={ocupado} onClick={() => void recuperar()}>Recuperar</Button>
              <Button size="sm" variant="ghost" onClick={() => setRecuperando(false)}>Cancelar</Button>
            </div>
          </div>
        ) : (
          <div>
            <Button size="sm" variant="outline" onClick={() => setRecuperando(true)}>
              Usar el código de recuperación
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
          <p className="text-fs font-medium text-foreground">Cifrado activo</p>
          <span className="font-mono text-fs-xs tabular-nums text-muted-foreground">clave #{estado.keyEpoch}</span>
        </div>
        <p className="text-fs-sm text-muted-foreground">{LO_QUE_QUEDA_EN_CLARO}</p>
        {error && <p className="text-fs-sm text-destructive">{error}</p>}

        {estado.pendingDevices.length > 0 && (
          <div className="flex flex-col gap-1">
            <p className="text-fs-sm text-foreground">Máquinas esperando autorización:</p>
            {estado.pendingDevices.map((d) => (
              <div key={d.deviceId}>
                <Button size="sm" variant="outline" disabled={ocupado} onClick={() => void autorizar(d.deviceId)}>
                  Autorizar {d.name}
                </Button>
              </div>
            ))}
          </div>
        )}

        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" disabled={ocupado} onClick={() => void reencriptar()}>
            Re-subir lo que ya estaba
          </Button>
          {reencriptadas !== null && (
            <span className="text-fs-sm text-muted-foreground">
              <span className="font-mono tabular-nums text-foreground">{reencriptadas}</span> memorias en cola
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
          <p className="text-fs font-medium text-foreground">Cifrado</p>
        </div>
        <p className="text-fs-sm text-muted-foreground">
          No se pudo consultar el estado del cifrado de esta cuenta. Volvé a entrar cuando haya conexión.
        </p>
      </div>
    )
  }

  // ── Se puede activar ──────────────────────────────────────────────────────
  return (
    <div className={marco}>
      <div className="flex items-center gap-2">
        <ShieldQuestion size={ICON_SIZE.md} className="text-muted-foreground" aria-hidden />
        <p className="text-fs font-medium text-foreground">Cifrado</p>
      </div>
      <p className="text-fs-sm text-muted-foreground">{LO_QUE_QUEDA_EN_CLARO}</p>
      <p className="text-fs-sm text-muted-foreground">
        Una vez activado, nadie que administre el servidor puede leer lo que escribiste — tampoco nosotros.
      </p>
      {error && <p className="text-fs-sm text-destructive">{error}</p>}
      <div>
        <Button size="sm" disabled={ocupado} onClick={() => void activar()}>Activar el cifrado</Button>
      </div>
    </div>
  )
}
