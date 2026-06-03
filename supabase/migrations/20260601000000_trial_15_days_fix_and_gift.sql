-- v1.2.8 — 15-day trial: bump length, fix deferred trial start, gift 15 days
--
-- Three things, all tied to the pricing relaunch:
--
-- 1) Trial length goes 14 -> 15 days. The RLS-side gate user_has_plan() must
--    agree with the client (useProfile.ts TRIAL_DAYS, UserMenu.tsx
--    TRIAL_DAYS_TOTAL), both now 15.
--
-- 2) Email/password trials never actually started. handle_email_confirmed()
--    (migration 013) sets profiles.trial_started_at = now() via an UPDATE when
--    the user confirms their email. But protect_profile_billing
--    (migration 20260502120000), a BEFORE UPDATE trigger, reverts
--    trial_started_at for any writer whose auth.role() <> 'service_role'. The
--    email-confirmation UPDATE runs inside GoTrue's auth-admin DB connection,
--    where auth.role() is NULL — so the trial write was silently reverted to
--    NULL and email/password users got no trial at all. (OAuth users were
--    unaffected: their trial is set on the INSERT path, which a BEFORE UPDATE
--    trigger never sees.)
--
--    Fix: gate the lock with a transaction-local GUC `app.allow_trial_write`.
--    The trusted trial-start paths (handle_email_confirmed and the gift below)
--    flip it on right before their UPDATE, so the lock lets trial_started_at
--    through while keeping plan / stripe_* frozen. A client cannot set this
--    GUC (no RPC exposes it, PostgREST can't set arbitrary GUCs), so the
--    billing-column lock stays fully airtight against the shipped anon key.
--
-- 3) Pricing relaunch gift: every current free user gets a fresh 15-day Team
--    trial starting now. New users are already covered by (1)+(2).

-- ---------------------------------------------------------------------------
-- 1: trial-aware plan gate at 15 days (was 14 in 20260514000000)
-- ---------------------------------------------------------------------------
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
          -- Active trial: effective plan is 'team' for 15 days after
          -- trial_started_at, so allow 'team' (and by extension 'pro') gates.
          trial_started_at IS NOT NULL
          AND trial_started_at > (now() - interval '15 days')
          AND ('team' = ANY(allowed) OR 'pro' = ANY(allowed))
        )
      )
  );
$$;

-- ---------------------------------------------------------------------------
-- 2a: let the legitimate trial-start UPDATE through the billing-column lock
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION protect_profile_billing_columns()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
  -- service_role (Edge Functions, webhooks, admin) can write anything.
  IF auth.role() = 'service_role' THEN
    RETURN NEW;
  END IF;

  -- Trusted trial-start path (handle_email_confirmed / this migration's gift):
  -- a transaction-local GUC the client cannot set. plan + stripe_* stay frozen;
  -- only trial_started_at is allowed through.
  IF current_setting('app.allow_trial_write', true) = 'on' THEN
    NEW.plan                   := OLD.plan;
    NEW.stripe_customer_id     := OLD.stripe_customer_id;
    NEW.stripe_subscription_id := OLD.stripe_subscription_id;
    RETURN NEW;
  END IF;

  -- Untrusted authenticated client: silently revert every protected column.
  NEW.plan                   := OLD.plan;
  NEW.stripe_customer_id     := OLD.stripe_customer_id;
  NEW.stripe_subscription_id := OLD.stripe_subscription_id;
  NEW.trial_started_at       := OLD.trial_started_at;
  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------------
-- 2b: handle_email_confirmed flags the trusted write before its UPDATE
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION handle_email_confirmed()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Only act when email_confirmed_at transitions from NULL to a real value.
  IF OLD.email_confirmed_at IS NULL AND NEW.email_confirmed_at IS NOT NULL THEN
    PERFORM set_config('app.allow_trial_write', 'on', true);
    UPDATE public.profiles
    SET trial_started_at = now()
    WHERE id = NEW.id AND trial_started_at IS NULL;
  END IF;

  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------------
-- 3: one-time gift — fresh 15-day Team trial for every current free user.
--    Paying users (plan in 'pro'/'team'/'enterprise') are untouched.
--    Setting trial_started_at = now() can only extend, never shorten, an
--    already-active trial. One-time: do not re-run this migration.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  PERFORM set_config('app.allow_trial_write', 'on', true);
  UPDATE public.profiles
  SET trial_started_at = now()
  WHERE plan = 'free';
END $$;
