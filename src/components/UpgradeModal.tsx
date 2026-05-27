import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import {
  STRIPE_PRICES,
  PLAN_PRICING,
  ANNUAL_DISCOUNT_PERCENT,
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
    tagline: 'Feel the multi-agent flow — free forever, no card',
    highlight: 'Run Claude, Codex & Gemini in 3 panes at once',
    features: [
      'All 7 AIs — Claude, Codex, Gemini, Copilot, OpenCode, Terminal + your own',
      'Bring your own keys — we never meter usage · local-first, no telemetry',
      'Preview localhost in an in-app browser, ports auto-detected',
      'Sessions survive restarts — pick up where you left off',
      'Command palette + global search across every pane',
      'Browse worktrees & MCP servers (read-only)',
    ],
  },
  {
    id: 'pro',
    name: 'Pro',
    tagline: 'Everything in Free — built out for one developer',
    popular: true,
    highlight: 'Up to 12 isolated worktrees side by side — a branch per pane, no stashing',
    features: [
      'Review, merge & open PRs without leaving Nest',
      'Branch straight from an issue, CI runs inline',
      'GitHub + GitLab · per-pane port detection',
      'Voice-to-prompt (local Whisper) + broadcast to every pane',
      'Diff viewer + open in any IDE (VS Code, Cursor, JetBrains, Zed…)',
      'Jump anywhere instantly (Spotlight) + benchmark across models',
      'Unlimited snippets, workspaces & auto standup',
      'Full read/write MCP + isolated HOME per account',
    ],
  },
  {
    id: 'team',
    name: 'Team',
    tagline: 'Everything in Pro — for a team that ships together',
    highlight: 'See where every teammate is working in real time, and jump in',
    features: [
      'Team chat with reactions + shared activity feed (GitHub/GitLab)',
      'Shared repos, snippets, workspaces & MCP servers',
      "Per-user local paths — one repo, everyone's machine",
      'Clone private repos over HTTPS with OAuth, one click',
      'Multi-leader roles + join by 8-char code',
      'Shared team standup',
      `Priority support (24h) · min ${TEAM_MIN_SEATS} seats`,
    ],
  },
]

function priceFor(planId: Plan, billing: 'monthly' | 'annual'): { amount: string; annualTotal?: string } {
  if (planId !== 'pro' && planId !== 'team') return { amount: '$0' }
  const pricing = PLAN_PRICING[planId]
  const monthlyEquiv = billing === 'monthly' ? pricing.monthly : pricing.annual
  const annualTotal = billing === 'annual' ? `$${pricing.annual * 12}/year` : undefined
  return { amount: `$${monthlyEquiv}`, annualTotal }
}

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

  const handleUpgrade = async (plan: 'pro' | 'team') => {
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
            <span className="upgrade-save-badge">Save {ANNUAL_DISCOUNT_PERCENT}%</span>
          </button>
        </div>

        <div className="upgrade-plans">
          {PLAN_LIST.map(plan => {
            const isCurrent = currentPlan === plan.id
            const { amount, annualTotal } = priceFor(plan.id, billing)
            const isPaid = plan.id === 'pro' || plan.id === 'team'
            const showSeatLabel = plan.id === 'team'
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
                  <span className="upgrade-plan-price">{amount}</span>
                  {isPaid && <span className="upgrade-plan-period">/{showSeatLabel ? 'seat/mo' : 'mo'}</span>}
                </div>
                {billing === 'annual' && annualTotal && (
                  <div className="upgrade-plan-annual">{annualTotal}{showSeatLabel ? ' / seat' : ''}</div>
                )}

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
                  ) : (
                    <button
                      className={`upgrade-plan-btn${plan.popular ? ' primary' : ''}`}
                      onClick={() => handleUpgrade(plan.id as 'pro' | 'team')}
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

        <button className="upgrade-enterprise-link" onClick={handleBookDemo}>
          <span className="upgrade-enterprise-link-text">
            Need SSO, audit logs or org-wide rollout?
          </span>
          <span className="upgrade-enterprise-link-cta">Book a demo →</span>
        </button>
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
