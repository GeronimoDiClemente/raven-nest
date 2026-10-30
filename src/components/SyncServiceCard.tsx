// Con qué servicio de sync habla esta instalación.
//
// Apuntar a otro backend no debería exigir recompilar (C4 de `memory-connection-state.ts`).
// La URL que trae el build, `MAIN_VITE_SYNC_URL`, sale de un `.env` que vive en una máquina
// de desarrollo y que los workflows de release no pasan: sin esta tarjeta, una instalación
// armada por CI no tiene forma de elegir el servicio.
//
// Self-contained como MemoryEncryptionCard y LinkDeviceCard: si el puente no expone
// `syncService` —un preload viejo— no se muestra nada.
import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import SettingRow from './memories/settings/SettingRow'

type EstadoDelServicio = { url: string; elegida: string | null; porDefecto: string }

type PuenteDeServicio = {
  syncService?: () => Promise<EstadoDelServicio>
  setSyncService?: (url: string | null) => Promise<
    { ok: true; url: string; hayQueReconectar: boolean } | { ok: false; error: string }
  >
}

function puente(): PuenteDeServicio | null {
  const api = (window as unknown as { memory?: PuenteDeServicio }).memory
  return api && typeof api.syncService === 'function' && typeof api.setSyncService === 'function' ? api : null
}

export default function SyncServiceCard() {
  const [estado, setEstado] = useState<EstadoDelServicio | null>(null)
  const [abierto, setAbierto] = useState(false)
  const [tipeado, setTipeado] = useState('')
  const [ocupado, setOcupado] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [reconectar, setReconectar] = useState(false)

  const api = puente()

  useEffect(() => {
    if (!api) return
    let vivo = true
    void api.syncService!().then((s) => { if (vivo) setEstado(s) }).catch(() => { /* la tarjeta queda sin dibujar */ })
    return () => { vivo = false }
  }, [api])

  if (!api || !estado) return null

  const guardar = async () => {
    setOcupado(true)
    setError(null)
    setReconectar(false)
    try {
      // Vaciar el campo es "volvé a la que viene por default", no "guardá un vacío".
      const r = await api.setSyncService!(tipeado.trim() === '' ? null : tipeado.trim())
      if (!r.ok) {
        setError(r.error)
        return
      }
      setEstado({ ...estado, url: r.url, elegida: tipeado.trim() === '' ? null : r.url })
      setReconectar(r.hayQueReconectar)
      setAbierto(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setOcupado(false)
    }
  }

  return (
    <SettingRow
      nombre="Sync server"
      descripcion={<span className="break-all font-mono text-foreground">{estado.url}</span>}
      control={!abierto && (
        <Button size="sm" variant="secondary" onClick={() => { setAbierto(true); setTipeado(estado.elegida ?? ''); setError(null) }}>
          Change
        </Button>
      )}
    >
      {estado.elegida === null && !abierto && (
        <p className="m-0 text-fs-sm text-muted-foreground">This is the address that comes with Nest.</p>
      )}
      {abierto && (
        <div className="flex flex-wrap items-center gap-2">
          <label htmlFor="sync-service-url" className="sr-only">Service address</label>
          <Input
            id="sync-service-url"
            value={tipeado}
            onChange={(e) => { setTipeado(e.target.value); setError(null) }}
            placeholder={estado.porDefecto}
            autoComplete="off"
            spellCheck={false}
            className="min-w-0 flex-1 font-mono"
            disabled={ocupado}
          />
          <Button size="sm" onClick={() => void guardar()} disabled={ocupado}>{ocupado ? 'Saving…' : 'Save'}</Button>
          <Button size="sm" variant="ghost" onClick={() => { setAbierto(false); setError(null) }} disabled={ocupado}>Cancel</Button>
        </div>
      )}
      {error && <p className="m-0 text-fs-sm text-destructive">{error}</p>}
      {reconectar && (
        <p className="m-0 text-fs-sm text-warn">
          Saved. This machine’s access was issued by the previous service — if the new one does not
          know it, you will have to connect this machine again.
        </p>
      )}
    </SettingRow>
  )
}
