-- 20260511040000_chat_events_insert_function.sql
-- B15: Migration 014 removed the INSERT policy on team_chat_events because the
-- broad "any team member can insert anything" policy was forgeable. The
-- intended writer is a server-side GitHub poller running with service_role.
--
-- Reality: the client-side poller (still shipping in v0.7.x) was already
-- calling .upsert() on team_chat_events from the renderer. After 014 those
-- calls fail silently — the events feed went stale for some teams.
--
-- Until the poller moves to an Edge Function / server cron, expose a
-- SECURITY DEFINER RPC that:
--   (1) verifies the caller is an active member of the team that owns the
--       given team_repo, and
--   (2) inserts the events server-side, bypassing the (now absent) INSERT
--       policy without giving the client the service_role key.
--
-- The function accepts an array of event objects so the poller can batch.
-- Each object shape (keys map 1:1 to team_chat_events columns from migration 008):
--   {
--     "github_event_id":   "12345",
--     "event_type":        "PushEvent",
--     "actor_login":       "octocat",
--     "actor_avatar_url":  "https://...",      // nullable
--     "repo_full_name":    "owner/repo",
--     "payload":           { ... },
--     "event_created_at":  "2026-05-11T12:00:00Z"
--   }
--
-- ON CONFLICT (team_id, github_event_id) DO NOTHING matches the UNIQUE
-- constraint from migration 008 — re-polling the same event is a no-op.

CREATE OR REPLACE FUNCTION insert_team_chat_events(
  p_team_repo_id uuid,
  p_events       jsonb
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_team_id   uuid;
  v_is_member boolean;
  v_inserted  integer;
BEGIN
  IF p_events IS NULL OR jsonb_typeof(p_events) <> 'array' THEN
    RAISE EXCEPTION 'p_events must be a JSON array';
  END IF;

  SELECT team_id INTO v_team_id
  FROM team_repos
  WHERE id = p_team_repo_id;

  IF v_team_id IS NULL THEN
    RAISE EXCEPTION 'team_repo not found: %', p_team_repo_id;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM team_members
    WHERE team_id = v_team_id
      AND user_id = auth.uid()
      AND status = 'active'
  ) INTO v_is_member;

  IF NOT v_is_member THEN
    RAISE EXCEPTION 'not an active member of team %', v_team_id;
  END IF;

  WITH ins AS (
    INSERT INTO team_chat_events (
      team_id,
      github_event_id,
      event_type,
      actor_login,
      actor_avatar_url,
      repo_full_name,
      payload,
      event_created_at
    )
    SELECT
      v_team_id,
      (e->>'github_event_id')::text,
      (e->>'event_type')::text,
      (e->>'actor_login')::text,
      (e->>'actor_avatar_url')::text,
      (e->>'repo_full_name')::text,
      COALESCE(e->'payload', '{}'::jsonb),
      (e->>'event_created_at')::timestamptz
    FROM jsonb_array_elements(p_events) AS e
    ON CONFLICT (team_id, github_event_id) DO NOTHING
    RETURNING 1
  )
  SELECT count(*)::int INTO v_inserted FROM ins;

  RETURN v_inserted;
END;
$$;

REVOKE ALL ON FUNCTION insert_team_chat_events(uuid, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION insert_team_chat_events(uuid, jsonb) TO authenticated;
