# Team Analytics — Design Spec
**Date:** 2026-07-08  
**Context:** Meeting with an accelerator that wants to use Nest for 45 developers. They asked for per-developer activity visibility (who does the most, what they do, how much).

---

## Objective

Add a "Stats" section inside the existing `TeamsWorkspace` that shows per-developer activity metrics, using data that already flows through the app (GitHub events + Supabase Presence). No new database migrations.

---

## What gets built

### 1. Hook `useTeamStats.ts`

Aggregates GitHub events (already available via the GitHub API) per developer and combines them with presence data.

**Input:**
- `events: GitHubEvent[]` — the same ones `ActivityFeed` already uses
- `presence: Record<string, PresenceState>` — from the existing `useTeamPresence` hook
- `teamMembers: Array<{ email: string; user_id: string | null }>` — already available in TeamsWorkspace

**Output per developer:**
```ts
interface DeveloperStats {
  login: string           // GitHub username
  avatarUrl: string
  isOnline: boolean       // from presence
  currentRepo: string | null   // from presence
  currentBranch: string | null // from presence
  lastSeen: string        // from presence
  commits: number         // PushEvents this week
  prsOpened: number       // PullRequestEvent opened
  prsMerged: number       // PullRequestEvent merged
  issuesClosed: number    // IssuesEvent closed
  lastEventAt: string     // last GitHub event
}
```

**Matching logic:** GitHub events include `actor.login` and `actor.avatar_url`. They are grouped by `actor.login` directly — no attempt is made to match against teamMembers emails (which are Supabase IDs, not GitHub logins). Presence online/offline is shown as a separate panel by displayName. In Phase 2, once the GitHub login is stored in the Supabase profile, the full merge can be done.

### 2. Component `TeamStats.tsx`

**Layout:**
```
┌─────────────────────────────────────────────────────┐
│  OVERVIEW                                            │
│  [🟢 12 active now] [📦 47 commits] [⬡ 8 PRs]     │
│  [🏆 top: @maticodes]                               │
├─────────────────────────────────────────────────────┤
│  DEVELOPERS                                          │
│  Avatar  Name      Status  Repo/Branch  C   PR  Last │
│  ●       @alice    🟢      main-api/feat 12   3   2m │
│  ●       @bob      ⚫      —            4    1   3h  │
│  ...                                                 │
└─────────────────────────────────────────────────────┘
```

- Sorted by commits (descending) by default
- Columns: Avatar, login, online status, current repo+branch, week commits, PRs, last activity
- 🟢 status if currently in presence, ⚫ if not
- Shows "N/A" if the developer doesn't have GitHub connected

### 3. Integration in `TeamsWorkspace.tsx`

- Add `'stats'` to the `WorkspaceSection` type
- Add a "Stats" button to the section navigation bar (next to activity, chat, repos, etc.)
- Pass `events` (from the ActivityFeed fetch) and `presence` to the new component

---

## What does NOT get built in this iteration

- AI sessions per developer (requires instrumenting the PTY per user + a new table)
- Time in terminal (requires persistent session tracking)
- History beyond the week (requires a new DB)
- Inactivity notifications
- Exporting data to CSV

These capabilities go into a Phase 2 after the meeting if the deal closes.

---

## Files to create/modify

| File | Action |
|---------|--------|
| `src/hooks/useTeamStats.ts` | Create |
| `src/components/TeamStats.tsx` | Create |
| `src/components/TeamsWorkspace.tsx` | Modify — add the 'stats' section + nav tab |

---

## Success criteria for the demo

In the meeting we can show live:
1. The developer table with who is online now
2. Commits and PRs of the week per developer
3. Sorting by activity and seeing who is the most productive

With 45 real developers from the client, the visual impact is immediate.
