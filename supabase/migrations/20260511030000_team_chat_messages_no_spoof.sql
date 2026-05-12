-- 20260511030000_team_chat_messages_no_spoof.sql
-- B14: Prevent client-side spoofing of user_email and github_login on
-- team_chat_messages INSERT.
--
-- Problem: the INSERT policy ("Team members can post messages", migration 008)
-- only verifies `user_id = auth.uid()` and team membership. The client passes
-- `user_email` and `github_login` as plain columns, so a malicious client can
-- post messages displayed with any victim's identity in the UI.
--
-- Fix: BEFORE INSERT trigger that overwrites both columns from server-trusted
-- sources (auth.users.email and profiles.github_login, added in migration 004).
-- The client-supplied values are discarded.

CREATE OR REPLACE FUNCTION enforce_chat_identity()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
BEGIN
  SELECT email INTO NEW.user_email
  FROM auth.users
  WHERE id = NEW.user_id;

  -- github_login lives on profiles (added in migration 004); NULL when the
  -- user has not connected GitHub.
  NEW.github_login := (
    SELECT github_login FROM profiles WHERE id = NEW.user_id
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_chat_identity_trg ON team_chat_messages;
CREATE TRIGGER enforce_chat_identity_trg
  BEFORE INSERT ON team_chat_messages
  FOR EACH ROW EXECUTE FUNCTION enforce_chat_identity();
