# Sprint 3 — Teams RLS fixes

Four migration drafts addressing audit findings B12–B15. Apply in numeric order via the Supabase SQL editor.

## Apply order

1. `20260511010000_team_members_leader_delete.sql` — **B12**: leaders can DELETE members; users can leave their own team.
2. `20260511020000_teams_leader_delete.sql` — **B13**: no-op (decision: team deletion stays owner-only; the UI must hide the button for non-owners).
3. `20260511030000_team_chat_messages_no_spoof.sql` — **B14**: BEFORE INSERT trigger overwrites `user_email` / `github_login` from server-trusted sources, blocking client spoofing.
4. `20260511040000_chat_events_insert_function.sql` — **B15**: SECURITY DEFINER RPC `insert_team_chat_events(team_repo_id, events jsonb)` lets authenticated team members record events server-side without re-opening the INSERT policy migration 014 removed.

## Companion changes required outside SQL

- **B13** — `TeamsWorkspace.tsx`: only render the "Delete team" button when `team.owner_id === currentUserId`. Without this, non-owner leaders still see the button and get a silent failure.
- **B15** — Renderer poller: replace `supabase.from('team_chat_events').upsert(...)` with `supabase.rpc('insert_team_chat_events', { p_team_repo_id, p_events })`. Long-term, move polling to an Edge Function and drop this RPC.

## Schema assumptions (verify before applying)

- `profiles.github_login TEXT` exists (added in `004_github_integration.sql`).
- `team_chat_messages` columns (`user_id`, `user_email`, `github_login`) match `008_team_chat.sql`.
- `team_chat_events` columns (`team_id`, `github_event_id`, `event_type`, `actor_login`, `actor_avatar_url`, `repo_full_name`, `payload`, `event_created_at`) and the `UNIQUE (team_id, github_event_id)` constraint match `008_team_chat.sql`.
- `team_repos.team_id` is the FK used by migration 4 to resolve the owning team.
