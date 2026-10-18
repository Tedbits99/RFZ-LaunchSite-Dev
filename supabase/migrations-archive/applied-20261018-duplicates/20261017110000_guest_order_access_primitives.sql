-- ALREADY APPLIED to live database as: 20261018152054_20261017110000_guest_order_access_primitives.sql
-- Do not re-execute this original file. Kept for history only.

-- Additive first stage for order capabilities and checkout policy.
-- This migration deliberately leaves the existing public order policies and
-- direct INSERT grants intact. The lock-down migration is applied only after
-- the application and guest-recovery paths have been deployed and verified.

CREATE TABLE IF NOT EXISTS public.checkout_policy (
  setting_key text PRIMARY KEY CHECK (setting_key = 'allow_guest_checkout'),
  allow_guest_checkout boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.checkout_policy (setting_key, allow_guest_checkout)
VALUES ('allow_guest_checkout', true)
ON CONFLICT (setting_key) DO NOTHING;

ALTER TABLE public.checkout_policy ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.checkout_policy FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.checkout_policy FROM service_role;

CREATE TABLE IF NOT EXISTS public.checkout_policy_audit (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  setting_key text NOT NULL CHECK (setting_key = 'allow_guest_checkout'),
  old_value boolean NOT NULL,
  new_value boolean NOT NULL,
  changed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  changed_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.checkout_policy_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.checkout_policy_audit FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.checkout_policy_audit FROM service_role;

CREATE OR REPLACE FUNCTION public.prevent_checkout_policy_audit_mutation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
BEGIN
  RAISE EXCEPTION 'checkout policy audit entries are immutable';
END;
$function$;

DROP TRIGGER IF EXISTS prevent_checkout_policy_audit_mutation ON public.checkout_policy_audit;
CREATE TRIGGER prevent_checkout_policy_audit_mutation
  BEFORE UPDATE OR DELETE ON public.checkout_policy_audit
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_checkout_policy_audit_mutation();
REVOKE ALL ON FUNCTION public.prevent_checkout_policy_audit_mutation() FROM PUBLIC, anon, authenticated, service_role;

CREATE TABLE IF NOT EXISTS public.guest_order_access (
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  token_hash text NOT NULL CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '60 days'),
  revoked_at timestamptz,
  PRIMARY KEY (order_id, token_hash)
);

ALTER TABLE public.guest_order_access ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.guest_order_access FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.guest_order_access TO service_role;

CREATE TABLE IF NOT EXISTS public.guest_order_access_challenges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  code_hash text NOT NULL CHECK (code_hash ~ '^[0-9a-f]{64}$'),
  rate_limit_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  consumed_at timestamptz
);

CREATE INDEX IF NOT EXISTS guest_order_access_challenges_rate_idx
  ON public.guest_order_access_challenges (rate_limit_key, created_at DESC);
CREATE INDEX IF NOT EXISTS guest_order_access_challenges_order_idx
  ON public.guest_order_access_challenges (order_id, created_at DESC);

ALTER TABLE public.guest_order_access_challenges ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.guest_order_access_challenges FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.guest_order_access_challenges TO service_role;

-- Challenge requests and consumption are service-only; callers cannot use
-- these functions to discover whether an order/email pair exists.
CREATE OR REPLACE FUNCTION public.create_guest_order_access_challenge(
  p_reference text,
  p_email text,
  p_code_hash text,
  p_rate_limit_key text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_order_id uuid;
BEGIN
  IF p_code_hash !~ '^[0-9a-f]{64}$' OR length(p_rate_limit_key) < 32 THEN
    RETURN false;
  END IF;

  SELECT o.id INTO v_order_id
  FROM public.orders o
  WHERE upper(o.reference) = upper(btrim(p_reference))
    AND lower(btrim(o.email)) = lower(btrim(p_email))
    AND o.customer_user_id IS NULL
  FOR UPDATE OF o;

  IF v_order_id IS NULL THEN
    RETURN false;
  END IF;

  -- Bound email delivery per network bucket and per order, regardless of
  -- whether the request uses a correct email address.
  IF (SELECT count(*) FROM public.guest_order_access_challenges c
      WHERE c.rate_limit_key = p_rate_limit_key
        AND c.created_at > now() - interval '1 hour') >= 10
     OR (SELECT count(*) FROM public.guest_order_access_challenges c
         WHERE c.order_id = v_order_id
           AND c.created_at > now() - interval '1 hour') >= 3 THEN
    RETURN false;
  END IF;

  UPDATE public.guest_order_access_challenges
  SET consumed_at = now()
  WHERE order_id = v_order_id AND consumed_at IS NULL;

  INSERT INTO public.guest_order_access_challenges
    (order_id, code_hash, rate_limit_key, expires_at)
  VALUES (v_order_id, p_code_hash, p_rate_limit_key, now() + interval '15 minutes');

  RETURN true;
END;
$function$;

CREATE OR REPLACE FUNCTION public.consume_guest_order_access_challenge(
  p_reference text,
  p_email text,
  p_code_hash text,
  p_capability_hash text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_order_id uuid;
  v_challenge public.guest_order_access_challenges%ROWTYPE;
BEGIN
  IF p_code_hash !~ '^[0-9a-f]{64}$'
     OR p_capability_hash !~ '^[0-9a-f]{64}$' THEN
    RETURN NULL;
  END IF;

  SELECT o.id INTO v_order_id
  FROM public.orders o
  WHERE upper(o.reference) = upper(btrim(p_reference))
    AND lower(btrim(o.email)) = lower(btrim(p_email))
    AND o.customer_user_id IS NULL
  FOR UPDATE;

  IF v_order_id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT c.* INTO v_challenge
  FROM public.guest_order_access_challenges c
  WHERE c.order_id = v_order_id
    AND c.consumed_at IS NULL
    AND c.expires_at > now()
  ORDER BY c.created_at DESC
  LIMIT 1
  FOR UPDATE;

  IF NOT FOUND OR v_challenge.attempts >= 5 THEN
    RETURN NULL;
  END IF;

  IF v_challenge.code_hash <> p_code_hash THEN
    UPDATE public.guest_order_access_challenges
    SET attempts = attempts + 1
    WHERE id = v_challenge.id;
    RETURN NULL;
  END IF;

  UPDATE public.guest_order_access_challenges
  SET consumed_at = now(), attempts = attempts + 1
  WHERE id = v_challenge.id;

  INSERT INTO public.guest_order_access (order_id, token_hash, expires_at)
  VALUES (v_order_id, p_capability_hash, now() + interval '60 days')
  ON CONFLICT (order_id, token_hash) DO UPDATE
    SET revoked_at = NULL, expires_at = EXCLUDED.expires_at;

  RETURN v_order_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_set_allow_guest_checkout(p_enabled boolean)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_admin_id uuid := auth.uid();
  v_old_value boolean;
BEGIN
  IF v_admin_id IS NULL OR NOT EXISTS (
    SELECT 1
    FROM public.admins a
    JOIN auth.users u ON u.id = a.id
    WHERE a.id = v_admin_id
      AND a.is_active IS TRUE
      AND a.role = 'SUPER_ADMIN'
      AND u.email_confirmed_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'FORBIDDEN';
  END IF;

  IF p_enabled IS NULL THEN
    RAISE EXCEPTION 'INVALID_CHECKOUT_POLICY';
  END IF;

  SELECT s.allow_guest_checkout INTO v_old_value
  FROM public.checkout_policy s
  WHERE s.setting_key = 'allow_guest_checkout'
  FOR UPDATE;

  IF NOT FOUND OR v_old_value IS NULL THEN
    RAISE EXCEPTION 'CHECKOUT_POLICY_UNAVAILABLE';
  END IF;

  UPDATE public.checkout_policy
  SET allow_guest_checkout = p_enabled, updated_at = now()
  WHERE setting_key = 'allow_guest_checkout';

  INSERT INTO public.checkout_policy_audit
    (setting_key, old_value, new_value, changed_by)
  VALUES ('allow_guest_checkout', v_old_value, p_enabled, v_admin_id);

  RETURN p_enabled;
END;
$function$;

REVOKE ALL ON FUNCTION public.create_guest_order_access_challenge(text, text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.consume_guest_order_access_challenge(text, text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_set_allow_guest_checkout(boolean) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.create_guest_order_access_challenge(text, text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.consume_guest_order_access_challenge(text, text, text, text) TO service_role;
