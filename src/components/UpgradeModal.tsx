import { useState } from 'react'
import logoUrl from '../assets/logo.svg'
import {
  CLOUD_MONTHLY_PRICE,
  CLOUD_ANNUAL_MONTHLY_PRICE,
  CLOUD_ANNUAL_PRICE,
  BOOK_DEMO_URL,
  TEAM_MIN_SEATS,
  tieneSuscripcionPropia,
  type BillingInterval,
  type Plan,
} from '../lib/stripe'
import { abrirCheckout, abrirPortal } from '../lib/checkout'
import { Button } from '@/components/ui/button'

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
  // `setIntervalo` y no `setInterval`: no tapar el global del navegador.
  const [interval, setIntervalo] = useState<BillingInterval>('monthly')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Spec 2b-2 §4.8: la identidad sale del JWT de la sesión (supabase-js lo manda solo) y el
  // precio lo elige la función según el intervalo. Los errores se ven en el modal.
  const cobrar = async (accion: () => ReturnType<typeof abrirCheckout>) => {
    if (loading) return
    setLoading(true)
    setError(null)
    const r = await accion()
    setLoading(false)
    if (r.ok) onClose()
    else setError(r.error)
  }
  const handleUpgrade = () => cobrar(() => abrirCheckout(interval))
  const handleManage = () => cobrar(abrirPortal)

  const handleBookDemo = () => {
    window.electronShell.openExternal(BOOK_DEMO_URL)
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="upgrade-modal" onClick={e => e.stopPropagation()}>
        <button className="upgrade-modal-close" onClick={onClose} aria-label="Close">×</button>

        <div className="upgrade-hero">
          <div className="upgrade-hero-icon">
            <img src={logoUrl} alt="Nest" width={22} height={22} />
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
            const gestiona = plan.id === 'cloud' && tieneSuscripcionPropia(currentPlan)
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
                      {plan.id === 'cloud' && (
                        <div role="group" aria-label="Billing" className="mb-2 inline-flex gap-1 rounded-lg border border-border p-0.5">
                          {(['monthly', 'annual'] as const).map((i) => (
                            <Button key={i} type="button" size="xs" variant={interval === i ? 'secondary' : 'ghost'}
                              aria-pressed={interval === i} onClick={() => setIntervalo(i)}>
                              {i === 'monthly' ? 'Monthly' : 'Annual'}
                            </Button>
                          ))}
                        </div>
                      )}
                      <span className="upgrade-plan-price">
                        {plan.id === 'cloud' ? `$${interval === 'annual' ? CLOUD_ANNUAL_MONTHLY_PRICE : CLOUD_MONTHLY_PRICE}` : '$0'}
                      </span>
                      {plan.id === 'cloud' && <span className="upgrade-plan-period">/mo</span>}
                      {plan.id === 'cloud' && interval === 'annual' && (
                        <span className="block w-full text-fs-sm text-muted-foreground">billed ${CLOUD_ANNUAL_PRICE} yearly</span>
                      )}
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
                  {gestiona ? (
                    <button className="upgrade-plan-btn" onClick={handleManage} disabled={loading}>
                      {loading ? '…' : 'Manage subscription'}
                    </button>
                  ) : isCurrent ? (
                    <span className="upgrade-plan-badge">Current plan</span>
                  ) : plan.id === 'free' ? (
                    <button className="upgrade-plan-btn ghost" disabled>Free forever</button>
                  ) : plan.id === 'team' ? (
                    <button className="upgrade-plan-btn" onClick={handleBookDemo}>Book a demo</button>
                  ) : (
                    <button
                      className={`upgrade-plan-btn${plan.popular ? ' primary' : ''}`}
                      onClick={handleUpgrade}
                      disabled={loading}
                    >
                      {loading ? '…' : `Upgrade to ${plan.name}`}
                    </button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
        {error && <p role="alert" className="m-0 mt-3 text-center text-fs-sm text-destructive">{error}</p>}
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
