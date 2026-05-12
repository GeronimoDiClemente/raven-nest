-- 20260511010000_team_members_leader_delete.sql
-- B12: Allow team leaders (not just team owners via the `teams.owner_id` check
-- in migration 002) to remove other members from the team.
-- B13-style: Allow any user to leave their own team (delete their own membership row).
--
-- Existing DELETE policy on team_members (from 002):
--   "Owner can remove members"  USING team_id IN (SELECT id FROM teams WHERE owner_id = auth.uid())
-- That policy stays. RLS policies are OR-combined, so adding more policies only
-- broadens what's allowed; it does not weaken the owner path.

CREATE POLICY "Team leader can delete members"
  ON team_members FOR DELETE
  USING (
    team_id IN (
      SELECT team_id FROM team_members
      WHERE user_id = auth.uid()
        AND role = 'leader'
        AND status = 'active'
    )
  );

CREATE POLICY "User can leave their team"
  ON team_members FOR DELETE
  USING (user_id = auth.uid());
