import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useMemory } from '../hooks/useMemory'
import { useProfile } from '../hooks/useProfile'
import { useUserRepos } from '../hooks/useUserRepos'
import { PLAN_LIMITS } from '../lib/stripe'
import { nubeDeMemoriaDisponible, textoDeErrorDeMemoria } from '../lib/beta-de-memoria'
import UpgradeModal from './UpgradeModal'
import MemoryHub from './MemoryHub'
import logoUrl from '../assets/logo.png'
import { Button } from '@/components/ui/button'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Cloud } from 'lucide-react'
import { ICON_SIZE } from '../lib/icons'

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
 * La tarjeta de nube de memoria, extraída de `SettingsPanel` (Task 3 del plan
 * "memorias vista y settings"). Antes vivía adentro de la sección `cloud` de Settings; ahora
 * es self-contained, sin props — lee todo lo que necesita de sus propios hooks, igual que
 * `MemoryEncryptionCard`.
 *
 * Dos cambios de fondo sobre la versión vieja:
 * - La subida (`pendingCount`) y la cuota (`quota`) eran la MISMA barra (`sp-mem-progress`
 *   medía el progreso de sincronización, no el espacio usado). Acá son dos cosas separadas:
 *   un texto "Uploading N changes…" mientras hay cola, y un `meter` de cuota que sólo refleja
 *   lo que el servidor reportó como usado/tope.
 * - "Disconnect" borraba sin preguntar (el checkbox de borrado vivía suelto al lado). Ahora
 *   abre un `AlertDialog` de confirmación — "Turn off" — con el checkbox adentro.
 */
export default function CloudMemoryCard() {
  const memory = useMemory()
  const { repos: userRepos } = useUserRepos()
  const { plan } = useProfile()
  // En un build beta la nube no depende del plan: la habilita el allowlist del servicio.
  const nubeDisponible = nubeDeMemoriaDisponible(PLAN_LIMITS[plan].memoryCloud)
  const [memoryUpgradeOpen, setMemoryUpgradeOpen] = useState(false)
  const [memoryHubOpen, setMemoryHubOpen] = useState(false)
  // M10 / §6.6 "Right to delete": disconnect never touches local data regardless of
  // this — it only controls whether main also calls memory-sync's delete-cloud-data
  // action (see electron/main.ts's memory:disconnect handler) before clearing the
  // local connection state.
  const [deleteCloudOnDisconnect, setDeleteCloudOnDisconnect] = useState(false)
  // La confirmación de "Turn off": el checkbox de borrado vive ADENTRO de este diálogo, no
  // suelto al lado del botón — antes se podía tildar y nunca apretar Disconnect, o al revés
  // desconectar sin haber mirado la opción de borrado.
  const [turnOffOpen, setTurnOffOpen] = useState(false)
  const [memoryToken, setMemoryToken] = useState('')
  // Once the token has done its job, drop it. main.ts persists it in the credential
  // store, so keeping the plaintext value in React state for the rest of the session
  // buys nothing and leaves it in every heap snapshot and devtools inspection of the
  // panel. Keyed on the card reaching 'connected' so it covers both the Connect and the
  // Retry button.
  useEffect(() => {
    if (memory.state === 'connected') setMemoryToken('')
  }, [memory.state])

  // §9.2: Connect y Retry pasan a pedirle el token al servicio con el JWT del login. El
  // token pegado a mano (C7) sigue ganando cuando está: es el camino del beta de una cuenta
  // y el escape para cuando el emisor está caído.
  const conectarMemoria = () => {
    const pegado = memoryToken.trim()
    return pegado ? memory.connectWithToken(pegado) : memory.connectWithLogin()
  }

  const confirmarTurnOff = () => {
    setTurnOffOpen(false)
    void memory.disconnect(deleteCloudOnDisconnect)
  }

  // El checkbox tiene que arrancar destildado CADA VEZ que el diálogo se abre — sin esto,
  // tildarlo una vez y cancelar dejaba la marca puesta para la próxima apertura, y un Turn
  // off sin querer borraba la nube.
  const abrirTurnOff = () => {
    setDeleteCloudOnDisconnect(false)
    setTurnOffOpen(true)
  }

  return (
    <div className="sp-section">
      <div className="sp-card">
        <div className="flex items-center gap-2">
          <Cloud size={ICON_SIZE.md} className="text-muted-foreground" aria-hidden />
          <p className="text-fs font-medium text-foreground">Cloud sync</p>
        </div>
        <p className="mt-1 text-fs-sm text-muted-foreground">
          Keeps a copy of your memory in the cloud, so what an agent learns on this machine is
          there when you open Nest on another one. Turn on Encryption so the server can't read
          it.
        </p>

        <div className="sp-card-row mt-2">
          <div className="sp-card-left">
            <img src={logoUrl} alt="" aria-hidden="true" width={15} height={15} style={{ display: 'block' }} />
            <span className="sp-card-label">Nest Memory</span>
            {/* Era un <button> con OCHO declaraciones inline para parecer un link —
                incluido un `color: inherit` que estaba ahi porque sin el heredaba
                `buttontext` del navegador (negro sobre #141414). El primitivo tiene una
                variante `link` que hace exactamente esto. */}
            <Button
              variant="link"
              size="xs"
              className="ml-1.5 h-auto p-0 text-fs-xs text-muted-foreground"
              onClick={() => setMemoryHubOpen(true)}
            >
              Learn more
            </Button>
            {memory.state === 'connected' && (
              <span className="ml-1.5 text-fs-xs text-muted-foreground">
                {memory.itemCount} {memory.itemCount === 1 ? 'memory' : 'memories'}
              </span>
            )}
            {/*
              `paused` tiene DOS motivos desde que existe el candado de sincronización
              (§6.3): sin red, u otra instancia de Nest lo tiene tomado. El texto estaba
              hardcodeado en "Offline", que para el segundo caso es falso — manda al
              usuario a revisar su internet cuando lo que pasa es que hay otra ventana
              abierta.
            */}
            {memory.state === 'paused' && (
              <span className="ml-1.5 text-fs-xs text-warn">
                {memory.statusDetail === 'lock_held' ? (
                  <>
                    Another instance of Nest is syncing this memory — {memory.pendingCount} change{memory.pendingCount === 1 ? '' : 's'} queued
                  </>
                ) : (
                  <>
                    Offline — {memory.pendingCount} change{memory.pendingCount === 1 ? '' : 's'} will sync when you're back
                  </>
                )}
              </span>
            )}
            {memory.state === 'error' && (
              <span className="ml-1.5 text-fs-xs text-destructive">
                Couldn't sync{memory.error ? ` — ${textoDeErrorDeMemoria(memory.error)}` : ''}
              </span>
            )}
            {memory.state === 'plan_required' && (
              <span className="ml-1.5 text-fs-xs text-warn">
                Your plan doesn't include cloud sync — upgrade to resume
              </span>
            )}
            {memory.state === 'unavailable' && (
              <span className="ml-1.5 text-fs-xs text-warn">
                Memory didn't start on this machine — restart Nest
              </span>
            )}
            {memory.state === 'disconnected' && !nubeDisponible && (
              <span className="ml-1.5 text-fs-xs text-muted-foreground">
                Local memory active — cloud sync is a Cloud feature
              </span>
            )}
            {(memory.state === 'connecting' || memory.state === 'migrating') && (
              <span className="ml-1.5 text-fs-xs text-muted-foreground">
                {memory.state === 'connecting' ? 'Connecting…' : 'Importing your memory…'}
              </span>
            )}
          </div>
          {memory.state === 'unavailable' ? (
            <Button size="sm" disabled>Unavailable</Button>
          ) : memory.state === 'connected' || memory.state === 'paused' ? (
            <Button variant="destructive" size="sm" onClick={abrirTurnOff}>Turn off</Button>
          ) : memory.state === 'error' ? (
            // §6.6/§7.5 "right to delete": `error` here means a connection that WAS
            // established (refresh() only reaches it when status.connected is true)
            // whose daemon is now failing — the stored token is still valid, so Turn
            // off (and an optional cloud delete via the dialog's checkbox) still
            // authenticates. Without it, a user stuck in a persistent error state had
            // no way to get their cloud copy deleted except fixing the underlying
            // failure first.
            <div className="flex gap-2">
              <Button size="sm" onClick={() => void conectarMemoria()}>Retry</Button>
              <Button variant="destructive" size="sm" onClick={abrirTurnOff}>Turn off</Button>
            </div>
          ) : memory.state === 'plan_required' ? (
            // Same right-to-delete gap as `error`: the connection still exists — the
            // token is valid and the device is registered, the server is just refusing
            // pushes for plan reasons — so Turn off is meaningful and the
            // delete-cloud-data call will authenticate. A downgraded user is exactly
            // someone who may want their data off the server, and the Upgrade-only
            // button gave them no way to ask for that.
            <div className="flex gap-2">
              {/* Reuses the same Upgrade affordance the free-plan disconnected branch
                  below already has — no second upgrade path invented. */}
              <Button size="sm" onClick={() => setMemoryUpgradeOpen(true)}>Upgrade</Button>
              <Button variant="destructive" size="sm" onClick={abrirTurnOff}>Turn off</Button>
            </div>
          ) : memory.state === 'connecting' || memory.state === 'migrating' ? (
            <Button size="sm" disabled>…</Button>
          ) : nubeDisponible ? (
            <Button size="sm" onClick={() => void conectarMemoria()}>Connect</Button>
          ) : (
            <Button size="sm" onClick={() => setMemoryUpgradeOpen(true)}>Upgrade</Button>
          )}
        </div>
        {((memory.state === 'disconnected' && nubeDisponible) || memory.state === 'error') && (
          <input
            type="password"
            className="sp-select"
            style={{ width: '100%', marginTop: 8, cursor: 'text' }}
            placeholder="Paste a sync token (optional)"
            aria-label="Memory sync token"
            value={memoryToken}
            onChange={(e) => setMemoryToken(e.target.value)}
          />
        )}
        {memory.state === 'disconnected' && userRepos.length === 0 && (
          <div className="sp-mem-no-repos-banner">
            <span className="sp-mem-no-repos-banner-icon">⚠</span>
            <span>
              No repositories linked yet. Link your repos first so imported memory gets
              organized per project — memory connected without repos goes to the global
              space and won't be re-organized later.
            </span>
          </div>
        )}
        {/* Uploading: la cola de subida, separada de la cuota — antes las dos compartían
            la misma barra (`sp-mem-progress`), que medía el progreso de sincronización y
            se mostraba debajo de un texto que hablaba de espacio usado. Eran dos
            preguntas distintas ("¿cuánto falta subir?" vs. "¿cuánto espacio me queda?")
            contestadas con un solo número. */}
        {memory.state === 'connected' && memory.pendingCount > 0 && (
          <p className="mt-2 flex items-center gap-1.5 text-fs-sm text-warn">
            {/* El mismo punto ambar que la fila de estado de la sidebar (`.memories-dot`,
                `data-dot="amber"` en global.css) — acá como utilidad, porque esta tarjeta no
                vive adentro de esa fila absoluta. */}
            <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-warn" />
            Uploading {memory.pendingCount} change{memory.pendingCount === 1 ? '' : 's'}…
          </p>
        )}
        {/* La cuota la manda el servidor. La condicion NO cuelga de
            PLAN_LIMITS[plan].memoryCloud a proposito: gatear el dato del servidor detras
            de una constante del cliente es justo lo que el corte comercial saca del
            medio. Si el servidor reporto cuota, el usuario tiene nube. */}
        {memory.quota && (memory.state === 'connected' || memory.state === 'paused') && (() => {
          // `max_bytes = 0` es un tope todavia sin asignar del lado del servidor, no "0
          // bytes disponibles" — dividir por el de todos modos da NaN, y NaN% rompe tanto el
          // texto como el ancho de la barra. Sin tope conocido se muestra vacia (0%), no NaN.
          const pct = memory.quota.max_bytes > 0
            ? (memory.quota.used_bytes / memory.quota.max_bytes) * 100
            : 0
          return (
            <div className="mt-2 flex flex-col gap-1">
              <p className="text-fs-sm text-muted-foreground">
                Cloud space: {formatBytes(memory.quota.used_bytes)} of {formatBytes(memory.quota.max_bytes)}
              </p>
              <div
                role="meter"
                aria-label="Cloud space"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={pct}
                className="h-1.5 w-full overflow-hidden rounded-full bg-muted"
              >
                <div
                  className="h-full rounded-full bg-primary"
                  style={{ width: `${Math.max(pct, 0.5)}%` }}
                />
              </div>
            </div>
          )
        })()}
      </div>

      <AlertDialog open={turnOffOpen} onOpenChange={setTurnOffOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Turn off cloud sync?</AlertDialogTitle>
            <AlertDialogDescription>
              Your memory keeps working on this machine. You can reconnect any time.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <label className="flex items-center gap-2 text-fs-sm text-foreground">
            <input
              type="checkbox"
              checked={deleteCloudOnDisconnect}
              onChange={(e) => setDeleteCloudOnDisconnect(e.target.checked)}
            />
            Also delete my cloud memory (your local memory is never affected)
          </label>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            {/* Rojo SOLO si tambien va a borrar la nube — un "Turn off" liso no es mas
                destructivo que cualquier otro boton de esta pantalla. */}
            <AlertDialogAction
              variant={deleteCloudOnDisconnect ? 'destructive' : 'default'}
              onClick={confirmarTurnOff}
            >
              Turn off
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {memoryUpgradeOpen && createPortal(
        <UpgradeModal currentPlan={plan} onClose={() => setMemoryUpgradeOpen(false)} />,
        document.body
      )}

      {memoryHubOpen && createPortal(
        <MemoryHub
          onClose={() => setMemoryHubOpen(false)}
          onUpgrade={() => { setMemoryHubOpen(false); setMemoryUpgradeOpen(true) }}
        />,
        document.body
      )}
    </div>
  )
}
