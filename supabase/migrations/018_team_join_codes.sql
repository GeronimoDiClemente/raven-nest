-- 018: Team join by code with leader approval
--
-- Adds a per-team rotatable join code and the request-to-join flow:
--   * One active code per team (regenerable by leaders)
--   * Users paste the code and create a team_members row with status='requested'
--   * Leaders approve (-> active) or decline (delete) the request

-- ── TABLE ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS team_join_codes (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id     uuid NOT NULL REFERENCES teams ON DELETE CASCADE,
  code        text NOT NULL UNIQUE,
  created_by  uuid NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  revoked_at  timestamptz
);

-- Only one active (non-revoked) code per team
CREATE UNIQUE INDEX IF NOT EXISTS team_join_codes_one_active_per_team
  ON team_join_codes (team_id) WHERE revoked_at IS NULL;

ALTER TABLE team_join_codes ENABLE ROW LEVEL SECURITY;

-- Active members of the team can read the code; owner always can
CREATE POLICY "Active members can read team join code"
  ON team_join_codes FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM team_members tm
      WHERE tm.team_id = team_join_codes.team_id
        AND tm.user_id = auth.uid()
        AND tm.status = 'active'
    )
    OR EXISTS (
      SELECT 1 FROM teams t
      WHERE t.id = team_join_codes.team_id AND t.owner_id = auth.uid()
    )
  );

-- All writes go through SECURITY DEFINER RPCs; no direct INSERT/UPDATE/DELETE policy
-- (RLS denies by default when no policy matches.)

-- ── HELPERS ───────────────────────────────────────────────────────────

-- 8-char code from an unambiguous alphabet (no 0/O/1/I/L)
CREATE OR REPLACE FUNCTION _gen_join_code() RETURNS text
LANGUAGE plpgsql AS $$
DECLARE
  alphabet constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  result text := '';
  i int;
BEGIN
  FOR i IN 1..8 LOOP
    result := result || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
  END LOOP;
  RETURN result;
END $$;

-- Whether the current user is an active leader of the given team
CREATE OR REPLACE FUNCTION _is_team_leader(p_team_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT EXISTS (
    SELECT 1 FROM team_members
    WHERE team_id = p_team_id
      AND user_id = auth.uid()
      AND role = 'leader'
      AND status = 'active'
  ) OR EXISTS (
    SELECT 1 FROM teams WHERE id = p_team_id AND owner_id = auth.uid()
  )
$$;

-- ── RPC: generate / rotate the team's join code ───────────────────────

CREATE OR REPLACE FUNCTION generate_team_join_code(p_team_id uuid)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  new_code text;
  attempts int := 0;
BEGIN
  IF NOT _is_team_leader(p_team_id) THEN
    RAISE EXCEPTION 'Only team leaders can generate join codes';
  END IF;

  -- Revoke any active code
  UPDATE team_join_codes
    SET revoked_at = now()
    WHERE team_id = p_team_id AND revoked_at IS NULL;

  -- Generate a unique code (retry on collision; ~31^8 space, collisions unlikely)
  LOOP
    attempts := attempts + 1;
    new_code := _gen_join_code();
    BEGIN
      INSERT INTO team_join_codes (team_id, code, created_by)
      VALUES (p_team_id, new_code, auth.uid());
      EXIT;
    EXCEPTION WHEN unique_violation THEN
      IF attempts > 10 THEN
        RAISE EXCEPTION 'Could not generate a unique code after 10 attempts';
      END IF;
    END;
  END LOOP;

  RETURN new_code;
END $$;

-- ── RPC: user requests to join a team using a code ────────────────────

CREATE OR REPLACE FUNCTION request_team_join(p_code text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_team_id uuid;
  v_team_name text;
  v_team_owner uuid;
  v_user_email text;
  v_existing record;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT email INTO v_user_email FROM auth.users WHERE id = auth.uid();
  IF v_user_email IS NULL THEN
    RAISE EXCEPTION 'No email on user record';
  END IF;

  -- Resolve active code
  SELECT tjc.team_id, t.name, t.owner_id
    INTO v_team_id, v_team_name, v_team_owner
  FROM team_join_codes tjc
  JOIN teams t ON t.id = tjc.team_id
  WHERE tjc.code = upper(trim(p_code))
    AND tjc.revoked_at IS NULL;

  IF v_team_id IS NULL THEN
    RAISE EXCEPTION 'Invalid or expired code';
  END IF;

  -- Existing membership check
  SELECT id, status INTO v_existing
  FROM team_members
  WHERE team_id = v_team_id AND email = v_user_email;

  IF FOUND THEN
    IF v_existing.status = 'active' THEN
      RAISE EXCEPTION 'You are already a member of this team';
    ELSIF v_existing.status = 'pending' THEN
      RAISE EXCEPTION 'You already have a pending invite to this team. Accept it from Pending invites.';
    ELSIF v_existing.status = 'requested' THEN
      RAISE EXCEPTION 'You already requested to join this team';
    ELSE
      RAISE EXCEPTION 'Existing membership row blocks join';
    END IF;
  END IF;

  INSERT INTO team_members (team_id, user_id, email, role, status, invited_by)
  VALUES (v_team_id, auth.uid(), v_user_email, 'member', 'requested', v_team_owner);

  RETURN jsonb_build_object('team_id', v_team_id, 'team_name', v_team_name);
END $$;

-- ── RPC: leader approves a request ────────────────────────────────────

CREATE OR REPLACE FUNCTION approve_join_request(p_member_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_team_id uuid;
  v_status text;
BEGIN
  SELECT team_id, status INTO v_team_id, v_status
  FROM team_members WHERE id = p_member_id;

  IF v_team_id IS NULL THEN
    RAISE EXCEPTION 'Request not found';
  END IF;
  IF v_status <> 'requested' THEN
    RAISE EXCEPTION 'Member row is not a join request';
  END IF;
  IF NOT _is_team_leader(v_team_id) THEN
    RAISE EXCEPTION 'Only team leaders can approve requests';
  END IF;

  UPDATE team_members
    SET status = 'active', accepted_at = now()
    WHERE id = p_member_id;
END $$;

-- ── RPC: leader declines a request (deletes the row) ──────────────────

CREATE OR REPLACE FUNCTION decline_join_request(p_member_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_team_id uuid;
  v_status text;
BEGIN
  SELECT team_id, status INTO v_team_id, v_status
  FROM team_members WHERE id = p_member_id;

  IF v_team_id IS NULL THEN
    RAISE EXCEPTION 'Request not found';
  END IF;
  IF v_status <> 'requested' THEN
    RAISE EXCEPTION 'Member row is not a join request';
  END IF;
  IF NOT _is_team_leader(v_team_id) THEN
    RAISE EXCEPTION 'Only team leaders can decline requests';
  END IF;

  DELETE FROM team_members WHERE id = p_member_id;
END $$;

-- ── Allow user to cancel their own requested-status row ───────────────

CREATE POLICY "User can cancel own join request"
  ON team_members FOR DELETE USING (
    user_id = auth.uid()
    AND status = 'requested'
  );
