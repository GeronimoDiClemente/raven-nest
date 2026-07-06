/**
 * Pitch de integraciones a medida para equipos (Team · Enterprise), embebido
 * dentro de `TeamsWorkspace` (sección "Integrations"). Extraído del tab
 * "Team · Enterprise" que antes vivía dentro de IntegrationsMarketplaceView
 * — ese marketplace ahora es exclusivamente personal (ver MyReposPanel).
 */
export function TeamIntegrationsView() {
  return (
    <div className="integrations-embedded">
      <div className="integrations-body">
        <div className="integrations-team" aria-label="Team Enterprise">
          <h3 className="integrations-team-title">Custom integrations for your team</h3>
          <ul className="integrations-team-list">
            <li>Centralized Slack alerts for the team</li>
            <li>Bidirectional Jira ↔ worktree sync</li>
            <li>Your internal tool — whatever you need</li>
          </ul>
          <p className="integrations-team-sub">We build them to spec.</p>
          <button className="integration-btn primary" onClick={() => window.electronShell.openExternal('https://cal.com/raven/enterprise')}>
            Contact Enterprise
          </button>
        </div>
      </div>
    </div>
  )
}
