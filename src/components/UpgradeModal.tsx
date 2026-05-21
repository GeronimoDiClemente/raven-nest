import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import {
  STRIPE_PRICES,
  PLAN_PRICING,
  ANNUAL_DISCOUNT_PERCENT,
  ENTERPRISE_CONTACT_EMAIL,
  ENTERPRISE_FLOOR_PER_SEAT,
  ENTERPRISE_MIN_SEATS,
  TEAM_MIN_SEATS,
  type Plan,
} from '../lib/stripe'

interface Props {
  currentPlan: Plan
  onClose: () => void
}

interface FeatureGroup {
  label?: string
  items: string[]
}

interface PlanInfo {
  id: Plan
  name: string
  tagline: string
  popular?: boolean
  groups: FeatureGroup[]
}

const PLAN_LIST: PlanInfo[] = [
  {
    id: 'free',
    name: 'Free',
    tagline: 'Try Nest, no card required',
    groups: [
      {
        items: [
          'Up to 3 panes at a time',
          'All 7 AIs: Claude, Codex, Gemini, Copilot, OpenCode, Terminal, Custom',
          'Browser cell (Chromium, port-filtered)',
          'Persistent sessions across restarts',
          'Command palette + keybindings',
          'Global search across panes',
          'View worktrees in your repos',
          'MCP server panel (read-only)',
        ],
      },
    ],
  },
  {
    id: 'pro',
    name: 'Pro',
    tagline: 'Everything Nest can do, for one developer',
    popular: true,
    groups: [
      {
        label: 'Everything in Free, plus',
        items: [
          'Up to 12 panes',
          'Create worktrees + Spotlight + benchmark',
          'Diff viewer + IDE picker (VS Code, Cursor, JetBrains, Zed, Sublime)',
          'Broadcast: one command, every pane',
          'Terminal Sharing with handshake',
          'Voice input — local Whisper, 8 languages',
          'Port detection per pane (with "Show all")',
          'GitHub + GitLab integration',
          'My Repos — PRs, issues, branch-from-issue',
          'Actions panel: CI runs inline',
          'Automatic daily standup',
          'Snippets + workspaces (unlimited)',
          'MCP panel — full read/write',
        ],
      },
    ],
  },
  {
    id: 'team',
    name: 'Team',
    tagline: 'Real-time collaboration for your dev team',
    groups: [
      {
        label: 'Everything in Pro, plus',
        items: [
          'Real-time presence — see where everyone is',
          'Team Chat with reactions',
          'Team Activity feed (GitHub/GitLab events)',
          'Multi-leader roles',
          'Shared repos, snippets, workspaces, MCP',
          'Per-user local paths for shared repos',
          'HTTPS clone with OAuth for private team repos',
          'Shared team standup',
          'Join-by-code (8-char, leader-approved)',
          `Priority support (24h email) · min ${TEAM_MIN_SEATS} seats`,
        ],
      },
    ],
  },
]

function priceFor(planId: Plan, billing: 'monthly' | 'annual'): { amount: string; annualTotal?: string } {
  if (planId === 'free' || planId === 'enterprise') return { amount: '$0' }
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

  const handleContactSales = () => {
    const subject = encodeURIComponent('Nest by RAVEN — Enterprise inquiry')
    const body = encodeURIComponent(
      `Hi RAVEN team,\n\nI'd like to talk about Enterprise pricing for Nest.\n\nTeam size: \nUse case: \nCompliance needs (SSO/audit/on-prem): \n\nThanks.`,
    )
    window.electronShell.openExternal(`mailto:${ENTERPRISE_CONTACT_EMAIL}?subject=${subject}&body=${body}`)
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

        <div className="upgrade-enterprise-banner">
          <div className="upgrade-enterprise-banner-text">
            <div className="upgrade-enterprise-banner-title">
              Enterprise — from ${ENTERPRISE_FLOOR_PER_SEAT}/seat/mo · min {ENTERPRISE_MIN_SEATS} seats
            </div>
            <div className="upgrade-enterprise-banner-subtitle">
              SSO · audit logs · SCIM · on-prem option · custom integrations · dedicated support · SLA. Need a feature we don't ship yet? We build it.
            </div>
          </div>
          <button
            className="upgrade-enterprise-banner-cta"
            onClick={handleContactSales}
          >
            Contact sales →
          </button>
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
