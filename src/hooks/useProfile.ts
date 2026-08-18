import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import type { Plan } from '../lib/stripe'

const TRIAL_DAYS = 15

interface Profile {
  plan: Plan
  loading: boolean
  isTrialActive: boolean
  trialDaysLeft: number
}

function computeEffectivePlan(rawPlan: string, trialStartedAt: string | null): {
  plan: Plan
  isTrialActive: boolean
  trialDaysLeft: number
} {
  if (rawPlan === 'pro' || rawPlan === 'team' || rawPlan === 'enterprise') {
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

export function useProfile(): Profile {
  const [profile, setProfile] = useState<Profile>({
    plan: 'free',
    loading: true,
    isTrialActive: false,
    trialDaysLeft: 0,
  })

  useEffect(() => {

    let alive = true

    const load = async () => {
      // Override E2E/demo (RAVEN_E2E_PLAN): gateado DOBLE al bypass — en una
      // sesión real appFlags.e2eBypass es false y esto nunca corre. Permite
      // probar features gateadas por plan sin un perfil Supabase.
      const e2ePlan = window.appFlags?.e2eBypass ? window.appFlags.e2ePlan : null
      if (e2ePlan === 'free' || e2ePlan === 'pro' || e2ePlan === 'team' || e2ePlan === 'enterprise') {
        setProfile({ plan: e2ePlan, loading: false, isTrialActive: false, trialDaysLeft: 0 })
        return
      }
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { setProfile(p => ({ ...p, loading: false })); return }

      // READ ONLY — never write to profiles from the client.
      // Profile creation is handled by the DB trigger (handle_new_user)
      // and the on-signup edge function.
      const { data } = await supabase
        .from('profiles')
        .select('plan, trial_started_at')
        .eq('id', user.id)
        .maybeSingle()

      if (alive) {
        const computed = computeEffectivePlan(
          data?.plan ?? 'free',
          data?.trial_started_at ?? null
        )
        setProfile({ ...computed, loading: false })
      }
    }

    load()
    return () => { alive = false }
  }, [])

  return profile
}
