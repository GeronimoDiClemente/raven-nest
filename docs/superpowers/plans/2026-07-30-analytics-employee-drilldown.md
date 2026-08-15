# Analytics per-employee (coaching drill-down) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** From Teams → Stats, a leader clicks a team member and sees a coaching drill-down: their trend (this period vs last), current WIP + stuck signals, recently merged PRs, and top areas touched.

**Architecture:** Reuse the per-dev data `useTeamStats` already computes; extend the team fetch to also pull OPEN PRs (for WIP + attention signals) and per-dev previous-period totals (for trend). Add ONE lazy per-employee GraphQL fetch (search by author, PR `files` nested) for "top areas touched". New pure functions do all aggregation (TDD'd); two new components render the list and the drawer. All UI copy in English; styling reuses Nest's `--raven-blue`/`ts-*` tokens and the `.confirm-overlay` drawer pattern.

**Tech Stack:** React + TypeScript, GitHub GraphQL API, Vitest. Spec: `docs/superpowers/specs/2026-07-30-analytics-employee-drilldown-design.md`.

**Conventions:** run tests with `npx vitest run <path>`; typecheck with `npx tsc -b --noEmit` (must stay at the 19-error baseline in `.claude/tsc-baseline.json` — 0 new). Commit messages end with the repo's Co-Authored-By trailer.

---

## File Structure

- Create `src/lib/employee-analytics.ts` — pure aggregation: `trendVsPrev`, `topAreasFromFiles`, `perLoginPrev`, `openPrSignal`, `attentionFor`.
- Create `src/__tests__/lib/employee-analytics.test.ts` — tests for the above.
- Modify `src/hooks/useTeamStats.ts` — fetch OPEN PRs per repo; export `prevByLogin` and `openPrsByLogin`.
- Create `src/hooks/useEmployeeFiles.ts` — lazy per-employee fetch (search by author, files) → merged/top-areas.
- Create `src/components/TeamMemberList.tsx` — the roster list with trend + attention chip.
- Create `src/components/EmployeeDetailPanel.tsx` — the drill-down drawer.
- Modify `src/components/TeamStats.tsx` — render the list under the aggregate; own the selected-login state + drawer.
- Modify `src/styles/global.css` — `.tm-*` (list) and `.ed-*` (drawer) classes, reusing existing tokens.

---

## Task 1: Pure — `trendVsPrev` and `topAreasFromFiles`

**Files:**
- Create: `src/lib/employee-analytics.ts`
- Test: `src/__tests__/lib/employee-analytics.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// src/__tests__/lib/employee-analytics.test.ts
import { describe, it, expect } from 'vitest'
import { trendVsPrev, topAreasFromFiles } from '../../lib/employee-analytics'

describe('trendVsPrev', () => {
  it('returns a signed percentage delta vs the previous period', () => {
    expect(trendVsPrev(120, 100)).toBe(20)
    expect(trendVsPrev(80, 100)).toBe(-20)
  })
  it('is 0 when unchanged, and null when there is no previous baseline', () => {
    expect(trendVsPrev(50, 50)).toBe(0)
    expect(trendVsPrev(5, 0)).toBeNull() // no baseline → "new", caller renders specially
  })
})

describe('topAreasFromFiles', () => {
  it('sums additions+deletions per top-2 path segments, sorted desc', () => {
    const prs = [
      { files: [{ path: 'src/components/A.tsx', additions: 10, deletions: 5 }, { path: 'src/components/B.tsx', additions: 3, deletions: 2 }] },
      { files: [{ path: 'src/hooks/x.ts', additions: 40, deletions: 0 }] },
      { files: [{ path: 'README.md', additions: 1, deletions: 1 }] },
    ]
    expect(topAreasFromFiles(prs, 2)).toEqual([
      { dir: 'src/hooks', lines: 40 },
      { dir: 'src/components', lines: 20 },
    ])
  })
  it('is empty when no PR carries files', () => {
    expect(topAreasFromFiles([{ files: [] }], 5)).toEqual([])
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/__tests__/lib/employee-analytics.test.ts`
Expected: FAIL — `employee-analytics` module / exports not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/lib/employee-analytics.ts

/** Signed % change vs the previous period. null when there is no baseline (prev = 0). */
export function trendVsPrev(current: number, previous: number): number | null {
  if (previous === 0) return null
  return Math.round(((current - previous) / previous) * 100)
}

export interface PrFile { path: string; additions?: number | null; deletions?: number | null }
export interface FiledPr { files: PrFile[] }

/** Aggregates PR files into top directories by lines changed (additions+deletions). */
export function topAreasFromFiles(prs: FiledPr[], topN: number): Array<{ dir: string; lines: number }> {
  const byDir = new Map<string, number>()
  for (const pr of prs) {
    for (const f of pr.files) {
      const dir = f.path.split('/').slice(0, 2).join('/')
      const lines = (f.additions ?? 0) + (f.deletions ?? 0)
      byDir.set(dir, (byDir.get(dir) ?? 0) + lines)
    }
  }
  return [...byDir.entries()]
    .map(([dir, lines]) => ({ dir, lines }))
    .sort((a, b) => b.lines - a.lines)
    .slice(0, topN)
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/__tests__/lib/employee-analytics.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/employee-analytics.ts src/__tests__/lib/employee-analytics.test.ts
git commit -m "feat(analytics): trendVsPrev + topAreasFromFiles pure helpers

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Pure — `perLoginPrev` (previous-period per-dev totals)

Trend needs each dev's PREVIOUS-period commits/merged-PRs. `useTeamStats` already synthesizes `GitHubEvent[]`; this reduces them for the window `[windowDays, 2*windowDays)` per login. Mirrors the existing `windowTotals` but keyed by login.

**Files:**
- Modify: `src/lib/employee-analytics.ts`
- Test: `src/__tests__/lib/employee-analytics.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// append to src/__tests__/lib/employee-analytics.test.ts
import { perLoginPrev } from '../../lib/employee-analytics'

const ev = (login: string, type: string, daysAgo: number, payload: object = {}) => ({
  id: `${login}-${type}-${daysAgo}-${Math.random()}`,
  type,
  actor: { login, avatar_url: '' },
  repo: { name: 'o/r' },
  created_at: new Date(Date.now() - daysAgo * 86_400_000).toISOString(),
  payload,
})

describe('perLoginPrev', () => {
  it('totals commits and merged PRs per login for the PREVIOUS window only', () => {
    const events = [
      ev('ana', 'PushEvent', 2, { commits: [{ sha: 'a' }] }),            // current window → excluded
      ev('ana', 'PushEvent', 10, { commits: [{ sha: 'b' }, { sha: 'c' }] }), // prev window (7..14) → counted
      ev('ana', 'PullRequestEvent', 12, { action: 'closed', pull_request: { merged: true } }), // prev → counted
    ]
    const prev = perLoginPrev(events as never, 7)
    expect(prev.ana).toEqual({ commits: 2, prsMerged: 1 })
  })
  it('has no entry for a login with no previous activity', () => {
    const events = [ev('bob', 'PushEvent', 1, { commits: [{ sha: 'a' }] })] // current only
    expect(perLoginPrev(events as never, 7).bob).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/__tests__/lib/employee-analytics.test.ts`
Expected: FAIL — `perLoginPrev` is not a function.

- [ ] **Step 3: Write minimal implementation**

```ts
// append to src/lib/employee-analytics.ts
const DAY_MS = 24 * 60 * 60 * 1000

interface MinEvent {
  type: string
  actor: { login: string }
  created_at: string
  payload: { commits?: unknown[]; action?: string; pull_request?: { merged?: boolean } }
}

/** Per-login commits + merged PRs in the PREVIOUS window [windowDays, 2*windowDays). */
export function perLoginPrev(
  events: MinEvent[],
  windowDays: number,
): Record<string, { commits: number; prsMerged: number }> {
  const out: Record<string, { commits: number; prsMerged: number }> = {}
  const seen = new Set<string>()
  for (const e of events) {
    const ageDays = (Date.now() - new Date(e.created_at).getTime()) / DAY_MS
    if (ageDays < windowDays || ageDays >= windowDays * 2) continue
    const login = e.actor.login
    if (login.endsWith('[bot]')) continue
    const row = (out[login] ??= { commits: 0, prsMerged: 0 })
    if (e.type === 'PushEvent') row.commits += e.payload.commits?.length ?? 0
    else if (e.type === 'PullRequestEvent' && e.payload.action === 'closed' && e.payload.pull_request?.merged) row.prsMerged++
    // seen guards nothing here (ids differ); kept for parity if dedup is added later
    void seen
  }
  return out
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/__tests__/lib/employee-analytics.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/employee-analytics.ts src/__tests__/lib/employee-analytics.test.ts
git commit -m "feat(analytics): perLoginPrev previous-period per-dev totals

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Pure — `openPrSignal` + `attentionFor`

`openPrSignal` classifies one open PR (age + awaiting-review). `attentionFor` picks the list chip for a member from their trend and open PRs, honoring the "coaching not ranking" rule.

**Files:**
- Modify: `src/lib/employee-analytics.ts`
- Test: `src/__tests__/lib/employee-analytics.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// append to src/__tests__/lib/employee-analytics.test.ts
import { openPrSignal, attentionFor } from '../../lib/employee-analytics'

const daysAgoIso = (d: number) => new Date(Date.now() - d * 86_400_000).toISOString()

describe('openPrSignal', () => {
  it('flags an old PR with no review as stuck + awaitingReview', () => {
    const s = openPrSignal({ createdAt: daysAgoIso(6), reviewCount: 0 })
    expect(s).toEqual({ ageDays: 6, stuck: true, awaitingReview: true })
  })
  it('a fresh reviewed PR is neither stuck nor awaiting', () => {
    const s = openPrSignal({ createdAt: daysAgoIso(1), reviewCount: 2 })
    expect(s).toEqual({ ageDays: 1, stuck: false, awaitingReview: false })
  })
})

describe('attentionFor', () => {
  it('flags a big activity drop as "Quiet"', () => {
    const chip = attentionFor({ commits: 5, prevCommits: 40 }, [], 'viewer')
    expect(chip).toEqual({ cls: 'warn', text: 'Quiet — activity down' })
  })
  it('flags a stuck open PR', () => {
    const chip = attentionFor({ commits: 30, prevCommits: 28 }, [{ createdAt: daysAgoIso(6), reviewCount: 0 }], 'viewer')
    expect(chip).toEqual({ cls: 'warn', text: 'PR stuck 6d' })
  })
  it('returns null when nothing needs attention', () => {
    expect(attentionFor({ commits: 30, prevCommits: 28 }, [{ createdAt: daysAgoIso(1), reviewCount: 1 }], 'viewer')).toBeNull()
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/__tests__/lib/employee-analytics.test.ts`
Expected: FAIL — `openPrSignal` / `attentionFor` not functions.

- [ ] **Step 3: Write minimal implementation**

```ts
// append to src/lib/employee-analytics.ts
const STUCK_DAYS = 4          // an open PR older than this with no review is "stuck"
const QUIET_DROP = 0.6        // >=60% fewer commits than last period → "quiet"

export interface OpenPrLite { createdAt: string; reviewCount: number }
export interface OpenPrSig { ageDays: number; stuck: boolean; awaitingReview: boolean }

export function openPrSignal(pr: OpenPrLite): OpenPrSig {
  const ageDays = Math.floor((Date.now() - new Date(pr.createdAt).getTime()) / DAY_MS)
  const awaitingReview = pr.reviewCount === 0
  return { ageDays, awaitingReview, stuck: awaitingReview && ageDays >= STUCK_DAYS }
}

export interface AttentionChip { cls: 'warn' | 'review'; text: string }

/** The list chip. Coaching signals only — never a rank/score. First match wins. */
export function attentionFor(
  dev: { commits: number; prevCommits: number },
  openPrs: OpenPrLite[],
  _viewerLogin: string,
): AttentionChip | null {
  const stuck = openPrs.map(openPrSignal).filter(s => s.stuck).sort((a, b) => b.ageDays - a.ageDays)[0]
  if (stuck) return { cls: 'warn', text: `PR stuck ${stuck.ageDays}d` }
  if (dev.prevCommits > 0 && dev.commits <= dev.prevCommits * (1 - QUIET_DROP)) {
    return { cls: 'warn', text: 'Quiet — activity down' }
  }
  const awaiting = openPrs.filter(p => openPrSignal(p).awaitingReview).length
  if (awaiting > 0) return { cls: 'review', text: `${awaiting} PR${awaiting > 1 ? 's' : ''} awaiting review` }
  return null
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/__tests__/lib/employee-analytics.test.ts`
Expected: PASS (11 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/employee-analytics.ts src/__tests__/lib/employee-analytics.test.ts
git commit -m "feat(analytics): openPrSignal + attentionFor coaching chips

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Extend `useTeamStats` — fetch OPEN PRs, export `prevByLogin` + `openPrsByLogin`

The hook already fetches commits + merged PRs via GraphQL and synthesizes `GitHubEvent[]`. Add an OPEN-PRs query per repo, expose per-dev previous totals and open PRs grouped by author. Parsing is a pure function (`openPrsFromGraphQL`) so it's tested; the fetch itself is verified with real data in Task 10.

**Files:**
- Modify: `src/hooks/useTeamStats.ts`
- Test: `src/__tests__/hooks/team-stats-graphql.test.ts` (extend)

- [ ] **Step 1: Write the failing test**

```ts
// append to src/__tests__/hooks/team-stats-graphql.test.ts
import { openPrsFromGraphQL } from '../../hooks/useTeamStats'

describe('openPrsFromGraphQL', () => {
  it('maps open PR nodes to {login, repo, number, title, createdAt, reviewCount}', () => {
    const rows = openPrsFromGraphQL('acme/api', [
      { number: 7, title: 'wip: cache', createdAt: '2026-07-20T00:00:00Z',
        author: { login: 'ana', avatarUrl: 'x' }, reviews: { totalCount: 0 } },
      { number: 8, title: 'feat: x', createdAt: '2026-07-25T00:00:00Z',
        author: { login: 'bob', avatarUrl: 'y' }, reviews: { totalCount: 2 } },
    ])
    expect(rows).toEqual([
      { login: 'ana', avatarUrl: 'x', repo: 'acme/api', number: 7, title: 'wip: cache', createdAt: '2026-07-20T00:00:00Z', reviewCount: 0 },
      { login: 'bob', avatarUrl: 'y', repo: 'acme/api', number: 8, title: 'feat: x', createdAt: '2026-07-25T00:00:00Z', reviewCount: 2 },
    ])
  })
  it('skips a PR with no author (ghost)', () => {
    expect(openPrsFromGraphQL('o/r', [{ number: 1, title: 't', createdAt: 'z', author: null, reviews: { totalCount: 0 } }])).toEqual([])
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/__tests__/hooks/team-stats-graphql.test.ts`
Expected: FAIL — `openPrsFromGraphQL` not exported.

- [ ] **Step 3: Write minimal implementation**

Add the exported type + parser near `eventsFromGraphQL` in `src/hooks/useTeamStats.ts`:

```ts
export interface OpenPr {
  login: string; avatarUrl: string; repo: string
  number: number; title: string; createdAt: string; reviewCount: number
}

interface GqlOpenPr {
  number: number; title?: string | null; createdAt: string
  author?: { login?: string | null; avatarUrl?: string | null } | null
  reviews?: { totalCount: number } | null
}

export function openPrsFromGraphQL(repoName: string, nodes: GqlOpenPr[]): OpenPr[] {
  const out: OpenPr[] = []
  for (const pr of nodes) {
    const login = pr.author?.login
    if (!login) continue
    out.push({
      login, avatarUrl: pr.author?.avatarUrl ?? '', repo: repoName,
      number: pr.number, title: pr.title ?? '(no title)',
      createdAt: pr.createdAt, reviewCount: pr.reviews?.totalCount ?? 0,
    })
  }
  return out
}
```

Add the query constant next to `MERGED_PRS_QUERY`:

```ts
const OPEN_PRS_QUERY = `
query($owner:String!,$name:String!,$after:String){
  repository(owner:$owner,name:$name){
    pullRequests(states:OPEN, first:50, orderBy:{field:CREATED_AT,direction:DESC}, after:$after){
      nodes{ number title createdAt author{ login avatarUrl } reviews(first:1){ totalCount } }
      pageInfo{ hasNextPage endCursor }
    }
  }
}`
```

In the hook's `load()`, after fetching commits+merged per repo, also fetch open PRs (add a `fetchOpenPrs(owner, name)` mirroring `fetchMergedPrs`, capped at 2 pages), collect into `const openPrs: OpenPr[] = []` via `openPrsFromGraphQL(fullName, nodes)`, and store in new state `const [openPrs, setOpenPrs] = useState<OpenPr[]>([])`. Then compute and return two memoized values:

```ts
import { perLoginPrev } from '../lib/employee-analytics'
// ...inside the hook, after `events` state:
const prevByLogin = useMemo(() => perLoginPrev(events as never, windowDays), [events, windowDays])
const openPrsByLogin = useMemo(() => {
  const m: Record<string, OpenPr[]> = {}
  for (const pr of openPrs) (m[pr.login] ??= []).push(pr)
  return m
}, [openPrs])
```

Extend the hook's return object with `prevByLogin` and `openPrsByLogin` (add them to the returned literal alongside `stats/loading/error/warning`). Update the hook's return type accordingly.

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/__tests__/hooks/team-stats-graphql.test.ts`
Expected: PASS (existing + 2 new). Then `npx tsc -b --noEmit` → grep shows 0 errors in `useTeamStats.ts`.

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useTeamStats.ts src/__tests__/hooks/team-stats-graphql.test.ts
git commit -m "feat(team-stats): fetch open PRs + expose prevByLogin/openPrsByLogin

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: `useEmployeeFiles` — lazy per-employee files fetch

Only when a member is selected, fetch that author's PRs across the team repos WITH `files` nested, and reduce to top areas. Uses GraphQL `search`.

**Files:**
- Create: `src/hooks/useEmployeeFiles.ts`

- [ ] **Step 1: Write the hook** (IO boundary — verified with real data in Task 10, not unit-tested)

```ts
// src/hooks/useEmployeeFiles.ts
import { useState, useEffect } from 'react'
import { topAreasFromFiles } from '../lib/employee-analytics'

const DAY_MS = 24 * 60 * 60 * 1000
const MAX_DAYS = 60

const SEARCH_QUERY = `
query($q:String!){
  search(query:$q, type:ISSUE, first:50){
    nodes{ ... on PullRequest {
      number title state createdAt mergedAt additions deletions
      repository{ nameWithOwner }
      files(first:100){ nodes{ path additions deletions } }
    } }
  }
}`

export interface EmployeePr {
  number: number; title: string; state: 'OPEN' | 'MERGED' | 'CLOSED'
  repo: string; createdAt: string; mergedAt: string | null; additions: number; deletions: number
  files: { path: string; additions: number; deletions: number }[]
}

export function useEmployeeFiles(
  repos: Array<{ repo_full_name: string }>,
  githubToken: string | null,
  login: string | null,
) {
  const [prs, setPrs] = useState<EmployeePr[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!githubToken || !login || repos.length === 0) { setPrs([]); return }
    let alive = true
    setLoading(true); setError(null)
    const since = new Date(Date.now() - MAX_DAYS * DAY_MS).toISOString().slice(0, 10)
    const repoQ = repos.map(r => `repo:${r.repo_full_name}`).join(' ')
    const q = `author:${login} is:pr updated:>=${since} ${repoQ}`
    ;(async () => {
      try {
        const res = await fetch('https://api.github.com/graphql', {
          method: 'POST',
          headers: { Authorization: `Bearer ${githubToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ query: SEARCH_QUERY, variables: { q } }),
        })
        if (!res.ok) throw new Error(`GraphQL HTTP ${res.status}`)
        const json = (await res.json()) as { data?: { search?: { nodes?: unknown[] } }; errors?: { message: string }[] }
        if (json.errors?.length) throw new Error(json.errors[0].message)
        const nodes = (json.data?.search?.nodes ?? []) as Array<Record<string, unknown>>
        const mapped: EmployeePr[] = nodes.filter(n => n && n.number != null).map(n => ({
          number: n.number as number,
          title: (n.title as string) ?? '(no title)',
          state: n.state as EmployeePr['state'],
          repo: (n.repository as { nameWithOwner: string })?.nameWithOwner ?? '',
          createdAt: n.createdAt as string,
          mergedAt: (n.mergedAt as string) ?? null,
          additions: (n.additions as number) ?? 0,
          deletions: (n.deletions as number) ?? 0,
          files: (((n.files as { nodes?: unknown[] })?.nodes ?? []) as Array<{ path: string; additions: number; deletions: number }>),
        }))
        if (alive) setPrs(mapped)
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : 'Failed to load')
      } finally {
        if (alive) setLoading(false)
      }
    })()
    return () => { alive = false }
  }, [githubToken, login, repos])

  const topAreas = topAreasFromFiles(prs.map(p => ({ files: p.files })), 6)
  const mergedRecent = prs.filter(p => p.state === 'MERGED').sort((a, b) => (b.mergedAt ?? '').localeCompare(a.mergedAt ?? '')).slice(0, 5)
  return { prs, topAreas, mergedRecent, loading, error }
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc -b --noEmit`
Expected: 0 errors in `useEmployeeFiles.ts` (total stays at baseline 19).

- [ ] **Step 3: Commit**

```bash
git add src/hooks/useEmployeeFiles.ts
git commit -m "feat(analytics): useEmployeeFiles lazy per-author files fetch

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: `TeamMemberList` component

**Files:**
- Create: `src/components/TeamMemberList.tsx`

- [ ] **Step 1: Write the component**

```tsx
// src/components/TeamMemberList.tsx
import { attentionFor, trendVsPrev } from '../lib/employee-analytics'
import type { OpenPr } from '../hooks/useTeamStats'

export interface MemberRow {
  login: string | null       // null when the member hasn't linked GitHub
  name: string
  avatarUrl: string
  online: boolean
  commits: number
  prsMerged: number
  prevCommits: number
}

function initials(name: string) { return name.split(' ').map(w => w[0]).slice(0, 2).join('') }

function Trend({ delta }: { delta: number | null }) {
  if (delta === null) return <span className="tm-trend up">▲ new</span>
  if (delta === 0) return <span className="tm-trend flat">— 0%</span>
  return <span className={`tm-trend ${delta > 0 ? 'up' : 'down'}`}>{delta > 0 ? '▲' : '▼'} {Math.abs(delta)}%</span>
}

export default function TeamMemberList({
  members, openPrsByLogin, viewerLogin, onSelect,
}: {
  members: MemberRow[]
  openPrsByLogin: Record<string, OpenPr[]>
  viewerLogin: string
  onSelect: (login: string) => void
}) {
  // Coaching order: members that need attention first, then alphabetical. Never by output.
  const ranked = members.map(m => {
    const openPrs = m.login ? (openPrsByLogin[m.login] ?? []) : []
    const chip = m.login ? attentionFor({ commits: m.commits, prevCommits: m.prevCommits }, openPrs, viewerLogin) : null
    return { m, chip }
  }).sort((a, b) => (a.chip ? 0 : 1) - (b.chip ? 0 : 1) || a.m.name.localeCompare(b.m.name))

  return (
    <div className="tm-list">
      {ranked.map(({ m, chip }) => (
        <div
          key={m.login ?? m.name}
          className={`tm-row${m.login ? '' : ' tm-nolink'}`}
          onClick={() => m.login && onSelect(m.login)}
          role={m.login ? 'button' : undefined}
        >
          <div className="tm-av" style={{ background: m.login ? undefined : '#333' }}>
            {m.avatarUrl ? <img src={m.avatarUrl} alt="" /> : initials(m.name)}
            <span className="tm-dot" style={{ background: m.online ? '#22C55E' : '#555' }} />
          </div>
          <div className="tm-name">{m.name}{m.login && <span className="tm-login">@{m.login}</span>}</div>
          {m.login ? (
            <>
              <div className="tm-act"><b>{m.commits}</b> commits · <b>{m.prsMerged}</b> PRs</div>
              <Trend delta={trendVsPrev(m.commits, m.prevCommits)} />
              <div className="tm-chip-cell">{chip && <span className={`tm-chip ${chip.cls}`}>{chip.text}</span>}</div>
            </>
          ) : (
            <div className="tm-act tm-muted" style={{ gridColumn: '3 / span 3' }}>No GitHub linked</div>
          )}
        </div>
      ))}
    </div>
  )
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc -b --noEmit`
Expected: 0 errors in `TeamMemberList.tsx`.

- [ ] **Step 3: Commit**

```bash
git add src/components/TeamMemberList.tsx
git commit -m "feat(analytics): TeamMemberList roster with trend + attention chips

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: `EmployeeDetailPanel` drawer

**Files:**
- Create: `src/components/EmployeeDetailPanel.tsx`

- [ ] **Step 1: Write the component**

```tsx
// src/components/EmployeeDetailPanel.tsx
import { useEffect } from 'react'
import { useEmployeeFiles } from '../hooks/useEmployeeFiles'
import { openPrSignal, trendVsPrev } from '../lib/employee-analytics'
import type { OpenPr } from '../hooks/useTeamStats'

function sizeLabel(add: number, del: number): 'S' | 'M' | 'L' | 'XL' {
  const n = add + del
  return n <= 50 ? 'S' : n <= 200 ? 'M' : n <= 500 ? 'L' : 'XL'
}
function Delta({ cur, prev }: { cur: number; prev: number }) {
  const d = trendVsPrev(cur, prev)
  if (d === null) return <span className="ed-d up">▲ new</span>
  if (d === 0) return <span className="ed-d flat">— 0%</span>
  return <span className={`ed-d ${d > 0 ? 'up' : 'down'}`}>{d > 0 ? '▲' : '▼'} {Math.abs(d)}%</span>
}

export interface EmployeeCtx {
  login: string; name: string; avatarUrl: string; online: boolean
  commits: number; prevCommits: number; prsMerged: number; prevPrsMerged: number
  dailyCommits: number[]; openPrs: OpenPr[]
}

export default function EmployeeDetailPanel({
  emp, repos, githubToken, onClose,
}: {
  emp: EmployeeCtx
  repos: Array<{ repo_full_name: string }>
  githubToken: string | null
  onClose: () => void
}) {
  const { topAreas, mergedRecent, loading, error } = useEmployeeFiles(repos, githubToken, emp.login)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const maxArea = Math.max(1, ...topAreas.map(a => a.lines))
  const maxDay = Math.max(1, ...emp.dailyCommits)

  return (
    <>
      <div className="ed-scrim" onMouseDown={onClose} />
      <div className="ed-drawer" role="dialog" aria-label={`${emp.name} details`}>
        <div className="ed-head">
          <div className="ed-av">{emp.avatarUrl ? <img src={emp.avatarUrl} alt="" /> : emp.name.slice(0, 2)}</div>
          <div>
            <div className="ed-name">{emp.name}</div>
            <div className="ed-sub"><span className="ed-mdot" style={{ background: emp.online ? '#22C55E' : '#555' }} />{emp.online ? 'online' : 'offline'} · @{emp.login}</div>
          </div>
          <button className="ed-close" onClick={onClose} aria-label="Close">✕</button>
        </div>

        <div className="ed-sec">
          <h4>Trend — this week vs last</h4>
          <div className="ed-mini">
            <div className="ed-k"><div className="ed-v">{emp.commits}</div><div className="ed-l">commits <Delta cur={emp.commits} prev={emp.prevCommits} /></div></div>
            <div className="ed-k"><div className="ed-v">{emp.prsMerged}</div><div className="ed-l">PRs merged <Delta cur={emp.prsMerged} prev={emp.prevPrsMerged} /></div></div>
          </div>
          <div className="ed-spark">{emp.dailyCommits.map((v, i) => <i key={i} className={i === emp.dailyCommits.length - 1 ? 'today' : ''} style={{ height: `${Math.max(6, (v / maxDay) * 36)}px` }} />)}</div>
        </div>

        <div className="ed-sec">
          <h4>Working on now ({emp.openPrs.length} open PR{emp.openPrs.length === 1 ? '' : 's'})</h4>
          {emp.openPrs.length === 0 && <div className="ed-empty">No open PRs.</div>}
          {emp.openPrs.map(pr => {
            const s = openPrSignal({ createdAt: pr.createdAt, reviewCount: pr.reviewCount })
            return (
              <div className="ed-pr" key={`${pr.repo}#${pr.number}`}>
                <div className="ed-pr-t">{pr.title}</div>
                <div className="ed-pr-m">
                  <span>{pr.repo}</span>
                  <span className={`ed-flag ${s.stuck ? 'warn' : 'review'}`}>open {s.ageDays}d{s.awaitingReview ? ' · awaiting review' : ''}</span>
                </div>
              </div>
            )
          })}
        </div>

        <div className="ed-sec">
          <h4>Recently merged</h4>
          {loading && <div className="ed-empty">Loading…</div>}
          {error && <div className="ed-empty">{error}</div>}
          {!loading && !error && mergedRecent.length === 0 && <div className="ed-empty">No merged PRs in this period.</div>}
          {mergedRecent.map(pr => (
            <div className="ed-pr" key={`${pr.repo}#${pr.number}`}>
              <div className="ed-pr-t">{pr.title}</div>
              <div className="ed-pr-m">
                <span className={`ed-size s-${sizeLabel(pr.additions, pr.deletions)}`}>{sizeLabel(pr.additions, pr.deletions)}</span>
                <span>+{pr.additions}/−{pr.deletions}</span><span>{pr.repo}</span>
              </div>
            </div>
          ))}
        </div>

        <div className="ed-sec ed-last">
          <h4>Top areas touched</h4>
          {!loading && topAreas.length === 0 && <div className="ed-empty">No file data (PR-based).</div>}
          {topAreas.map(a => (
            <div className="ed-area" key={a.dir}>
              <span className="ed-area-p">{a.dir}</span>
              <span className="ed-area-track"><span className="ed-area-fill" style={{ width: `${(a.lines / maxArea) * 100}%` }} /></span>
              <span className="ed-area-n">{a.lines}</span>
            </div>
          ))}
        </div>
      </div>
    </>
  )
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc -b --noEmit`
Expected: 0 errors in `EmployeeDetailPanel.tsx`.

- [ ] **Step 3: Commit**

```bash
git add src/components/EmployeeDetailPanel.tsx
git commit -m "feat(analytics): EmployeeDetailPanel coaching drawer

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: Wire into `TeamStats.tsx`

Render the list under the aggregate and own the selected-login + drawer. `TeamStats` receives new props from `TeamsWorkspace` (members roster + viewer login) — pass them through in the next step.

**Files:**
- Modify: `src/components/TeamStats.tsx`
- Modify: `src/components/TeamsWorkspace.tsx` (pass `members`, `viewerLogin`)

- [ ] **Step 1: Extend `TeamStatsProps` and render the list + drawer**

In `TeamStats.tsx`, add to the props interface:

```ts
members: Array<{ login: string | null; name: string; avatarUrl: string; online: boolean }>
viewerLogin: string
```

Consume the new hook outputs and build member rows:

```tsx
import { useState } from 'react'
import TeamMemberList, { type MemberRow } from './TeamMemberList'
import EmployeeDetailPanel, { type EmployeeCtx } from './EmployeeDetailPanel'
// inside TeamStats(), replace the destructure of useTeamStats to also take the new fields:
const { stats, loading, error, warning, prevByLogin, openPrsByLogin } = useTeamStats(repos, githubToken, windowDays)
const [selected, setSelected] = useState<string | null>(null)

const byLogin = new Map(stats.developers.map(d => [d.login, d]))
const memberRows: MemberRow[] = members.map(m => {
  const d = m.login ? byLogin.get(m.login) : undefined
  return {
    login: m.login, name: m.name, avatarUrl: m.avatarUrl, online: m.online,
    commits: d?.commits ?? 0, prsMerged: d?.prsMerged ?? 0,
    prevCommits: (m.login && prevByLogin[m.login]?.commits) || 0,
  }
})

const selectedEmp: EmployeeCtx | null = (() => {
  if (!selected) return null
  const m = members.find(x => x.login === selected)
  const d = byLogin.get(selected)
  if (!m) return null
  const prev = prevByLogin[selected] ?? { commits: 0, prsMerged: 0 }
  return {
    login: selected, name: m.name, avatarUrl: m.avatarUrl, online: m.online,
    commits: d?.commits ?? 0, prevCommits: prev.commits,
    prsMerged: d?.prsMerged ?? 0, prevPrsMerged: prev.prsMerged,
    dailyCommits: d?.dailyCommits ?? Array(windowDays).fill(0),
    openPrs: openPrsByLogin[selected] ?? [],
  }
})()
```

Then, at the end of the returned JSX (after the chart block), add:

```tsx
      <div className="ts-section-title" style={{ marginTop: 20 }}>Team members</div>
      <TeamMemberList members={memberRows} openPrsByLogin={openPrsByLogin} viewerLogin={viewerLogin} onSelect={setSelected} />
      {selectedEmp && <EmployeeDetailPanel emp={selectedEmp} repos={repos} githubToken={githubToken} onClose={() => setSelected(null)} />}
```

- [ ] **Step 2: Pass the new props from `TeamsWorkspace.tsx`**

At the `<TeamStats … />` render (currently `repos`, `githubToken`, `presence`), add `members` and `viewerLogin`. Build `members` from the existing `members` roster + `presence` (online) + each member's `github_login` (from the member record / presence):

```tsx
<TeamStats
  repos={repos.map(r => ({ repo_full_name: r.repo_full_name }))}
  githubToken={githubToken}
  presence={presence}
  viewerLogin={githubLogin ?? ''}
  members={members.map(m => ({
    login: presence[m.user_id]?.githubLogin ?? null,
    name: m.email,
    avatarUrl: '',
    online: !!presence[m.user_id],
  }))}
/>
```

(If a `githubLogin` for the current viewer isn't already in scope, read it from the same source `presence`/`useGitHub` uses; keep it a plain string.)

- [ ] **Step 3: Typecheck + full suite**

Run: `npx tsc -b --noEmit` (0 new errors) then `npx vitest run` (all pass).

- [ ] **Step 4: Commit**

```bash
git add src/components/TeamStats.tsx src/components/TeamsWorkspace.tsx
git commit -m "feat(analytics): wire member list + drill-down into the Stats tab

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 9: Styles (`global.css`) — reuse Nest tokens

**Files:**
- Modify: `src/styles/global.css`

- [ ] **Step 1: Append the classes** (mirror the mockup; reuse `--raven-blue`, `--bg-*`, `--border`, `--text-*`; drawer mirrors `.confirm-overlay`)

```css
/* Team member list */
.tm-list{border:1px solid var(--border);border-radius:10px;overflow:hidden;background:var(--bg-surface)}
.tm-row{display:grid;grid-template-columns:30px 1.6fr 1fr 78px 150px;align-items:center;gap:12px;padding:11px 14px;border-top:1px solid var(--border);cursor:pointer}
.tm-row:first-child{border-top:0}
.tm-row:hover{background:#141414}
.tm-nolink{cursor:default;opacity:.6}
.tm-av{position:relative;width:26px;height:26px;border-radius:50%;display:grid;place-items:center;font-size:10px;font-weight:600;color:#fff;background:#2a2a2a}
.tm-av img{width:100%;height:100%;border-radius:50%;object-fit:cover}
.tm-dot{position:absolute;right:-1px;bottom:-1px;width:8px;height:8px;border-radius:50%;border:2px solid var(--bg-surface)}
.tm-name{font-weight:500}
.tm-login{color:var(--text-3);font-size:11px;margin-left:6px}
.tm-act{color:var(--text-2);font-size:12px}
.tm-act b{color:var(--text-primary);font-weight:600}
.tm-muted{color:var(--text-3)}
.tm-trend{font-size:12px}
.tm-trend.up{color:#22C55E}.tm-trend.down{color:#FF4500}.tm-trend.flat{color:var(--text-3)}
.tm-chip-cell{text-align:right}
.tm-chip{font-size:11px;padding:3px 8px;border-radius:20px;white-space:nowrap}
.tm-chip.warn{background:rgba(255,184,0,.12);color:#FFB800;border:1px solid rgba(255,184,0,.25)}
.tm-chip.review{background:rgba(0,102,255,.1);color:#4d94ff;border:1px solid rgba(0,102,255,.22)}

/* Employee drawer (mirrors .confirm-overlay behavior) */
.ed-scrim{position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:60}
.ed-drawer{position:fixed;top:0;right:0;height:100%;width:440px;max-width:92vw;background:var(--bg-elevated);border-left:1px solid var(--border);overflow-y:auto;z-index:61;animation:ed-in .18s ease}
@keyframes ed-in{from{transform:translateX(100%)}to{transform:none}}
.ed-head{display:flex;align-items:center;gap:12px;padding:16px 18px;border-bottom:1px solid var(--border);position:sticky;top:0;background:var(--bg-elevated)}
.ed-av{width:38px;height:38px;border-radius:50%;background:#2a2a2a;display:grid;place-items:center;font-size:13px;font-weight:600}
.ed-av img{width:100%;height:100%;border-radius:50%;object-fit:cover}
.ed-name{font-size:15px;font-weight:600}
.ed-sub{font-size:11px;color:var(--text-2);margin-top:2px;display:flex;align-items:center;gap:6px}
.ed-mdot{width:7px;height:7px;border-radius:50%}
.ed-close{margin-left:auto;background:none;border:0;color:var(--text-2);font-size:18px;cursor:pointer}
.ed-sec{padding:15px 18px;border-bottom:1px solid var(--border)}
.ed-last{border-bottom:0}
.ed-sec h4{margin:0 0 11px;font-size:11px;text-transform:uppercase;letter-spacing:.5px;color:var(--text-2)}
.ed-mini{display:grid;grid-template-columns:1fr 1fr;gap:10px}
.ed-k{background:var(--bg-surface);border:1px solid var(--border);border-radius:9px;padding:10px 12px}
.ed-v{font-size:20px;font-weight:600}
.ed-l{font-size:11px;color:var(--text-2);margin-top:2px;display:flex;gap:6px;align-items:center}
.ed-d.up{color:#22C55E}.ed-d.down{color:#FF4500}.ed-d.flat{color:var(--text-3)}
.ed-spark{margin-top:12px;display:flex;align-items:flex-end;gap:3px;height:36px}
.ed-spark i{flex:1;background:var(--raven-blue);opacity:.55;border-radius:2px 2px 0 0}
.ed-spark i.today{opacity:1}
.ed-pr{padding:9px 0;border-top:1px solid var(--border)}
.ed-pr:first-of-type{border-top:0}
.ed-pr-t{font-size:12.5px}
.ed-pr-m{font-size:11px;color:var(--text-3);margin-top:3px;display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.ed-flag{font-size:11px;padding:1px 7px;border-radius:20px}
.ed-flag.warn{background:rgba(255,184,0,.12);color:#FFB800}
.ed-flag.review{background:rgba(0,102,255,.1);color:#4d94ff}
.ed-size{font-size:10px;font-weight:700;padding:1px 6px;border-radius:4px}
.ed-size.s-S{background:rgba(34,197,94,.15);color:#22C55E}
.ed-size.s-M{background:rgba(0,102,255,.15);color:#4d94ff}
.ed-size.s-L{background:rgba(255,184,0,.15);color:#FFB800}
.ed-size.s-XL{background:rgba(255,69,0,.15);color:#FF4500}
.ed-area{display:grid;grid-template-columns:120px 1fr 48px;align-items:center;gap:10px;margin-bottom:8px}
.ed-area-p{font-size:12px;font-family:ui-monospace,monospace}
.ed-area-track{height:7px;background:#181818;border-radius:4px;overflow:hidden}
.ed-area-fill{height:100%;background:var(--raven-blue);border-radius:4px}
.ed-area-n{font-size:11px;color:var(--text-2);text-align:right}
.ed-empty{font-size:12px;color:var(--text-3)}
```

- [ ] **Step 2: Commit**

```bash
git add src/styles/global.css
git commit -m "style(analytics): member list + drill-down drawer, on Nest tokens

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 10: Verify end-to-end

- [ ] **Step 1: Full suite + typecheck**

Run: `npx vitest run` → all pass (existing + new employee-analytics + open-PR parse tests).
Run: `npx tsc -b --noEmit` → total error count still **19** (baseline; 0 new). Confirm none reference the new files.

- [ ] **Step 2: Real-data check of the lazy fetch** (mirrors the stats-migration verification)

Run the `useEmployeeFiles` search query via `gh` against a real repo/author and confirm `files` + `state` come back and `topAreasFromFiles` yields sensible directories:

```bash
gh api graphql -f query='query($q:String!){ search(query:$q,type:ISSUE,first:20){ nodes{ ... on PullRequest { number state additions deletions repository{nameWithOwner} files(first:100){nodes{path additions deletions}} } } } }' -F q='author:GeronimoDiClemente is:pr repo:GeronimoDiClemente/raven-nest' --jq '.data.search.nodes | length'
```

Expected: a non-zero count, nodes carry `files.nodes[].path`.

- [ ] **Step 3: Drive the app** (per the `run` skill / `nest-app-drive-capture` memory)

Rebuild (`npm run build`) and launch over a copy of userData with the real Nest **closed** (Supabase lock). Open Teams → Stats → the member list renders under the aggregate; click a member → the drawer opens with trend, WIP, merged, and top areas. Verify Esc and click-outside close it.

- [ ] **Step 4: Final commit (if any tweaks)**

```bash
git add -A
git commit -m "test(analytics): verify per-employee drill-down end-to-end

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review (author checklist — done)

- **Spec coverage:** list (§3.1) → Tasks 6/8; drawer (§3.2) → Task 7; trend → Tasks 1/2; WIP + stuck → Tasks 3/4/7; recently merged + top areas → Tasks 1/5/7; consistency §3.3 → Task 9 + component class reuse; access (leaders) → gate already in `TeamsWorkspace` render (`section==='stats' && isTeamLeader`), unchanged. ✅
- **Placeholder scan:** none — every code step is complete.
- **Type consistency:** `OpenPr` (defined Task 4) consumed in Tasks 6/7/8; `EmployeePr`/`useEmployeeFiles` (Task 5) consumed in Task 7; `MemberRow`/`EmployeeCtx` exported where consumed. ✅
- **Known limitation carried from spec:** file data is PR-based (direct-to-`main` commits excluded) — surfaced in the drawer as "No file data (PR-based)." when empty.
```
