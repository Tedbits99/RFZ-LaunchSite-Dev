-- ALREADY APPLIED to live database as: 20261018152151_20261017111000_customer_order_security_lockdown.sql
-- Do not re-execute this original file. Kept for history only.

-- Second stage of the customer/order security rollout.
-- Apply only after the web application and QR-payment Edge Function support
-- the per-order HttpOnly capability and the historical email-code recovery.

CREATE OR REPLACE FUNCTION public.set_order_customer_ownership()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_status text;
  v_email_confirmed_at timestamptz;
  v_verified_email text;
  v_allow_guest boolean;
  v_capability_hash text;
BEGIN
  v_capability_hash := NEW.player_inputs ->> '__rfz_order_access_hash';
  IF v_capability_hash IS NULL OR v_capability_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'ORDER_ACCESS_CAPABILITY_REQUIRED';
  END IF;

  IF v_user_id IS NULL THEN
    SELECT s.allow_guest_checkout INTO v_allow_guest
    FROM public.checkout_policy s
    WHERE s.setting_key = 'allow_guest_checkout';

    IF NOT FOUND OR v_allow_guest IS NULL THEN
      RAISE EXCEPTION 'CHECKOUT_POLICY_UNAVAILABLE';
    END IF;
    IF v_allow_guest IS NOT TRUE THEN
      RAISE EXCEPTION 'GUEST_CHECKOUT_DISABLED';
    END IF;

    IF NEW.customer_user_id IS NOT NULL THEN
      RAISE EXCEPTION 'customer order ownership is server-managed';
    END IF;
  ELSE
    SELECT u.email_confirmed_at, u.email INTO v_email_confirmed_at, v_verified_email
    FROM auth.users u
    WHERE u.id = v_user_id;

    IF NOT FOUND OR v_email_confirmed_at IS NULL THEN
      RAISE EXCEPTION 'EMAIL_NOT_VERIFIED';
    END IF;
    IF v_verified_email IS NULL OR position('@' in v_verified_email) < 2 THEN
      RAISE EXCEPTION 'ACCOUNT_EMAIL_UNAVAILABLE';
    END IF;

    SELECT cp.status INTO v_status
    FROM public.customer_profiles cp
    WHERE cp.user_id = v_user_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'ACCOUNT_PROFILE_REQUIRED';
    ELSIF v_status <> 'active' THEN
      RAISE EXCEPTION 'ACCOUNT_RESTRICTED';
    END IF;

    IF NEW.customer_user_id IS NOT NULL AND NEW.customer_user_id <> v_user_id THEN
      RAISE EXCEPTION 'customer order ownership is server-managed';
    END IF;
    NEW.customer_user_id := v_user_id;
    NEW.email := lower(btrim(v_verified_email));
  END IF;

  -- The capability hash is private DB state; never persist it in the
  -- player_inputs JSON returned to customers, supplier adapters or admins.
  NEW.player_inputs := COALESCE(NEW.player_inputs, '{}'::jsonb) - '__rfz_order_access_hash';
  INSERT INTO public.guest_order_access (order_id, token_hash, expires_at)
  VALUES (NEW.id, v_capability_hash, now() + interval '60 days');

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS set_order_customer_ownership ON public.orders;
CREATE TRIGGER set_order_customer_ownership
  BEFORE INSERT ON public.orders
  FOR EACH ROW
  EXECUTE FUNCTION public.set_order_customer_ownership();
REVOKE ALL ON FUNCTION public.set_order_customer_ownership() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.prevent_order_owner_reassignment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
BEGIN
  IF NEW.customer_user_id IS DISTINCT FROM OLD.customer_user_id THEN
    RAISE EXCEPTION 'customer order ownership is immutable';
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS prevent_order_owner_reassignment ON public.orders;
CREATE TRIGGER prevent_order_owner_reassignment
  BEFORE UPDATE OF customer_user_id ON public.orders
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_order_owner_reassignment();
REVOKE ALL ON FUNCTION public.prevent_order_owner_reassignment() FROM PUBLIC, anon, authenticated;

-- create_order must run with the caller's anon/authenticated JWT so auth.uid()
-- and the guest policy are authoritative. The application has no legitimate
-- service-role order-creation caller; deny that path explicitly.
REVOKE ALL ON FUNCTION public.create_order(uuid, uuid, text, text, jsonb, text, text, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.create_order(uuid, uuid, text, text, jsonb, text, text, text)
  TO anon, authenticated;

-- A profile can become active only after Auth confirms the target user's email.
CREATE OR REPLACE FUNCTION public.protect_customer_profile_system_fields()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_confirmed_at timestamptz;
BEGIN
  IF NEW.user_id IS DISTINCT FROM OLD.user_id THEN
    RAISE EXCEPTION 'customer profile ownership is immutable';
  END IF;
  IF NEW.email_snapshot IS DISTINCT FROM OLD.email_snapshot THEN
    RAISE EXCEPTION 'customer profile email is immutable';
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF NEW.status = 'active' THEN
      SELECT u.email_confirmed_at INTO v_confirmed_at
      FROM auth.users u WHERE u.id = NEW.user_id;
      IF NOT FOUND OR v_confirmed_at IS NULL THEN
        RAISE EXCEPTION 'EMAIL_NOT_VERIFIED';
      END IF;
    END IF;

    IF auth.uid() IS DISTINCT FROM NEW.user_id
       AND NOT EXISTS (
         SELECT 1 FROM public.admins a
         JOIN auth.users actor ON actor.id = a.id
         WHERE a.id = auth.uid()
           AND a.is_active IS TRUE
           AND a.role = 'SUPER_ADMIN'
           AND actor.email_confirmed_at IS NOT NULL
       ) THEN
      RAISE EXCEPTION 'FORBIDDEN';
    END IF;
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_set_customer_profile_status(p_user_id uuid, p_status text)
RETURNS TABLE(out_status text, out_error text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
BEGIN
  IF auth.uid() IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.admins a
    JOIN auth.users actor ON actor.id = a.id
    WHERE a.id = auth.uid()
      AND a.is_active IS TRUE
      AND a.role = 'SUPER_ADMIN'
      AND actor.email_confirmed_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'FORBIDDEN';
  END IF;

  IF p_status IS NULL OR p_status NOT IN ('pending_verification', 'active', 'suspended', 'deactivated') THEN
    RETURN QUERY SELECT NULL::text, 'Invalid customer profile status.'::text;
    RETURN;
  END IF;

  IF p_status = 'active' AND NOT EXISTS (
    SELECT 1 FROM auth.users u
    WHERE u.id = p_user_id AND u.email_confirmed_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'EMAIL_NOT_VERIFIED';
  END IF;

  UPDATE public.customer_profiles SET status = p_status WHERE user_id = p_user_id;
  IF NOT FOUND THEN
    RETURN QUERY SELECT NULL::text, 'Customer profile not found.'::text;
    RETURN;
  END IF;

  RETURN QUERY SELECT cp.status, NULL::text
  FROM public.customer_profiles cp WHERE cp.user_id = p_user_id;
END;
$function$;

-- Remove anonymous and direct authenticated INSERT paths; create_order remains
-- the supported insertion boundary and retains its existing eight arguments.
DROP POLICY IF EXISTS anon_select_orders ON public.orders;
DROP POLICY IF EXISTS anon_insert_orders ON public.orders;
DROP POLICY IF EXISTS "anon_select_orders" ON public.orders;
DROP POLICY IF EXISTS "anon_insert_orders" ON public.orders;
DROP POLICY IF EXISTS "Public can create orders" ON public.orders;
REVOKE ALL ON TABLE public.orders FROM PUBLIC, anon;
REVOKE INSERT, DELETE ON TABLE public.orders FROM authenticated;
DO $revoke_order_column_grants$
DECLARE c record;
BEGIN
  FOR c IN
    SELECT a.attname
    FROM pg_attribute a
    WHERE a.attrelid = 'public.orders'::regclass
      AND a.attnum > 0 AND NOT a.attisdropped
  LOOP
    EXECUTE format('REVOKE SELECT (%I) ON TABLE public.orders FROM PUBLIC, anon', c.attname);
    EXECUTE format('REVOKE INSERT (%I) ON TABLE public.orders FROM PUBLIC, anon, authenticated', c.attname);
    EXECUTE format('REVOKE UPDATE (%I) ON TABLE public.orders FROM PUBLIC, anon', c.attname);
  END LOOP;
END
$revoke_order_column_grants$;
-- Customers only need to read their own orders. All order mutations remain
-- behind trusted RPCs/server-side workflows.
GRANT SELECT ON TABLE public.orders TO authenticated;

DROP POLICY IF EXISTS anon_select_order_timeline ON public.order_timeline;
DROP POLICY IF EXISTS anon_insert_order_timeline ON public.order_timeline;
DROP POLICY IF EXISTS anon_update_order_timeline ON public.order_timeline;
DROP POLICY IF EXISTS anon_delete_order_timeline ON public.order_timeline;
DROP POLICY IF EXISTS "anon_select_order_timeline" ON public.order_timeline;
DROP POLICY IF EXISTS "anon_insert_order_timeline" ON public.order_timeline;
REVOKE ALL ON TABLE public.order_timeline FROM PUBLIC, anon;
REVOKE UPDATE, DELETE ON TABLE public.order_timeline FROM authenticated;
DO $revoke_timeline_column_grants$
DECLARE c record;
BEGIN
  FOR c IN
    SELECT a.attname
    FROM pg_attribute a
    WHERE a.attrelid = 'public.order_timeline'::regclass
      AND a.attnum > 0 AND NOT a.attisdropped
  LOOP
    EXECUTE format('REVOKE SELECT (%I) ON TABLE public.order_timeline FROM PUBLIC, anon', c.attname);
    EXECUTE format('REVOKE INSERT (%I) ON TABLE public.order_timeline FROM PUBLIC, anon', c.attname);
    EXECUTE format('REVOKE UPDATE (%I) ON TABLE public.order_timeline FROM PUBLIC, anon', c.attname);
  END LOOP;
END
$revoke_timeline_column_grants$;
-- Timeline entries are written by trusted RPCs and system workers, never by
-- customer sessions.
GRANT SELECT ON TABLE public.order_timeline TO authenticated;

DROP POLICY IF EXISTS customer_select_own_order_timeline ON public.order_timeline;
CREATE POLICY customer_select_own_order_timeline
  ON public.order_timeline FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.orders o
    WHERE o.id = order_timeline.order_id
      AND o.customer_user_id = auth.uid()
  ));

-- generate_order_reference needs to inspect references internally, but that
-- lookup must not imply anonymous SELECT rights on the orders table.
ALTER FUNCTION public.generate_order_reference() SECURITY DEFINER;
ALTER FUNCTION public.generate_order_reference() SET search_path = pg_catalog, public;

-- The application submits proofs only after capability verification. Direct
-- RPC callers cannot bypass the protected server endpoint with ref + email.
REVOKE ALL ON FUNCTION public.submit_payment(text, text, text, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.submit_payment(text, text, text, text, text, text) TO service_role;

-- Do not expose the guest-checkout policy mutation until the same migration
-- has installed the database order-creation enforcement above.
GRANT EXECUTE ON FUNCTION public.admin_set_allow_guest_checkout(boolean) TO authenticated;
