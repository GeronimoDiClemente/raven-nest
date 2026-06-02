// src/lib/e2eFixtures.ts
// Dev-only fixtures for the Teams preview harness. Imported ONLY from hooks behind
// isE2EPreview(). Mirrors the acme-platform data from the nestmux TeamsDemo.
import type { Team, TeamMember } from '../hooks/useTeam'
import type { TeamRepo } from '../hooks/useTeamRepos'
import type { PresenceState } from '../hooks/useTeamPresence'
import type { ChatItem } from '../hooks/useTeamChat'

export const FX_USER_ID = 'fx-user-alex'
const T0 = '2026-06-01T12:00:00.000Z'

export const FX_TEAM: Team = {
  id: 'fx-team-acme',
  name: 'acme-platform',
  owner_id: FX_USER_ID,
  created_at: T0,
}

export const FX_MEMBERS: TeamMember[] = [
  { id: 'm-alex',   team_id: FX_TEAM.id, user_id: FX_USER_ID, email: 'alex.k@acme.io',   role: 'leader', status: 'active', invited_by: FX_USER_ID, invited_at: T0, accepted_at: T0 },
  { id: 'm-sam',    team_id: FX_TEAM.id, user_id: 'u-sam',    email: 'sam.r@acme.io',    role: 'leader', status: 'active', invited_by: FX_USER_ID, invited_at: T0, accepted_at: T0 },
  { id: 'm-devon',  team_id: FX_TEAM.id, user_id: 'u-devon',  email: 'devon.p@acme.io',  role: 'member', status: 'active', invited_by: FX_USER_ID, invited_at: T0, accepted_at: T0 },
  { id: 'm-morgan', team_id: FX_TEAM.id, user_id: 'u-morgan', email: 'morgan.t@acme.io', role: 'member', status: 'active', invited_by: FX_USER_ID, invited_at: T0, accepted_at: T0 },
  { id: 'm-riley',  team_id: FX_TEAM.id, user_id: 'u-riley',  email: 'riley.b@acme.io',  role: 'member', status: 'active', invited_by: FX_USER_ID, invited_at: T0, accepted_at: T0 },
]

const repo = (n: string, provider: 'github' | 'gitlab' = 'github'): TeamRepo => ({
  id: `r-${n}`, team_id: FX_TEAM.id, repo_full_name: `acme/${n}`,
  repo_url: `https://github.com/acme/${n}`, added_by: FX_USER_ID, added_at: T0,
  local_path: null, provider,
})
export const FX_REPOS: TeamRepo[] = [
  repo('platform-api'), repo('billing-service'), repo('auth-rewrite'),
  repo('web-dashboard'), repo('payments-svc'), repo('data-pipeline'),
]

export const FX_PRESENCE: Record<string, PresenceState> = {
  [FX_USER_ID]: { userId: FX_USER_ID, displayName: 'alex.k@acme.io', repo: 'acme/platform-api', branch: 'feat/auth-rewrite', lastSeen: T0 },
  'u-sam':    { userId: 'u-sam',    displayName: 'sam.r@acme.io',    repo: 'acme/platform-api', branch: 'main',            lastSeen: T0 },
  'u-devon':  { userId: 'u-devon',  displayName: 'devon.p@acme.io',  repo: 'acme/payments-svc', branch: 'fix/cache-key',  lastSeen: T0 },
}

export interface FxFeedEvent {
  id: string; actor: string; avatar: string; action: string; detail: string | null
  badge: 'push' | 'pr' | 'issue' | 'create'; repo: string; ago: string
}
export const FX_FEED: FxFeedEvent[] = [
  { id: 'f1', actor: 'alex.k',   avatar: '', action: 'created branch "feat/auth-rewrite"', detail: null, badge: 'create', repo: 'acme/platform-api', ago: '6h' },
  { id: 'f2', actor: 'sam.r',    avatar: '', action: 'opened PR #142',                     detail: 'add rate limiter v2', badge: 'pr', repo: 'acme/platform-api', ago: '3h' },
  { id: 'f3', actor: 'devon.p',  avatar: '', action: 'created branch "fix/cache-key"',     detail: null, badge: 'create', repo: 'acme/payments-svc', ago: '1h' },
  { id: 'f4', actor: 'morgan.t', avatar: '', action: 'pushed 3 commits',                   detail: 'wire standup digest', badge: 'push', repo: 'acme/auth-rewrite', ago: '12m' },
  { id: 'f5', actor: 'riley.b',  avatar: '', action: 'opened issue #47',                   detail: 'Refresh token leaks on 401 retry', badge: 'issue', repo: 'acme/billing-service', ago: '1m' },
]

export const FX_SNIPPETS = [
  { id: 's1', owner_id: FX_USER_ID, name: 'Staff review',   content: 'Review this diff with the eye of a staff engineer.', team_id: FX_TEAM.id, created_at: T0 },
  { id: 's2', owner_id: FX_USER_ID, name: 'Write RFC',      content: 'Draft an RFC for: {{topic}}.', team_id: FX_TEAM.id, created_at: T0 },
  { id: 's3', owner_id: 'u-sam',    name: 'Release notes',  content: 'Summarize commits since last tag.', team_id: FX_TEAM.id, created_at: T0 },
]
export const FX_WORKSPACES = [
  { id: 'w1', owner_id: FX_USER_ID, name: 'auth-rewrite',     data: {}, team_id: FX_TEAM.id, created_at: T0 },
  { id: 'w2', owner_id: 'u-devon',  name: 'payments-rollout', data: {}, team_id: FX_TEAM.id, created_at: T0 },
]
export const FX_MCP = [
  { id: 'c1', owner_id: FX_USER_ID, name: 'github',   config: {}, team_id: FX_TEAM.id, created_at: T0 },
  { id: 'c2', owner_id: 'u-sam',    name: 'postgres', config: {}, team_id: FX_TEAM.id, created_at: T0 },
  { id: 'c3', owner_id: 'u-sam',    name: 'linear',   config: {}, team_id: FX_TEAM.id, created_at: T0 },
]

export const FX_CHAT: ChatItem[] = [
  { kind: 'message', id: 'cm1', created_at: T0, user_id: FX_USER_ID, user_email: 'alex.k@acme.io', github_login: 'alex.k', content: 'anyone hitting flake on auth.spec.ts after the middleware refactor?' },
  { kind: 'message', id: 'cm2', created_at: T0, user_id: 'u-sam', user_email: 'sam.r@acme.io', github_login: 'sam.r', content: 'yes - the cleanup hook is not awaiting. PR #142 patches it' },
]
