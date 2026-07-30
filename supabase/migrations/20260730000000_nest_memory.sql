-- Nest Memory — Phase 1 schema (cloud replica + identity + RLS + RPCs)
--
-- Design: docs/nest-memory-architecture.md §3.2 (schema), §4.2 (push RPC + advisory
-- lock), §4.4 (pull), §5.1 (bootstrap), §6 (identity/security), §6.5 (RLS), §7.1 (plan
-- gating, reuses user_has_plan from 20260502120100_plan_gates_rls.sql).
--
-- UNVERIFIED IN THIS ENVIRONMENT: no Docker / supabase CLI was available to run
-- `supabase start` + `supabase db reset` here (see docs/nest-memory-architecture.md §9
-- Phase 1 "Local test plan" and O-8). This migration is written to spec and reviewed by
-- hand, but has not been executed against a real Postgres. Run
-- `supabase db reset` locally before relying on it.

-- ── Tables ────────────────────────────────────────────────────────────────

CREATE TABLE memory_projects (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id      uuid NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  project_key   text NOT NULL,
  display_name  text NOT NULL,
  remote_url    text,
  team_id       uuid REFERENCES teams ON DELETE SET NULL,
  seq_counter   bigint NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (owner_id, project_key)
);

CREATE TABLE memory_observations (
  sync_id        text PRIMARY KEY,
  user_id        uuid NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  project_id     uuid NOT NULL REFERENCES memory_projects ON DELETE CASCADE,
  scope          text NOT NULL CHECK (scope IN ('personal','project','team')),
  topic_key      text,
  type           text NOT NULL,
  title          text NOT NULL,
  content        text NOT NULL,
  tags           jsonb NOT NULL DEFAULT '[]',
  origin_ai      text,
  origin_account text,
  git_branch     text,
  author_display text NOT NULL,
  content_hash   text NOT NULL,
  client_created_at timestamptz NOT NULL,
  client_updated_at timestamptz NOT NULL,
  lamport        bigint NOT NULL DEFAULT 0,
  deleted        boolean NOT NULL DEFAULT false,
  superseded_by  text REFERENCES memory_observations(sync_id) ON DELETE SET NULL,
  project_seq    bigint NOT NULL,
  server_updated_at timestamptz NOT NULL DEFAULT now(),
  topic_owner    uuid GENERATED ALWAYS AS
                   (CASE WHEN scope = 'personal' THEN user_id
                         ELSE '00000000-0000-0000-0000-000000000000'::uuid END) STORED
);

CREATE UNIQUE INDEX memory_obs_topic_uniq
  ON memory_observations (project_id, scope, topic_owner, topic_key)
  WHERE topic_key IS NOT NULL AND deleted = false AND superseded_by IS NULL;
CREATE INDEX memory_obs_pull ON memory_observations (project_id, project_seq);
CREATE INDEX memory_obs_author ON memory_observations (user_id, server_updated_at DESC);

CREATE TABLE memory_project_shares (
  project_id uuid REFERENCES memory_projects ON DELETE CASCADE,
  team_id    uuid REFERENCES teams ON DELETE CASCADE,
  shared_by  uuid NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, team_id)
);

CREATE TABLE memory_devices (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  name       text NOT NULL,
  platform   text NOT NULL,
  app_version text,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz
);

CREATE TABLE memory_tokens (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  device_id    uuid NOT NULL REFERENCES memory_devices ON DELETE CASCADE,
  token_hash   text NOT NULL UNIQUE,
  token_prefix text NOT NULL,
  -- Snapshot of profiles.memory_token_epoch at mint time. memory-sync compares this to
  -- the current epoch on every call; a mismatch (bumped by team removal, §6.4) forces
  -- re-issue without needing a revocation list or a stale-scope window.
  minted_epoch integer NOT NULL DEFAULT 0,
  created_at   timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz,
  expires_at   timestamptz,
  revoked_at   timestamptz
);

CREATE TABLE memory_promotions (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sync_id    text NOT NULL,
  from_scope text NOT NULL,
  to_scope   text NOT NULL,
  by_user    uuid NOT NULL REFERENCES auth.users ON DELETE SET NULL,
  at         timestamptz NOT NULL DEFAULT now()
);

-- §7.5 Subscription lapse & downgrade: tracks when a user's plan last dropped below
-- pro/team so a future purge job (retention window — OPEN QUESTION, proposed default
-- 90 days, needs founder confirmation per §7.5) has a start point. No purge job ships in
-- this migration; this column only records the fact, it enforces nothing on its own.
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS memory_plan_lapsed_at timestamptz;

-- ── RLS (dashboard / PostgREST path — §6.5) ─────────────────────────────────

ALTER TABLE memory_projects        ENABLE ROW LEVEL SECURITY;
ALTER TABLE memory_observations    ENABLE ROW LEVEL SECURITY;
ALTER TABLE memory_tokens          ENABLE ROW LEVEL SECURITY;
ALTER TABLE memory_devices         ENABLE ROW LEVEL SECURITY;
ALTER TABLE memory_project_shares  ENABLE ROW LEVEL SECURITY;
ALTER TABLE memory_promotions      ENABLE ROW LEVEL SECURITY;

CREATE POLICY memory_projects_read ON memory_projects FOR SELECT USING (
  owner_id = auth.uid()
  OR team_id IN (SELECT team_id FROM team_members
                 WHERE user_id = auth.uid() AND status = 'active')
);

CREATE POLICY memory_projects_insert ON memory_projects FOR INSERT WITH CHECK (
  owner_id = auth.uid() AND user_has_plan(auth.uid(), ARRAY['pro','team'])
);

CREATE POLICY memory_projects_update ON memory_projects FOR UPDATE
  USING (owner_id = auth.uid());

CREATE POLICY memory_obs_read ON memory_observations FOR SELECT USING (
  user_id = auth.uid()
  OR (scope = 'team' AND project_id IN (
        SELECT mp.id FROM memory_projects mp
        JOIN team_members tm ON tm.team_id = mp.team_id
        WHERE tm.user_id = auth.uid() AND tm.status = 'active'))
);

CREATE POLICY memory_obs_insert ON memory_observations FOR INSERT WITH CHECK (
  user_id = auth.uid() AND user_has_plan(auth.uid(), ARRAY['pro','team'])
);
CREATE POLICY memory_obs_update ON memory_observations FOR UPDATE
  USING (user_id = auth.uid());

CREATE POLICY memory_tokens_own ON memory_tokens FOR SELECT USING (user_id = auth.uid());
CREATE POLICY memory_devices_own ON memory_devices FOR SELECT USING (user_id = auth.uid());

CREATE POLICY memory_project_shares_read ON memory_project_shares FOR SELECT USING (
  team_id IN (SELECT team_id FROM team_members WHERE user_id = auth.uid() AND status = 'active')
  OR project_id IN (SELECT id FROM memory_projects WHERE owner_id = auth.uid())
);

CREATE POLICY memory_promotions_read ON memory_promotions FOR SELECT USING (
  by_user = auth.uid()
);

-- Never expose token_hash to any client role via PostgREST — a view with the display
-- columns only. Clients should query this view, not the base table, for listing devices.
CREATE VIEW memory_tokens_public AS
  SELECT id, user_id, device_id, token_prefix, created_at, last_used_at, expires_at, revoked_at
  FROM memory_tokens;

-- ── RPCs (daemon path — Bearer nmk_… resolved to user_id by the edge function before
--    calling these; every authorization check lives here, in one reviewable place) ────

-- Resolves (and lazily creates) a memory_projects row for a client project_key, honoring
-- the Pro/Team plan gate the same way the RLS insert policy does, so a direct RPC call
-- with a free-plan JWT is rejected exactly like the client insert path (§7.1).
CREATE OR REPLACE FUNCTION memory_resolve_project(
  p_user_id uuid, p_project_key text, p_display_name text, p_remote_url text
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_project_id uuid;
BEGIN
  SELECT id INTO v_project_id FROM memory_projects
    WHERE owner_id = p_user_id AND project_key = p_project_key;
  IF v_project_id IS NOT NULL THEN
    RETURN v_project_id;
  END IF;

  IF NOT user_has_plan(p_user_id, ARRAY['pro','team']) THEN
    RAISE EXCEPTION 'plan_required' USING ERRCODE = '42501';
  END IF;

  INSERT INTO memory_projects (owner_id, project_key, display_name, remote_url)
  VALUES (p_user_id, p_project_key, p_display_name, p_remote_url)
  RETURNING id INTO v_project_id;
  RETURN v_project_id;
END;
$$;
GRANT EXECUTE ON FUNCTION memory_resolve_project(uuid, text, text, text) TO service_role;

-- Small helper: increments and returns memory_projects.seq_counter under the caller's
-- already-held advisory lock (memory_sync_push), so seq assignment and the UPDATE that
-- consumes it happen inside the same locked transaction. Defined BEFORE
-- memory_sync_push, which calls it — plpgsql resolves function calls at CREATE FUNCTION
-- time (check_function_bodies), so a forward reference here would fail the migration.
CREATE OR REPLACE FUNCTION nextval_project_seq(p_project_id uuid) RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_seq bigint;
BEGIN
  UPDATE memory_projects SET seq_counter = seq_counter + 1 WHERE id = p_project_id
    RETURNING seq_counter INTO v_seq;
  RETURN v_seq;
END;
$$;
GRANT EXECUTE ON FUNCTION nextval_project_seq(uuid) TO service_role;

-- Push: applies a batch of client mutations under a per-project advisory lock so
-- project_seq assignment and commit visibility agree (§4.2 — the exact bug a plain
-- BIGSERIAL has: a puller can observe a later seq committed before an earlier one and
-- permanently miss a row). One call = one project's batch; the edge function fans out
-- per-project if a client batch spans projects.
CREATE OR REPLACE FUNCTION memory_sync_push(
  p_user_id uuid, p_device_id uuid, p_project_key text, p_display_name text,
  p_remote_url text, p_mutations jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_project_id uuid;
  v_mutation jsonb;
  v_payload jsonb;
  v_results jsonb := '[]'::jsonb;
  v_existing memory_observations%ROWTYPE;
  v_client_updated_at timestamptz;
  v_lamport bigint;
  v_seq bigint;
BEGIN
  v_project_id := memory_resolve_project(p_user_id, p_project_key, p_display_name, p_remote_url);

  -- Per-project serialization — see §4.2 for why this must be an advisory lock, not a
  -- plain sequence.
  PERFORM pg_advisory_xact_lock(hashtext(v_project_id::text));

  FOR v_mutation IN SELECT * FROM jsonb_array_elements(p_mutations)
  LOOP
    v_payload := v_mutation->'payload';
    v_client_updated_at := to_timestamp((v_payload->>'updated_at')::bigint / 1000.0);
    v_lamport := COALESCE((v_payload->>'lamport')::bigint, 0);

    SELECT * INTO v_existing FROM memory_observations WHERE sync_id = v_payload->>'sync_id';

    IF v_existing.sync_id IS NOT NULL THEN
      -- (a) same sync_id — LWW: max(client_updated_at) -> max(lamport) -> sync_id.
      IF v_client_updated_at > v_existing.client_updated_at
         OR (v_client_updated_at = v_existing.client_updated_at AND v_lamport > v_existing.lamport)
         OR (v_client_updated_at = v_existing.client_updated_at AND v_lamport = v_existing.lamport
             AND (v_payload->>'sync_id') > v_existing.sync_id)
      THEN
        v_seq := nextval_project_seq(v_project_id);
        UPDATE memory_observations SET
          title = v_payload->>'title', content = v_payload->>'content',
          tags = COALESCE(v_payload->'tags', '[]'::jsonb),
          topic_key = v_payload->>'topic_key',
          client_updated_at = v_client_updated_at, lamport = v_lamport,
          deleted = COALESCE((v_payload->>'deleted')::int, 0) = 1,
          project_seq = v_seq, server_updated_at = now()
        WHERE sync_id = v_existing.sync_id;
        v_results := v_results || jsonb_build_object('sync_id', v_existing.sync_id, 'outcome', 'applied', 'project_seq', v_seq);
      ELSE
        v_results := v_results || jsonb_build_object('sync_id', v_existing.sync_id, 'outcome', 'superseded', 'project_seq', v_existing.project_seq);
      END IF;
    ELSE
      v_seq := nextval_project_seq(v_project_id);
      INSERT INTO memory_observations (
        sync_id, user_id, project_id, scope, topic_key, type, title, content, tags,
        origin_ai, origin_account, git_branch, author_display, content_hash,
        client_created_at, client_updated_at, lamport, deleted, superseded_by, project_seq
      ) VALUES (
        v_payload->>'sync_id', p_user_id, v_project_id, COALESCE(v_payload->>'scope', 'personal'),
        v_payload->>'topic_key', v_payload->>'type', v_payload->>'title', v_payload->>'content',
        COALESCE(v_payload->'tags', '[]'::jsonb),
        v_payload->>'origin_ai', v_payload->>'origin_account', v_payload->>'git_branch',
        COALESCE(v_payload->>'author_display', ''), COALESCE(v_payload->>'content_hash', ''),
        to_timestamp((v_payload->>'created_at')::bigint / 1000.0), v_client_updated_at, v_lamport,
        COALESCE((v_payload->>'deleted')::int, 0) = 1, v_payload->>'superseded_by', v_seq
      );
      v_results := v_results || jsonb_build_object('sync_id', v_payload->>'sync_id', 'outcome', 'applied', 'project_seq', v_seq);
    END IF;
  END LOOP;

  RETURN jsonb_build_object('results', v_results, 'project_id', v_project_id);
END;
$$;
GRANT EXECUTE ON FUNCTION memory_sync_push(uuid, uuid, text, text, text, jsonb) TO service_role;

-- Pull: re-evaluates team-membership authorization on every call (§6.4 — no scope baked
-- into the token). Free-plan users are allowed to pull (read-only grace access, §7.5)
-- but not push — enforced by memory_sync_push's plan check, not here.
CREATE OR REPLACE FUNCTION memory_sync_pull(
  p_user_id uuid, p_project_id uuid, p_cursor bigint, p_limit int DEFAULT 500
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rows jsonb;
  v_max_seq bigint;
  v_authorized boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM memory_projects mp
    WHERE mp.id = p_project_id
      AND (mp.owner_id = p_user_id
           OR EXISTS (SELECT 1 FROM team_members tm
                      WHERE tm.team_id = mp.team_id AND tm.user_id = p_user_id AND tm.status = 'active'))
  ) INTO v_authorized;

  IF NOT v_authorized THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;

  SELECT jsonb_agg(to_jsonb(o) - 'topic_owner'), max(o.project_seq)
    INTO v_rows, v_max_seq
  FROM (
    SELECT * FROM memory_observations
    WHERE project_id = p_project_id AND project_seq > p_cursor
      AND (user_id = p_user_id OR scope = 'team')
    ORDER BY project_seq ASC
    LIMIT p_limit
  ) o;

  RETURN jsonb_build_object('rows', COALESCE(v_rows, '[]'::jsonb), 'cursor', COALESCE(v_max_seq, p_cursor));
END;
$$;
GRANT EXECUTE ON FUNCTION memory_sync_pull(uuid, uuid, bigint, int) TO service_role;

-- Bootstrap: does this user already have cloud data? Drives the SEED vs ADOPT branch
-- in the first-connect flow (§5.1, §5.5).
CREATE OR REPLACE FUNCTION memory_sync_bootstrap(p_user_id uuid) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_has_data boolean;
  v_projects jsonb;
BEGIN
  SELECT EXISTS (SELECT 1 FROM memory_observations WHERE user_id = p_user_id) INTO v_has_data;
  SELECT jsonb_agg(jsonb_build_object('id', id, 'project_key', project_key, 'display_name', display_name))
    INTO v_projects
  FROM memory_projects WHERE owner_id = p_user_id;

  RETURN jsonb_build_object('has_cloud_data', v_has_data, 'projects', COALESCE(v_projects, '[]'::jsonb));
END;
$$;
GRANT EXECUTE ON FUNCTION memory_sync_bootstrap(uuid) TO service_role;

-- §6.4 team-removal hard-kill lever: revoke tokens whose owner lost access to every
-- team-shared project a device depended on, and bump the epoch. Belt-and-braces on top
-- of the "re-evaluate every call" default (§6.4).
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS memory_token_epoch integer NOT NULL DEFAULT 0;

CREATE OR REPLACE FUNCTION memory_handle_team_member_removed() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF (TG_OP = 'DELETE') OR (TG_OP = 'UPDATE' AND NEW.status <> 'active') THEN
    UPDATE profiles SET memory_token_epoch = memory_token_epoch + 1
      WHERE id = COALESCE(OLD.user_id, NEW.user_id);
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS memory_team_member_removed ON team_members;
CREATE TRIGGER memory_team_member_removed
  AFTER DELETE OR UPDATE ON team_members
  FOR EACH ROW EXECUTE FUNCTION memory_handle_team_member_removed();
