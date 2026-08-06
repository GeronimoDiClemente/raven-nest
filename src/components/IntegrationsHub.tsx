import { useBoardRows } from '../hooks/useBoardRows'
import { OrchestrationBoard } from './OrchestrationBoard'

interface IntegrationsHubProps {
  onClose: () => void
}

/** Full-screen overlay for the orchestration board — mirrors the
 *  teams-workspace shell used by TeamsWorkspace/MyReposPanel. */
export function IntegrationsHub({ onClose }: IntegrationsHubProps) {
  const { rows } = useBoardRows()

  return (
    <div className="teams-workspace">
      {/* Header */}
      <div className="teams-workspace-header">
        <button className="tw-back-btn" onClick={onClose}>
          <svg width="13" height="13" viewBox="0 0 13 13" fill="none" style={{ display: 'inline-block', verticalAlign: 'middle', marginRight: 5 }}>
            <path d="M8 2L4 6.5L8 11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          Back
        </button>

        <div className="tw-header-center">
          <svg width="15" height="15" viewBox="0 0 16 16" fill="none" style={{ color: 'var(--raven-blue)', flexShrink: 0 }}>
            <rect x="2" y="2" width="12" height="12" rx="3.5" stroke="currentColor" strokeWidth="1.4" />
            <path d="M5.5 8h5M8 5.5v5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
          </svg>
          <span className="tw-header-title">Integrations</span>
        </div>

        <div className="tw-header-right" />
      </div>

      {/* Body */}
      <div className="teams-workspace-body">
        <div className="teams-workspace-content">
          <OrchestrationBoard rows={rows} />
        </div>
      </div>
    </div>
  )
}
