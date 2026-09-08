import type { RepoScope } from '../hooks/useScopedRepos'
import type { Team } from '../hooks/useTeam'

interface ScopeSelectorProps {
  scope: RepoScope
  teams: Team[]
  allowTeam: boolean
  onScopeChange: (scope: RepoScope) => void
  onOpenTeamWorkspace: () => void
}

/**
 * Switches the Personal surface between your own repos and each team's. Hidden
 * entirely for plans without teams and for users who belong to none: a lone
 * "Personal" chip would be a control that controls nothing.
 */
export default function ScopeSelector({
  scope, teams, allowTeam, onScopeChange, onOpenTeamWorkspace,
}: ScopeSelectorProps) {
  if (!allowTeam || teams.length === 0) return null

  return (
    <div className="scope-selector">
      <button
        type="button"
        className={`scope-chip${scope.kind === 'personal' ? ' active' : ''}`}
        onClick={() => onScopeChange({ kind: 'personal' })}
      >
        Personal
      </button>

      {teams.map(t => (
        <button
          key={t.id}
          type="button"
          className={`scope-chip${scope.kind === 'team' && scope.teamId === t.id ? ' active' : ''}`}
          onClick={() => onScopeChange({ kind: 'team', teamId: t.id })}
        >
          {t.name}
        </button>
      ))}

      {scope.kind === 'team' && (
        <button type="button" className="scope-open-team" onClick={onOpenTeamWorkspace}>
          Open team workspace
        </button>
      )}
    </div>
  )
}
