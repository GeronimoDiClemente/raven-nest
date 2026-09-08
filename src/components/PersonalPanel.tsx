import { useTeam } from '../hooks/useTeam'
import { useUserRepos } from '../hooks/useUserRepos'

interface Props {
  plan?: 'free' | 'pro' | 'team' | 'enterprise'
  onTeamsOpen?: () => void
  onReposOpen?: () => void
}

const MAX_MEMBERS = 6

// A member's display name: their GitHub login if the profile trigger filled it
// in, otherwise the local part of the email (the full address is too wide for
// a 200px sidebar and the domain is the same for everyone anyway).
function memberName(email: string, githubLogin: string | null): string {
  return githubLogin ?? email.split('@')[0]
}

/**
 * The Personal tab. It used to be two rows that opened the Team and Repos
 * panels; now it shows what is inside them, and clicking still opens the full
 * panel. Teams only appear when the user actually belongs to one — a solo user
 * gets the repos list alone.
 */
export default function PersonalPanel({ plan, onTeamsOpen, onReposOpen }: Props) {
  const { teams, activeTeam, members, pendingInvites } = useTeam()
  const { repos } = useUserRepos()

  const hasTeam = teams.length > 0
  const shown = members.slice(0, MAX_MEMBERS)
  const hidden = members.length - shown.length

  return (
    <div className="personal-panel">
      {hasTeam && (
        <>
          <div className="wt-section-header">
            <span>TEAM</span>
            {activeTeam && <span className="personal-section-name">{activeTeam.name}</span>}
          </div>

          {pendingInvites.length > 0 && (
            <button className="personal-row personal-invites" onClick={onTeamsOpen}>
              {pendingInvites.length} pending invite{pendingInvites.length === 1 ? '' : 's'}
            </button>
          )}

          {shown.map(m => (
            <button key={m.id} className="personal-row" onClick={onTeamsOpen} title={m.email}>
              <span className="personal-avatar">{memberName(m.email, m.github_login).charAt(0).toUpperCase()}</span>
              <span className="personal-name">{memberName(m.email, m.github_login)}</span>
              {m.role === 'leader' && <span className="personal-tag">leader</span>}
              {m.status === 'pending' && <span className="personal-tag">invited</span>}
            </button>
          ))}

          {hidden > 0 && (
            <button className="personal-row personal-more" onClick={onTeamsOpen}>+{hidden} more</button>
          )}
        </>
      )}

      <div className="wt-section-header">
        <span>REPOS</span>
        {plan === 'free' && <span className="sidebar-plan-badge">Pro</span>}
      </div>

      {repos.length === 0 ? (
        <button className="personal-row personal-empty" onClick={onReposOpen}>
          {plan === 'free' ? 'Upgrade to track your repos' : 'Add a repo'}
        </button>
      ) : (
        repos.map(r => (
          <button key={r.id} className="personal-row" onClick={onReposOpen} title={r.repo_full_name}>
            <span className="personal-name">{r.repo_full_name}</span>
            {r.local_path && <span className="personal-tag">local</span>}
          </button>
        ))
      )}
    </div>
  )
}
