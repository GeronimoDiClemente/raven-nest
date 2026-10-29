-- 2b-3 — Settings > Account: intervalo y fin del período de la suscripción
--
-- La pantalla de cuenta necesita mostrar "Pro · Annual · renews on <fecha>" o
-- "ends on <fecha>" sin llamar a Stripe desde el cliente. Para eso el webhook
-- de Stripe (service_role) deja tres datos en profiles:
--
--   billing_interval      'monthly' | 'annual' (null si no hay suscripción)
--   current_period_end    cuándo termina el período ya pagado
--   cancel_at_period_end  true si el usuario canceló y sigue activo hasta esa fecha
--
-- Son columnas de facturación como plan o stripe_*: el cliente las LEE (select
-- propio, sin revoke) pero no las escribe. protect_profile_billing_columns()
-- (20260502120000, redefinida en 20260601000000) revierte las columnas
-- protegidas para todo writer que no sea service_role; hay que sumar estas
-- tres en las DOS ramas de reversión (la del trial y la del cliente), si no un
-- usuario autenticado podría reescribir su propia fecha de renovación.
-- El trigger en sí no se recrea: ya apunta a la función.

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS billing_interval text
    CHECK (billing_interval IN ('monthly', 'annual')),
  ADD COLUMN IF NOT EXISTS current_period_end timestamptz,
  ADD COLUMN IF NOT EXISTS cancel_at_period_end boolean NOT NULL DEFAULT false;

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

  -- Trusted trial-start path (handle_email_confirmed / gift): a transaction-local
  -- GUC the client cannot set. plan + stripe_* + período stay frozen;
  -- only trial_started_at is allowed through.
  IF current_setting('app.allow_trial_write', true) = 'on' THEN
    NEW.plan                   := OLD.plan;
    NEW.stripe_customer_id     := OLD.stripe_customer_id;
    NEW.stripe_subscription_id := OLD.stripe_subscription_id;
    NEW.billing_interval       := OLD.billing_interval;
    NEW.current_period_end     := OLD.current_period_end;
    NEW.cancel_at_period_end   := OLD.cancel_at_period_end;
    RETURN NEW;
  END IF;

  -- Untrusted authenticated client: silently revert every protected column.
  NEW.plan                   := OLD.plan;
  NEW.stripe_customer_id     := OLD.stripe_customer_id;
  NEW.stripe_subscription_id := OLD.stripe_subscription_id;
  NEW.trial_started_at       := OLD.trial_started_at;
  NEW.billing_interval       := OLD.billing_interval;
  NEW.current_period_end     := OLD.current_period_end;
  NEW.cancel_at_period_end   := OLD.cancel_at_period_end;
  RETURN NEW;
END;
$$;
