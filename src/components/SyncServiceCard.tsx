// Con qué servicio de sync habla esta instalación.
//
// El C4 de `memory-connection-state.ts` decía desde el principio que «apuntar a otro backend
// no debería exigir recompilar», y sin embargo el campo que lo permitía no lo escribía nadie:
// la única fuente real era `MAIN_VITE_SUPABASE_URL`, horneada en el build desde un `.env` que
// vive en una máquina de desarrollo. Los workflows de release no la pasan, así que toda
// instalación armada por CI se quedaba sin nube y sin forma de arreglarlo. Esta tarjeta es la
// mitad que faltaba.
//
// Self-contained como MemoryEncryptionCard y LinkDeviceCard: si el puente no expone
// `syncService` —un preload viejo— no se muestra nada.
import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

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

  // El marco de MemoryEncryptionCard y LinkDeviceCard, para que el pie de Memories comparta
  // la escala del resto de la pantalla.
  const marco = 'flex shrink-0 flex-col gap-2 rounded-md border border-border p-3'

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
    <div className={marco}>
      <h4 className="m-0 text-fs font-medium text-foreground">Sync service</h4>

      <p className="break-all font-mono text-fs-sm text-foreground">{estado.url}</p>
      {estado.elegida === null && (
        <p className="text-fs-sm text-muted-foreground">This is the address that comes with Nest.</p>
      )}

      {!abierto && (
        <div>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => { setAbierto(true); setTipeado(estado.elegida ?? ''); setError(null) }}
          >
            Change
          </Button>
        </div>
      )}

      {abierto && (
        <>
          <p className="text-fs-sm text-muted-foreground">
            Point this machine at a different service. Leave it empty to go back to the one that
            comes with Nest.
          </p>
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
            <Button size="sm" onClick={() => void guardar()} disabled={ocupado}>
              {ocupado ? 'Saving…' : 'Save'}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => { setAbierto(false); setError(null) }} disabled={ocupado}>
              Cancel
            </Button>
          </div>
        </>
      )}

      {error && <p className="text-fs-sm text-destructive">{error}</p>}
      {reconectar && (
        <p className="text-fs-sm text-warn">
          Saved. This machine’s access was issued by the previous service — if the new one does not
          know it, you will have to connect this machine again.
        </p>
      )}
    </div>
  )
}
