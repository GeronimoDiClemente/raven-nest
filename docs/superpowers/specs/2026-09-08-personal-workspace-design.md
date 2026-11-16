# Personal — one door for your repos, your teams and your invites

**Date:** 2026-09-08
**Status:** proposal — approved in chat, not implemented. Branch `feat/sidebar-tabs`.
**Author:** Gero (assisted design)

## Problem

The sidebar has two separate doors, `Team` and `My Repos`, sitting above the user
row. They open two full-screen surfaces that are **the same UI written twice**:

| Panel | Lines | Sections |
|---|---|---|
| `MyReposPanel` | 785 | activity · **repos** · issues · standup |
| `TeamsWorkspace` | 1485 | activity · chat · **repos** · issues · members · stats · snippets · workspaces · mcp · pendings |

Four sections are duplicated (activity, repos, issues, standup), and both files
import the exact same components to draw them: `RepoCIBadge`,
`RepoActionsAccordion`, `RepoActionsMenu`, `RepoStatusPanel`, `RepoPicker`,
`PRList`, `PRReview`, `IssueList`, `IssueDetail`, `ActivityFeed`,
`DailyStandup`, `NotificationPanel`. The only real differences are the data
source (`useUserRepos` vs `useTeamRepos`) and who is allowed to add a repo
(anyone vs the team leader).

Two consequences:

1. Every repo-list fix has to be made twice, and the two copies drift.
2. There is no single place to manage all your code vaults. Which repos you can
   reach depends on which door you walked through.

The tabbed sidebar (`feat/sidebar-tabs`) made this worse, not better: it turned
`Team`/`My Repos` into a `Personal` tab that competes for attention with
Worktrees and Explorer, and it only exists in repo mode, so Hub and repo mode
have different tab shapes.

## Solution

One door called **Personal**, holding everything that is *yours*: your repos,
the repos of each team you belong to, and your pending invites. A **scope
selector** at the top switches between `Personal` and each team. The team
workspace keeps existing for what only makes sense as a team.

### Entry point

- The `Team` and `My Repos` rows are removed. A single `Personal` row takes
  their place, fixed above the user menu in the sidebar footer, carrying the
  pending-invites badge.
- `REPO_TABS` drops to `['worktrees', 'explorer', 'tools']`, matching
  `HUB_TABS` (`['hub', 'explorer', 'tools']`). Both sidebar modes finally have
  the same shape.
- `PersonalPanel.tsx` (the tab preview added on 2026-09-07) is deleted. Its job
  was to preview what is now one click away.

### Plan gating

Gating is preserved per feature, so no plan gains or loses access:

- The **door** is gated by `planLimits.allowMyRepos` (false only on Free, which
  opens the upgrade modal, exactly like `My Repos` does today).
- The **scope selector** renders only when `planLimits.allowTeam` is true (Team,
  Enterprise) **and** the user belongs to at least one team.
- Free sees the upgrade modal. Pro sees its repos with no selector. Team and
  Enterprise see the selector.

### Which shell survives

`PersonalWorkspace` is `MyReposPanel` renamed and extended with the scope
selector, not a third component. It is the smaller and cleaner of the two
shells (785 lines against 1485) and its section set is already the subset we
want. The four duplicated sections are kept in their `MyReposPanel` form; the
`TeamsWorkspace` copies are deleted.

### Scope model

A new hook `useScopedRepos(scope)` normalises both sources into one type:

```ts
type RepoScope = { kind: 'personal' } | { kind: 'team'; teamId: string }

interface Repo {
  id: string
  fullName: string
  url: string
  provider: 'github' | 'gitlab'
  addedAt: string
  localPath: string | null
  canAdd: boolean   // true for personal; isTeamLeader for a team
}
```

Both underlying hooks already select the same columns and both cross-reference
`window.localPaths.getAll()` keyed by repo id, so the adapter is thin. Two
details it must absorb:

- `useUserRepos` refreshes on mount; `useTeamRepos` does **not** (it has no
  `useEffect`). The scoped hook refreshes on mount *and* on every scope change.
- In the team hook, local paths come back in a separate `userLocalPaths` map and
  `local_path` is always `null` (deprecated column, see CLAUDE.md v1.2). The
  adapter folds that map into `localPath` so the view never knows the difference.

`ActivityFeed` and `DailyStandup` already take `repos` and `teamMembers` as
props, so they work per scope without modification: `teamMembers` is empty in
personal scope.

### Section split

| Personal (scope-aware) | Team workspace |
|---|---|
| activity · repos · issues · standup · pendings | chat · members · stats · snippets · workspaces · mcp |

`TeamsWorkspace` loses `activity`, `repos`, `issues` and `pendings` from its
`WorkspaceSection` union and from its section router. It keeps its full-screen
shell and everything that is genuinely collaborative.

### Pending invites

`pendings` moves to Personal. Without this, a user who belongs to **no team yet**
has no way to accept an invitation once the `Team` door is gone from the sidebar.
Accepting an invite is an act of your account, not of a team you are not in.
The `Personal` row's badge reads from the same `pendingInvitesCount` that feeds
the tab badge today.

### Reaching the team workspace

When the active scope is a team, the scope selector shows an **Open team
workspace** button. `TeamsWorkspace` keeps its own `onClose` and its full-screen
overlay; it simply loses its sidebar door.

## Data flow

```
Sidebar (Personal row)
  └─ App: personalOpen  ──▶ PersonalWorkspace
                              ├─ scope selector ── useTeam() ── teams, activeTeam, members, pendingInvites
                              ├─ useScopedRepos(scope) ──┬─ useUserRepos()   (personal)
                              │                          └─ useTeamRepos(id) (team)
                              └─ sections: activity · repos · issues · standup · pendings
                                   └─ "Open team workspace" ──▶ TeamsWorkspace (chat · members · stats · …)
```

`App.tsx` collapses `teamsOpen` and `myReposOpen` into a single `personalOpen`,
and the `onTeamsOpen` / `onMyReposOpen` props on `Sidebar` become one
`onPersonalOpen`. `openRepoInNewTab` stays the single bottleneck for opening a
repo in a tab, as it is today.

## Error handling

Nothing new is invented; the existing behaviour is preserved per scope:

- A failed `select` keeps the previous list and warns, as both hooks do today.
- A missing or stale `local_path` surfaces the existing "Clone vs Link" dialog,
  which both panels already share.
- Switching scope while a fetch is in flight discards the stale result: the
  scoped hook tags each refresh with its scope and ignores responses whose scope
  is no longer active.
- Adding a repo in a team scope where `canAdd` is false is not reachable from
  the UI; the button is not rendered, matching today's `isTeamLeader` guard.

## Testing

Baseline on this branch is 877 green.

New:
- `useScopedRepos`: normalisation of both shapes, local-path folding, refresh on
  scope change, stale-response discard.
- `PersonalWorkspace`: selector hidden on Pro and on a user with no teams,
  visible on Team; `canAdd` false for a non-leader in team scope; pendings
  section reachable with zero teams.
- `Sidebar`: three tabs, `Personal` row present above the user menu, badge shows
  the pending count.

Deleted or rewritten:
- `PersonalPanel.test.tsx` (115 lines) goes with its component.
- `Sidebar-tabs.test.tsx` (154 lines) currently asserts four tabs.
- The `TeamsWorkspace` tests covering `activity`, `repos`, `issues` and
  `pendings` move to `PersonalWorkspace`.

## Out of scope

- Any visual restyle beyond what the merge requires. The typography and density
  decisions from 2026-09-07 stand: VS Code font, Nest spacing.
- Team repo permissions (`TeamRepoPermission`) keep today's semantics. Unifying
  them with personal repos is a separate question.
- The Hub sidebar keeps its current three tabs; only the footer row is added.
