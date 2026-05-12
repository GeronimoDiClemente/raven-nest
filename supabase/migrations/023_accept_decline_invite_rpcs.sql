-- 023: Accept / decline pending invite via SECURITY DEFINER RPCs
--
-- Direct UPDATE/DELETE on team_members from the client keeps tripping the
-- recursion guard because the WITH CHECK and SELECT policies still
-- cross-reference each other. Mirror the pattern used for the join-by-code
-- flow (`request_team_join`, `approve_join_request`): expose dedicated RPCs
-- that bypass RLS via SECURITY DEFINER.

CREATE OR REPLACE FUNCTION accept_invite(p_member_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET row_security = OFF
AS $$
DECLARE
  v_member record;
  v_user_email text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT id, team_id, email, status, role
    INTO v_member
  FROM team_members
  WHERE id = p_member_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invite not found';
  END IF;
  IF v_member.status <> 'pending' THEN
    RAISE EXCEPTION 'Invite is not pending (current status: %)', v_member.status;
  END IF;

  SELECT email INTO v_user_email FROM auth.users WHERE id = auth.uid();
  IF lower(v_user_email) <> lower(v_member.email)
     AND v_member.email <> v_user_email THEN
    -- Be lenient on case: only block if neither match works
    IF v_user_email IS DISTINCT FROM v_member.email THEN
      RAISE EXCEPTION 'This invite is for % — not your account', v_member.email;
    END IF;
  END IF;

  UPDATE team_members
    SET status = 'active',
        accepted_at = now(),
        user_id = auth.uid()
    WHERE id = p_member_id;
END $$;

CREATE OR REPLACE FUNCTION decline_invite(p_member_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET row_security = OFF
AS $$
DECLARE
  v_member record;
  v_user_email text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT id, email, status INTO v_member
  FROM team_members WHERE id = p_member_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invite not found';
  END IF;
  IF v_member.status <> 'pending' THEN
    RAISE EXCEPTION 'Invite is not pending';
  END IF;

  SELECT email INTO v_user_email FROM auth.users WHERE id = auth.uid();
  IF lower(v_user_email) <> lower(v_member.email) THEN
    RAISE EXCEPTION 'This invite is not yours';
  END IF;

  DELETE FROM team_members WHERE id = p_member_id;
END $$;
