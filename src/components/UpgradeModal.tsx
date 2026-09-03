import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import {
  STRIPE_PRICES,
  CLOUD_MONTHLY_PRICE,
  BOOK_DEMO_URL,
  TEAM_MIN_SEATS,
  type Plan,
} from '../lib/stripe'

interface Props {
  currentPlan: Plan
  onClose: () => void
}

interface PlanInfo {
  id: Plan
  name: string
  tagline: string
  /** The one feature that makes this tier worth it — shown above the list. */
  highlight: string
  popular?: boolean
  features: string[]
}

const PLAN_LIST: PlanInfo[] = [
  {
    id: 'free',
    name: 'Free',
    tagline: 'Everything on your machine — free forever, no card',
    highlight: 'Unlimited local memory, all the CLIs, the editor, worktrees',
    features: [
      'All the AIs — Claude, Codex, Gemini, Copilot, OpenCode, Terminal + your own',
      'Bring your own keys — we never meter usage · local-first, no telemetry',
      'Unlimited panes, worktrees, snippets, workspaces and MCP servers',
      'Voice-to-prompt, broadcast, diff viewer, Spotlight and the editor',
      'One project synced to the cloud',
    ],
  },
  {
    id: 'cloud',
    name: 'Cloud',
    tagline: 'Your memory, on every machine you use',
    popular: true,
    highlight: 'Every project synced, backed up, and yours if the disk dies',
    features: [
      'Every project replicated, not just one',
      'Pick up on another machine mid-thought — same context, same memories',
      'Your memory survives the laptop',
      'Everything in Free, which is everything that runs locally',
    ],
  },
  {
    id: 'team',
    name: 'Teams',
    tagline: 'Shared memory for the whole team',
    highlight: 'What one teammate learned, the next one already knows',
    features: [
      'Promote a memory to the team and everyone sees it',
      'Shared repos, snippets, workspaces & MCP servers',
      'SSO and a dedicated instance if you need one',
      `Priority support (24h) · min ${TEAM_MIN_SEATS} seats`,
    ],
  },
]

export default function UpgradeModal({ currentPlan, onClose }: Props) {
  const [userId, setUserId] = useState<string | null>(null)
  const [userEmail, setUserEmail] = useState<string | null>(null)
  const [loading, setLoading] = useState<string | null>(null)

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      setUserId(data.user?.id ?? null)
      setUserEmail(data.user?.email ?? null)
    })
  }, [])

  // Cloud es el unico plan self-serve. Sin price ID (Task 5 del corte comercial todavia
  // no lo creo) el boton esta deshabilitado: abrir el checkout con el price de `pro`
  // cobraria $20 por una card que dice $10.
  const checkoutReady = STRIPE_PRICES.cloud_monthly !== ''

  const handleUpgrade = async () => {
    if (!userId || !checkoutReady) return
    setLoading('cloud')
    try {
      const priceId = STRIPE_PRICES.cloud_monthly
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

  const handleBookDemo = () => {
    window.electronShell.openExternal(BOOK_DEMO_URL)
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
            Nest is BYOK — your Claude / Codex / Copilot subscriptions handle the AI. We don't meter usage.
          </p>
        </div>

        <div className="upgrade-plans">
          {PLAN_LIST.map(plan => {
            // `pro` es el alias heredado de `cloud` hasta que la Task 6 migre los
            // perfiles: un usuario en `pro` tiene que ver su card marcada como actual.
            const isCurrent = currentPlan === plan.id || (plan.id === 'cloud' && currentPlan === 'pro')
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
                  {plan.id === 'team' ? (
                    // Teams es venta asistida: sin precio de lista, el CTA es la demo.
                    <span className="upgrade-plan-price">Custom</span>
                  ) : (
                    <>
                      <span className="upgrade-plan-price">{plan.id === 'cloud' ? `$${CLOUD_MONTHLY_PRICE}` : '$0'}</span>
                      {plan.id === 'cloud' && <span className="upgrade-plan-period">/mo</span>}
                    </>
                  )}
                </div>

                <div className="upgrade-plan-feature-list">
                  <div className="upgrade-plan-highlight">
                    <StarIcon />
                    <span>{plan.highlight}</span>
                  </div>
                  <ul className="upgrade-plan-features">
                    {plan.features.map(item => (
                      <li key={item}>
                        <CheckIcon />
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                <div className="upgrade-plan-cta">
                  {isCurrent ? (
                    <span className="upgrade-plan-badge">Current plan</span>
                  ) : plan.id === 'free' ? (
                    <button className="upgrade-plan-btn ghost" disabled>Free forever</button>
                  ) : plan.id === 'team' ? (
                    <button className="upgrade-plan-btn" onClick={handleBookDemo}>Book a demo</button>
                  ) : (
                    <button
                      className={`upgrade-plan-btn${plan.popular ? ' primary' : ''}`}
                      onClick={handleUpgrade}
                      disabled={!userId || !checkoutReady || loading === 'cloud'}
                      title={checkoutReady ? undefined : 'Checkout opens once the $10 price is live in Stripe'}
                    >
                      {loading === 'cloud' ? '…' : `Upgrade to ${plan.name}`}
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

function StarIcon() {
  return (
    <svg className="upgrade-feature-star" width="13" height="13" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <path d="M8 1l1.9 4.1 4.5.5-3.4 3 1 4.4L8 10.8 3.9 13l1-4.4-3.4-3 4.5-.5L8 1z"/>
    </svg>
  )
}
