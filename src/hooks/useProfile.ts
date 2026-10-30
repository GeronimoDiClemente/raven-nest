import { useEffect, useSyncExternalStore } from 'react'
import { supabase } from '../lib/supabase'
import type { Plan } from '../lib/stripe'

const TRIAL_DAYS = 15

interface Profile {
  plan: Plan
  loading: boolean
  isTrialActive: boolean
  trialDaysLeft: number
  /**
   * El plan tal cual está en `profiles`, sin el trial encima. Spec 2b-2 §4.8 (Ruling P3): el
   * aviso de Cloud activo compara éste, porque durante el trial el efectivo es `team` y el
   * paso de free a cloud no se vería.
   */
  rawPlan: string
  /** El usuario de la última lectura; null = sin sesión (Ruling P4: otra cuenta, otra base). */
  userId: string | null
  /** Período de facturación (Task 1: lo escribe el webhook). null = sin suscripción o sin dato. */
  billingInterval: 'monthly' | 'annual' | null
  currentPeriodEnd: string | null
  cancelAtPeriodEnd: boolean
  /** La misma lectura que dispara `focus`, respetando la lectura en vuelo. */
  recargar: () => void
}

const PLANES_CONOCIDOS = ['free', 'cloud', 'pro', 'team', 'enterprise']

/** RAVEN_E2E_BILLING llega como string crudo; un JSON roto se ignora. */
function leerE2eBilling(): Pick<Profile, 'billingInterval' | 'currentPeriodEnd' | 'cancelAtPeriodEnd'> {
  const vacio = { billingInterval: null, currentPeriodEnd: null, cancelAtPeriodEnd: false }
  const crudo = window.appFlags?.e2eBypass ? window.appFlags.e2eBilling : null
  if (!crudo) return vacio
  try {
    const b = JSON.parse(crudo) as { billingInterval?: unknown; currentPeriodEnd?: unknown; cancelAtPeriodEnd?: unknown }
    return {
      billingInterval: b.billingInterval === 'monthly' || b.billingInterval === 'annual' ? b.billingInterval : null,
      currentPeriodEnd: typeof b.currentPeriodEnd === 'string' ? b.currentPeriodEnd : null,
      cancelAtPeriodEnd: b.cancelAtPeriodEnd === true,
    }
  } catch {
    return vacio
  }
}

function computeEffectivePlan(rawPlan: string, trialStartedAt: string | null): {
  plan: Plan
  isTrialActive: boolean
  trialDaysLeft: number
} {
  if (rawPlan === 'cloud' || rawPlan === 'pro' || rawPlan === 'team' || rawPlan === 'enterprise') {
    return { plan: rawPlan as Plan, isTrialActive: false, trialDaysLeft: 0 }
  }

  if (!trialStartedAt) {
    return { plan: 'free', isTrialActive: false, trialDaysLeft: 0 }
  }

  const elapsed = Date.now() - new Date(trialStartedAt).getTime()
  const daysLeft = Math.max(0, TRIAL_DAYS - Math.floor(elapsed / (1000 * 60 * 60 * 24)))

  if (daysLeft > 0) {
    return { plan: 'team', isTrialActive: true, trialDaysLeft: daysLeft }
  }

  return { plan: 'free', isTrialActive: false, trialDaysLeft: 0 }
}

// Una sola lectura compartida. Hasta el 2026-10-29 cada uno de los siete componentes que
// llaman a `useProfile` tenía su copia del estado y su propio oyente de `focus`, así que cada
// vuelta a la ventana eran siete `getUser` + siete selects de `profiles` idénticos, y dos
// componentes podían mostrar planes distintos durante un instante. Ahora el estado vive acá y
// los hooks se suscriben. Al montar, cada uno pide una lectura igual que antes (lo que se abre
// después de pagar ve el plan fresco), pero `enVuelo` las junta en una.

const recargar = (): void => { void load() }

const INICIAL: Profile = {
  plan: 'free',
  loading: true,
  isTrialActive: false,
  trialDaysLeft: 0,
  rawPlan: 'free',
  userId: null,
  billingInterval: null,
  currentPeriodEnd: null,
  cancelAtPeriodEnd: false,
  recargar,
}

let estado: Profile = INICIAL
const suscriptores = new Set<() => void>()
// Evita apilar lecturas: tres `focus` seguidos (alt-tab nervioso) dispararian
// tres consultas identicas, y la ultima en resolver decide el estado.
let enVuelo = false
let overridePlan: string | null = null
// Sube cuando se va el último suscriptor y el estado vuelve a INICIAL: una lectura que
// arrancó antes no puede escribir sobre el estado de después.
let generacion = 0
let soltarOyentes: (() => void) | null = null

function publicar(siguiente: Profile | ((p: Profile) => Profile)): void {
  estado = typeof siguiente === 'function' ? siguiente(estado) : siguiente
  for (const cb of suscriptores) cb()
}

async function load(): Promise<void> {
  // Override E2E/demo (RAVEN_E2E_PLAN): gateado DOBLE al bypass — en una
  // sesión real appFlags.e2eBypass es false y esto nunca corre. Permite
  // probar features gateadas por plan sin un perfil Supabase.
  // Un plan puesto por el evento 'nest:e2e-plan' gana sobre RAVEN_E2E_PLAN: sin esto el
  // próximo `focus` lo pisaba (y en Playwright el foco llega solo).
  const e2ePlan = window.appFlags?.e2eBypass ? (overridePlan ?? window.appFlags.e2ePlan) : null
  if (e2ePlan && PLANES_CONOCIDOS.includes(e2ePlan)) {
    publicar({ plan: e2ePlan as Plan, loading: false, isTrialActive: false, trialDaysLeft: 0, rawPlan: e2ePlan, userId: null, ...leerE2eBilling(), recargar })
    return
  }
  if (enVuelo) return
  enVuelo = true
  const gen = generacion
  try {
    await leerPerfil(gen)
  } finally {
    if (gen === generacion) enVuelo = false
  }
}

async function leerPerfil(gen: number): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser()
  if (gen !== generacion) return
  if (!user) { publicar(p => ({ ...p, loading: false, userId: null })); return }

  // READ ONLY — never write to profiles from the client.
  // Profile creation is handled by the DB trigger (handle_new_user)
  // and the on-signup edge function.
  const consultar = (columnas: string) => supabase
    .from('profiles')
    .select(columnas)
    .eq('id', user.id)
    .maybeSingle<Record<string, unknown>>()
  let { data, error } = await consultar('plan, trial_started_at, billing_interval, current_period_end, cancel_at_period_end')
  // Sin la migración de 2b-3 en la base, PostgREST rechaza el select entero por las
  // columnas que no existen. Ignorar el error dejaba `data` en null → free para TODOS los
  // que pagan. Se reintenta con las de siempre y el período queda vacío.
  if (error) ({ data, error } = await consultar('plan, trial_started_at'))
  if (gen !== generacion) return
  // Tampoco eso: no se sabe el plan, y un `free` inventado esconde lo que pagó. Se conserva
  // la lectura anterior (la inicial, si es la primera) y se deja de cargar.
  if (error) { publicar(p => ({ ...p, loading: false })); return }

  const rawPlan = typeof data?.plan === 'string' ? data.plan : 'free'
  const computed = computeEffectivePlan(rawPlan, typeof data?.trial_started_at === 'string' ? data.trial_started_at : null)
  const intervalo = data?.billing_interval
  publicar({
    ...computed,
    loading: false,
    rawPlan,
    userId: user.id,
    billingInterval: intervalo === 'monthly' || intervalo === 'annual' ? intervalo : null,
    currentPeriodEnd: typeof data?.current_period_end === 'string' ? data.current_period_end : null,
    cancelAtPeriodEnd: data?.cancel_at_period_end === true,
    recargar,
  })
}

// E2E: deja producir el paso free -> cloud sin Stripe. Sólo con el bypass.
function alCambiarPlanE2e(e: Event): void {
  const plan = (e as CustomEvent<{ plan: string }>).detail?.plan
  if (!PLANES_CONOCIDOS.includes(plan)) return
  overridePlan = plan
  publicar(p => ({ ...p, plan: plan as Plan, rawPlan: plan, loading: false, isTrialActive: false, trialDaysLeft: 0 }))
}

function alFoco(): void { void load() }

function suscribir(cb: () => void): () => void {
  suscriptores.add(cb)
  if (!soltarOyentes) {
    // Un pago exitoso lo escribe el webhook de Stripe directo en `profiles`, sin
    // avisarle al cliente. Sin esto el hook leia una sola vez al montar, asi que
    // el que pagaba seguia viendo su plan viejo hasta reiniciar la app y la
    // compra parecia no haber funcionado. `profiles` no esta en la publicacion
    // de realtime, asi que no hay push posible: se re-lee al volver el foco, que
    // es exactamente cuando el usuario vuelve del navegador de pagar.
    const e2e = !!window.appFlags?.e2eBypass
    window.addEventListener('focus', alFoco)
    if (e2e) window.addEventListener('nest:e2e-plan', alCambiarPlanE2e)
    soltarOyentes = () => {
      window.removeEventListener('focus', alFoco)
      if (e2e) window.removeEventListener('nest:e2e-plan', alCambiarPlanE2e)
    }
  }
  return () => {
    suscriptores.delete(cb)
    if (suscriptores.size > 0) return
    // Sin nadie mirando (en la app no pasa: App vive siempre; en los tests, entre uno y
    // otro) se vuelve al arranque, como hacía cada instancia al desmontarse.
    soltarOyentes?.()
    soltarOyentes = null
    generacion++
    enVuelo = false
    overridePlan = null
    estado = INICIAL
  }
}

export function useProfile(): Profile {
  const profile = useSyncExternalStore(suscribir, () => estado)
  useEffect(() => { void load() }, [])
  return profile
}
