-- 016: Fix invite accept WITH CHECK shadowing
--
-- Migration 015 broadened USING (so existing users with NULL user_id can match
-- by email) but kept the WITH CHECK subselect from 012:
--
--   role = (SELECT role FROM team_members WHERE id = team_members.id LIMIT 1)
--
-- The inner FROM team_members shadows the outer table reference. The WHERE
-- clause `id = team_members.id` resolves to `id = id` (always true), and
-- LIMIT 1 returns the role of an arbitrary visible row. When the picked row's
-- role differs from the row being accepted (common for users who already
-- belong to other teams as leader), the policy silently rejects the UPDATE.
-- The client (`acceptInvite` in useTeam.ts) gets an error but does not surface
-- it, so the Accept button appears to do nothing.
--
-- Fix: alias the inner table so `team_members.id` unambiguously refers to the
-- outer (modified) row.

DROP POLICY IF EXISTS "Invitee can accept invitation" ON team_members;

CREATE POLICY "Invitee can accept invitation"
  ON team_members FOR UPDATE
  USING (
    (
      user_id = auth.uid()
      OR email = (SELECT email FROM auth.users WHERE id = auth.uid())
    )
    AND status = 'pending'
  )
  WITH CHECK (
    status = 'active'
    AND role = (
      SELECT tm_prev.role
      FROM team_members tm_prev
      WHERE tm_prev.id = team_members.id
      LIMIT 1
    )
  );
