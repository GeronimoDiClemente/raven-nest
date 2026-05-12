-- B7: Allow a user to add the same repo on different providers.
-- The previous UNIQUE(user_id, repo_full_name) constraint blocked
-- adding e.g. `octocat/Hello-World` on BOTH GitHub and GitLab even
-- though they are distinct repositories on distinct platforms.
-- Drop it and replace with a composite key that includes provider.
-- Requires `provider` column on user_repos (added in 20260501000000_actions_panel.sql).

ALTER TABLE user_repos DROP CONSTRAINT IF EXISTS user_repos_user_id_repo_full_name_key;
ALTER TABLE user_repos ADD CONSTRAINT user_repos_user_id_provider_repo_full_name_key
  UNIQUE (user_id, provider, repo_full_name);
