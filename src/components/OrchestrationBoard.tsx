import type { BoardRow } from '../integrations/board'
import { BUILTIN_CATALOG } from '../lib/plugins/builtinCatalog'
import { IntegrationLogo } from './IntegrationLogos'

interface Props {
  rows: BoardRow[]
  onOpen?: (row: BoardRow) => void
  onConnect?: () => void
}

const STATUS_LABEL = {
  needs_you: 'Needs You',
  working: 'Working',
  done: 'Done',
  todo: 'To do',
} as const

export function OrchestrationBoard({ rows, onOpen, onConnect }: Props) {
  if (rows.length === 0) {
    return (
      <div className="ob-empty">
        <p className="ob-empty-title">No tasks yet</p>
        <p className="ob-empty-sub">Connect a source (GitHub, Jira, Linear…) to see your work here.</p>
        {onConnect && (
          <button className="ob-connect-btn" onClick={onConnect}>Connect a source →</button>
        )}
      </div>
    )
  }

  return (
    <div className="ob-list">
      {rows.map((row) => {
        const cat = BUILTIN_CATALOG.find((c) => c.id === row.pluginId)
        return (
          <div
            key={row.key}
            className="ob-row"
            role="button"
            tabIndex={0}
            onClick={() => onOpen?.(row)}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen?.(row) } }}
          >
            <span className={`ob-dot ob-dot-${row.status}`} />
            <span className="ob-status">{STATUS_LABEL[row.status]}</span>
            <span className="ob-key">{row.key}</span>
            <span className="ob-title">{row.title}</span>
            <span className="ob-spacer" />
            {row.branch && <span className="ob-branch">{row.branch}</span>}
            {row.scope.kind === 'org' && <span className="ob-scope">{row.scope.org}</span>}
            <span className="ob-src" style={{ background: cat?.color }}>
              <IntegrationLogo id={row.pluginId} size={16} />
            </span>
            <span className="ob-src-name">{cat?.name}</span>
          </div>
        )
      })}
    </div>
  )
}
