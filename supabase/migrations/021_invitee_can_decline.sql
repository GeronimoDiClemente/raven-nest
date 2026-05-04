-- 021: Allow invitee to decline (delete) their own pending invite
--
-- The original schema (002) only had "Owner can remove members" for DELETE
-- on team_members. There was no policy letting the invitee delete their own
-- pending invite, so `rejectInvite` (the user-side Decline button) silently
-- failed: the DELETE matched zero rows under RLS but Postgres returned no
-- error because zero-row DELETEs are valid.
--
-- This migration adds the missing policy.

CREATE POLICY "Invitee can decline own pending invite"
  ON team_members FOR DELETE USING (
    status = 'pending'
    AND (
      user_id = auth.uid()
      OR email = _current_user_email()
    )
  );
