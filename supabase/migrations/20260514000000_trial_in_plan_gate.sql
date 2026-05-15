-- v1.1.0 enforcement hardening — trial-aware plan gate
--
-- Problem: user_has_plan() (introduced in 20260502120100) only reads
-- profiles.plan and ignores the 14-day trial. The client (useProfile.ts) on
-- the other hand exposes Team-level features to any user with an active
-- trial_started_at within the last 14 days. So a free user during their
-- trial sees the "Create Team" button, clicks it, and RLS rejects the INSERT
-- — which is a confusing dead-end UX for a paying-soon user.
--
-- Fix: make the trial visible to RLS. A user is considered "team plan" for
-- 14 days after trial_started_at, in addition to whatever plan they have
-- in profiles.plan. This mirrors the client-side computeEffectivePlan().
--
-- Why not store the trial as plan='team' directly in profiles? Because the
-- expiration would require a cron job. Computing it on read keeps the
-- source of truth in trial_started_at and is consistent with the client.

CREATE OR REPLACE FUNCTION user_has_plan(uid uuid, allowed text[])
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM profiles
    WHERE id = uid
      AND (
        plan = ANY(allowed)
        OR (
          -- Active trial: effective plan is 'team' for 14 days after
          -- trial_started_at, so allow 'team' (and by extension 'pro') gates.
          trial_started_at IS NOT NULL
          AND trial_started_at > (now() - interval '14 days')
          AND ('team' = ANY(allowed) OR 'pro' = ANY(allowed))
        )
      )
  );
$$;
