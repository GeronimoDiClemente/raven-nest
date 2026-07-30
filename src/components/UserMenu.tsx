import { useState, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { supabase } from '../lib/supabase'
import { useUserIdentity } from '../hooks/useUserIdentity'
import type { Plan } from '../lib/stripe'

interface Props {
  plan: Plan | null
  isTrialActive: boolean
  trialDaysLeft: number
  onUpgrade: () => void
  expanded: boolean
}

const TRIAL_DAYS_TOTAL = 15

const planLabel = (plan: Plan | null, isTrialActive: boolean, trialDaysLeft: number) => {
  if (isTrialActive) return `Trial · ${trialDaysLeft}d`
  if (plan === 'enterprise') return 'Enterprise'
  if (plan === 'team') return 'Team'
  if (plan === 'pro') return 'Pro'
  return 'Free'
}

const planDotClass = (plan: Plan | null, isTrialActive: boolean) => {
  if (isTrialActive) return 'user-menu-dot--trial'
  if (plan === 'enterprise') return 'user-menu-dot--enterprise'
  if (plan === 'team') return 'user-menu-dot--team'
  if (plan === 'pro') return 'user-menu-dot--pro'
  return 'user-menu-dot--free'
}

export default function UserMenu({ plan, isTrialActive, trialDaysLeft, onUpgrade, expanded }: Props) {
  const { email, displayName, avatarUrl } = useUserIdentity()
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const [popoverPos, setPopoverPos] = useState<{ left: number; top: number } | null>(null)

  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => {
      if (triggerRef.current?.contains(e.target as Node)) return
      setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', close)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  useEffect(() => {
    if (!open || !triggerRef.current) return
    const rect = triggerRef.current.getBoundingClientRect()
    setPopoverPos({ left: rect.right + 8, top: rect.bottom - 240 })
  }, [open])

  const initial = (displayName || email || '?').charAt(0).toUpperCase()
  const showUpgrade = plan === 'free' || isTrialActive
  const trialPct = isTrialActive
    ? Math.max(0, Math.min(100, ((TRIAL_DAYS_TOTAL - trialDaysLeft) / TRIAL_DAYS_TOTAL) * 100))
    : 0

  return (
    <>
      <button
        ref={triggerRef}
        className={`user-menu-trigger${expanded ? ' expanded' : ''}`}
        onClick={() => setOpen(v => !v)}
        title={`${email ?? ''} · ${planLabel(plan, isTrialActive, trialDaysLeft)}`}
      >
        <span className="user-menu-avatar">
          {avatarUrl ? (
            <img src={avatarUrl} alt="" referrerPolicy="no-referrer" />
          ) : (
            <span className="user-menu-avatar-initial">{initial}</span>
          )}
          <span className={`user-menu-dot ${planDotClass(plan, isTrialActive)}`} />
        </span>
        {expanded && (
          <span className="user-menu-meta">
            <span className="user-menu-name">{displayName || email || 'Signed in'}</span>
            <span className="user-menu-plan">{planLabel(plan, isTrialActive, trialDaysLeft)}</span>
          </span>
        )}
      </button>

      {open && popoverPos && createPortal(
        <div
          className="user-menu-popover"
          style={{ left: popoverPos.left, top: popoverPos.top }}
          onMouseDown={e => e.stopPropagation()}
        >
          <div className="user-menu-popover-header">
            <span className="user-menu-popover-avatar">
              {avatarUrl ? (
                <img src={avatarUrl} alt="" referrerPolicy="no-referrer" />
              ) : (
                <span className="user-menu-avatar-initial">{initial}</span>
              )}
            </span>
            <div className="user-menu-popover-identity">
              {displayName && <span className="user-menu-popover-name">{displayName}</span>}
              <span className="user-menu-popover-email">{email ?? '—'}</span>
            </div>
          </div>

          <div className="user-menu-popover-section">
            <div className="user-menu-popover-row">
              <span className="user-menu-popover-label">Plan</span>
              <span className={`user-menu-popover-badge ${planDotClass(plan, isTrialActive)}`}>
                {planLabel(plan, isTrialActive, trialDaysLeft)}
              </span>
            </div>
            {isTrialActive && (
              <>
                <div className="user-menu-trial-bar">
                  <div className="user-menu-trial-bar-fill" style={{ width: `${trialPct}%` }} />
                </div>
                <p className="user-menu-trial-text">
                  {trialDaysLeft} {trialDaysLeft === 1 ? 'day' : 'days'} left of your Team trial
                </p>
              </>
            )}
          </div>

          {showUpgrade && (
            <button
              className="user-menu-upgrade-btn"
              onClick={() => { setOpen(false); onUpgrade() }}
            >
              Upgrade to {plan === 'team' || isTrialActive ? 'Team' : 'Pro'}
            </button>
          )}

          <div className="user-menu-popover-divider" />

          <button
            className="user-menu-signout-btn"
            onClick={() => { setOpen(false); supabase.auth.signOut() }}
          >
            Sign out
          </button>
        </div>,
        document.body
      )}
    </>
  )
}
