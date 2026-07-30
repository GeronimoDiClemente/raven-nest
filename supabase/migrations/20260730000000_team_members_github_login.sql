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
create or replace function public.tm_set_github_login()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.user_id is not null then
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
