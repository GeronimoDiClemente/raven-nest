// La línea de Plan de Settings › Account: puro (sin React) para poder testearlo con un reloj fijo.
import { tieneSuscripcionPropia } from './stripe'

export type AccionDePlan = 'upgrade' | 'manage' | null
export interface LineaDePlan { titulo: string; detalle: string | null; accion: AccionDePlan }

const NOMBRES: Record<string, string> = { free: 'Free', cloud: 'Cloud', pro: 'Pro', team: 'Team', enterprise: 'Enterprise' }
const INTERVALOS = { monthly: 'Monthly', annual: 'Annual' } as const

/** 'Nov 29, 2026'. En UTC, para que el día no dependa del huso de la máquina. */
export function fechaLarga(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' })
}

export function lineaDePlan(
  p: {
    rawPlan: string
    isTrialActive: boolean
    billingInterval: 'monthly' | 'annual' | null
    currentPeriodEnd: string | null
    cancelAtPeriodEnd: boolean
  },
  ahora: number,
): LineaDePlan {
  if (p.isTrialActive) return { titulo: 'Trial', detalle: null, accion: 'upgrade' }
  if (p.rawPlan === 'free') {
    return { titulo: 'Free', detalle: '1 project in the cloud. Cloud syncs all of them.', accion: 'upgrade' }
  }
  const nombre = NOMBRES[p.rawPlan] ?? (p.rawPlan.charAt(0).toUpperCase() + p.rawPlan.slice(1))
  const titulo = p.billingInterval ? `${nombre} · ${INTERVALOS[p.billingInterval]}` : nombre
  const accion: AccionDePlan = tieneSuscripcionPropia(p.rawPlan) ? 'manage' : null
  // Una fecha ya vencida (webhook atrasado) no se muestra como "Renews on" viejo.
  const fin = p.currentPeriodEnd ? new Date(p.currentPeriodEnd).getTime() : NaN
  let detalle: string | null = null
  if (Number.isFinite(fin) && fin > ahora) {
    const fecha = fechaLarga(p.currentPeriodEnd as string)
    detalle = p.cancelAtPeriodEnd
      ? `Cancels on ${fecha} — you keep ${nombre} until then.`
      : `Renews on ${fecha}`
  }
  return { titulo, detalle, accion }
}
