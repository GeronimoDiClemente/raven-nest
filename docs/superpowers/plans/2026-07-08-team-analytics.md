# Team Analytics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Stats" section in `TeamsWorkspace` that shows the last week's activity per developer (commits, PRs, who is online now), using data that already flows through the app.

**Architecture:** A new `useTeamStats` hook fetches the GitHub events (the same endpoint `ActivityFeed` uses) and aggregates them by `actor.login`. A `TeamStats` component renders overview cards + a developer table. `TeamsWorkspace` gets the new `'stats'` tab with minimal changes: one line in the type, one entry in `NAV_ITEMS` and a render block.

**Tech Stack:** React + TypeScript, Vitest + @testing-library/react, Playwright (Electron e2e), GitHub REST API (`/repos/:owner/:repo/events`), Supabase Realtime (existing presence).

## Global Constraints

- Strict TypeScript — no `any`
- Tests with Vitest (`import { describe, it, expect, vi } from 'vitest'`)
- Styles: inline styles or classes already existing in `global.css` for the simple new elements; add new classes at the end of the file for layout
- Do not create separate CSS files — everything in `src/styles/global.css`
- `per_page=100` in the events fetch (ActivityFeed uses 10; we need more to cover the week)
- Run tests with `npm test` (alias of `vitest run`)

---

## File structure

| File | Action | Responsibility |
|---------|--------|-----------------|
| `src/hooks/useTeamStats.ts` | Create | Fetch + aggregation of GitHub events per developer |
| `src/__tests__/hooks/useTeamStats.test.ts` | Create | Unit tests of the aggregation logic |
| `src/components/TeamStats.tsx` | Create | UI: overview cards + developer table |
| `src/__tests__/components/TeamStats.test.tsx` | Create | Component tests |
| `src/styles/global.css` | Modify | Add `.ts-*` classes at the end of the file |
| `src/components/TeamsWorkspace.tsx` | Modify | Add `'stats'` to the type, nav item and render |
| `e2e/team-stats.spec.ts` | Create | Playwright smoke test: Teams opens without crash with the new code |

---

## Setup: create the feature branch

Before any task, create the branch:

```bash
git checkout -b feat/team-stats
```

---

## Task 1: Hook `useTeamStats` — fetch and aggregation

**Files:**
- Create: `src/hooks/useTeamStats.ts`
- Create: `src/__tests__/hooks/useTeamStats.test.ts`

**Interfaces:**
- Produce: `aggregateEvents(events: GitHubEvent[]): DeveloperStats[]` (exported for testing)
- Produce: `useTeamStats(repos, githubToken): { stats: TeamStatsData; loading: boolean; error: string | null }`

---

- [ ] **Step 1: Write the aggregation test**

Create `src/__tests__/hooks/useTeamStats.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { aggregateEvents } from '../../hooks/useTeamStats'

const NOW = new Date().toISOString()
const OLD = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString() // 8 days ago

const makeEvent = (
  id: string,
  login: string,
  type: string,
  created_at: string,
  payload: object = {}
) => ({
  id,
  type,
  actor: { login, avatar_url: `https://avatars.githubusercontent.com/u/1?v=4` },
  created_at,
  payload,
})

describe('aggregateEvents', () => {
  it('counts PushEvent commits from this week', () => {
    const events = [
      makeEvent('1', 'alice', 'PushEvent', NOW, { commits: [{ sha: 'a', message: 'fix' }, { sha: 'b', message: 'feat' }] }),
    ]
    const result = aggregateEvents(events)
    expect(result).toHaveLength(1)
    expect(result[0].login).toBe('alice')
    expect(result[0].commits).toBe(2)
  })

  it('ignores events older than 7 days', () => {
    const events = [
      makeEvent('1', 'alice', 'PushEvent', OLD, { commits: [{ sha: 'a', message: 'old' }] }),
    ]
    expect(aggregateEvents(events)).toHaveLength(0)
  })

  it('counts opened and merged PRs separately', () => {
    const events = [
      makeEvent('1', 'bob', 'PullRequestEvent', NOW, { action: 'opened' }),
      makeEvent('2', 'bob', 'PullRequestEvent', NOW, { action: 'closed', pull_request: { merged: true } }),
      makeEvent('3', 'bob', 'PullRequestEvent', NOW, { action: 'closed', pull_request: { merged: false } }),
    ]
    const result = aggregateEvents(events)
    expect(result[0].prsOpened).toBe(1)
    expect(result[0].prsMerged).toBe(1)
  })

  it('counts closed issues', () => {
    const events = [
      makeEvent('1', 'carol', 'IssuesEvent', NOW, { action: 'closed' }),
      makeEvent('2', 'carol', 'IssuesEvent', NOW, { action: 'opened' }),
    ]
    const result = aggregateEvents(events)
    expect(result[0].issuesClosed).toBe(1)
  })

  it('groups multiple events from the same developer', () => {
    const events = [
      makeEvent('1', 'alice', 'PushEvent', NOW, { commits: [{ sha: 'a', message: 'x' }] }),
      makeEvent('2', 'alice', 'PushEvent', NOW, { commits: [{ sha: 'b', message: 'y' }, { sha: 'c', message: 'z' }] }),
    ]
    const result = aggregateEvents(events)
    expect(result).toHaveLength(1)
    expect(result[0].commits).toBe(3)
  })

  it('sorts by commits descending', () => {
    const events = [
      makeEvent('1', 'alice', 'PushEvent', NOW, { commits: [{ sha: 'a', message: 'x' }] }),
      makeEvent('2', 'bob', 'PushEvent', NOW, { commits: [{ sha: 'b', message: 'y' }, { sha: 'c', message: 'z' }, { sha: 'd', message: 'w' }] }),
    ]
    const result = aggregateEvents(events)
    expect(result[0].login).toBe('bob')
    expect(result[1].login).toBe('alice')
  })

  it('deduplicates events with the same id', () => {
    const events = [
      makeEvent('1', 'alice', 'PushEvent', NOW, { commits: [{ sha: 'a', message: 'x' }] }),
      makeEvent('1', 'alice', 'PushEvent', NOW, { commits: [{ sha: 'a', message: 'x' }] }),
    ]
    const result = aggregateEvents(events)
    expect(result[0].commits).toBe(1)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npm test -- useTeamStats
```

Expected result: `Error: Failed to resolve import "../../hooks/useTeamStats"`

- [ ] **Step 3: Implement `useTeamStats.ts`**

Create `src/hooks/useTeamStats.ts`:

```typescript
import { useState, useEffect, useMemo } from 'react'

export interface DeveloperStats {
  login: string
  avatarUrl: string
  commits: number
  prsOpened: number
  prsMerged: number
  issuesClosed: number
  lastEventAt: string | null
}

export interface TeamStatsData {
  developers: DeveloperStats[]
  totalCommits: number
  totalPrsMerged: number
  topDeveloper: DeveloperStats | null
}

interface GitHubEvent {
  id: string
  type: string
  actor: { login: string; avatar_url: string }
  created_at: string
  payload: {
    action?: string
    commits?: { sha: string; message: string }[]
    pull_request?: { merged?: boolean }
  }
}

const ONE_WEEK_MS = 7 * 24 * 60 * 60 * 1000

function isThisWeek(dateStr: string): boolean {
  return Date.now() - new Date(dateStr).getTime() < ONE_WEEK_MS
}

export function aggregateEvents(events: GitHubEvent[]): DeveloperStats[] {
  const map = new Map<string, DeveloperStats>()
  const seen = new Set<string>()

  for (const event of events) {
    if (seen.has(event.id)) continue
    seen.add(event.id)
    if (!isThisWeek(event.created_at)) continue

    const { login, avatar_url } = event.actor
    if (!map.has(login)) {
      map.set(login, {
        login,
        avatarUrl: avatar_url,
        commits: 0,
        prsOpened: 0,
        prsMerged: 0,
        issuesClosed: 0,
        lastEventAt: null,
      })
    }
    const dev = map.get(login)!

    if (!dev.lastEventAt || event.created_at > dev.lastEventAt) {
      dev.lastEventAt = event.created_at
    }

    if (event.type === 'PushEvent') {
      dev.commits += event.payload.commits?.length ?? 0
    } else if (event.type === 'PullRequestEvent') {
      if (event.payload.action === 'opened') dev.prsOpened++
      if (event.payload.action === 'closed' && event.payload.pull_request?.merged) dev.prsMerged++
    } else if (event.type === 'IssuesEvent' && event.payload.action === 'closed') {
      dev.issuesClosed++
    }
  }

  return Array.from(map.values()).sort((a, b) => b.commits - a.commits)
}

export function useTeamStats(
  repos: Array<{ repo_full_name: string }>,
  githubToken: string | null
): { stats: TeamStatsData; loading: boolean; error: string | null } {
  const [events, setEvents] = useState<GitHubEvent[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const repoNames = useMemo(
    () => repos.map(r => r.repo_full_name).join(','),
    [repos]
  )

  useEffect(() => {
    if (!githubToken || !repoNames) return
    const repoList = repoNames.split(',').filter(Boolean)
    let alive = true
    setLoading(true)
    setError(null)

    const load = async () => {
      try {
        const results = await Promise.allSettled(
          repoList.map(name =>
            fetch(`https://api.github.com/repos/${name}/events?per_page=100`, {
              headers: {
                Authorization: `Bearer ${githubToken}`,
                Accept: 'application/vnd.github.v3+json',
              },
            }).then(res => (res.ok ? (res.json() as Promise<GitHubEvent[]>) : ([] as GitHubEvent[])))
          )
        )
        const all: GitHubEvent[] = []
        for (const r of results) {
          if (r.status === 'fulfilled') all.push(...r.value)
        }
        if (alive) setEvents(all)
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : 'Failed to load stats')
      } finally {
        if (alive) setLoading(false)
      }
    }

    void load()
    return () => { alive = false }
  }, [repoNames, githubToken])

  const developers = useMemo(() => aggregateEvents(events), [events])
  const totalCommits = developers.reduce((s, d) => s + d.commits, 0)
  const totalPrsMerged = developers.reduce((s, d) => s + d.prsMerged, 0)
  const topDeveloper = developers[0] ?? null

  return {
    stats: { developers, totalCommits, totalPrsMerged, topDeveloper },
    loading,
    error,
  }
}
```

- [ ] **Step 4: Run the tests and verify they pass**

```bash
npm test -- useTeamStats
```

Expected result: `7 passed`

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useTeamStats.ts src/__tests__/hooks/useTeamStats.test.ts
git commit -m "feat: add useTeamStats hook with GitHub event aggregation"
```

---

## Task 2: Component `TeamStats` — UI

**Files:**
- Create: `src/components/TeamStats.tsx`
- Create: `src/__tests__/components/TeamStats.test.tsx`
- Modify: `src/styles/global.css` — add `.ts-*` classes at the end

**Interfaces:**
- Consume: `useTeamStats(repos, githubToken)` → `{ stats: TeamStatsData, loading, error }`
- Consume: `presence: Record<string, PresenceState>` (from `useTeamPresence`)
- Props:
  ```typescript
  interface TeamStatsProps {
    repos: Array<{ repo_full_name: string }>
    githubToken: string | null
    presence: Record<string, PresenceState>
  }
  ```

---

- [ ] **Step 1: Write the component test**

Create `src/__tests__/components/TeamStats.test.tsx`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import TeamStats from '../../components/TeamStats'

vi.mock('../../hooks/useTeamStats', () => ({
  useTeamStats: () => ({
    stats: {
      developers: [
        {
          login: 'alice',
          avatarUrl: 'https://avatars.githubusercontent.com/u/1?v=4',
          commits: 12,
          prsOpened: 2,
          prsMerged: 1,
          issuesClosed: 3,
          lastEventAt: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
        },
        {
          login: 'bob',
          avatarUrl: 'https://avatars.githubusercontent.com/u/2?v=4',
          commits: 4,
          prsOpened: 0,
          prsMerged: 0,
          issuesClosed: 0,
          lastEventAt: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(),
        },
      ],
      totalCommits: 16,
      totalPrsMerged: 1,
      topDeveloper: {
        login: 'alice',
        avatarUrl: 'https://avatars.githubusercontent.com/u/1?v=4',
        commits: 12,
        prsOpened: 2,
        prsMerged: 1,
        issuesClosed: 3,
        lastEventAt: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
      },
    },
    loading: false,
    error: null,
  }),
}))

const presence = {
  'user-alice': { userId: 'user-alice', displayName: 'alice@co.com', repo: 'org/repo', branch: 'main', lastSeen: new Date().toISOString() },
}

const defaultProps = {
  repos: [{ repo_full_name: 'org/repo' }],
  githubToken: 'token',
  presence,
}

describe('TeamStats', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('shows the total commit count in the overview cards', () => {
    render(<TeamStats {...defaultProps} />)
    expect(screen.getByText('16')).toBeTruthy()
  })

  it('shows the most active developer', () => {
    render(<TeamStats {...defaultProps} />)
    expect(screen.getByText('alice')).toBeTruthy()
  })

  it('shows the online developer count from presence', () => {
    render(<TeamStats {...defaultProps} />)
    expect(screen.getByText('1')).toBeTruthy()
  })

  it('shows the table with both developers', () => {
    render(<TeamStats {...defaultProps} />)
    expect(screen.getByText('alice')).toBeTruthy()
    expect(screen.getByText('bob')).toBeTruthy()
  })

  it('shows the connect-GitHub message when there is no token', () => {
    render(<TeamStats {...defaultProps} githubToken={null} />)
    expect(screen.getByText(/connect your github/i)).toBeTruthy()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npm test -- "TeamStats.test"
```

Expected result: `Error: Failed to resolve import "../../components/TeamStats"`

- [ ] **Step 3: Add CSS classes at the end of `src/styles/global.css`**

Add at the end of the file:

```css
/* ── Team Stats ──────────────────────────────────────────── */
.ts-container {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 14px;
  height: 100%;
  overflow-y: auto;
}

.ts-overview-row {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 8px;
}

.ts-card {
  background: #ffffff08;
  border: 1px solid #ffffff12;
  border-radius: 8px;
  padding: 12px 14px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.ts-card-label {
  font-size: 10px;
  color: #ffffff55;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.ts-card-value {
  font-size: 22px;
  font-weight: 600;
  color: #fff;
  line-height: 1;
}

.ts-card-sub {
  font-size: 11px;
  color: #ffffff66;
}

.ts-section-title {
  font-size: 11px;
  font-weight: 600;
  color: #ffffff55;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  margin-bottom: 6px;
}

.ts-table-wrap {
  overflow-x: auto;
}

.ts-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
}

.ts-table th {
  text-align: left;
  font-size: 10px;
  font-weight: 500;
  color: #ffffff44;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  padding: 0 8px 8px;
  white-space: nowrap;
}

.ts-table th:first-child { padding-left: 0; }

.ts-table td {
  padding: 6px 8px;
  color: #ffffffcc;
  border-top: 1px solid #ffffff08;
  vertical-align: middle;
}

.ts-table td:first-child { padding-left: 0; }

.ts-table tr:hover td { background: #ffffff05; }

.ts-dev-cell {
  display: flex;
  align-items: center;
  gap: 8px;
}

.ts-avatar {
  width: 22px;
  height: 22px;
  border-radius: 50%;
  flex-shrink: 0;
}

.ts-status-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  flex-shrink: 0;
}

.ts-status-dot.online  { background: #22c55e; }
.ts-status-dot.offline { background: #ffffff22; }

.ts-num {
  font-variant-numeric: tabular-nums;
  text-align: right;
}

.ts-muted { color: #ffffff44; }

.ts-empty {
  padding: 40px 0;
  text-align: center;
  color: #ffffff44;
  font-size: 12px;
}
```

- [ ] **Step 4: Implement `TeamStats.tsx`**

Create `src/components/TeamStats.tsx`:

```typescript
import { useTeamStats } from '../hooks/useTeamStats'
import type { PresenceState } from '../hooks/useTeamPresence'

interface TeamStatsProps {
  repos: Array<{ repo_full_name: string }>
  githubToken: string | null
  presence: Record<string, PresenceState>
}

function timeAgo(dateStr: string | null): string {
  if (!dateStr) return '—'
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h`
  return `${Math.floor(hrs / 24)}d`
}

export default function TeamStats({ repos, githubToken, presence }: TeamStatsProps) {
  const { stats, loading, error } = useTeamStats(repos, githubToken)
  const onlineCount = Object.keys(presence).length
  const onlineLogins = new Set(
    Object.values(presence).map(p => p.displayName.split('@')[0].toLowerCase())
  )

  if (!githubToken) {
    return (
      <div className="ts-container">
        <div className="ts-empty">Connect your GitHub account to see team stats</div>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="ts-container">
        <div className="ts-empty">Loading stats…</div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="ts-container">
        <div className="ts-empty">{error}</div>
      </div>
    )
  }

  const { developers, totalCommits, totalPrsMerged, topDeveloper } = stats

  return (
    <div className="ts-container">
      {/* Overview cards */}
      <div>
        <div className="ts-section-title">This week</div>
        <div className="ts-overview-row">
          <div className="ts-card">
            <span className="ts-card-label">Online now</span>
            <span className="ts-card-value">{onlineCount}</span>
            <span className="ts-card-sub">developers active</span>
          </div>
          <div className="ts-card">
            <span className="ts-card-label">Commits</span>
            <span className="ts-card-value">{totalCommits}</span>
            <span className="ts-card-sub">across all repos</span>
          </div>
          <div className="ts-card">
            <span className="ts-card-label">PRs merged</span>
            <span className="ts-card-value">{totalPrsMerged}</span>
            <span className="ts-card-sub">this week</span>
          </div>
          <div className="ts-card">
            <span className="ts-card-label">Top dev</span>
            <span className="ts-card-value" style={{ fontSize: 14, paddingTop: 4 }}>
              {topDeveloper ? `@${topDeveloper.login}` : '—'}
            </span>
            <span className="ts-card-sub">
              {topDeveloper ? `${topDeveloper.commits} commits` : 'no activity'}
            </span>
          </div>
        </div>
      </div>

      {/* Developer table */}
      <div>
        <div className="ts-section-title">Developers</div>
        {developers.length === 0 ? (
          <div className="ts-empty">No activity in the last 7 days</div>
        ) : (
          <div className="ts-table-wrap">
            <table className="ts-table">
              <thead>
                <tr>
                  <th>Developer</th>
                  <th style={{ textAlign: 'right' }}>Commits</th>
                  <th style={{ textAlign: 'right' }}>PRs</th>
                  <th style={{ textAlign: 'right' }}>Issues</th>
                  <th style={{ textAlign: 'right' }}>Last activity</th>
                </tr>
              </thead>
              <tbody>
                {developers.map(dev => {
                  const isOnline = onlineLogins.has(dev.login.toLowerCase())
                  return (
                    <tr key={dev.login}>
                      <td>
                        <div className="ts-dev-cell">
                          <span className={`ts-status-dot ${isOnline ? 'online' : 'offline'}`} />
                          <img
                            className="ts-avatar"
                            src={dev.avatarUrl}
                            alt={dev.login}
                          />
                          <span>{dev.login}</span>
                        </div>
                      </td>
                      <td className="ts-num">{dev.commits || <span className="ts-muted">—</span>}</td>
                      <td className="ts-num">{dev.prsOpened + dev.prsMerged || <span className="ts-muted">—</span>}</td>
                      <td className="ts-num">{dev.issuesClosed || <span className="ts-muted">—</span>}</td>
                      <td className="ts-num ts-muted">{timeAgo(dev.lastEventAt)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 5: Run the tests and verify they pass**

```bash
npm test -- "TeamStats.test"
```

Expected result: `5 passed`

- [ ] **Step 6: Commit**

```bash
git add src/components/TeamStats.tsx src/__tests__/components/TeamStats.test.tsx src/styles/global.css
git commit -m "feat: add TeamStats component with overview cards and developer table"
```

---

## Task 3: Integrate into `TeamsWorkspace`

**Files:**
- Modify: `src/components/TeamsWorkspace.tsx`

**Interfaces:**
- Consume: `TeamStats` (default export of `src/components/TeamStats.tsx`)
- Consume: Props already available in `TeamsWorkspace`: `repos`, `githubToken`, `presence`

---

- [ ] **Step 1: Add `'stats'` to the `WorkspaceSection` type**

In `src/components/TeamsWorkspace.tsx`, line 44, change:

```typescript
// Before:
type WorkspaceSection = 'activity' | 'chat' | 'repos' | 'issues' | 'members' | 'snippets' | 'workspaces' | 'mcp' | 'pendings'

// After:
type WorkspaceSection = 'activity' | 'chat' | 'repos' | 'issues' | 'members' | 'snippets' | 'workspaces' | 'mcp' | 'pendings' | 'stats'
```

- [ ] **Step 2: Add the `TeamStats` import**

After the line that imports `TeamJoinCodePanel` (approx. line 32), add:

```typescript
import TeamStats from './TeamStats'
```

- [ ] **Step 3: Add the Stats nav item in `NAV_ITEMS`**

Add after the `'members'` item (after approx. line 364), before the `'snippets'` item:

```typescript
{
  id: 'stats',
  label: 'Stats',
  icon: (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
      <rect x="1" y="9" width="3" height="5" rx="0.5" stroke="currentColor" strokeWidth="1.3"/>
      <rect x="6" y="5" width="3" height="9" rx="0.5" stroke="currentColor" strokeWidth="1.3"/>
      <rect x="11" y="2" width="3" height="12" rx="0.5" stroke="currentColor" strokeWidth="1.3"/>
    </svg>
  ),
},
```

- [ ] **Step 4: Add the render block for the `'stats'` section**

Find the last section block before the `</ErrorBoundary>` close (approx. line 1255, `'mcp'` section). After that block, add:

```typescript
{!creatingTeam && section === 'stats' && (
  <TeamStats
    repos={repos.map(r => ({ repo_full_name: r.repo_full_name }))}
    githubToken={githubToken}
    presence={presence}
  />
)}
```

- [ ] **Step 5: Run all the tests**

```bash
npm test
```

Expected result: all previous tests still pass + the new ones.

- [ ] **Step 6: Verify TypeScript**

```bash
npm run typecheck 2>/dev/null || npx tsc --noEmit
```

Expected result: no errors.

- [ ] **Step 7: Final commit**

```bash
git add src/components/TeamsWorkspace.tsx
git commit -m "feat: add Stats tab to TeamsWorkspace for team analytics"
```

---

## Task 4: Playwright smoke test

**Files:**
- Create: `e2e/team-stats.spec.ts`

The test launches the app with auth bypassed and verifies that TeamsWorkspace opens without crash with the new integrated code. The Stats test itself (with a real team, real GitHub token) is done by Gero on Mac/Linux with his account.

**Note:** Playwright requires the app to be built. The CI workflow already does this before running e2e. Locally: `npm run build` before `npm run test:e2e`.

---

- [ ] **Step 1: Create `e2e/team-stats.spec.ts`**

```typescript
import { test } from '@playwright/test'
import { launchHarness, teardown, expect } from './helpers/harness'

test('TeamsWorkspace opens without crash after Stats tab integration', async () => {
  const h = await launchHarness({ withRepo: false })

  // Click the Teams button in the sidebar
  await h.page.locator('.sidebar-item-team').click()

  // TeamsWorkspace mounts — either the empty state (no team) or the full workspace
  await expect(h.page.locator('.teams-workspace')).toBeVisible({ timeout: 10_000 })

  // No JS error overlay should be visible
  await expect(h.page.locator('.error-boundary-fallback')).not.toBeVisible()

  await teardown(h)
})
```

- [ ] **Step 2: Commit**

```bash
git add e2e/team-stats.spec.ts
git commit -m "test: add Playwright smoke test for Stats tab in TeamsWorkspace"
```

---

## Task 5: Create the PR

- [ ] **Step 1: Push the branch**

```bash
git push origin feat/team-stats
```

- [ ] **Step 2: Create the PR**

```bash
gh pr create \
  --title "feat: Team Stats tab — activity dashboard for team leaders" \
  --body "$(cat <<'EOF'
## What it does

Adds a new **Stats** section to `TeamsWorkspace` that shows the last week's activity metrics per developer, using data that already flows through the app (GitHub Events API + Supabase Presence). No database migrations.

## Screens

- **Overview cards:** devs online now, total commits, merged PRs, most active developer
- **Developer table:** avatar, online/offline status, commits, PRs, closed issues, last activity — sorted by commits desc

## Modified files

- `src/hooks/useTeamStats.ts` — new hook, aggregates events by `actor.login`
- `src/components/TeamStats.tsx` — new component
- `src/styles/global.css` — `.ts-*` classes at the end of the file
- `src/components/TeamsWorkspace.tsx` — +1 line in the type, +1 nav item, +1 render block
- `e2e/team-stats.spec.ts` — Playwright smoke test

## Tests

- 7 unit tests in `useTeamStats.test.ts` (aggregation logic)
- 5 unit tests in `TeamStats.test.tsx` (component render)
- 1 Playwright smoke test (Teams opens without crash)

## For the reviewer (Gero)

- [ ] Verify on Mac and Linux that the Stats tab appears correctly in Teams
- [ ] With GitHub connected and team repos, confirm the week's data loads
- [ ] Security: the fetch uses the existing OAuth token in the `useGitHub` hook, the same one `ActivityFeed` uses
- [ ] The e2e requires a prior `npm run build` (like the other specs)
EOF
)"
```

- [ ] **Step 3: Copy the PR URL and share it**
