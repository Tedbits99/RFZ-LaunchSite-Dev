-- Synthetic seed executed only in the disposable full-upgrade Supabase stack,
-- after all canonical migrations and immediately before the pending RF Coins
-- migrations. It represents one existing product order/payment snapshot.
DO $$
DECLARE
  v_game_id uuid;
  v_package_id uuid;
  v_amount_cents integer;
BEGIN
  SELECT id INTO v_game_id
  FROM public.games WHERE slug = 'mobile-legends' LIMIT 1;
  SELECT id, price_cents INTO v_package_id, v_amount_cents
  FROM public.packages
  WHERE game_id = v_game_id AND is_active IS TRUE ORDER BY id LIMIT 1;

  IF v_game_id IS NULL OR v_package_id IS NULL OR v_amount_cents IS NULL THEN
    RAISE EXCEPTION 'RF_COINS_PAYMENT_FIXTURE_CATALOG_MISSING';
  END IF;

  INSERT INTO public.orders (
    id, reference, email, customer_name, game_id, package_id,
    player_inputs, subtotal_cents, total_cents, payment_method
  ) VALUES (
    'f8200000-0000-4000-8000-000000000001',
    'RFZ-DISPOSABLE-COINS-UPGRADE',
    'rfz-upgrade-fixture@example.invalid',
    'Disposable migration fixture', v_game_id, v_package_id,
    '{}'::jsonb, v_amount_cents, v_amount_cents, 'paymongo_qrph'
  );

  INSERT INTO public.payment_transactions (
    id, order_id, idempotency_key, provider_name, provider_reference,
    action, status, amount_cents, currency, metadata
  ) VALUES (
    'f8200000-0000-4000-8000-000000000002',
    'f8200000-0000-4000-8000-000000000001',
    'rfz-disposable-existing-product-payment',
    'paymongo', 'synthetic-not-a-provider-reference',
    'create', 'pending', v_amount_cents, 'PHP',
    '{"fixture":"isolated-migration-rehearsal"}'::jsonb
  );
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.payment_transactions
    WHERE idempotency_key = 'rfz-disposable-existing-product-payment'
      AND order_id = 'f8200000-0000-4000-8000-000000000001'
      AND status = 'pending' AND currency = 'PHP'
      AND amount_cents = (SELECT total_cents FROM public.orders
        WHERE id = 'f8200000-0000-4000-8000-000000000001')
  ) THEN
    RAISE EXCEPTION 'RF_COINS_PAYMENT_FIXTURE_NOT_SEEDED';
  END IF;
  RAISE NOTICE 'RF_COINS_PRE_UPGRADE_PRODUCT_PAYMENT_FIXTURE_PASS';
END;
$$;
