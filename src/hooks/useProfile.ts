import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import type { Plan } from '../lib/stripe'
import { isE2EPreview } from '../lib/e2ePreview'

const TRIAL_DAYS = 14

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
  if (rawPlan === 'pro' || rawPlan === 'team') {
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

  // LOCAL PREVIEW ONLY (gated on RAVEN_E2E bypass): unlock Pro/Team
  // so My Repos / Teams render without a real Supabase backend.
  if (isE2EPreview()) {
    return { plan: 'team', loading: false, isTrialActive: false, trialDaysLeft: 0 }
  }

  return profile
}
