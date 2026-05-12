# Team Join by Code — Design Spec

**Date:** 2026-05-04
**Status:** Approved (brainstorming complete, pending implementation plan)
**Branch:** `feat/team-pendings`

## Goal

Let users join an existing team via a shared code, with leader approval. Redesign the empty state of `TeamsWorkspace` so a user without any team can either **Join** (by invite or code) or **Create**, and let users with an active team join additional teams via code without leaving the current one.

## Decisions taken (from brainstorming)

| # | Decision | Choice |
|---|----------|--------|
| 1 | Two-factor for code | Code + leader approval (no TOTP / email split) |
| 2 | Code lifecycle | One permanent code per team, regenerable by leader (rotates → invalidates old) |
| 3 | Who sees / regenerates the code | Any active member sees it, only leaders regenerate |
| 4 | Where Join/Create tabs live | Empty-state tabs **and** "Join with code" entry in the active-team switcher dropdown (always accessible) |
| 5 | Leader sees join requests | Mixed in the Members tab (third state alongside `pending`) labeled "Wants to join" |
| 6 | What user sees after pasting valid code | Team name only (no member count). Confirms then submits request. |
| 7 | After leader declines | Neutral message "Request declined", user can retry, can cancel their own request before leader responds. No cooldown for v1. |

## Schema changes (migration 018)

### New table: `team_join_codes`

```sql
CREATE TABLE team_join_codes (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id     uuid NOT NULL REFERENCES teams ON DELETE CASCADE,
  code        text NOT NULL UNIQUE,
  created_by  uuid NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  revoked_at  timestamptz
);

-- Only one active code per team
CREATE UNIQUE INDEX team_join_codes_one_active_per_team
  ON team_join_codes (team_id) WHERE revoked_at IS NULL;
```

**Code format:** 8 chars from the alphabet `ABCDEFGHJKLMNPQRSTUVWXYZ23456789` (no `0/O/1/I/l`). Server-generated.

**RLS on `team_join_codes`:**
- SELECT: any active member of the team or owner
- INSERT/UPDATE: only owner / leader (enforced via RPCs, not direct DML)
- No DELETE (rotation = set `revoked_at`, never delete)

### `team_members` — reused, no schema change

New value for `status`:
- `pending` — invited by leader (existing)
- `requested` — user requested to join via code (NEW)
- `active` — accepted (existing)

Existing `unique(team_id, email)` constraint already prevents duplicate rows per team-email combo.

`invited_by` for join-by-code rows: set to the team owner's user_id (since the column is NOT NULL and can't be the requester themselves without breaking the leader-only invite policy semantics).

### New RLS policies on `team_members`

Extend existing policies to cover the `requested` flow:

- **SELECT** (existing already covers it via `email = auth.users.email` for the user's own rows, and leaders via `team_id IN (... owner_id = auth.uid())`)
- **INSERT** new policy "User can request to join via code" — allows a user to insert a row with their own email + status='requested' only if a matching active code exists. In practice this is enforced by the `request_team_join` RPC (`SECURITY DEFINER`), so the row-level INSERT policy stays restrictive.
- **DELETE** new policy "User can cancel their own request" — allows DELETE where `email = auth.users.email AND status = 'requested'`.

### RPC `generate_team_join_code(p_team_id uuid)`

`SECURITY DEFINER`. Caller must be active leader of the team. Revokes any active code for the team (sets `revoked_at = now()`), generates a new 8-char code, inserts row, returns the code. Used both for first generation and rotation.

### RPC `request_team_join(p_code text)`

`SECURITY DEFINER`. Steps:
1. Resolve `p_code` → active `team_id` (where `revoked_at IS NULL`). If not found, raise "Invalid or expired code".
2. Check the user is not already an active member of the team (`unique(team_id, email)` will block but raise nicer error).
3. Check no existing pending invite for the same email/team (raise "You already have a pending invite to that team").
4. Check no existing requested row (raise "You already requested to join that team").
5. Insert `team_members` row with `email = auth.user.email, status='requested', invited_by = team.owner_id, user_id = auth.uid()`.
6. Return `{ team_id, team_name }`.

### RPC `approve_join_request(p_member_id uuid)` and `decline_join_request(p_member_id uuid)`

`SECURITY DEFINER`. Caller must be active leader of the team. Approve sets `status='active', accepted_at=now()`. Decline does `DELETE` so the requester can retry later.

## UI changes

### `TeamsWorkspace.tsx` — empty state (`teams.length === 0`)

Replace the current branching (cards-vs-create-form) with a single layout containing tabs:

```
┌─────────────────────────────────────────┐
│  [ Join ]   Create                      │  ← tab switcher
│ ────────                                 │
│                                          │
│  Pega un código de invitación:          │
│  ┌─────────────────┐  [Verify]          │
│  │ XXXXXXXX        │                    │
│  └─────────────────┘                    │
│                                          │
│  ─── O esperá un invite ───             │
│                                          │
│  [pendingInvites cards: Accept/Decline] │
│                                          │
│  [your pending request, if any]:        │
│  ┌──────────────────────────┐           │
│  │ Request to STI-PROJECTS  │           │
│  │ Waiting for approval     │ [Cancel]  │
│  └──────────────────────────┘           │
└─────────────────────────────────────────┘
```

Tab `Create` = current "Create your team" form unchanged.

### `TeamsWorkspace.tsx` — switcher dropdown (with active team)

Add a `🔑 Join with code` entry between the existing `Pending invites` row and `＋ New team`:

```
✓ STI-PROJECTS
  Other Team
─────────────────
✉ Pending invites · 2
🔑 Join with code            ← NEW
─────────────────
＋ New team
```

`Join with code` opens a modal containing the same Verify-then-Confirm flow.

### `TeamsWorkspace.tsx` — Members tab (leader view)

**New section at top:** team join code panel (visible to all active members, regenerable only by leaders).

```
┌────────────────────────────────────────────┐
│ 🔑 Team join code: AB7K3M9X  [📋] [↻]      │
│ Anyone with this code can request to join. │
└────────────────────────────────────────────┘
```

**Member list rows:** add a third status label and per-row actions for `requested` rows:
- `Leader` / `Member` (active) — as today
- `Invite Pending` (status=pending) — as today
- **`Wants to join` + [Approve] [Decline]** (status=requested) — NEW

### New components

- `JoinByCodeForm.tsx` — input + verify-then-confirm flow. Used in both empty-state tab and switcher modal.
- `TeamJoinCodePanel.tsx` — leader-visible code display + copy + regenerate button.
- `MyJoinRequests.tsx` (or inlined into JoinByCodeForm) — shows the user's own pending requests with Cancel.

### Hooks

- `useTeamJoinCode(teamId)` — fetches and exposes the active code, exposes `regenerate()`.
- Extend `useTeam` to expose `myPendingRequests` (rows where `email = me, status = 'requested'`) and `requestJoin(code)`, `cancelRequest(memberId)`, `approveRequest(memberId)`, `declineRequest(memberId)`.

## Flows

1. **Leader generates code**
   - Members tab → if no active code, panel shows `[Generate code]` → calls `generate_team_join_code` → displays code.
   - Otherwise shows code + `[Copy]` + `[Regenerate]` (regenerate confirms before rotating).

2. **User joins by code**
   - No active team → tab `Join` → paste code → `[Verify]` calls `request_team_join` (we don't add a separate verify-only endpoint — `request_team_join` itself surfaces errors before inserting).
   - On success: row inserted with status='requested'. UI shows `Request to <team>: Waiting for approval [Cancel]`.

3. **Leader approves / declines**
   - Members tab → `Wants to join` row → `[Approve]` calls `approve_join_request` → row becomes active.
   - `[Decline]` calls `decline_join_request` → row deleted. Requester sees neutral "Request declined" the next time their UI refreshes (or live via Realtime in a follow-up).

4. **User cancels own request**
   - Empty-state tab `Join` or modal → click `[Cancel]` next to their pending request → DELETE row via `cancelRequest`.

## Edge cases

- Pasting a code for a team you're already an active member of → "You're already a member of that team".
- Pasting a code while you have a pending invite (email-based) to the same team → "You already have a pending invite to that team. Accept it from Pending invites."
- Pasting a code while you have a pending request to the same team → "You already requested to join that team."
- Code rotated mid-flow: pending requests created with the old code are NOT invalidated — they're already rows in `team_members`, the code only mediated their creation.
- Code not found / revoked → "Invalid or expired code".
- Leader leaves / is demoted while a request is pending → request stays; any current leader can approve it.
- Leader deletes the team while requests are pending → ON DELETE CASCADE on `team_members` removes them.

## Out of scope (v1)

- Code expiration (always permanent until rotated)
- Multiple codes per team
- Push notifications to leader on new request
- Email to user on approve / decline
- Cooldown / rate-limiting after decline (mitigated by `unique(team_id, email)` for now)
- Realtime-driven UI refresh of pending requests (will refresh on tab switch / manual refresh)

## Files affected

**New:**
- `supabase/migrations/018_team_join_codes.sql`
- `src/components/JoinByCodeForm.tsx`
- `src/components/TeamJoinCodePanel.tsx`
- `src/hooks/useTeamJoinCode.ts`

**Modified:**
- `src/components/TeamsWorkspace.tsx` (empty state, switcher dropdown, Members tab)
- `src/hooks/useTeam.ts` (add `myPendingRequests`, `requestJoin`, `cancelRequest`, `approveRequest`, `declineRequest`)

## Open questions for implementation plan

- Where exactly to place the verify-vs-submit step in `JoinByCodeForm`: single button (request directly + show team in success toast) vs two buttons (verify shows confirm card, then submit)?
- Whether to use Supabase Realtime to auto-update the leader's view when a new request comes in, or rely on tab-switch refresh.
- Styling: reuse existing `team-pending-banner` / `team-invite-card` classes, or add `team-join-code-panel` etc.
