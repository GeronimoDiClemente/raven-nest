-- 022: Force RLS bypass in policy helper functions
--
-- Migration 020 introduced SECURITY DEFINER helpers to break the recursion
-- between teams and team_members policies. SECURITY DEFINER alone only
-- bypasses RLS if the function's owner has BYPASSRLS — which depends on
-- which role created the function in Supabase. When the bypass doesn't kick
-- in, calling these helpers from within another policy re-triggers the same
-- policy and Postgres aborts with "infinite recursion detected".
--
-- Fix: add `SET row_security = OFF` as a function attribute. This forces RLS
-- to be skipped while the function body runs, regardless of the owner's
-- privileges. The functions only return scalar values or sets of UUIDs (no
-- full rows), so leaking RLS-protected data isn't a concern.

CREATE OR REPLACE FUNCTION _current_user_email()
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER
SET row_security = OFF
AS $$
  SELECT email FROM auth.users WHERE id = auth.uid()
$$;

CREATE OR REPLACE FUNCTION _user_active_team_ids()
RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER
SET row_security = OFF
AS $$
  SELECT team_id FROM team_members
  WHERE user_id = auth.uid() AND status = 'active'
$$;

CREATE OR REPLACE FUNCTION _user_owned_team_ids()
RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER
SET row_security = OFF
AS $$
  SELECT id FROM teams WHERE owner_id = auth.uid()
$$;

CREATE OR REPLACE FUNCTION _team_member_role(p_member_id uuid)
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER
SET row_security = OFF
AS $$
  SELECT role FROM team_members WHERE id = p_member_id LIMIT 1
$$;

CREATE OR REPLACE FUNCTION _is_active_team_member(p_team_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET row_security = OFF
AS $$
  SELECT EXISTS (
    SELECT 1 FROM team_members
    WHERE team_id = p_team_id
      AND user_id = auth.uid()
      AND status = 'active'
  )
$$;

CREATE OR REPLACE FUNCTION _user_has_pending_invite_to_team(p_team_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET row_security = OFF
AS $$
  SELECT EXISTS (
    SELECT 1 FROM team_members
    WHERE team_id = p_team_id
      AND email = (SELECT email FROM auth.users WHERE id = auth.uid())
      AND status = 'pending'
  )
$$;

CREATE OR REPLACE FUNCTION _is_team_leader(p_team_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET row_security = OFF
AS $$
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
