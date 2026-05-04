-- 017: Teams visible to pending invitees
--
-- The teams SELECT policy (migration 002) only let active members and owners
-- read a team row. The pending-invites UI (`useTeam.ts`) selects
-- `team_members` joined with `teams(*)`. When the user has a pending invite
-- to a team they are NOT yet a member of, the embedded `teams` row comes back
-- NULL because the team SELECT policy denies it. The hook then filters those
-- out, hiding pending invites from the UI even though the team_members row is
-- visible (its policy already allows email-match reads).
--
-- Fix: extend the teams SELECT policy to also allow reads when the user has a
-- pending invite (matched by email in team_members).

DROP POLICY IF EXISTS "Team members can read their team" ON teams;

CREATE POLICY "Team members can read their team"
  ON teams FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM team_members
      WHERE team_members.team_id = teams.id
        AND team_members.user_id = auth.uid()
        AND team_members.status = 'active'
    )
    OR owner_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM team_members tm
      WHERE tm.team_id = teams.id
        AND tm.email = (SELECT email FROM auth.users WHERE id = auth.uid())
        AND tm.status = 'pending'
    )
  );
