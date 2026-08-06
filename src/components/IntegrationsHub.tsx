import { useState } from 'react'
import { useBoardRows } from '../hooks/useBoardRows'
import { OrchestrationBoard } from './OrchestrationBoard'
import { IntegrationsRail } from './IntegrationsRail'
import { WorktreePicker } from './WorktreePicker'
import { RecipesView } from './RecipesView'
import { AutomationsView } from './AutomationsView'
import { ConnectionsView } from './ConnectionsView'
import type { BoardRow } from '../integrations/board'

interface IntegrationsHubProps {
  onClose: () => void
}

type HubTab = 'hub' | 'connections' | 'recipes' | 'automations'

/** Full-screen overlay for the orchestration board — mirrors the
 *  teams-workspace shell used by TeamsWorkspace/MyReposPanel. */
export function IntegrationsHub({ onClose }: IntegrationsHubProps) {
  const { rows, refresh } = useBoardRows()
  const [scope, setScope] = useState<'all' | 'personal' | string>('all')
  const [picked, setPicked] = useState<BoardRow | null>(null)
  const [tab, setTab] = useState<HubTab>('hub')

  const orgs = [...new Set(rows.filter((r) => r.scope.kind === 'org').map((r) => (r.scope.kind === 'org' ? r.scope.org : '')))]
  const hasPersonal = rows.some((r) => r.scope.kind === 'personal')
  const showFilter = orgs.length + (hasPersonal ? 1 : 0) >= 2

  const visibleRows = scope === 'all'
    ? rows
    : rows.filter((r) => (scope === 'personal' ? r.scope.kind === 'personal' : r.scope.kind === 'org' && r.scope.org === scope))

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
          <div className="ih-tabs">
            <button className={tab === 'hub' ? 'active' : ''} onClick={() => setTab('hub')}>Hub</button>
            <button className={tab === 'connections' ? 'active' : ''} onClick={() => setTab('connections')}>Connections</button>
            <button className={tab === 'recipes' ? 'active' : ''} onClick={() => setTab('recipes')}>Recipes</button>
            <button className={tab === 'automations' ? 'active' : ''} onClick={() => setTab('automations')}>Automations</button>
          </div>
        </div>

        <div className="tw-header-right" />
      </div>

      {/* Body */}
      <div className="teams-workspace-body">
        <div className="teams-workspace-content">
          {tab === 'hub' && (
            <div className="ih-layout">
              <div className="ih-main">
                {showFilter && (
                  <div className="ih-filter">
                    <button className={scope === 'all' ? 'active' : ''} onClick={() => setScope('all')}>All</button>
                    {orgs.map((org) => (
                      <button key={org} className={scope === org ? 'active' : ''} onClick={() => setScope(org)}>{org}</button>
                    ))}
                    <button className={scope === 'personal' ? 'active' : ''} onClick={() => setScope('personal')}>Personal</button>
                  </div>
                )}
                <OrchestrationBoard rows={visibleRows} onOpen={setPicked} onConnect={() => setTab('connections')} />
              </div>
              <div className="ih-rail">
                <IntegrationsRail rows={visibleRows} onOpenRow={setPicked} />
              </div>
            </div>
          )}
          {tab === 'connections' && <ConnectionsView />}
          {tab === 'recipes' && <RecipesView />}
          {tab === 'automations' && <AutomationsView />}
        </div>
      </div>

      {picked && <WorktreePicker row={picked} onClose={() => setPicked(null)} onCreated={refresh} />}
    </div>
  )
}
