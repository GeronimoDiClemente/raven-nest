// Qué le pasa a una máquina de una cuenta: el veredicto de beta, plan y tope de máquinas.
//
// Puro, y en UN solo lugar, porque lo usan dos caminos que tienen que decir lo mismo:
// `authenticate` (cada request de un device ya registrado) y `/v1/link/check` (lo que la
// página le muestra a alguien ANTES de aprobar una máquina nueva). Spec
// 2026-11-02-login-y-compra-sin-nest §3: "el mismo control… para que no haya dos verdades".
import { limitsFor } from './limits'

// Plans that include cloud sync. Checked server-side because the renderer's own check is a
// release blocker: anything enforced only in the client is not enforced (§9.3).
//
// 'free' is here on purpose: the pricing spec (§4) gives Free 1 project in the cloud — the
// product's central hook, the moment someone opens a second machine and finds the first
// one's memory. What bounds Free isn't this gate, it's the limits already built on top of it
// (1 project, 100 MB, a 15-minute poll interval). Excluding 'free' from this set made that
// free project unreachable and left the whole project cap built for it dead code.
//
// 'cloud' is here for the same reason 'pro' is: it's the plan's actual current name (the
// pro -> cloud rename landed in limits.ts's BY_PLAN table), and a paying Cloud-tier user
// with that literal plan value could not authenticate at all without it.
export const CLOUD_PLANS = new Set(['free', 'cloud', 'pro', 'team', 'enterprise'])

export type Elegibilidad = 'ok' | 'not_in_beta' | 'plan_required' | 'device_limit_reached'

/**
 * `maquinasPrevias`: las máquinas vivas de la cuenta que van ANTES que la juzgada. Para un
 * device registrado son las más viejas que él (`authenticate`); para una máquina que todavía
 * no existe son todas las vivas, porque la nueva sería la última.
 *
 * El orden de los chequeos es el de `authenticate` desde siempre: beta, plan, tope.
 */
export function veredictoDeElegibilidad(e: { enAllowlist: boolean; plan: string; maquinasPrevias: number }): Elegibilidad {
  if (!e.enAllowlist) return 'not_in_beta'
  if (!CLOUD_PLANS.has(e.plan)) return 'plan_required'
  if (e.maquinasPrevias >= limitsFor(e.plan).maxDevices) return 'device_limit_reached'
  return 'ok'
}
