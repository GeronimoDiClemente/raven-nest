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
 * entirely for plans without teams — there is nothing to switch to and nothing
 * to create.
 *
 * On a plan that does have teams but with none joined yet, the chips are still
 * pointless (a lone "Personal" chip controls nothing) but the door to the team
 * workspace is not: its "Welcome to Teams" empty state is where you create your
 * first team or join one by code, and this is the only way in since the sidebar
 * lost its Team door.
 */
export default function ScopeSelector({
  scope, teams, allowTeam, onScopeChange, onOpenTeamWorkspace,
}: ScopeSelectorProps) {
  if (!allowTeam) return null

  if (teams.length === 0) {
    return (
      <div className="scope-selector">
        <button type="button" className="scope-open-team" onClick={onOpenTeamWorkspace}>
          Create or join a team
        </button>
      </div>
    )
  }

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
