/** Coming-soon placeholder for scheduled, time-driven agents (epic C) —
 *  contrasted with Recipes, which react to events on the bus. */
export function AutomationsView() {
  return (
    <div className="auto-soon">
      <span className="auto-soon-icon" aria-hidden="true">⏰</span>
      <h2 className="auto-soon-title">Automations</h2>
      <p className="auto-soon-lead">
        Scheduled agents — run a prompt on a schedule (nightly audits, triage, summaries). Coming soon.
      </p>
      <p className="auto-soon-note">Time-driven, unlike Recipes which are event-driven.</p>
    </div>
  )
}
