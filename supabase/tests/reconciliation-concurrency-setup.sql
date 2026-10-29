\set ON_ERROR_STOP on

BEGIN;

INSERT INTO public.games AS existing_game (
  id, slug, name, short_name, description, region, currency, is_active, sort_order, catalog_status, published_at
)
VALUES (
  '00000000-0000-0000-0000-000000000201', 'reconciliation-concurrency-game', 'Concurrency Test Game', 'CONC', 'Disposable fixture', 'Test', 'PHP', true, 2002,
  'PUBLISHED', '2026-01-01T00:00:00Z'::timestamptz
)
ON CONFLICT (id) DO UPDATE SET
  is_active = true, catalog_status = 'PUBLISHED',
  published_at = COALESCE(existing_game.published_at, EXCLUDED.published_at);

INSERT INTO public.packages AS existing_package (
  id, game_id, name, sku, amount, price_cents, sort_order, is_active, catalog_status, published_at
)
VALUES (
  '00000000-0000-0000-0000-000000000202', '00000000-0000-0000-0000-000000000201', 'Concurrency Test Package', 'RECON-CONCURRENCY-PACKAGE', '1', 1, 2002, true,
  'PUBLISHED', '2026-01-01T00:00:00Z'::timestamptz
)
ON CONFLICT (id) DO UPDATE SET
  is_active = true, catalog_status = 'PUBLISHED',
  published_at = COALESCE(existing_package.published_at, EXCLUDED.published_at);

INSERT INTO public.suppliers (id, name, code, adapter, enabled, environment)
VALUES ('00000000-0000-0000-0000-000000000203', 'FazerCards Concurrency Test', 'fazercards', 'custom', true, 'sandbox')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.orders (
  id, reference, email, customer_name, game_id, package_id, player_inputs,
  subtotal_cents, discount_cents, fee_cents, total_cents, payment_method,
  status, payment_status, fulfillment_status
)
VALUES (
  '00000000-0000-0000-0000-000000000204', 'RECON-CONCURRENCY', 'recon-concurrency@example.invalid', 'Recon Concurrency',
  '00000000-0000-0000-0000-000000000201', '00000000-0000-0000-0000-000000000202',
  jsonb_build_object('__rfz_order_access_hash', repeat('d', 64)), 1, 0, 0, 1, 'manual',
  'PROCESSING', 'VERIFIED', 'PROCESSING'
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.supplier_transactions (
  id, order_id, supplier_id, idempotency_key, action, status, supplier_reference
)
VALUES (
  '00000000-0000-0000-0000-000000000205', '00000000-0000-0000-0000-000000000204',
  '00000000-0000-0000-0000-000000000203', 'recon-concurrency-key', 'create_order', 'pending', 'recon-concurrency-ref'
)
ON CONFLICT (id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.reconciliation_test_sleep_timeline()
RETURNS trigger LANGUAGE plpgsql AS $function$
BEGIN
  PERFORM pg_sleep(1);
  RETURN NEW;
END;
$function$;

CREATE TRIGGER reconciliation_concurrency_sleep
BEFORE INSERT ON public.order_timeline
FOR EACH ROW EXECUTE FUNCTION public.reconciliation_test_sleep_timeline();

COMMIT;
