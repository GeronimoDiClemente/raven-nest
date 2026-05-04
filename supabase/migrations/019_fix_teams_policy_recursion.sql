-- 019: Fix infinite recursion in teams SELECT policy
--
-- Migration 017 added an `EXISTS (FROM team_members ...)` clause to the teams
-- SELECT policy so users with pending invites could read the team. The
-- team_members SELECT policy already references teams (`team_id IN (SELECT
-- id FROM teams WHERE owner_id = auth.uid())`), so cross-evaluating both
-- policies in a single SELECT triggers Postgres' recursion detector and
-- the query fails with:
--   "infinite recursion detected in policy for relation 'teams'"
--
-- This blocks team creation: createTeam INSERTs a row and the implicit
-- RETURNING SELECT trips the recursion guard.
--
-- Fix: route the cross-table lookups through SECURITY DEFINER helpers that
-- bypass RLS. They only return booleans, so they're safe to expose.

CREATE OR REPLACE FUNCTION _is_active_team_member(p_team_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT EXISTS (
    SELECT 1 FROM team_members
    WHERE team_id = p_team_id
      AND user_id = auth.uid()
      AND status = 'active'
  )
$$;

CREATE OR REPLACE FUNCTION _user_has_pending_invite_to_team(p_team_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT EXISTS (
    SELECT 1 FROM team_members
    WHERE team_id = p_team_id
      AND email = (SELECT email FROM auth.users WHERE id = auth.uid())
      AND status = 'pending'
  )
$$;

DROP POLICY IF EXISTS "Team members can read their team" ON teams;

CREATE POLICY "Team members can read their team"
  ON teams FOR SELECT USING (
    owner_id = auth.uid()
    OR _is_active_team_member(teams.id)
    OR _user_has_pending_invite_to_team(teams.id)
  );
