-- 024: Fix infinite recursion in team_members leader UPDATE and DELETE policies
--
-- Migration 007 "Team leader can update members" and migration 20260511050000
-- "Team leader can delete members" both contain direct self-referential subqueries:
--
--   team_id IN (SELECT team_id FROM team_members
--               WHERE user_id = auth.uid() AND role = 'leader' AND status = 'active')
--
-- When these policies are evaluated, the inner SELECT on team_members triggers
-- the SELECT RLS policies on team_members from within the UPDATE/DELETE policy
-- evaluation — hitting Postgres' recursion guard.
--
-- Fix: replace both policies using _is_team_leader() (migration 022), which is
-- SECURITY DEFINER SET row_security = OFF and thus bypasses RLS internally.

DROP POLICY IF EXISTS "Team leader can update members" ON team_members;

CREATE POLICY "Team leader can update members"
  ON team_members FOR UPDATE USING (
    _is_team_leader(team_members.team_id)
  );

DROP POLICY IF EXISTS "Team leader can delete members" ON team_members;

CREATE POLICY "Team leader can delete members"
  ON team_members FOR DELETE USING (
    _is_team_leader(team_members.team_id)
    AND user_id <> (SELECT owner_id FROM teams WHERE id = team_members.team_id)
    AND user_id <> auth.uid()
  );
