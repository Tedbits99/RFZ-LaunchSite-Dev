\set ON_ERROR_STOP on

-- Disposable-only tests for the direct fulfillment completion boundary.
-- Supplier-confirmed completion and its independent-session concurrency test
-- remain covered by reconciliation-atomicity.sql and the reconciliation
-- concurrency setup/assertion pair.

BEGIN;

INSERT INTO public.admins (id, email, name, role, is_active)
VALUES (
  '00000000-0000-0000-0000-000000000301',
  'completion-guard-admin@example.invalid',
  'Completion Guard Admin',
  'SUPER_ADMIN',
  true
)
ON CONFLICT (id) DO UPDATE SET is_active = true;

INSERT INTO public.games (id, slug, name, short_name, description, region, currency, is_active, sort_order)
VALUES (
  '00000000-0000-0000-0000-000000000302',
  'completion-guard-game', 'Completion Guard Game', 'CG',
  'Disposable fixture', 'Test', 'PHP', true, 2302
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.packages (id, game_id, name, sku, amount, price_cents, sort_order)
VALUES (
  '00000000-0000-0000-0000-000000000303',
  '00000000-0000-0000-0000-000000000302',
  'Completion Guard Package', 'COMPLETION-GUARD-PACKAGE', '1', 1, 2302
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.orders (
  id, reference, email, customer_name, game_id, package_id, player_inputs,
  subtotal_cents, discount_cents, fee_cents, total_cents, payment_method,
  status, payment_status, fulfillment_status
)
VALUES
  (
    '00000000-0000-0000-0000-000000000304', 'COMPLETION-GUARD-DIRECT',
    'completion-guard@example.invalid', 'Completion Guard',
    '00000000-0000-0000-0000-000000000302',
    '00000000-0000-0000-0000-000000000303',
    jsonb_build_object('__rfz_order_access_hash', repeat('1', 64)),
    1, 0, 0, 1, 'manual', 'PROCESSING', 'VERIFIED', 'PROCESSING'
  ),
  (
    '00000000-0000-0000-0000-000000000305', 'COMPLETION-GUARD-NONTERMINAL',
    'completion-guard@example.invalid', 'Completion Guard',
    '00000000-0000-0000-0000-000000000302',
    '00000000-0000-0000-0000-000000000303',
    jsonb_build_object('__rfz_order_access_hash', repeat('2', 64)),
    1, 0, 0, 1, 'manual', 'PAYMENT_VERIFIED', 'VERIFIED', 'NOT_STARTED'
  )
ON CONFLICT (id) DO NOTHING;

DO $$
DECLARE
  v_status text;
  v_fulfillment text;
  v_timeline_count integer;
BEGIN
  IF has_function_privilege(
       'public.complete_fulfillment(uuid,text,text,text)', 'EXECUTE'
     ) IS NOT TRUE THEN
    RAISE EXCEPTION 'COMPLETION_GUARD_SIGNATURE_MISSING';
  END IF;

  IF has_function_privilege('anon', 'public.complete_fulfillment(uuid,text,text,text)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.complete_fulfillment(uuid,text,text,text)', 'EXECUTE') IS NOT TRUE THEN
    RAISE EXCEPTION 'COMPLETION_GUARD_GRANTS_INVALID';
  END IF;
END $$;

-- Anonymous callers remain denied at the privilege boundary.
SET LOCAL ROLE anon;
SELECT set_config('request.jwt.claims', '{"role":"anon"}', true);
DO $$
BEGIN
  BEGIN
    PERFORM * FROM public.complete_fulfillment(
      '00000000-0000-0000-0000-000000000304', 'COMPLETED', 'anon', 'denial test'
    );
    RAISE EXCEPTION 'COMPLETION_GUARD_ANON_ALLOWED';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;
END $$;
RESET ROLE;

-- Authenticated non-operators retain the existing FORBIDDEN boundary.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"role":"authenticated","sub":"00000000-0000-0000-0000-000000000399"}', true);
DO $$
BEGIN
  BEGIN
    PERFORM * FROM public.complete_fulfillment(
      '00000000-0000-0000-0000-000000000304', 'COMPLETED', 'non-admin', 'denial test'
    );
    RAISE EXCEPTION 'COMPLETION_GUARD_NON_OPERATOR_ALLOWED';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'FORBIDDEN' THEN
      RAISE;
    END IF;
  END;
END $$;
RESET ROLE;

-- An authenticated payment operator cannot complete without a supplier result.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"role":"authenticated","sub":"00000000-0000-0000-0000-000000000301"}', true);
DO $$
BEGIN
  BEGIN
    PERFORM * FROM public.complete_fulfillment(
      '00000000-0000-0000-0000-000000000304', 'COMPLETED', 'completion-guard-admin', 'direct completion denial'
    );
    RAISE EXCEPTION 'COMPLETION_GUARD_AUTH_OPERATOR_ALLOWED';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'COMPLETED_REQUIRES_SUPPLIER_CONFIRMATION' THEN
      RAISE;
    END IF;
  END;
END $$;
RESET ROLE;

-- The trusted service role is subject to the same direct-completion guard.
SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);
DO $$
BEGIN
  IF has_function_privilege(
       'service_role', 'public.complete_fulfillment(uuid,text,text,text)', 'EXECUTE'
     ) THEN
    BEGIN
      PERFORM * FROM public.complete_fulfillment(
        '00000000-0000-0000-0000-000000000304', 'COMPLETED', 'service_role', 'direct completion denial'
      );
      RAISE EXCEPTION 'COMPLETION_GUARD_SERVICE_ROLE_ALLOWED';
    EXCEPTION WHEN raise_exception THEN
      IF SQLERRM <> 'COMPLETED_REQUIRES_SUPPLIER_CONFIRMATION' THEN
        RAISE;
      END IF;
    END;
  ELSE
    BEGIN
      PERFORM * FROM public.complete_fulfillment(
        '00000000-0000-0000-0000-000000000304', 'COMPLETED', 'service_role', 'direct completion denial'
      );
      RAISE EXCEPTION 'COMPLETION_GUARD_SERVICE_ROLE_PRIVILEGE_UNEXPECTED';
    EXCEPTION WHEN insufficient_privilege THEN
      NULL;
    END;
  END IF;
END $$;
RESET ROLE;

-- A denied terminal transition has no order or timeline side effect.
DO $$
DECLARE
  v_fulfillment text;
  v_status text;
  v_timeline_count integer;
BEGIN
  SELECT fulfillment_status, status INTO v_fulfillment, v_status
  FROM public.orders
  WHERE id = '00000000-0000-0000-0000-000000000304';
  SELECT count(*) INTO v_timeline_count
  FROM public.order_timeline
  WHERE order_id = '00000000-0000-0000-0000-000000000304'
    AND status = 'COMPLETED';
  IF v_fulfillment <> 'PROCESSING' OR v_status <> 'PROCESSING' OR v_timeline_count <> 0 THEN
    RAISE EXCEPTION 'COMPLETION_GUARD_DENIAL_MUTATED_ORDER';
  END IF;
END $$;

-- Non-terminal transitions retain their existing operator behavior.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"role":"authenticated","sub":"00000000-0000-0000-0000-000000000301"}', true);
DO $$
DECLARE
  r record;
BEGIN
  SELECT * INTO r
  FROM public.complete_fulfillment(
    '00000000-0000-0000-0000-000000000305', 'PROCESSING', 'service_role', 'claim test'
  );
  IF r.out_fulfillment_status <> 'PROCESSING' OR r.out_transitioned IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'COMPLETION_GUARD_PROCESSING_TRANSITION_FAILED';
  END IF;

  SELECT * INTO r
  FROM public.complete_fulfillment(
    '00000000-0000-0000-0000-000000000305', 'PROCESSING', 'service_role', 'idempotence test'
  );
  IF r.out_fulfillment_status <> 'PROCESSING' OR r.out_transitioned IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'COMPLETION_GUARD_PROCESSING_IDEMPOTENCE_FAILED';
  END IF;
END $$;

RESET ROLE;
ROLLBACK;
