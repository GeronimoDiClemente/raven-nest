// Spec 2b-3 §3.3: las máquinas de la cuenta en Settings › Account. El hook trae y muta la
// lista; el bloque dibuja las filas con la confirmación en línea (no un modal).
import { useCallback, useEffect, useRef, useState } from 'react'
import type { MaquinaDeLaCuenta } from '../../types'
import { relativeTime } from '../../lib/memories-status'
import SettingRow from '../memories/settings/SettingRow'
import { Button } from '@/components/ui/button'

export type EstadoDeMaquinas =
  | { tipo: 'cargando' }
  | { tipo: 'error' }
  // Servidor viejo sin GET /v1/devices: no hay lista que pedir, y un Retry no lo arregla.
  | { tipo: 'no_soportado' }
  | { tipo: 'ok'; lista: MaquinaDeLaCuenta[] }

/** `/v1/devices` de un servidor viejo sólo acepta POST: 405 con o sin cuerpo. */
function rutaAusente(error: string): boolean {
  return error === 'method_not_allowed' || error === 'HTTP 405'
}

/** `activo` = el sync está conectado: sin conexión no hay a quién preguntarle. */
export function useMaquinas(activo: boolean) {
  const [estado, setEstado] = useState<EstadoDeMaquinas>({ tipo: 'cargando' })
  // Gana la última respuesta pedida: un Retry no lo pisa una lectura vieja que llega tarde.
  const pedido = useRef(0)

  const cargar = useCallback(async () => {
    const n = ++pedido.current
    // Un Retry vuelve a "cargando"; una relectura con la lista puesta la deja hasta que llega.
    setEstado((e) => (e.tipo === 'error' ? { tipo: 'cargando' } : e))
    let siguiente: EstadoDeMaquinas = { tipo: 'error' }
    try {
      const r = await window.memory?.devices?.()
      if (r?.ok) siguiente = { tipo: 'ok', lista: r.devices }
      else if (r && rutaAusente(r.error)) siguiente = { tipo: 'no_soportado' }
    } catch { /* queda en error */ }
    if (n === pedido.current) setEstado(siguiente)
  }, [])

  useEffect(() => {
    if (activo) { void cargar(); return }
    // Desconectado o cambiando de cuenta: la lista vieja (con sus Disconnect) no puede volver a
    // verse al reconectar, y una lectura en vuelo es de la cuenta anterior.
    pedido.current++
    setEstado({ tipo: 'cargando' })
  }, [activo, cargar])

  /** true = la máquina ya no está (o la lista se releyó); false = mostrar el error en la fila. */
  const revocar = useCallback(async (id: string): Promise<boolean> => {
    let r: { ok: true } | { ok: false; error: string } | undefined
    try { r = await window.memory?.revokeDevice?.(id) } catch { return false }
    if (!r) return false
    if (r.ok) {
      // Invalida una lectura en vuelo: llegaría con la máquina revocada y la resucitaría.
      pedido.current++
      setEstado((e) => (e.tipo === 'ok' ? { tipo: 'ok', lista: e.lista.filter((m) => m.id !== id) } : e))
      return true
    }
    // Un 404 casi seguro es que ya estaba desconectada; `account_changed` puede haberla revocado
    // igual en el servidor. En los dos la verdad la tiene la lista nueva.
    if (r.error === 'not_found' || r.error === 'account_changed') {
      await cargar()
      return true
    }
    return false
  }, [cargar])

  return { estado, cargar, revocar }
}

function plataformaLegible(p: string | null): string | null {
  if (!p) return null
  const s = p.toLowerCase()
  if (s === 'darwin' || s.startsWith('mac')) return 'macOS'
  if (s.startsWith('win')) return 'Windows'
  if (s === 'linux') return 'Linux'
  return p
}

export default function MachinesBlock({ estado, onRetry, onRevocar }: {
  estado: EstadoDeMaquinas
  onRetry: () => void
  onRevocar: (id: string) => Promise<boolean>
}) {
  const [confirmando, setConfirmando] = useState<string | null>(null)
  const [revocando, setRevocando] = useState<string | null>(null)
  const [conError, setConError] = useState<string | null>(null)
  // El estado no alcanza contra dos clicks en el mismo tick: el ref corta antes del re-render.
  const enVuelo = useRef(false)

  const confirmar = async (id: string) => {
    if (enVuelo.current) return
    enVuelo.current = true
    setRevocando(id)
    setConError(null)
    try {
      const ok = await onRevocar(id)
      if (!ok) setConError(id)
    } finally {
      enVuelo.current = false
      setRevocando(null)
      setConfirmando(null)
    }
  }

  if (estado.tipo === 'no_soportado') return null
  if (estado.tipo === 'cargando') {
    return <div aria-busy className="h-4 w-48 animate-pulse rounded bg-muted" />
  }
  if (estado.tipo === 'error') {
    return (
      <SettingRow
        nombre={<span role="alert" className="text-destructive">Couldn&apos;t load your machines.</span>}
        control={<Button variant="outline" size="sm" onClick={onRetry}>Retry</Button>}
      />
    )
  }

  return (
    <>
      {estado.lista.map((m) => {
        const plataforma = plataformaLegible(m.platform)
        const cuando = m.current ? 'This machine' : `last seen ${relativeTime(m.lastSeenAt)}`
        const control = m.current ? null
          : confirmando === m.id ? (
            <>
              <span className="text-fs-sm text-foreground">{`Disconnect ${m.name}?`}</span>
              <Button variant="ghost" size="sm" autoFocus disabled={revocando === m.id} onClick={() => setConfirmando(null)}>Cancel</Button>
              {/* Un solo revoke a la vez en todo el bloque: el guard `enVuelo` es uno. */}
              <Button variant="destructive" size="sm" disabled={revocando !== null} onClick={() => void confirmar(m.id)}>Disconnect</Button>
            </>
          )
          : <Button variant="outline" size="sm" aria-label={`Disconnect ${m.name}`} onClick={() => { setConError(null); setConfirmando(m.id) }}>Disconnect</Button>
        return (
          <SettingRow
            key={m.id}
            nombre={m.name}
            descripcion={plataforma ? `${plataforma} · ${cuando}` : cuando}
            control={control}
          >
            {conError === m.id && (
              <p role="alert" className="m-0 text-fs-sm text-destructive">{`Couldn't disconnect ${m.name}. Try again.`}</p>
            )}
          </SettingRow>
        )
      })}
      <p className="m-0 pt-2 text-fs-sm text-muted-foreground">
        Disconnecting stops syncing on that machine. Memory it already downloaded stays there.
      </p>
    </>
  )
}
