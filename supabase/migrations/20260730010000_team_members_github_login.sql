-- Denormalize github_login onto team_members.
--
-- profiles RLS only exposes your OWN github_login, so the client cannot read a
-- teammate's GitHub username to join them to their GitHub activity. Both the team
-- analytics per-employee drill-down and DailyStandup need that join. Store
-- github_login on team_members (reads are already allowed by the existing
-- team_members SELECT policy) and keep it in sync server-side via triggers, so
-- every write path is covered without any client-side write code.
--
-- Idempotent: safe to re-run.

alter table public.team_members
  add column if not exists github_login text;

-- One-time backfill from profiles. The migration runs with elevated rights, so it
-- can read every profile (bypassing the per-user RLS the client is subject to).
update public.team_members tm
set github_login = p.github_login
from public.profiles p
where tm.user_id = p.id
  and tm.github_login is distinct from p.github_login;

-- Stamp github_login from the member's profile whenever a row gains a user_id.
-- Fires on INSERT (createTeam, request_team_join insert their own user_id) and on
-- UPDATE OF user_id (accept_invite promotes a pending user_id=null row to the
-- accepting user). SECURITY DEFINER so it can read profiles regardless of caller.
--
-- SECURITY: because this runs with elevated rights it bypasses the profiles RLS
-- that restricts github_login to auth.uid() = id. Without a guard, a team owner
-- could INSERT (or UPDATE OF user_id) a row bearing an ARBITRARY user_id and have
-- this trigger stamp that victim's github_login, then read it back from their own
-- team — a cross-user deanonymization (UUID -> GitHub identity) that profiles RLS
-- is meant to prevent. Guard: only stamp when new.user_id is the caller
-- (new.user_id = auth.uid()). Every legitimate stamping path already satisfies this
-- (createTeam / request_team_join / accept_invite all set user_id to auth.uid()).
-- The `auth.uid() is null` arm keeps trusted server contexts working
-- (handle_team_invite_on_signup runs with no JWT; github_login is null there anyway
-- and gets backfilled by profiles_sync_github_login when the user connects GitHub) —
-- a regular authenticated attacker always has a non-null auth.uid(), so it grants
-- them nothing.
create or replace function public.tm_set_github_login()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.user_id is not null
     and (new.user_id = auth.uid() or auth.uid() is null) then
    select github_login into new.github_login
    from public.profiles where id = new.user_id;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_tm_set_github_login on public.team_members;
create trigger trg_tm_set_github_login
  before insert or update of user_id on public.team_members
  for each row execute function public.tm_set_github_login();

-- When a user connects or disconnects GitHub (profiles.github_login changes),
-- propagate the new value to all of their memberships.
create or replace function public.profiles_sync_github_login()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.team_members
  set github_login = new.github_login
  where user_id = new.id;
  return new;
end;
$$;

drop trigger if exists trg_profiles_sync_github_login on public.profiles;
create trigger trg_profiles_sync_github_login
  after update of github_login on public.profiles
  for each row
  when (new.github_login is distinct from old.github_login)
  execute function public.profiles_sync_github_login();

-- ── Defense in depth: constrain user_id on the invite INSERT ───────────
-- The trigger guard above already prevents stamping a foreign user's github_login,
-- but also close the door at the RLS layer so an owner can't seed a team_members
-- row with someone else's user_id at all. The prior "Team owner can invite" policy
-- (migration 020) checked only invited_by + team ownership, leaving user_id free.
-- Legitimate inserts are either the owner's own row (user_id = auth.uid(), createTeam)
-- or an email invite that starts as user_id = null and is later claimed via the
-- accept_invite RPC (SECURITY DEFINER, so unaffected by this policy). Both pass.
drop policy if exists "Team owner can invite" on public.team_members;
create policy "Team owner can invite"
  on public.team_members for insert with check (
    invited_by = auth.uid()
    and team_id in (select _user_owned_team_ids())
    and (user_id is null or user_id = auth.uid())
  );
