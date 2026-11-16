import type { ReactNode } from 'react'

export interface WorkspaceNavButtonProps {
  icon: ReactNode
  label: string
  active: boolean
  onClick: () => void
  /**
   * workspace-shell-design §2: shown as mono, tabular-nums text at the row's
   * trailing edge. Omit (don't pass 0) when the underlying data hasn't been
   * fetched yet — a real 0 and "no data yet" both render as nothing, which is
   * the point: this component never invents a number.
   */
  count?: number
  /**
   * Status dot — `ok` (something's running), `warn` (needs attention),
   * `destructive` (something failed). No dot means nothing to look at; there
   * is deliberately no "neutral" dot color.
   */
  dotStatus?: 'ok' | 'warn' | 'destructive'
  /** Tutorial anchor (`data-tour-id="teams-nav-<id>"`, teamSections.ts) — Teams-only. */
  dataTourId?: string
}

/**
 * One row of the shared workspace nav (Personal, Teams — Memories has none).
 * Pulled out of both call sites so the count/dot layout is defined once and
 * unit-testable in isolation, per workspace-shell-design §2's "a counter
 * never renders a lying zero" rule.
 *
 * The trailing badge is `aria-hidden`: it's a visual reinforcement of state
 * that's already conveyed by which row you're looking at and what its
 * section shows, not new information the row's action depends on — so the
 * button's accessible name stays just the label, unaffected by whether a
 * count happens to be available this render.
 */
export default function WorkspaceNavButton({ icon, label, active, onClick, count, dotStatus, dataTourId }: WorkspaceNavButtonProps) {
  const hasTrailing = count !== undefined || dotStatus !== undefined
  return (
    <button
      type="button"
      data-tour-id={dataTourId}
      className={`tw-nav-btn${active ? ' active' : ''}`}
      onClick={onClick}
    >
      <span className="tw-nav-icon">{icon}</span>
      <span className="tw-nav-label">{label}</span>
      {hasTrailing && (
        <span className="tw-nav-trailing" aria-hidden="true">
          {count !== undefined && <span className="tw-nav-count">{count}</span>}
          {dotStatus && <span className={`tw-nav-dot tw-nav-dot--${dotStatus}`} />}
        </span>
      )}
    </button>
  )
}
