-- Phase 1A customer-account foundation.
-- This migration is forward-only and deliberately does not backfill existing
-- guest orders or infer ownership from email addresses.

CREATE TABLE IF NOT EXISTS public.customer_profiles (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name text NOT NULL DEFAULT '' CHECK (char_length(display_name) <= 120),
  status text NOT NULL DEFAULT 'pending_verification'
    CHECK (status IN ('pending_verification', 'active', 'suspended', 'deactivated')),
  email_snapshot text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.customer_profiles ENABLE ROW LEVEL SECURITY;

-- Auth users receive a pending profile in the same transaction as signup.
-- A trigger failure aborts the auth-user insert, allowing the caller to retry
-- rather than leaving an account without its required security state.
CREATE OR REPLACE FUNCTION public.create_customer_profile_for_auth_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  IF NEW.email IS NOT NULL THEN
    INSERT INTO public.customer_profiles (user_id, display_name, email_snapshot)
    VALUES (
      NEW.id,
      left(COALESCE(btrim(NEW.raw_user_meta_data ->> 'full_name'), ''), 120),
      lower(btrim(NEW.email))
    )
    ON CONFLICT (user_id) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS on_auth_user_created_customer_profile ON auth.users;
CREATE TRIGGER on_auth_user_created_customer_profile
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.create_customer_profile_for_auth_user();

-- Only the owner may edit display_name. System fields are protected again in
-- the trigger below so future grants cannot make them client-writable.
CREATE OR REPLACE FUNCTION public.protect_customer_profile_system_fields()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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
    -- A customer may only activate their own pending profile after Supabase
    -- Auth has independently recorded email confirmation.
    IF NEW.status = 'active'
       AND OLD.status = 'pending_verification'
       AND auth.uid() = NEW.user_id THEN
      SELECT email_confirmed_at
      INTO v_confirmed_at
      FROM auth.users
      WHERE id = NEW.user_id;

      IF v_confirmed_at IS NULL THEN
        RAISE EXCEPTION 'EMAIL_NOT_VERIFIED';
      END IF;
    ELSIF NOT public.is_admin() THEN
      RAISE EXCEPTION 'customer profile status is server-managed';
    END IF;
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS protect_customer_profile_system_fields ON public.customer_profiles;
CREATE TRIGGER protect_customer_profile_system_fields
  BEFORE UPDATE ON public.customer_profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.protect_customer_profile_system_fields();

-- Trusted activation operation used after the server verifies the Auth user.
-- Suspended and deactivated accounts are never reactivated by this function.
CREATE OR REPLACE FUNCTION public.activate_customer_profile()
RETURNS TABLE(out_status text, out_error text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_status text;
  v_confirmed_at timestamptz;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN QUERY SELECT NULL::text, 'UNAUTHENTICATED'::text;
    RETURN;
  END IF;

  SELECT email_confirmed_at INTO v_confirmed_at
  FROM auth.users
  WHERE id = v_user_id;

  SELECT status INTO v_status
  FROM public.customer_profiles
  WHERE user_id = v_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN QUERY SELECT NULL::text, 'PROFILE_MISSING'::text;
    RETURN;
  END IF;

  IF v_status IN ('suspended', 'deactivated') THEN
    RETURN QUERY SELECT v_status, 'ACCOUNT_RESTRICTED'::text;
    RETURN;
  END IF;

  IF v_status = 'pending_verification' AND v_confirmed_at IS NULL THEN
    RETURN QUERY SELECT v_status, 'EMAIL_NOT_VERIFIED'::text;
    RETURN;
  END IF;

  IF v_status = 'pending_verification' THEN
    UPDATE public.customer_profiles
    SET status = 'active'
    WHERE user_id = v_user_id;
    v_status := 'active';
  END IF;

  RETURN QUERY SELECT v_status, NULL::text;
END;
$function$;

-- Explicit admin status management. It uses the authenticated admin identity
-- carried by auth.uid(); service-role callers must use a separately verified
-- server-side admin flow and must not bypass this function with client input.
CREATE OR REPLACE FUNCTION public.admin_set_customer_profile_status(p_user_id uuid, p_status text)
RETURNS TABLE(out_status text, out_error text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'FORBIDDEN';
  END IF;

  IF p_status IS NULL
     OR p_status NOT IN ('pending_verification', 'active', 'suspended', 'deactivated') THEN
    RETURN QUERY SELECT NULL::text, 'Invalid customer profile status.'::text;
    RETURN;
  END IF;

  UPDATE public.customer_profiles
  SET status = p_status
  WHERE user_id = p_user_id;

  IF NOT FOUND THEN
    RETURN QUERY SELECT NULL::text, 'Customer profile not found.'::text;
    RETURN;
  END IF;

  RETURN QUERY
  SELECT cp.status, NULL::text
  FROM public.customer_profiles cp
  WHERE cp.user_id = p_user_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.create_customer_profile_for_auth_user() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.protect_customer_profile_system_fields() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.activate_customer_profile() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_set_customer_profile_status(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.activate_customer_profile() TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_set_customer_profile_status(uuid, text) TO authenticated;

REVOKE ALL ON TABLE public.customer_profiles FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.customer_profiles TO authenticated;
GRANT UPDATE (display_name) ON TABLE public.customer_profiles TO authenticated;
GRANT ALL ON TABLE public.customer_profiles TO service_role;

DROP POLICY IF EXISTS customer_profiles_select_own ON public.customer_profiles;
CREATE POLICY customer_profiles_select_own
  ON public.customer_profiles FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS customer_profiles_update_display_name ON public.customer_profiles;
CREATE POLICY customer_profiles_update_display_name
  ON public.customer_profiles FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Nullable ownership preserves every existing guest order as NULL. No
-- historical order is backfilled or matched by email.
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS customer_user_id uuid
  REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS orders_customer_user_id_idx
  ON public.orders(customer_user_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.set_order_customer_ownership()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_status text;
BEGIN
  IF v_user_id IS NULL THEN
    IF NEW.customer_user_id IS NOT NULL THEN
      RAISE EXCEPTION 'customer order ownership is server-managed';
    END IF;
    RETURN NEW;
  END IF;

  SELECT status INTO v_status
  FROM public.customer_profiles
  WHERE user_id = v_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ACCOUNT_PROFILE_REQUIRED';
  END IF;

  IF v_status = 'pending_verification' THEN
    RAISE EXCEPTION 'EMAIL_NOT_VERIFIED';
  ELSIF v_status IN ('suspended', 'deactivated') THEN
    RAISE EXCEPTION 'ACCOUNT_RESTRICTED';
  ELSIF v_status <> 'active' THEN
    RAISE EXCEPTION 'ACCOUNT_RESTRICTED';
  END IF;

  IF NEW.customer_user_id IS NOT NULL AND NEW.customer_user_id <> v_user_id THEN
    RAISE EXCEPTION 'customer order ownership is server-managed';
  END IF;

  NEW.customer_user_id := v_user_id;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS set_order_customer_ownership ON public.orders;
CREATE TRIGGER set_order_customer_ownership
  BEFORE INSERT ON public.orders
  FOR EACH ROW
  EXECUTE FUNCTION public.set_order_customer_ownership();

REVOKE ALL ON FUNCTION public.set_order_customer_ownership() FROM PUBLIC, anon, authenticated;

-- Anonymous guest tracking/checkout remains available. Authenticated direct
-- reads are restricted to UUID ownership; the existing admin policy remains.
DROP POLICY IF EXISTS anon_select_orders ON public.orders;
CREATE POLICY anon_select_orders
  ON public.orders FOR SELECT
  TO anon USING (true);

DROP POLICY IF EXISTS anon_insert_orders ON public.orders;
CREATE POLICY anon_insert_orders
  ON public.orders FOR INSERT
  TO anon
  WITH CHECK (customer_user_id IS NULL);

DROP POLICY IF EXISTS authenticated_select_own_orders ON public.orders;
CREATE POLICY authenticated_select_own_orders
  ON public.orders FOR SELECT
  TO authenticated
  USING (customer_user_id = auth.uid());

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'customer_profiles'
      AND column_name = 'user_id'
      AND data_type = 'uuid'
  ) THEN
    RAISE EXCEPTION 'customer_profiles.user_id UUID column is missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'orders'
      AND column_name = 'customer_user_id'
      AND data_type = 'uuid'
  ) THEN
    RAISE EXCEPTION 'orders.customer_user_id UUID column is missing';
  END IF;
END $$;
