import { useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useMemory } from '../hooks/useMemory'
import { useProfile } from '../hooks/useProfile'
import { useUserRepos } from '../hooks/useUserRepos'
import { PLAN_LIMITS } from '../lib/stripe'
import { nubeDeMemoriaDisponible, textoDeErrorDeMemoria } from '../lib/beta-de-memoria'
import UpgradeModal from './UpgradeModal'
import LinkDeviceCard from './LinkDeviceCard'
import SettingRow from './memories/settings/SettingRow'
import { Button } from '@/components/ui/button'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'

// Bytes legibles. Un valor entero no lleva decimal ("1 GB"), uno fraccionario lleva uno
// ("3.0 MB"): la cuota tope suele ser redondo y el usado nunca lo es.
function formatBytes(bytes: number): string {
  const unidades = ['B', 'KB', 'MB', 'GB', 'TB']
  let v = bytes
  let i = 0
  while (v >= 1024 && i < unidades.length - 1) { v /= 1024; i++ }
  return `${Number.isInteger(v) ? v : v.toFixed(1)} ${unidades[i]}`
}

/**
 * Sync de Memory settings (spec 2026-10-21 §5): las filas Cloud sync, Cloud space y Machine
 * without a browser. Self-contained como antes: lee sus hooks. Lo que NO cambia: los mismos
 * estados de `useMemory`, el mismo diálogo de Turn off con el borrado de la nube adentro.
 * El campo de token se mudó a Advanced (SyncTokenRow, D7) y "Learn more" salió (D16).
 */
export default function CloudMemoryCard() {
  const memory = useMemory()
  const { repos: userRepos } = useUserRepos()
  const { plan } = useProfile()
  // En un build beta la nube no depende del plan: la habilita el allowlist del servicio.
  const nubeDisponible = nubeDeMemoriaDisponible(PLAN_LIMITS[plan].memoryCloud)
  const [memoryUpgradeOpen, setMemoryUpgradeOpen] = useState(false)
  // M10 / §6.6 "Right to delete": disconnect never touches local data regardless of this — it
  // only controls whether main also calls memory-sync's delete-cloud-data action.
  const [deleteCloudOnDisconnect, setDeleteCloudOnDisconnect] = useState(false)
  const [turnOffOpen, setTurnOffOpen] = useState(false)

  const confirmarTurnOff = () => {
    setTurnOffOpen(false)
    void memory.disconnect(deleteCloudOnDisconnect)
  }
  // El checkbox arranca destildado CADA VEZ que el diálogo se abre: tildarlo y cancelar no
  // puede dejar armado un borrado de la nube para la próxima.
  const abrirTurnOff = () => {
    setDeleteCloudOnDisconnect(false)
    setTurnOffOpen(true)
  }

  const conectada = memory.state === 'connected' || memory.state === 'paused'
  const n = memory.pendingCount
  const cambios = `${n} change${n === 1 ? '' : 's'}`
  const turnOff = <Button variant="destructive" size="sm" onClick={abrirTurnOff}>Turn off</Button>

  const control: ReactNode =
    memory.state === 'unavailable' ? <Button size="sm" disabled>Unavailable</Button>
    : conectada ? turnOff
    // §6.6/§7.5: `error` y `plan_required` son conexiones que EXISTEN (token válido, device
    // registrado): Turn off tiene sentido y el borrado de la nube autentica.
    : memory.state === 'error' ? <><Button size="sm" onClick={() => void memory.connectWithLogin()}>Retry</Button>{turnOff}</>
    : memory.state === 'plan_required' ? <><Button size="sm" onClick={() => setMemoryUpgradeOpen(true)}>Upgrade</Button>{turnOff}</>
    : memory.state === 'connecting' || memory.state === 'migrating' ? <Button size="sm" disabled>…</Button>
    : nubeDisponible ? <Button size="sm" onClick={() => void memory.connectWithLogin()}>Connect</Button>
    : <Button size="sm" onClick={() => setMemoryUpgradeOpen(true)}>Upgrade</Button>

  const linea = (texto: ReactNode, tono: 'muted' | 'warn' | 'destructive' = 'muted') => (
    <p className={`m-0 text-fs-sm ${tono === 'warn' ? 'text-warn' : tono === 'destructive' ? 'text-destructive' : 'text-muted-foreground'}`}>{texto}</p>
  )

  // La línea de estado (spec §5). `paused` tiene dos motivos desde el candado de
  // sincronización (§6.3): sin red, u otra instancia de Nest lo tiene tomado.
  const estado: ReactNode =
    memory.state === 'connected' && n > 0 ? (
      <p className="m-0 flex items-center gap-1.5 text-fs-sm text-warn">
        {/* El mismo punto ámbar que la fila de estado de la sidebar (`.memories-dot`). */}
        <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-warn" />
        Uploading {cambios}…
      </p>
    )
    : memory.state === 'connected' ? linea(`Up to date · ${memory.itemCount} ${memory.itemCount === 1 ? 'memory' : 'memories'}`)
    : memory.state === 'paused' && memory.statusDetail === 'lock_held' ? linea(`Another Nest is syncing this memory — ${cambios} queued`, 'warn')
    : memory.state === 'paused' ? linea(`Offline — ${cambios} waiting`, 'warn')
    : memory.state === 'error' ? linea(`Couldn't sync${memory.error ? ` — ${textoDeErrorDeMemoria(memory.error)}` : ''}`, 'destructive')
    : memory.state === 'plan_required' ? linea("Your plan doesn't include cloud sync", 'warn')
    : memory.state === 'unavailable' ? linea("Memory didn't start on this machine — restart Nest", 'warn')
    : memory.state === 'connecting' ? linea('Connecting…')
    : memory.state === 'migrating' ? linea('Importing your memory…')
    : !nubeDisponible ? linea('Local memory active — cloud sync is a Cloud feature')
    : null

  // La cuota la manda el servidor; NO cuelga de PLAN_LIMITS a propósito. `max_bytes = 0` es un
  // tope sin asignar: sin tope conocido la barra va vacía, nunca NaN%.
  const quota = memory.quota
  const pct = quota && quota.max_bytes > 0 ? (quota.used_bytes / quota.max_bytes) * 100 : 0

  return (
    <>
      <SettingRow
        nombre="Cloud sync"
        descripcion="Keeps a copy in the cloud so what your agents learn here is there on your other machines."
        control={control}
      >
        {estado}
        {memory.state === 'disconnected' && userRepos.length === 0 && (
          <p className="m-0 rounded-md border border-warn/40 px-3 py-2 text-fs-sm text-warn">
            Link your repos before connecting — memory imported without them goes to Global and stays there.
          </p>
        )}
      </SettingRow>

      {quota && conectada && (
        <SettingRow
          nombre="Cloud space"
          control={<span className="text-fs-sm tabular-nums text-muted-foreground">{formatBytes(quota.used_bytes)} of {formatBytes(quota.max_bytes)}</span>}
        >
          <div role="meter" aria-label="Cloud space" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
            {/* D18: el único estilo inline — el ancho es el dato, a escala real. */}
            <div className="h-full rounded-full bg-primary" style={{ width: `${Math.max(pct, 0.5)}%` }} />
          </div>
        </SettingRow>
      )}

      {/* D8: aprobar otra máquina tiene sentido con la nube conectada. */}
      {conectada && <LinkDeviceCard />}

      <AlertDialog open={turnOffOpen} onOpenChange={setTurnOffOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Turn off cloud sync?</AlertDialogTitle>
            <AlertDialogDescription>
              Your memory keeps working on this machine. You can reconnect any time.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <label className="flex items-center gap-2 text-fs-sm text-foreground">
            <input type="checkbox" checked={deleteCloudOnDisconnect} onChange={(e) => setDeleteCloudOnDisconnect(e.target.checked)} />
            Also delete my cloud memory (your local memory is never affected)
          </label>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            {/* Rojo SOLO si también va a borrar la nube. */}
            <AlertDialogAction variant={deleteCloudOnDisconnect ? 'destructive' : 'default'} onClick={confirmarTurnOff}>
              Turn off
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {memoryUpgradeOpen && createPortal(
        <UpgradeModal currentPlan={plan} onClose={() => setMemoryUpgradeOpen(false)} />,
        document.body,
      )}
    </>
  )
}
