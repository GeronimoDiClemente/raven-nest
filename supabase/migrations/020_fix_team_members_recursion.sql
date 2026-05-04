-- 020: Fix infinite recursion in team_members policies
--
-- After migration 019 fixed the `teams` SELECT policy, accepting a pending
-- invite still failed with:
--   "infinite recursion detected in policy for relation 'team_members'"
--
-- Cause: the team_members SELECT/UPDATE policies have subqueries that cross
-- back to `teams` ("team_id IN (SELECT id FROM teams WHERE owner_id =
-- auth.uid())") and to itself ("SELECT role FROM team_members WHERE id = ..."
-- inside the WITH CHECK of the accept-invite UPDATE policy). Combined with
-- the multi-clause teams SELECT policy, Postgres trips the recursion guard.
--
-- Fix: route all cross-table / self-referential lookups through SECURITY
-- DEFINER helpers so they bypass RLS. The helpers only return scalar values
-- or arrays of UUIDs/text, no full rows, so they're safe to expose.

-- ── Helpers ───────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION _current_user_email()
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT email FROM auth.users WHERE id = auth.uid()
$$;

CREATE OR REPLACE FUNCTION _user_active_team_ids()
RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT team_id FROM team_members
  WHERE user_id = auth.uid() AND status = 'active'
$$;

CREATE OR REPLACE FUNCTION _user_owned_team_ids()
RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT id FROM teams WHERE owner_id = auth.uid()
$$;

CREATE OR REPLACE FUNCTION _team_member_role(p_member_id uuid)
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT role FROM team_members WHERE id = p_member_id LIMIT 1
$$;

-- ── team_members SELECT policy ────────────────────────────────────────

DROP POLICY IF EXISTS "Team members can read member list" ON team_members;

CREATE POLICY "Team members can read member list"
  ON team_members FOR SELECT USING (
    user_id = auth.uid()
    OR email = _current_user_email()
    OR team_id IN (SELECT _user_active_team_ids())
    OR team_id IN (SELECT _user_owned_team_ids())
  );

-- ── team_members UPDATE policy (accept invite) ────────────────────────

DROP POLICY IF EXISTS "Invitee can accept invitation" ON team_members;

CREATE POLICY "Invitee can accept invitation"
  ON team_members FOR UPDATE
  USING (
    (
      user_id = auth.uid()
      OR email = _current_user_email()
    )
    AND status = 'pending'
  )
  WITH CHECK (
    status = 'active'
    AND role = _team_member_role(team_members.id)
  );

-- ── team_members UPDATE: owner can manage (untouched by 015/016 fixes,
--    but the original references `teams` which now goes through helpers
--    above so we re-state it for clarity). ─────────────────────────────

DROP POLICY IF EXISTS "Invitee can accept; owner can manage" ON team_members;

CREATE POLICY "Owner can manage member rows"
  ON team_members FOR UPDATE
  USING (
    user_id = auth.uid()
    OR team_id IN (SELECT _user_owned_team_ids())
  );

-- ── team_members DELETE: owner can remove ─────────────────────────────

DROP POLICY IF EXISTS "Owner can remove members" ON team_members;

CREATE POLICY "Owner can remove members"
  ON team_members FOR DELETE USING (
    team_id IN (SELECT _user_owned_team_ids())
  );

-- ── team_members INSERT: owner can invite ─────────────────────────────

DROP POLICY IF EXISTS "Team owner can invite" ON team_members;

CREATE POLICY "Team owner can invite"
  ON team_members FOR INSERT WITH CHECK (
    invited_by = auth.uid()
    AND team_id IN (SELECT _user_owned_team_ids())
  );
