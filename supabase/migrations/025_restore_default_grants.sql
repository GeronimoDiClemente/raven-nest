-- 025: Restore default API role grants for local/new environments
--
-- A clean `supabase start` running only this repo's migrations leaves every
-- table in `public` without GRANTs for anon/authenticated: the app can't even
-- SELECT `profiles`, and useProfile swallows the error silently (user sees the
-- free plan). Production works only because the default grants were applied
-- there outside of the migration history.
--
-- This restores the Supabase platform defaults so any environment built from
-- migrations alone matches production. Row access control remains 100% RLS —
-- these grants only make the tables reachable through the API roles, exactly
-- like a fresh Supabase project. Idempotent: re-granting existing grants is a
-- no-op, so this is safe to run in production.

grant usage on schema public to anon, authenticated, service_role;

grant all on all tables in schema public to anon, authenticated, service_role;
grant all on all sequences in schema public to anon, authenticated, service_role;
grant all on all routines in schema public to anon, authenticated, service_role;

-- Future objects created by migrations get the same defaults automatically.
alter default privileges in schema public
  grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public
  grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public
  grant all on routines to anon, authenticated, service_role;
