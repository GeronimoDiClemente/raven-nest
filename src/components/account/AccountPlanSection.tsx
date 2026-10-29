// Spec 2b-3 §3: Plan, Usage y Machines en Settings › Account, entre el email y Memory settings.
import { useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useProfile } from '../../hooks/useProfile'
import type { useMemory } from '../../hooks/useMemory'
import { lineaDePlan } from '../../lib/plan-de-cuenta'
import { abrirPortal, COPY_CHECKOUT_SIN_RED } from '../../lib/checkout'
import { estadoDeUso } from '../../lib/uso-de-cuenta'
import UpgradeModal from '../UpgradeModal'
import SettingRow from '../memories/settings/SettingRow'
import MachinesBlock, { useMaquinas } from './MachinesBlock'
import { Button } from '@/components/ui/button'

// El mismo peso que `.sp-seccion-titulo`, con utilidades: sin clases nuevas en global.css.
function Titulo({ children }: { children: ReactNode }) {
  return <h4 className="m-0 mt-3 text-fs font-semibold text-foreground">{children}</h4>
}

function Enlace({ children, onClick }: { children: ReactNode; onClick: () => void }) {
  return (
    <Button variant="link" size="sm" className="h-auto justify-start self-start p-0" onClick={onClick}>
      {children}
    </Button>
  )
}

/** Lo que la sección lee de `useMemory`. */
export type MemoriaDeCuenta = Pick<ReturnType<typeof useMemory>, 'state' | 'error' | 'cloudProjects' | 'limits' | 'localOnlyProjects' | 'overLimit'>

/**
 * `memory` viene de SettingsPanel y NO de un `useMemory()` propio. Nació porque el `onStatus`
 * del preload hacía `removeAllListeners('memory:status')` y una tercera instancia dejaba sorda
 * a otra; eso ya no pasa (Task 10b), pero una sola lectura del status por panel sigue alcanzando.
 */
export default function AccountPlanSection({ memory, onOpenMemorySync }: { memory: MemoriaDeCuenta; onOpenMemorySync: () => void }) {
  const profile = useProfile()
  const [upgradeOpen, setUpgradeOpen] = useState(false)
  const [errorDePortal, setErrorDePortal] = useState<string | null>(null)
  const [abriendoPortal, setAbriendoPortal] = useState(false)

  const uso = estadoDeUso({
    state: memory.state,
    error: memory.error,
    cloudProjects: memory.cloudProjects,
    maxProjects: memory.limits?.max_projects ?? null,
    localOnly: memory.localOnlyProjects,
    overLimit: memory.overLimit,
  })
  // Se pide al montar y cada vez que el sync vuelve a estar conectado.
  const maquinas = useMaquinas(uso.tipo === 'conectado')

  const gestionar = async () => {
    setAbriendoPortal(true)
    setErrorDePortal(null)
    // try/finally como en CloudMemoryCard: si `openExternal` lanza, el botón no queda trabado.
    try {
      const r = await abrirPortal()
      if (!r.ok) {
        setErrorDePortal(r.error)
        // Sin suscripción en Stripe (customer borrado): el webhook ya dejó el plan en free y la
        // relectura cambia el botón a Upgrade.
        if (r.code === 'no_subscription') profile.recargar()
      }
    } catch {
      setErrorDePortal(COPY_CHECKOUT_SIN_RED)
    } finally {
      setAbriendoPortal(false)
    }
  }

  const linea = profile.loading ? null : lineaDePlan(profile, Date.now())
  const accion =
    linea?.accion === 'upgrade' ? <Button size="sm" onClick={() => setUpgradeOpen(true)}>Upgrade</Button>
    : linea?.accion === 'manage' ? (
      <Button variant="outline" size="sm" disabled={abriendoPortal} onClick={() => void gestionar()}>Manage subscription</Button>
    )
    : null

  return (
    <div className="flex flex-col">
      <Titulo>Plan</Titulo>
      {/* Cargando: un esqueleto, nunca un `Free` que parpadea antes del plan real. */}
      {linea === null ? (
        <div data-testid="plan-cargando" aria-busy className="my-3 h-4 w-40 animate-pulse rounded bg-muted" />
      ) : (
        <SettingRow nombre={linea.titulo} descripcion={linea.detalle} control={accion}>
          {errorDePortal && <p role="alert" className="m-0 text-fs-sm text-destructive">{errorDePortal}</p>}
        </SettingRow>
      )}

      <Titulo>Usage</Titulo>
      {uso.tipo === 'cargando' ? (
        <div data-testid="uso-cargando" aria-busy className="my-3 h-4 w-40 animate-pulse rounded bg-muted" />
      ) : uso.tipo === 'beta' ? (
        <p className="m-0 py-3 text-fs-sm text-muted-foreground">Cloud sync is invite-only during the beta.</p>
      ) : uso.tipo === 'apagado' ? (
        <SettingRow nombre="Cloud sync is off.">
          <Enlace onClick={onOpenMemorySync}>Turn on in Memory settings ›</Enlace>
        </SettingRow>
      ) : (
        <>
          {uso.proyectos !== null && (
            <SettingRow
              nombre="Projects in the cloud"
              control={<span className="text-fs-sm tabular-nums text-muted-foreground">{uso.proyectos}</span>}
            >
              {uso.soloLocales > 0 && (
                <Enlace onClick={onOpenMemorySync}>{`${uso.soloLocales} local only — Keep syncing in Memory settings ›`}</Enlace>
              )}
            </SettingRow>
          )}
          {/* El conteo sale de la lista: sin lista cargada no se inventa un número. */}
          {maquinas.estado.tipo === 'ok' && (
            <SettingRow
              nombre="Machines"
              control={<span className="text-fs-sm tabular-nums text-muted-foreground">{`${maquinas.estado.lista.length} connected`}</span>}
            />
          )}
        </>
      )}

      {uso.tipo === 'conectado' && (
        <>
          <Titulo>Machines</Titulo>
          <MachinesBlock estado={maquinas.estado} onRetry={() => void maquinas.cargar()} onRevocar={maquinas.revocar} />
        </>
      )}

      {upgradeOpen && createPortal(
        <UpgradeModal currentPlan={profile.plan} onClose={() => setUpgradeOpen(false)} />,
        document.body,
      )}
    </div>
  )
}
