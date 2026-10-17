\set ON_ERROR_STOP on

-- Disposable Supabase-only tests for the Phase 1A account foundation.
-- No production connection settings or customer data are used.

BEGIN;

CREATE TEMP TABLE customer_auth_test_ids (
  user_id uuid NOT NULL,
  other_user_id uuid NOT NULL,
  admin_user_id uuid NOT NULL,
  game_id uuid NOT NULL,
  package_id uuid NOT NULL
);

INSERT INTO customer_auth_test_ids VALUES (
  '00000000-0000-0000-0000-000000000011',
  '00000000-0000-0000-0000-000000000012',
  '00000000-0000-0000-0000-000000000013',
  '00000000-0000-0000-0000-000000000014',
  '00000000-0000-0000-0000-000000000015'
);

-- Synthetic Auth users. The migration trigger must create pending profiles.
INSERT INTO auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at
)
SELECT user_id, (SELECT id FROM auth.instances LIMIT 1), 'authenticated', 'authenticated',
       'customer-one@example.invalid', 'security-test-password', NULL,
       '{}'::jsonb, '{"full_name":"Customer One"}'::jsonb, now(), now()
FROM customer_auth_test_ids
ON CONFLICT (id) DO NOTHING;

INSERT INTO auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at
)
SELECT other_user_id, (SELECT id FROM auth.instances LIMIT 1), 'authenticated', 'authenticated',
       'customer-two@example.invalid', 'security-test-password', NULL,
       '{}'::jsonb, '{"full_name":"Customer Two"}'::jsonb, now(), now()
FROM customer_auth_test_ids
ON CONFLICT (id) DO NOTHING;

INSERT INTO auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at
)
SELECT admin_user_id, (SELECT id FROM auth.instances LIMIT 1), 'authenticated', 'authenticated',
       'customer-admin@example.invalid', 'security-test-password', now(),
       '{}'::jsonb, '{"full_name":"Customer Admin"}'::jsonb, now(), now()
FROM customer_auth_test_ids
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.admins (id, email, name, role, is_active)
SELECT admin_user_id, 'customer-admin@example.invalid', 'Customer Test Admin', 'SUPER_ADMIN', true
FROM customer_auth_test_ids
ON CONFLICT (id) DO UPDATE SET is_active = true;

INSERT INTO public.games (id, slug, name, short_name, description, region, currency, is_active, sort_order)
SELECT game_id, 'customer-auth-test-game', 'Customer Auth Test Game', 'AUTH', 'Disposable fixture', 'Test', 'PHP', true, 1001
FROM customer_auth_test_ids
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.packages (id, game_id, name, sku, amount, price_cents, sort_order)
SELECT package_id, game_id, 'Customer Auth Test Package', 'CUSTOMER-AUTH-TEST', '1', 1, 1001
FROM customer_auth_test_ids
ON CONFLICT (id) DO NOTHING;

DO $$
DECLARE
  v_status text;
  v_email text;
  v_failures text[];
  v_public_grants text;
BEGIN
  IF to_regprocedure('public.activate_customer_profile()') IS NULL
     OR to_regprocedure('public.admin_set_customer_profile_status(uuid,text)') IS NULL THEN
    RAISE EXCEPTION 'customer profile lifecycle functions are missing';
  END IF;

  IF has_function_privilege('anon', 'public.activate_customer_profile()', 'EXECUTE')
     OR has_function_privilege('anon', 'public.admin_set_customer_profile_status(uuid,text)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.activate_customer_profile()', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.admin_set_customer_profile_status(uuid,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'customer profile lifecycle grants are unsafe';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
    WHERE p.oid = to_regprocedure('public.activate_customer_profile()')::oid
      AND p.prosecdef
      AND p.proconfig @> ARRAY['search_path=public']::text[]
  ) THEN
    RAISE EXCEPTION 'activation function is not a locked SECURITY DEFINER';
  END IF;

  SELECT status, email_snapshot INTO v_status, v_email
  FROM public.customer_profiles
  WHERE user_id = '00000000-0000-0000-0000-000000000011';

  IF v_status <> 'pending_verification' OR v_email <> 'customer-one@example.invalid' THEN
    RAISE EXCEPTION 'new customer profile was not created in pending state';
  END IF;

  -- Keep these as individually labeled effective-privilege checks. The
  -- has_*_privilege functions include privileges inherited through PUBLIC and
  -- role membership; the column checks separately catch column ACLs that can
  -- survive a table-level REVOKE. Direct PUBLIC ACLs are reported as context,
  -- not as a warning-only bypass of the assertion.
  v_failures := ARRAY[]::text[];
    SELECT COALESCE(string_agg(acl.privilege_type, ',' ORDER BY acl.privilege_type), 'none')
    INTO v_public_grants
    FROM pg_class c,
         LATERAL aclexplode(COALESCE(c.relacl, acldefault('r', c.relowner))) acl
    WHERE c.oid = 'public.orders'::regclass
      AND acl.grantee = 0
      AND acl.privilege_type IN ('SELECT', 'INSERT', 'UPDATE', 'DELETE');

    IF has_table_privilege('anon', 'public.orders', 'SELECT') THEN
      v_failures := array_append(v_failures, format('role=anon object=public.orders privilege=SELECT expected=denied actual=granted public_acl=%s', v_public_grants));
    END IF;
    IF has_table_privilege('anon', 'public.orders', 'INSERT') THEN
      v_failures := array_append(v_failures, format('role=anon object=public.orders privilege=INSERT expected=denied actual=granted public_acl=%s', v_public_grants));
    END IF;
    IF has_table_privilege('anon', 'public.orders', 'UPDATE') THEN
      v_failures := array_append(v_failures, format('role=anon object=public.orders privilege=UPDATE expected=denied actual=granted public_acl=%s', v_public_grants));
    END IF;
    IF has_table_privilege('anon', 'public.orders', 'DELETE') THEN
      v_failures := array_append(v_failures, format('role=anon object=public.orders privilege=DELETE expected=denied actual=granted public_acl=%s', v_public_grants));
    END IF;
    IF has_table_privilege('authenticated', 'public.orders', 'INSERT') THEN
      v_failures := array_append(v_failures, format('role=authenticated object=public.orders privilege=INSERT expected=denied actual=granted public_acl=%s', v_public_grants));
    END IF;
    IF has_table_privilege('authenticated', 'public.orders', 'UPDATE') THEN
      v_failures := array_append(v_failures, format('role=authenticated object=public.orders privilege=UPDATE expected=denied actual=granted public_acl=%s', v_public_grants));
    END IF;
    IF has_any_column_privilege('authenticated', 'public.orders', 'UPDATE') THEN
      v_failures := array_append(v_failures, 'role=authenticated object=public.orders columns privilege=UPDATE expected=denied actual=granted');
    END IF;
    IF has_table_privilege('authenticated', 'public.orders', 'DELETE') THEN
      v_failures := array_append(v_failures, format('role=authenticated object=public.orders privilege=DELETE expected=denied actual=granted public_acl=%s', v_public_grants));
    END IF;
    IF has_any_column_privilege('anon', 'public.orders', 'SELECT') THEN
      v_failures := array_append(v_failures, 'role=anon object=public.orders columns privilege=SELECT expected=denied actual=granted');
    END IF;
    IF has_any_column_privilege('anon', 'public.orders', 'INSERT') THEN
      v_failures := array_append(v_failures, 'role=anon object=public.orders columns privilege=INSERT expected=denied actual=granted');
    END IF;
    IF has_any_column_privilege('anon', 'public.orders', 'UPDATE') THEN
      v_failures := array_append(v_failures, 'role=anon object=public.orders columns privilege=UPDATE expected=denied actual=granted');
    END IF;

    SELECT COALESCE(string_agg(acl.privilege_type, ',' ORDER BY acl.privilege_type), 'none')
    INTO v_public_grants
    FROM pg_class c,
         LATERAL aclexplode(COALESCE(c.relacl, acldefault('r', c.relowner))) acl
    WHERE c.oid = 'public.order_timeline'::regclass
      AND acl.grantee = 0
      AND acl.privilege_type IN ('SELECT', 'INSERT', 'UPDATE', 'DELETE');

    IF has_table_privilege('anon', 'public.order_timeline', 'SELECT') THEN
      v_failures := array_append(v_failures, format('role=anon object=public.order_timeline privilege=SELECT expected=denied actual=granted public_acl=%s', v_public_grants));
    END IF;
    IF has_table_privilege('anon', 'public.order_timeline', 'INSERT') THEN
      v_failures := array_append(v_failures, format('role=anon object=public.order_timeline privilege=INSERT expected=denied actual=granted public_acl=%s', v_public_grants));
    END IF;
    IF has_table_privilege('anon', 'public.order_timeline', 'UPDATE') THEN
      v_failures := array_append(v_failures, format('role=anon object=public.order_timeline privilege=UPDATE expected=denied actual=granted public_acl=%s', v_public_grants));
    END IF;
    IF has_table_privilege('anon', 'public.order_timeline', 'DELETE') THEN
      v_failures := array_append(v_failures, format('role=anon object=public.order_timeline privilege=DELETE expected=denied actual=granted public_acl=%s', v_public_grants));
    END IF;
    IF has_table_privilege('authenticated', 'public.order_timeline', 'INSERT') THEN
      v_failures := array_append(v_failures, format('role=authenticated object=public.order_timeline privilege=INSERT expected=denied actual=granted public_acl=%s', v_public_grants));
    END IF;
    IF has_any_column_privilege('authenticated', 'public.order_timeline', 'INSERT') THEN
      v_failures := array_append(v_failures, 'role=authenticated object=public.order_timeline columns privilege=INSERT expected=denied actual=granted');
    END IF;
    IF has_table_privilege('authenticated', 'public.order_timeline', 'UPDATE') THEN
      v_failures := array_append(v_failures, format('role=authenticated object=public.order_timeline privilege=UPDATE expected=denied actual=granted public_acl=%s', v_public_grants));
    END IF;
    IF has_table_privilege('authenticated', 'public.order_timeline', 'DELETE') THEN
      v_failures := array_append(v_failures, format('role=authenticated object=public.order_timeline privilege=DELETE expected=denied actual=granted public_acl=%s', v_public_grants));
    END IF;
    IF has_any_column_privilege('anon', 'public.order_timeline', 'SELECT') THEN
      v_failures := array_append(v_failures, 'role=anon object=public.order_timeline columns privilege=SELECT expected=denied actual=granted');
    END IF;
    IF has_any_column_privilege('anon', 'public.order_timeline', 'INSERT') THEN
      v_failures := array_append(v_failures, 'role=anon object=public.order_timeline columns privilege=INSERT expected=denied actual=granted');
    END IF;
    IF has_any_column_privilege('anon', 'public.order_timeline', 'UPDATE') THEN
      v_failures := array_append(v_failures, 'role=anon object=public.order_timeline columns privilege=UPDATE expected=denied actual=granted');
    END IF;

  IF cardinality(v_failures) > 0 THEN
    RAISE EXCEPTION 'unauthorized order/timeline privileges: %', array_to_string(v_failures, ' | ');
  END IF;

  IF to_regprocedure('public.create_order(uuid,uuid,text,text,jsonb,text,text,text)') IS NULL
     OR NOT has_function_privilege('anon', 'public.create_order(uuid,uuid,text,text,jsonb,text,text,text)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.create_order(uuid,uuid,text,text,jsonb,text,text,text)', 'EXECUTE')
     OR has_function_privilege('service_role', 'public.create_order(uuid,uuid,text,text,jsonb,text,text,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'create_order caller grants are unsafe';
  END IF;

  IF has_schema_privilege('anon', 'public', 'CREATE')
     OR has_schema_privilege('authenticated', 'public', 'CREATE') THEN
    RAISE EXCEPTION 'untrusted API roles can CREATE objects in public';
  END IF;

  IF has_table_privilege('anon', 'public.checkout_policy', 'SELECT')
     OR has_table_privilege('authenticated', 'public.checkout_policy', 'UPDATE')
     OR has_table_privilege('service_role', 'public.checkout_policy', 'UPDATE')
     OR has_table_privilege('anon', 'public.checkout_policy_audit', 'SELECT')
     OR has_table_privilege('authenticated', 'public.checkout_policy_audit', 'INSERT')
     OR has_table_privilege('service_role', 'public.checkout_policy_audit', 'UPDATE')
     OR has_function_privilege('anon', 'public.admin_set_allow_guest_checkout(boolean)', 'EXECUTE')
     OR has_function_privilege('service_role', 'public.admin_set_allow_guest_checkout(boolean)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.admin_set_allow_guest_checkout(boolean)', 'EXECUTE') THEN
    RAISE EXCEPTION 'checkout policy table or mutation privileges are unsafe';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
    WHERE p.oid = to_regprocedure('public.admin_set_allow_guest_checkout(boolean)')::oid
      AND p.prosecdef
      AND p.proconfig @> ARRAY['search_path=pg_catalog, public']::text[]
  ) THEN
    RAISE EXCEPTION 'checkout policy mutation is not a fixed-path SECURITY DEFINER';
  END IF;

  IF (SELECT allow_guest_checkout FROM public.checkout_policy
      WHERE setting_key = 'allow_guest_checkout') IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'guest checkout default is not TRUE';
  END IF;
END $$;

-- Anonymous users cannot read profiles or execute lifecycle functions.
SET LOCAL ROLE anon;
SELECT set_config('request.jwt.claims', '{"role":"anon"}', true);
DO $$
BEGIN
  BEGIN
    PERFORM 1 FROM public.customer_profiles;
    RAISE EXCEPTION 'anonymous profile access unexpectedly succeeded';
  EXCEPTION
    WHEN insufficient_privilege THEN
      NULL;
  END;
  BEGIN
    PERFORM 1 FROM public.activate_customer_profile();
    RAISE EXCEPTION 'anonymous profile activation unexpectedly executed';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;

  BEGIN
    PERFORM email FROM public.orders;
    RAISE EXCEPTION 'anonymous order enumeration unexpectedly succeeded';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;

  BEGIN
    INSERT INTO public.orders (customer_user_id)
    VALUES ('00000000-0000-0000-0000-000000000012');
    RAISE EXCEPTION 'anonymous direct order INSERT unexpectedly succeeded';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;

  BEGIN
    PERFORM note FROM public.order_timeline;
    RAISE EXCEPTION 'anonymous timeline enumeration unexpectedly succeeded';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;
END $$;
RESET ROLE;

-- The owner can read and edit display_name, but cannot change status or email.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"role":"authenticated","sub":"00000000-0000-0000-0000-000000000011"}', true);
DO $$
DECLARE
  v_count integer;
BEGIN
  SELECT count(*) INTO v_count
  FROM public.customer_profiles
  WHERE user_id = '00000000-0000-0000-0000-000000000011';
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'profile owner cannot read own profile';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.customer_profiles
    WHERE user_id = '00000000-0000-0000-0000-000000000012'
  ) THEN
    RAISE EXCEPTION 'profile owner can read another customer profile';
  END IF;

  UPDATE public.customer_profiles
  SET display_name = 'Updated Customer One'
  WHERE user_id = '00000000-0000-0000-0000-000000000011';

  BEGIN
    UPDATE public.customer_profiles
    SET status = 'active'
    WHERE user_id = '00000000-0000-0000-0000-000000000011';
    RAISE EXCEPTION 'customer could directly change profile status';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;

  BEGIN
    UPDATE public.customer_profiles
    SET email_snapshot = 'attacker@example.invalid'
    WHERE user_id = '00000000-0000-0000-0000-000000000011';
    RAISE EXCEPTION 'customer could directly change email snapshot';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;

  BEGIN
    INSERT INTO public.orders (customer_user_id)
    VALUES ('00000000-0000-0000-0000-000000000012');
    RAISE EXCEPTION 'authenticated direct order INSERT unexpectedly succeeded';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;
END $$;
RESET ROLE;

-- Unverified users cannot activate or create orders.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"role":"authenticated","sub":"00000000-0000-0000-0000-000000000011"}', true);
DO $$
DECLARE
  v_error text;
BEGIN
  SELECT out_error INTO v_error FROM public.activate_customer_profile();
  IF v_error <> 'EMAIL_NOT_VERIFIED' THEN
    RAISE EXCEPTION 'unverified activation did not fail closed: %', v_error;
  END IF;

  BEGIN
    PERFORM 1 FROM public.create_order(
      '00000000-0000-0000-0000-000000000014',
      '00000000-0000-0000-0000-000000000015',
      'customer-one@example.invalid', 'Customer One',
      jsonb_build_object('__rfz_order_access_hash', repeat('a', 64)), 'manual'
    );
    RAISE EXCEPTION 'unverified customer could create an order';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'EMAIL_NOT_VERIFIED' THEN
      RAISE;
    END IF;
  END;
END $$;
RESET ROLE;

-- Confirmation is an Auth fact, and activation changes only pending profiles.
UPDATE auth.users
SET email_confirmed_at = now()
WHERE id = '00000000-0000-0000-0000-000000000011';

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"role":"authenticated","sub":"00000000-0000-0000-0000-000000000011"}', true);
DO $$
DECLARE
  v_status text;
  v_error text;
BEGIN
  SELECT out_status, out_error INTO v_status, v_error
  FROM public.activate_customer_profile();
  IF v_status <> 'active' OR v_error IS NOT NULL THEN
    RAISE EXCEPTION 'confirmed customer did not activate: %, %', v_status, v_error;
  END IF;

  SELECT out_status, out_error INTO v_status, v_error
  FROM public.activate_customer_profile();
  IF v_status <> 'active' OR v_error IS NOT NULL THEN
    RAISE EXCEPTION 'active customer activation was not idempotent';
  END IF;
END $$;
RESET ROLE;

-- An active customer gets UUID ownership from auth.uid(), not from input.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"role":"authenticated","sub":"00000000-0000-0000-0000-000000000011"}', true);
DO $$
DECLARE
  v_order_id uuid;
  v_owner uuid;
  v_email text;
BEGIN
  SELECT out_order_id INTO v_order_id
  FROM public.create_order(
    '00000000-0000-0000-0000-000000000014',
    '00000000-0000-0000-0000-000000000015',
    'customer-one@example.invalid', 'Customer One',
    jsonb_build_object('__rfz_order_access_hash', repeat('b', 64), 'customer_user_id', '00000000-0000-0000-0000-000000000012'), 'manual'
  );

  SELECT customer_user_id, email INTO v_owner, v_email FROM public.orders WHERE id = v_order_id;
  IF v_owner <> '00000000-0000-0000-0000-000000000011' THEN
    RAISE EXCEPTION 'authenticated order was not assigned to auth.uid()';
  END IF;
  IF v_email <> 'customer-one@example.invalid' THEN
    RAISE EXCEPTION 'authenticated order email was not derived from verified Auth';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.orders
    WHERE id = v_order_id AND player_inputs ? '__rfz_order_access_hash'
  ) THEN
    RAISE EXCEPTION 'private guest access hash was persisted in player_inputs';
  END IF;
END $$;
RESET ROLE;

-- A second customer cannot read the first customer's order.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"role":"authenticated","sub":"00000000-0000-0000-0000-000000000012"}', true);
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.orders
    WHERE customer_user_id = '00000000-0000-0000-0000-000000000011'
  ) THEN
    RAISE EXCEPTION 'cross-user order read unexpectedly succeeded';
  END IF;
END $$;
RESET ROLE;

-- Genuine anonymous checkout remains available by default. The resulting
-- order is unowned, the capability hash is stored privately, and no hash is
-- reflected in persisted player inputs.
SET LOCAL ROLE anon;
SELECT set_config('request.jwt.claims', '{"role":"anon"}', true);
SELECT out_order_id AS guest_order_id, out_reference AS guest_reference
FROM public.create_order(
  '00000000-0000-0000-0000-000000000014',
  '00000000-0000-0000-0000-000000000015',
  'guest@example.invalid', 'Guest Customer',
  jsonb_build_object('__rfz_order_access_hash', repeat('e', 64)), 'manual'
) \gset
RESET ROLE;
CREATE TEMP TABLE guest_order_fixture_ids (
  order_id uuid PRIMARY KEY
);
INSERT INTO guest_order_fixture_ids (order_id)
VALUES (:'guest_order_id'::uuid);
DO $$
DECLARE
  v_fixture_count integer;
  v_guest_order_id uuid;
  v_order_count integer;
  v_unowned_order_count integer;
  v_hash_stripped_count integer;
  v_capability_count integer;
  v_matching_capability_count integer;
  v_active_capability_count integer;
BEGIN
  SELECT count(*) INTO v_fixture_count
  FROM pg_temp.guest_order_fixture_ids;
  IF v_fixture_count <> 1 THEN
    RAISE EXCEPTION 'GUEST_FIXTURE_ID_INVALID';
  END IF;

  SELECT order_id INTO v_guest_order_id
  FROM pg_temp.guest_order_fixture_ids;

  SELECT count(*) INTO v_order_count
  FROM public.orders
  WHERE id = v_guest_order_id;
  IF v_order_count = 0 THEN
    RAISE EXCEPTION 'GUEST_ORDER_NOT_FOUND';
  END IF;

  SELECT count(*) INTO v_unowned_order_count
  FROM public.orders
  WHERE id = v_guest_order_id
    AND customer_user_id IS NULL;
  IF v_unowned_order_count = 0 THEN
    RAISE EXCEPTION 'GUEST_ORDER_OWNERSHIP_INVALID';
  END IF;

  SELECT count(*) INTO v_hash_stripped_count
  FROM public.orders
  WHERE id = v_guest_order_id
    AND NOT (player_inputs ? '__rfz_order_access_hash');
  IF v_hash_stripped_count = 0 THEN
    RAISE EXCEPTION 'GUEST_ORDER_HASH_NOT_STRIPPED';
  END IF;

  SELECT count(*) INTO v_capability_count
  FROM public.guest_order_access
  WHERE order_id = v_guest_order_id;
  IF v_capability_count = 0 THEN
    RAISE EXCEPTION 'GUEST_CAPABILITY_NOT_FOUND';
  ELSIF v_capability_count <> 1 THEN
    RAISE EXCEPTION 'GUEST_CAPABILITY_DUPLICATE';
  END IF;

  SELECT count(*) INTO v_matching_capability_count
  FROM public.guest_order_access
  WHERE order_id = v_guest_order_id
    AND token_hash = repeat('e', 64);
  IF v_matching_capability_count = 0 THEN
    RAISE EXCEPTION 'GUEST_CAPABILITY_HASH_MISMATCH';
  END IF;

  SELECT count(*) INTO v_active_capability_count
  FROM public.guest_order_access
  WHERE order_id = v_guest_order_id
    AND token_hash = repeat('e', 64)
    AND revoked_at IS NULL;
  IF v_active_capability_count = 0 THEN
    RAISE EXCEPTION 'GUEST_CAPABILITY_REVOKED';
  END IF;
END $$;

-- Challenge RPCs are service-only. Verify public roles cannot invoke them,
-- then exercise the synthetic email-code recovery state transition as the
-- trusted server role without sending mail or exposing a real order.
DO $$
BEGIN
  IF has_function_privilege('anon', 'public.create_guest_order_access_challenge(text,text,text,text)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.create_guest_order_access_challenge(text,text,text,text)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.create_guest_order_access_challenge(text,text,text,text)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.consume_guest_order_access_challenge(text,text,text,text)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.consume_guest_order_access_challenge(text,text,text,text)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.consume_guest_order_access_challenge(text,text,text,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'guest recovery RPC grants are unsafe';
  END IF;
END $$;

SET LOCAL ROLE anon;
SELECT set_config('request.jwt.claims', '{"role":"anon"}', true);
DO $$
BEGIN
  BEGIN
    PERFORM public.create_guest_order_access_challenge('RF-ABC234', 'guest@example.invalid', repeat('1', 64), repeat('2', 64));
    RAISE EXCEPTION 'anon invoked service-only guest recovery RPC';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
RESET ROLE;

SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);
SELECT CASE WHEN public.create_guest_order_access_challenge(
  :'guest_reference', 'guest@example.invalid', repeat('3', 64), repeat('4', 64)
) THEN 1 ELSE 1/0 END AS challenge_created;
SELECT public.consume_guest_order_access_challenge(
  :'guest_reference', 'guest@example.invalid', repeat('3', 64), repeat('5', 64)
) AS recovered_order_id \gset
RESET ROLE;
SELECT CASE WHEN :'recovered_order_id'::uuid = :'guest_order_id'::uuid
  AND EXISTS (
    SELECT 1 FROM public.guest_order_access
    WHERE order_id = :'guest_order_id'::uuid
      AND token_hash = repeat('5', 64)
      AND revoked_at IS NULL
  ) THEN 1 ELSE 1/0 END AS guest_recovery_consumed;

-- Admin status changes are explicit and do not allow a non-admin caller.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"role":"authenticated","sub":"00000000-0000-0000-0000-000000000012"}', true);
DO $$
BEGIN
  BEGIN
    PERFORM 1 FROM public.admin_set_customer_profile_status(
      '00000000-0000-0000-0000-000000000011', 'suspended'
    );
    RAISE EXCEPTION 'non-admin changed customer profile status';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'FORBIDDEN' THEN
      RAISE;
    END IF;
  END;
END $$;
RESET ROLE;

-- SUPER_ADMIN is independently checked for policy updates; changes are audited.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"role":"authenticated","sub":"00000000-0000-0000-0000-000000000012"}', true);
DO $$
BEGIN
  BEGIN
    PERFORM public.admin_set_allow_guest_checkout(false);
    RAISE EXCEPTION 'non-admin changed the guest checkout policy';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'FORBIDDEN' THEN RAISE; END IF;
  END;
END $$;
RESET ROLE;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"role":"authenticated","sub":"00000000-0000-0000-0000-000000000013"}', true);
DO $$
DECLARE v_enabled boolean;
BEGIN
  SELECT public.admin_set_allow_guest_checkout(false) INTO v_enabled;
  IF v_enabled IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'authorized super admin could not disable guest checkout';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.checkout_policy_audit
    WHERE setting_key = 'allow_guest_checkout'
      AND old_value IS TRUE AND new_value IS FALSE
      AND changed_by = '00000000-0000-0000-0000-000000000013'
  ) THEN
    RAISE EXCEPTION 'checkout policy change was not audited';
  END IF;
END $$;
RESET ROLE;

UPDATE auth.users SET email_confirmed_at = NULL
WHERE id = '00000000-0000-0000-0000-000000000013';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"role":"authenticated","sub":"00000000-0000-0000-0000-000000000013"}', true);
DO $$
BEGIN
  BEGIN
    PERFORM public.admin_set_allow_guest_checkout(true);
    RAISE EXCEPTION 'unconfirmed super admin changed guest checkout policy';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'FORBIDDEN' THEN RAISE; END IF;
  END;
END $$;
RESET ROLE;
UPDATE auth.users SET email_confirmed_at = now()
WHERE id = '00000000-0000-0000-0000-000000000013';

DO $$
BEGIN
  BEGIN
    UPDATE public.checkout_policy_audit
    SET new_value = true
    WHERE setting_key = 'allow_guest_checkout' AND new_value IS FALSE;
    RAISE EXCEPTION 'checkout policy audit record was mutable';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'checkout policy audit entries are immutable' THEN RAISE; END IF;
  END;
END $$;

-- Guest OFF blocks anonymous RPC creation; active verified users remain allowed.
SET LOCAL ROLE anon;
SELECT set_config('request.jwt.claims', '{"role":"anon"}', true);
DO $$
BEGIN
  BEGIN
    PERFORM 1 FROM public.create_order(
      '00000000-0000-0000-0000-000000000014',
      '00000000-0000-0000-0000-000000000015',
      'guest@example.invalid', 'Guest Customer',
      jsonb_build_object('__rfz_order_access_hash', repeat('c', 64)), 'manual'
    );
    RAISE EXCEPTION 'anonymous checkout succeeded while guest checkout was disabled';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'GUEST_CHECKOUT_DISABLED' THEN RAISE; END IF;
  END;
END $$;
RESET ROLE;

SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);
DO $$
BEGIN
  BEGIN
    PERFORM 1 FROM public.create_order(
      '00000000-0000-0000-0000-000000000014',
      '00000000-0000-0000-0000-000000000015',
      'service@example.invalid', 'Service Caller',
      jsonb_build_object('__rfz_order_access_hash', repeat('9', 64)), 'manual'
    );
    RAISE EXCEPTION 'service_role bypassed guest policy through create_order';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
RESET ROLE;

-- Account eligibility is independently enforced while guest checkout is OFF.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"role":"authenticated","sub":"00000000-0000-0000-0000-000000000013"}', true);
SELECT out_status FROM public.admin_set_customer_profile_status(
  '00000000-0000-0000-0000-000000000011', 'pending_verification'
);
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"role":"authenticated","sub":"00000000-0000-0000-0000-000000000011"}', true);
DO $$
BEGIN
  BEGIN
    PERFORM 1 FROM public.create_order(
      '00000000-0000-0000-0000-000000000014', '00000000-0000-0000-0000-000000000015',
      'customer-one@example.invalid', 'Customer One',
      jsonb_build_object('__rfz_order_access_hash', repeat('6', 64)), 'manual'
    );
    RAISE EXCEPTION 'pending customer purchased while guest checkout was disabled';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'ACCOUNT_RESTRICTED' THEN RAISE; END IF;
  END;
END $$;
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"role":"authenticated","sub":"00000000-0000-0000-0000-000000000013"}', true);
SELECT out_status FROM public.admin_set_customer_profile_status(
  '00000000-0000-0000-0000-000000000011', 'active'
);
RESET ROLE;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"role":"authenticated","sub":"00000000-0000-0000-0000-000000000013"}', true);
SELECT out_status FROM public.admin_set_customer_profile_status(
  '00000000-0000-0000-0000-000000000011', 'suspended'
);
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"role":"authenticated","sub":"00000000-0000-0000-0000-000000000011"}', true);
DO $$
BEGIN
  BEGIN
    PERFORM 1 FROM public.create_order(
      '00000000-0000-0000-0000-000000000014', '00000000-0000-0000-0000-000000000015',
      'customer-one@example.invalid', 'Customer One',
      jsonb_build_object('__rfz_order_access_hash', repeat('7', 64)), 'manual'
    );
    RAISE EXCEPTION 'suspended customer purchased while guest checkout was disabled';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'ACCOUNT_RESTRICTED' THEN RAISE; END IF;
  END;
END $$;
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"role":"authenticated","sub":"00000000-0000-0000-0000-000000000013"}', true);
SELECT out_status FROM public.admin_set_customer_profile_status(
  '00000000-0000-0000-0000-000000000011', 'active'
);
RESET ROLE;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"role":"authenticated","sub":"00000000-0000-0000-0000-000000000013"}', true);
SELECT out_status FROM public.admin_set_customer_profile_status(
  '00000000-0000-0000-0000-000000000011', 'deactivated'
);
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"role":"authenticated","sub":"00000000-0000-0000-0000-000000000011"}', true);
DO $$
BEGIN
  BEGIN
    PERFORM 1 FROM public.create_order(
      '00000000-0000-0000-0000-000000000014', '00000000-0000-0000-0000-000000000015',
      'customer-one@example.invalid', 'Customer One',
      jsonb_build_object('__rfz_order_access_hash', repeat('8', 64)), 'manual'
    );
    RAISE EXCEPTION 'deactivated customer purchased while guest checkout was disabled';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'ACCOUNT_RESTRICTED' THEN RAISE; END IF;
  END;
END $$;
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"role":"authenticated","sub":"00000000-0000-0000-0000-000000000013"}', true);
SELECT out_status FROM public.admin_set_customer_profile_status(
  '00000000-0000-0000-0000-000000000011', 'active'
);
RESET ROLE;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"role":"authenticated","sub":"00000000-0000-0000-0000-000000000011"}', true);
DO $$
DECLARE v_order_id uuid;
BEGIN
  SELECT out_order_id INTO v_order_id
  FROM public.create_order(
    '00000000-0000-0000-0000-000000000014',
    '00000000-0000-0000-0000-000000000015',
    'attacker@example.invalid', 'Customer One',
    jsonb_build_object('__rfz_order_access_hash', repeat('d', 64)), 'manual'
  );
  IF v_order_id IS NULL THEN
    RAISE EXCEPTION 'active customer checkout failed while guest checkout was disabled';
  END IF;
END $$;
RESET ROLE;

-- A verified SUPER_ADMIN can restore guest checkout; previously-created guest
-- orders remain NULL-owned and untouched by policy changes.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"role":"authenticated","sub":"00000000-0000-0000-0000-000000000013"}', true);
SELECT public.admin_set_allow_guest_checkout(true);
RESET ROLE;
SELECT CASE WHEN EXISTS (
  SELECT 1 FROM public.orders
  WHERE id = :'guest_order_id'::uuid
    AND customer_user_id IS NULL
    AND status = 'WAITING_PAYMENT'
) THEN 1 ELSE 1/0 END AS preexisting_guest_order_unchanged;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"role":"authenticated","sub":"00000000-0000-0000-0000-000000000013"}', true);
DO $$
DECLARE
  v_status text;
  v_error text;
BEGIN
  SELECT out_status, out_error INTO v_status, v_error
  FROM public.admin_set_customer_profile_status(
    '00000000-0000-0000-0000-000000000011', 'suspended'
  );
  IF v_status <> 'suspended' OR v_error IS NOT NULL THEN
    RAISE EXCEPTION 'admin suspension failed: %, %', v_status, v_error;
  END IF;

  BEGIN
    PERFORM 1 FROM public.admin_set_customer_profile_status(
      '00000000-0000-0000-0000-000000000012', 'active'
    );
    RAISE EXCEPTION 'admin activated a user without confirmed email';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'EMAIL_NOT_VERIFIED' THEN RAISE; END IF;
  END;

  SELECT out_status, out_error INTO v_status, v_error
  FROM public.activate_customer_profile();
  IF v_status <> 'suspended' OR v_error <> 'ACCOUNT_RESTRICTED' THEN
    RAISE EXCEPTION 'activation unexpectedly changed a suspended account: %, %', v_status, v_error;
  END IF;

  SELECT out_status, out_error INTO v_status, v_error
  FROM public.admin_set_customer_profile_status(
    '00000000-0000-0000-0000-000000000011', 'deactivated'
  );
  IF v_status <> 'deactivated' OR v_error IS NOT NULL THEN
    RAISE EXCEPTION 'admin deactivation failed: %, %', v_status, v_error;
  END IF;

  SELECT out_status, out_error INTO v_status, v_error
  FROM public.activate_customer_profile();
  IF v_status <> 'deactivated' OR v_error <> 'ACCOUNT_RESTRICTED' THEN
    RAISE EXCEPTION 'deactivated customer was reactivated unexpectedly';
  END IF;
END $$;
RESET ROLE;

-- The deactivated customer's existing order remains private and new checkout is
-- rejected. Guest checkout remains NULL-owned and available to anon.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"role":"authenticated","sub":"00000000-0000-0000-0000-000000000011"}', true);
DO $$
BEGIN
  BEGIN
    PERFORM 1 FROM public.create_order(
      '00000000-0000-0000-0000-000000000014',
      '00000000-0000-0000-0000-000000000015',
      'customer-one@example.invalid', 'Customer One', '{}', 'manual'
    );
    RAISE EXCEPTION 'suspended customer could create an order';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'ACCOUNT_RESTRICTED' THEN
      RAISE;
    END IF;
  END;
END $$;
RESET ROLE;

ROLLBACK;
