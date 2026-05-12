-- 20260511050000_team_members_leader_delete_fix.sql
-- Security audit follow-up to 20260511010000.
--
-- Original "Team leader can delete members" policy let ANY leader DELETE the
-- team owner's membership row, and also let a leader delete their own row
-- (which should go through "User can leave their team" instead).
--
-- Fix: drop the existing policy and recreate it with two exclusions:
--   1. user_id <> owner_id   — preserve the team owner regardless of leaders
--   2. user_id <> auth.uid() — force self-removal through the "leave" path
--
-- "User can leave their team" (also created in 010000) is unchanged and
-- remains the path for any member (including leaders and the owner via the
-- preexisting "Owner can leave" path) to remove their own row.

DROP POLICY IF EXISTS "Team leader can delete members" ON team_members;

CREATE POLICY "Team leader can delete members"
  ON team_members FOR DELETE
  USING (
    team_id IN (
      SELECT team_id FROM team_members
      WHERE user_id = auth.uid()
        AND role = 'leader'
        AND status = 'active'
    )
    AND user_id <> (SELECT owner_id FROM teams WHERE id = team_members.team_id)
    AND user_id <> auth.uid()
  );
