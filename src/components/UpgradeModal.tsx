import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { STRIPE_PRICES, type Plan } from '../lib/stripe'

interface Props {
  currentPlan: Plan
  onClose: () => void
}

interface FeatureGroup {
  label?: string
  items: string[]
}

interface PlanInfo {
  id: Plan | 'free'
  name: string
  tagline: string
  monthlyPrice: string
  annualPrice: string
  annualTotal: string
  popular?: boolean
  groups: FeatureGroup[]
}

const PLAN_LIST: PlanInfo[] = [
  {
    id: 'free',
    name: 'Free',
    tagline: 'Try Raven, no commitment',
    monthlyPrice: '$0',
    annualPrice: '$0',
    annualTotal: '$0/year',
    groups: [
      {
        items: [
          'Grid 2×2 multi-pane',
          'All AIs: Claude, Codex, Cursor, Gemini, Copilot',
          'Persistent sessions across restarts',
          'Command palette + keybindings',
          'Global MCP server panel',
          'Voice dictation offline',
        ],
      },
    ],
  },
  {
    id: 'pro',
    name: 'Pro',
    tagline: 'Your personal workflow, unlimited',
    monthlyPrice: '$20',
    annualPrice: '$17',
    annualTotal: '$204/year',
    popular: true,
    groups: [
      {
        label: 'Everything in Free, plus',
        items: [
          'Grid up to 4×4',
          'Broadcast: one command, every pane',
          'Personal My Repos with change detection',
          'GitHub OAuth + Git status panel',
          'Personal Snippets and Workspaces',
          'Actions panel (GitHub + GitLab workflows)',
          'Automatic daily standup',
        ],
      },
    ],
  },
  {
    id: 'team',
    name: 'Team',
    tagline: 'Code with your team in real time',
    monthlyPrice: '$35',
    annualPrice: '$29',
    annualTotal: '$348/year',
    groups: [
      {
        label: 'Everything in Pro, plus',
        items: [
          'Real-time presence: see where everyone is',
          'Team chat with reactions',
          'Shared team activity feed',
          'Multi-leader roles',
          'Shared team repos',
          'Shared snippets, workspaces and MCP',
          'Join by code: no email needed',
          'Priority support',
        ],
      },
    ],
  },
]

export default function UpgradeModal({ currentPlan, onClose }: Props) {
  const [userId, setUserId] = useState<string | null>(null)
  const [userEmail, setUserEmail] = useState<string | null>(null)
  const [billing, setBilling] = useState<'monthly' | 'annual'>('monthly')
  const [loading, setLoading] = useState<string | null>(null)

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      setUserId(data.user?.id ?? null)
      setUserEmail(data.user?.email ?? null)
    })
  }, [])

  const handleUpgrade = async (plan: Plan) => {
    if (!userId) return
    setLoading(plan)
    try {
      const priceKey = `${plan}_${billing}` as keyof typeof STRIPE_PRICES
      const priceId = STRIPE_PRICES[priceKey]
      const { data, error } = await supabase.functions.invoke('stripe-checkout', {
        body: { priceId, userId, email: userEmail ?? undefined },
      })
      if (error || !data?.url) throw new Error(error?.message ?? 'No checkout URL')
      window.electronShell.openExternal(data.url)
      onClose()
    } catch (err) {
      console.error('Stripe checkout error:', err)
    } finally {
      setLoading(null)
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="upgrade-modal" onClick={e => e.stopPropagation()}>
        <button className="upgrade-modal-close" onClick={onClose} aria-label="Close">×</button>

        <div className="upgrade-hero">
          <div className="upgrade-hero-icon">
            <svg width="22" height="22" viewBox="0 0 16 16" fill="none">
              <path d="M2 11.5L4 5l2.5 4L8 4l1.5 5L12 5l2 6.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              <path d="M2.5 13.5h11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
          </div>
          <h2 className="upgrade-hero-title">Choose your plan</h2>
          <p className="upgrade-hero-subtitle">
            Upgrade to Pro for your personal workflow, or Team to collaborate in real time.
          </p>
        </div>

        <div className="upgrade-billing-toggle">
          <button
            className={`upgrade-billing-btn${billing === 'monthly' ? ' active' : ''}`}
            onClick={() => setBilling('monthly')}
          >Monthly</button>
          <button
            className={`upgrade-billing-btn${billing === 'annual' ? ' active' : ''}`}
            onClick={() => setBilling('annual')}
          >
            Annual
            <span className="upgrade-save-badge">Save 15%</span>
          </button>
        </div>

        <div className="upgrade-plans">
          {PLAN_LIST.map(plan => {
            const isCurrent = currentPlan === plan.id
            const showAnnual = billing === 'annual' && plan.id !== 'free'
            const price = billing === 'monthly' ? plan.monthlyPrice : plan.annualPrice
            return (
              <div
                key={plan.id}
                className={`upgrade-plan${isCurrent ? ' current' : ''}${plan.popular ? ' popular' : ''}`}
              >
                {plan.popular && !isCurrent && (
                  <div className="upgrade-plan-popular-badge">Most popular</div>
                )}

                <div className="upgrade-plan-head">
                  <div className="upgrade-plan-name">{plan.name}</div>
                  <div className="upgrade-plan-tagline">{plan.tagline}</div>
                </div>

                <div className="upgrade-plan-pricing">
                  <span className="upgrade-plan-price">{price}</span>
                  {plan.id !== 'free' && <span className="upgrade-plan-period">/mo</span>}
                </div>
                {showAnnual && (
                  <div className="upgrade-plan-annual">{plan.annualTotal}</div>
                )}

                <div className="upgrade-plan-feature-list">
                  {plan.groups.map((group, gi) => (
                    <div key={gi} className="upgrade-plan-feature-group">
                      {group.label && (
                        <div className="upgrade-plan-feature-group-label">{group.label}</div>
                      )}
                      <ul className="upgrade-plan-features">
                        {group.items.map(item => (
                          <li key={item}>
                            <CheckIcon />
                            <span>{item}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>

                <div className="upgrade-plan-cta">
                  {isCurrent ? (
                    <span className="upgrade-plan-badge">Current plan</span>
                  ) : plan.id === 'free' ? (
                    <button className="upgrade-plan-btn ghost" disabled>Free forever</button>
                  ) : (
                    <button
                      className={`upgrade-plan-btn${plan.popular ? ' primary' : ''}`}
                      onClick={() => handleUpgrade(plan.id as Plan)}
                      disabled={!userId || loading === plan.id}
                    >
                      {loading === plan.id ? '…' : `Upgrade to ${plan.name}`}
                    </button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

function CheckIcon() {
  return (
    <svg className="upgrade-feature-check" width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M3 8.5l3 3 7-7" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  )
}
