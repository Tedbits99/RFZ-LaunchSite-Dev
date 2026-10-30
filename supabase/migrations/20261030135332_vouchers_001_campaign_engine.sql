-- VOUCHERS-001: additive campaign engine, atomic redemption accounting, and
-- abuse controls. Existing vouchers/orders remain in place; no hosted endpoint
-- or provider integration is called by this migration.

CREATE SCHEMA IF NOT EXISTS voucher_private;
REVOKE ALL ON SCHEMA voucher_private FROM PUBLIC, anon, authenticated, service_role;

CREATE TABLE IF NOT EXISTS voucher_private.rate_limit_salt (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  salt uuid NOT NULL DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO voucher_private.rate_limit_salt(singleton) VALUES (true) ON CONFLICT (singleton) DO NOTHING;

CREATE TABLE IF NOT EXISTS voucher_private.rate_limit_buckets (
  ip_hash text PRIMARY KEY CHECK (ip_hash ~ '^[0-9a-f]{32}$'),
  window_started_at timestamptz NOT NULL,
  attempts integer NOT NULL CHECK (attempts > 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS voucher_rate_limit_window_idx
  ON voucher_private.rate_limit_buckets(window_started_at);
ALTER TABLE voucher_private.rate_limit_salt ENABLE ROW LEVEL SECURITY;
ALTER TABLE voucher_private.rate_limit_buckets ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON ALL TABLES IN SCHEMA voucher_private FROM PUBLIC, anon, authenticated, service_role;

CREATE TABLE IF NOT EXISTS voucher_private.checkout_idempotency (
  request_key uuid PRIMARY KEY,
  order_id uuid NOT NULL UNIQUE REFERENCES public.orders(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS checkout_idempotency_created_at_idx
  ON voucher_private.checkout_idempotency(created_at);
ALTER TABLE voucher_private.checkout_idempotency ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON voucher_private.checkout_idempotency FROM PUBLIC, anon, authenticated, service_role;

CREATE TABLE public.promotion_campaigns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  voucher_id uuid NOT NULL UNIQUE REFERENCES public.vouchers(id) ON DELETE RESTRICT,
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 100),
  description text NOT NULL DEFAULT '' CHECK (length(description) <= 500),
  campaign_type text NOT NULL CHECK (campaign_type IN (
    'WELCOME', 'SEASONAL', 'GAME_SPECIFIC', 'PACKAGE_SPECIFIC',
    'LIMITED_REDEMPTION', 'CUSTOMER_RETENTION', 'PUBLIC_PROMOTION', 'PRIVATE_CODE'
  )),
  status text NOT NULL DEFAULT 'DRAFT' CHECK (status IN (
    'DRAFT', 'SCHEDULED', 'ACTIVE', 'PAUSED', 'ENDED', 'ARCHIVED'
  )),
  timezone text NOT NULL DEFAULT 'UTC',
  starts_at timestamptz NOT NULL,
  ends_at timestamptz,
  eligibility_rules jsonb NOT NULL DEFAULT '{"allow_guest":false}'::jsonb
    CHECK (jsonb_typeof(eligibility_rules) = 'object'),
  total_redemption_limit integer CHECK (total_redemption_limit IS NULL OR total_redemption_limit > 0),
  per_customer_redemption_limit integer CHECK (per_customer_redemption_limit IS NULL OR per_customer_redemption_limit > 0),
  discount_budget_cents bigint CHECK (discount_budget_cents IS NULL OR discount_budget_cents > 0),
  public_discovery boolean NOT NULL DEFAULT false,
  legacy_compatibility boolean NOT NULL DEFAULT false,
  created_by uuid REFERENCES public.admins(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_at IS NULL OR ends_at > starts_at),
  CHECK (campaign_type <> 'PUBLIC_PROMOTION' OR public_discovery IS TRUE),
  CHECK (campaign_type <> 'PRIVATE_CODE' OR public_discovery IS FALSE)
);

CREATE TABLE public.promotion_campaign_games (
  campaign_id uuid NOT NULL REFERENCES public.promotion_campaigns(id) ON DELETE CASCADE,
  game_id uuid NOT NULL REFERENCES public.games(id) ON DELETE RESTRICT,
  PRIMARY KEY (campaign_id, game_id)
);
CREATE TABLE public.promotion_campaign_packages (
  campaign_id uuid NOT NULL REFERENCES public.promotion_campaigns(id) ON DELETE CASCADE,
  package_id uuid NOT NULL REFERENCES public.packages(id) ON DELETE RESTRICT,
  PRIMARY KEY (campaign_id, package_id)
);

CREATE TABLE public.promotion_campaign_audit (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  campaign_id uuid NOT NULL REFERENCES public.promotion_campaigns(id) ON DELETE RESTRICT,
  actor_id uuid NOT NULL REFERENCES public.admins(id) ON DELETE RESTRICT,
  action text NOT NULL CHECK (action IN ('CREATED', 'UPDATED', 'STATUS_CHANGED', 'DUPLICATED')),
  before_state jsonb,
  after_state jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX promotion_campaign_audit_campaign_created_idx
  ON public.promotion_campaign_audit(campaign_id, created_at DESC);

ALTER TABLE public.voucher_usages
  ADD COLUMN campaign_id uuid REFERENCES public.promotion_campaigns(id) ON DELETE RESTRICT,
  ADD COLUMN redemption_status text NOT NULL DEFAULT 'COMMITTED'
    CHECK (redemption_status IN ('RESERVED', 'COMMITTED', 'RELEASED')),
  ADD COLUMN discount_cents integer NOT NULL DEFAULT 0 CHECK (discount_cents >= 0),
  ADD COLUMN customer_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN customer_key text,
  ADD COLUMN reservation_expires_at timestamptz,
  ADD COLUMN committed_at timestamptz,
  ADD COLUMN released_at timestamptz,
  ADD COLUMN release_reason text;

ALTER TABLE public.promotion_campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.promotion_campaign_games ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.promotion_campaign_packages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.promotion_campaign_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.voucher_usages ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.promotion_campaigns, public.promotion_campaign_games,
  public.promotion_campaign_packages, public.promotion_campaign_audit
  FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.promotion_campaigns, public.promotion_campaign_games,
  public.promotion_campaign_packages, public.promotion_campaign_audit TO service_role;
REVOKE INSERT, UPDATE, DELETE ON public.vouchers, public.voucher_usages
  FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.vouchers, public.voucher_usages TO service_role;
REVOKE ALL ON public.promotion_campaign_audit FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.promotion_campaign_audit TO service_role;

CREATE INDEX voucher_usages_active_customer_idx
  ON public.voucher_usages(voucher_id, customer_key)
  WHERE redemption_status IN ('RESERVED', 'COMMITTED');
CREATE INDEX voucher_usages_campaign_customer_active_idx
  ON public.voucher_usages(campaign_id, customer_key)
  WHERE redemption_status IN ('RESERVED', 'COMMITTED');
CREATE INDEX voucher_usages_campaign_state_idx
  ON public.voucher_usages(campaign_id, redemption_status, created_at DESC);
CREATE INDEX promotion_campaign_public_window_idx
  ON public.promotion_campaigns(starts_at, id)
  WHERE public_discovery IS TRUE AND status IN ('ACTIVE', 'SCHEDULED');

UPDATE public.voucher_usages u
SET discount_cents = greatest(0, coalesce(o.voucher_discount_cents, o.discount_cents, 0)),
    customer_user_id = o.customer_user_id,
    customer_key = CASE
      WHEN o.customer_user_id IS NOT NULL THEN 'user:' || o.customer_user_id::text
      ELSE 'guest:' || md5((SELECT salt::text FROM voucher_private.rate_limit_salt WHERE singleton) || '|' || lower(btrim(u.email)))
    END
FROM public.orders o
WHERE o.id = u.order_id AND u.customer_key IS NULL;

-- Historical/manual rows without a surviving order remain countable and
-- retain a privacy-preserving identity key instead of blocking the upgrade.
UPDATE public.voucher_usages u
SET customer_key = CASE
  WHEN u.customer_user_id IS NOT NULL THEN 'user:' || u.customer_user_id::text
  ELSE 'guest:' || md5((SELECT salt::text FROM voucher_private.rate_limit_salt WHERE singleton)
    || '|' || lower(btrim(coalesce(u.email, ''))))
END
WHERE u.customer_key IS NULL;

ALTER TABLE public.voucher_usages ALTER COLUMN customer_key SET NOT NULL;
COMMENT ON COLUMN public.voucher_usages.reservation_expires_at IS
  'Expected unpaid-order archive horizon only; a reservation is released only after the order lifecycle marks a terminal state.';
ALTER TABLE public.voucher_usages DROP CONSTRAINT IF EXISTS voucher_usages_order_id_fkey;
ALTER TABLE public.voucher_usages ADD CONSTRAINT voucher_usages_order_id_fkey
  FOREIGN KEY (order_id) REFERENCES public.orders(id) ON DELETE RESTRICT;

-- Convert every pre-existing voucher into a non-public compatibility
-- campaign. The code, discount, dates, limits, and use history are retained.
INSERT INTO public.promotion_campaigns (
  voucher_id, name, description, campaign_type, status, timezone, starts_at,
  ends_at, eligibility_rules, total_redemption_limit,
  per_customer_redemption_limit, discount_budget_cents, public_discovery,
  legacy_compatibility
)
SELECT v.id,
       left(coalesce(nullif(btrim(v.description), ''), v.code), 100),
       coalesce(v.description, ''),
       'PRIVATE_CODE',
       CASE
         WHEN NOT v.is_active THEN 'PAUSED'
         WHEN v.ends_at IS NOT NULL AND v.ends_at <= now() THEN 'ENDED'
         WHEN v.starts_at > now() THEN 'SCHEDULED'
         ELSE 'ACTIVE'
       END,
       'UTC', v.starts_at, v.ends_at,
       '{"allow_guest":true,"legacy":true}'::jsonb,
       nullif(v.usage_limit, 0),
       nullif(v.per_user_limit, 0),
       NULL, false, true
FROM public.vouchers v
ON CONFLICT (voucher_id) DO NOTHING;

-- Legacy campaign rows now exist, so attribute each historical usage and
-- snapshot the order's discount/customer/terminal state without deleting it.
UPDATE public.voucher_usages u
SET campaign_id = c.id,
    discount_cents = greatest(0, coalesce(o.voucher_discount_cents, o.discount_cents, 0)),
    customer_user_id = o.customer_user_id,
    customer_key = CASE
      WHEN o.customer_user_id IS NOT NULL THEN 'user:' || o.customer_user_id::text
      ELSE 'guest:' || md5((SELECT salt::text FROM voucher_private.rate_limit_salt WHERE singleton)
        || '|' || lower(btrim(u.email)))
    END,
    redemption_status = CASE
      WHEN o.payment_status = 'VERIFIED' OR o.status IN ('PAID', 'PAYMENT_VERIFIED', 'PROCESSING', 'COMPLETED', 'DELIVERED', 'REFUND_PENDING', 'REFUNDED') THEN 'COMMITTED'
      WHEN o.payment_status = 'FAILED' OR o.status IN ('FAILED', 'CANCELLED', 'EXPIRED') THEN 'RELEASED'
      ELSE 'RESERVED'
    END,
    committed_at = CASE
      WHEN o.payment_status = 'VERIFIED' OR o.status IN ('PAID', 'PAYMENT_VERIFIED', 'PROCESSING', 'COMPLETED', 'DELIVERED', 'REFUND_PENDING', 'REFUNDED') THEN coalesce(o.updated_at, o.created_at, u.created_at)
      ELSE NULL
    END,
    released_at = CASE
      WHEN o.payment_status = 'FAILED' OR o.status IN ('FAILED', 'CANCELLED', 'EXPIRED') THEN coalesce(o.updated_at, o.created_at, u.created_at)
      ELSE NULL
    END,
    reservation_expires_at = CASE
      WHEN o.payment_status = 'VERIFIED' OR o.payment_status = 'FAILED'
        OR o.status IN ('PAID', 'PAYMENT_VERIFIED', 'PROCESSING', 'COMPLETED', 'DELIVERED', 'REFUND_PENDING', 'REFUNDED', 'FAILED', 'CANCELLED', 'EXPIRED')
        THEN NULL
      ELSE coalesce(o.created_at, u.created_at) + interval '24 hours'
    END,
    release_reason = CASE
      WHEN o.payment_status = 'FAILED' OR o.status IN ('FAILED', 'CANCELLED', 'EXPIRED') THEN 'LEGACY_TERMINAL_ORDER'
      ELSE NULL
    END
FROM public.orders o
CROSS JOIN public.promotion_campaigns c
WHERE o.id = u.order_id
  AND c.voucher_id = u.voucher_id;

INSERT INTO public.promotion_campaign_games(campaign_id, game_id)
SELECT c.id, v.applies_to_game_id
FROM public.promotion_campaigns c
JOIN public.vouchers v ON v.id = c.voucher_id
WHERE v.applies_to_game_id IS NOT NULL
ON CONFLICT DO NOTHING;

-- Codes are case- and whitespace-insensitive at every application boundary.
-- A conflicting legacy pair fails the additive migration closed for owner review.
CREATE UNIQUE INDEX vouchers_code_normalized_uidx
  ON public.vouchers (upper(btrim(code)));

UPDATE public.voucher_usages u
SET campaign_id = c.id
FROM public.promotion_campaigns c
WHERE c.voucher_id = u.voucher_id AND u.campaign_id IS NULL;

CREATE OR REPLACE FUNCTION public.evaluate_promotion_voucher(
  p_code text,
  p_package_id uuid,
  p_email text DEFAULT NULL,
  p_public_only boolean DEFAULT false
)
RETURNS TABLE (
  out_valid boolean,
  out_error text,
  out_discount_cents integer,
  out_total_cents integer,
  out_campaign_id uuid,
  out_voucher_id uuid,
  out_code text,
  out_starts_at timestamptz,
  out_ends_at timestamptz,
  out_timezone text,
  out_public_discovery boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_now timestamptz := statement_timestamp();
  v_user_id uuid := auth.uid();
  v_package public.packages%ROWTYPE;
  v_game_status text;
  v_game_active boolean;
  v_voucher public.vouchers%ROWTYPE;
  v_campaign public.promotion_campaigns%ROWTYPE;
  v_customer_key text;
  v_completed_orders integer := 0;
  v_customer_uses integer := 0;
  v_total_uses integer := 0;
  v_budget_used bigint := 0;
  v_discount integer := 0;
  v_total integer := 0;
  v_minimum_price integer := 1;
  v_rules jsonb;
  v_allow_guest boolean := false;
  v_min_completed integer := 0;
  v_max_completed integer;
  v_email_confirmed_at timestamptz;
  v_profile_status text;
  v_fee_bps integer;
  v_fixed_fee_cents integer;
  v_fx numeric;
  v_supplier_release boolean;
  v_code text := upper(btrim(coalesce(p_code, '')));
  v_email text := lower(btrim(coalesce(p_email, '')));
BEGIN
  out_valid := false;
  out_error := 'Invalid or unavailable promotion code.';
  out_discount_cents := 0;
  out_total_cents := 0;
  out_campaign_id := NULL;
  out_voucher_id := NULL;
  out_code := NULL;
  out_starts_at := NULL;
  out_ends_at := NULL;
  out_timezone := NULL;
  out_public_discovery := false;

  IF v_code = '' OR length(v_code) > 50 OR p_package_id IS NULL OR length(v_email) > 320 THEN
    out_error := 'Enter a valid promotion code and choose a package.';
    RETURN NEXT;
    RETURN;
  END IF;

  SELECT p.* INTO v_package
  FROM public.packages p
  WHERE p.id = p_package_id;
  IF FOUND THEN
    SELECT g.catalog_status, g.is_active INTO v_game_status, v_game_active
    FROM public.games g WHERE g.id = v_package.game_id;
  END IF;
  IF NOT FOUND
     OR NOT v_package.is_active
     OR coalesce(v_package.catalog_status, 'PUBLISHED') <> 'PUBLISHED'
     OR v_game_status <> 'PUBLISHED'
     OR v_game_active IS DISTINCT FROM true
     OR v_package.price_cents IS NULL
     OR v_package.price_cents <= 0 THEN
    out_error := 'The selected package is no longer available.';
    RETURN NEXT;
    RETURN;
  END IF;

  SELECT v.* INTO v_voucher
  FROM public.vouchers v
  WHERE upper(btrim(v.code)) = v_code
  LIMIT 1;
  IF NOT FOUND THEN
    out_error := 'Invalid or unavailable promotion code.';
    RETURN NEXT;
    RETURN;
  END IF;
  SELECT c.* INTO v_campaign
  FROM public.promotion_campaigns c
  WHERE c.voucher_id = v_voucher.id;
  IF NOT FOUND THEN
    out_error := 'This promotion requires administrator review.';
    RETURN NEXT;
    RETURN;
  END IF;

  out_campaign_id := v_campaign.id;
  out_voucher_id := v_voucher.id;
  out_code := v_voucher.code;
  out_starts_at := v_campaign.starts_at;
  out_ends_at := v_campaign.ends_at;
  out_timezone := v_campaign.timezone;
  out_public_discovery := v_campaign.public_discovery;

  IF p_public_only AND NOT v_campaign.public_discovery THEN
    out_error := 'No public promotion is available for this package.';
    RETURN NEXT;
    RETURN;
  END IF;
  IF NOT v_voucher.is_active OR v_campaign.status NOT IN ('ACTIVE', 'SCHEDULED') THEN
    out_error := 'This promotion is currently unavailable.';
    RETURN NEXT;
    RETURN;
  END IF;
  IF v_campaign.starts_at > v_now OR (v_campaign.ends_at IS NOT NULL AND v_campaign.ends_at <= v_now)
     OR v_voucher.starts_at > v_now OR (v_voucher.ends_at IS NOT NULL AND v_voucher.ends_at <= v_now) THEN
    out_error := CASE WHEN v_campaign.starts_at > v_now OR v_voucher.starts_at > v_now
      THEN 'This promotion has not started yet.' ELSE 'This promotion has expired.' END;
    RETURN NEXT;
    RETURN;
  END IF;

  IF v_campaign.campaign_type = 'GAME_SPECIFIC'
     AND NOT EXISTS (SELECT 1 FROM public.promotion_campaign_games x WHERE x.campaign_id = v_campaign.id) THEN
    out_error := 'This game-specific promotion has no eligible game configured.';
    RETURN NEXT;
    RETURN;
  END IF;
  IF EXISTS (SELECT 1 FROM public.promotion_campaign_games x WHERE x.campaign_id = v_campaign.id)
     AND NOT EXISTS (SELECT 1 FROM public.promotion_campaign_games x WHERE x.campaign_id = v_campaign.id AND x.game_id = v_package.game_id) THEN
    out_error := 'This promotion is not available for the selected game.';
    RETURN NEXT;
    RETURN;
  END IF;
  IF v_campaign.campaign_type = 'PACKAGE_SPECIFIC'
     AND NOT EXISTS (SELECT 1 FROM public.promotion_campaign_packages x WHERE x.campaign_id = v_campaign.id) THEN
    out_error := 'This package-specific promotion has no eligible package configured.';
    RETURN NEXT;
    RETURN;
  END IF;
  IF EXISTS (SELECT 1 FROM public.promotion_campaign_packages x WHERE x.campaign_id = v_campaign.id)
     AND NOT EXISTS (SELECT 1 FROM public.promotion_campaign_packages x WHERE x.campaign_id = v_campaign.id AND x.package_id = v_package.id) THEN
    out_error := 'This promotion is not available for the selected package.';
    RETURN NEXT;
    RETURN;
  END IF;

  v_rules := v_campaign.eligibility_rules;
  v_allow_guest := coalesce((v_rules ->> 'allow_guest')::boolean, false);
  v_min_completed := coalesce((v_rules ->> 'min_completed_orders')::integer, 0);
  v_max_completed := nullif(v_rules ->> 'max_completed_orders', '')::integer;
  IF v_min_completed < 0 OR (v_max_completed IS NOT NULL AND v_max_completed < v_min_completed) THEN
    out_error := 'This promotion has invalid customer eligibility rules.';
    RETURN NEXT;
    RETURN;
  END IF;

  IF v_user_id IS NULL THEN
    IF NOT v_allow_guest OR v_campaign.campaign_type IN ('WELCOME', 'CUSTOMER_RETENTION')
       OR coalesce((v_rules ->> 'require_authenticated')::boolean, false)
       OR v_min_completed > 0 OR v_max_completed IS NOT NULL THEN
      out_error := 'Sign in with an eligible verified account to use this promotion.';
      RETURN NEXT;
      RETURN;
    END IF;
    IF v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' OR length(v_email) > 320 THEN
      out_error := 'A valid checkout email is required for guest promotion eligibility.';
      RETURN NEXT;
      RETURN;
    END IF;
    v_customer_key := 'guest:' || md5(
      (SELECT s.salt::text FROM voucher_private.rate_limit_salt s WHERE s.singleton) || '|' || v_email
    );
  ELSE
    SELECT u.email_confirmed_at INTO v_email_confirmed_at
    FROM auth.users u WHERE u.id = v_user_id;
    IF NOT FOUND OR v_email_confirmed_at IS NULL THEN
      out_error := 'Sign in with a verified account to use this promotion.';
      RETURN NEXT;
      RETURN;
    END IF;
    SELECT cp.status INTO v_profile_status
    FROM public.customer_profiles cp WHERE cp.user_id = v_user_id;
    IF NOT FOUND OR v_profile_status IS DISTINCT FROM 'active' THEN
      out_error := 'Your account is not eligible for this promotion.';
      RETURN NEXT;
      RETURN;
    END IF;
    v_customer_key := 'user:' || v_user_id::text;
    SELECT count(*)::integer INTO v_completed_orders
    FROM public.orders o
    WHERE o.customer_user_id = v_user_id
      AND o.payment_status = 'VERIFIED'
      AND o.status NOT IN ('FAILED', 'CANCELLED', 'EXPIRED', 'REFUNDED');
  END IF;

  IF v_campaign.campaign_type = 'WELCOME' THEN
    IF v_user_id IS NULL OR v_completed_orders > 0 THEN
      out_error := 'This welcome promotion is limited to a verified first purchase.';
      RETURN NEXT;
      RETURN;
    END IF;
    SELECT count(*)::integer INTO v_customer_uses
    FROM public.voucher_usages u
    WHERE u.campaign_id = v_campaign.id
      AND u.customer_key = v_customer_key
      AND u.redemption_status IN ('RESERVED', 'COMMITTED');
    IF v_customer_uses > 0 THEN
      out_error := 'This welcome promotion has already been reserved or used for this account.';
      RETURN NEXT;
      RETURN;
    END IF;
  ELSIF v_campaign.campaign_type = 'CUSTOMER_RETENTION' THEN
    IF v_user_id IS NULL OR v_completed_orders < 1 THEN
      out_error := 'This promotion is for eligible returning customers.';
      RETURN NEXT;
      RETURN;
    END IF;
  END IF;
  IF v_user_id IS NOT NULL AND (v_completed_orders < v_min_completed
      OR (v_max_completed IS NOT NULL AND v_completed_orders > v_max_completed)) THEN
    out_error := 'Your account does not meet this promotion''s purchase eligibility rules.';
    RETURN NEXT;
    RETURN;
  END IF;

  IF v_voucher.min_order_cents > v_package.price_cents THEN
    out_error := 'This promotion requires a higher minimum purchase.';
    RETURN NEXT;
    RETURN;
  END IF;
  SELECT count(*)::integer INTO v_total_uses
  FROM public.voucher_usages u
  WHERE u.voucher_id = v_voucher.id
    AND u.redemption_status IN ('RESERVED', 'COMMITTED');
  IF (v_voucher.usage_limit IS NOT NULL AND v_voucher.usage_limit > 0 AND v_total_uses >= v_voucher.usage_limit)
     OR (v_campaign.total_redemption_limit IS NOT NULL AND v_total_uses >= v_campaign.total_redemption_limit) THEN
    out_error := 'This promotion has reached its redemption limit.';
    RETURN NEXT;
    RETURN;
  END IF;

  SELECT count(*)::integer INTO v_customer_uses
  FROM public.voucher_usages u
  WHERE u.campaign_id = v_campaign.id
    AND u.customer_key = v_customer_key
    AND u.redemption_status IN ('RESERVED', 'COMMITTED');
  IF (v_voucher.per_user_limit > 0 AND v_customer_uses >= v_voucher.per_user_limit)
     OR (v_campaign.per_customer_redemption_limit IS NOT NULL
         AND v_customer_uses >= v_campaign.per_customer_redemption_limit) THEN
    out_error := 'This promotion has reached its per-customer limit.';
    RETURN NEXT;
    RETURN;
  END IF;

  IF v_voucher.discount_type = 'PERCENTAGE' THEN
    v_discount := round((v_package.price_cents::numeric * v_voucher.discount_value::numeric) / 100)::integer;
    IF v_voucher.max_discount_cents IS NOT NULL THEN
      v_discount := least(v_discount, v_voucher.max_discount_cents);
    END IF;
  ELSE
    v_discount := v_voucher.discount_value;
  END IF;
  v_discount := greatest(0, least(v_discount, v_package.price_cents));
  v_total := v_package.price_cents - v_discount;
  IF v_discount <= 0 OR v_total <= 0 THEN
    out_error := 'This promotion would make the package price invalid.';
    RETURN NEXT;
    RETURN;
  END IF;

  IF v_campaign.discount_budget_cents IS NOT NULL THEN
    SELECT coalesce(sum(u.discount_cents), 0)::bigint INTO v_budget_used
    FROM public.voucher_usages u
    WHERE u.campaign_id = v_campaign.id
      AND u.redemption_status IN ('RESERVED', 'COMMITTED');
    IF v_budget_used + v_discount > v_campaign.discount_budget_cents THEN
      out_error := 'This promotion has insufficient remaining discount budget.';
      RETURN NEXT;
      RETURN;
    END IF;
  END IF;

  IF v_package.supplier_review_required IS TRUE THEN
    out_error := 'This package is awaiting supplier pricing review.';
    RETURN NEXT;
    RETURN;
  END IF;
  IF v_package.supplier_offer_id IS NOT NULL OR v_package.supplier_category_id IS NOT NULL
     OR v_package.supplier_cost_usd IS NOT NULL THEN
    SELECT a.payment_fee_reserve_bps, a.payment_fee_fixed_cents,
           a.reference_usd_php_rate, a.supplier_fulfillment_release_enabled
      INTO v_fee_bps, v_fixed_fee_cents, v_fx, v_supplier_release
    FROM public.app_settings a WHERE a.id = 1;
    IF v_supplier_release IS DISTINCT FROM true
       OR v_package.supplier_offer_id IS NULL
       OR v_package.supplier_category_id IS NULL
       OR v_package.supplier_cost_usd IS NULL OR v_package.supplier_cost_usd <= 0
       OR v_fee_bps IS NULL OR v_fee_bps < 0 OR v_fee_bps >= 10000
       OR v_fixed_fee_cents IS NULL OR v_fixed_fee_cents < 0
       OR v_fx IS NULL OR v_fx <= 0
       OR NOT EXISTS (
         SELECT 1 FROM public.supplier_package_mappings m
         JOIN public.suppliers s ON s.id = m.supplier_id
         WHERE m.package_id = v_package.id
           AND m.supplier_product_id = v_package.supplier_offer_id
           AND m.enabled IS TRUE AND s.enabled IS TRUE
           AND m.metadata ->> 'category_id' = v_package.supplier_category_id
       ) THEN
      out_error := 'This supplier-linked package is not cleared for checkout.';
      RETURN NEXT;
      RETURN;
    END IF;
    v_minimum_price := ceil(
      (v_package.supplier_cost_usd * v_fx * 100 + v_fixed_fee_cents)
      / (1 - v_fee_bps::numeric / 10000)
    )::integer;
    IF v_total < v_minimum_price THEN
      out_error := 'This discount would fall below the approved supplier-cost and payment-fee price floor.';
      RETURN NEXT;
      RETURN;
    END IF;
  END IF;

  out_valid := true;
  out_error := NULL;
  out_discount_cents := v_discount;
  out_total_cents := v_total;
  RETURN NEXT;
  RETURN;
END;
$function$;
REVOKE ALL ON FUNCTION public.evaluate_promotion_voucher(text, uuid, text, boolean)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.validate_campaign_voucher(
  p_code text,
  p_package_id uuid,
  p_email text DEFAULT NULL
)
RETURNS TABLE (
  out_valid boolean,
  out_error text,
  out_discount_cents integer,
  out_total_cents integer,
  out_starts_at timestamptz,
  out_ends_at timestamptz,
  out_timezone text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
BEGIN
  RETURN QUERY
  SELECT e.out_valid, e.out_error, e.out_discount_cents, e.out_total_cents,
         e.out_starts_at, e.out_ends_at, e.out_timezone
  FROM public.evaluate_promotion_voucher(p_code, p_package_id, p_email, false) e;
END;
$function$;
REVOKE ALL ON FUNCTION public.validate_campaign_voucher(text, uuid, text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.validate_campaign_voucher(text, uuid, text) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.list_public_promotion_offers(
  p_package_id uuid,
  p_email text DEFAULT NULL
)
RETURNS TABLE (
  campaign_id uuid,
  name text,
  description text,
  code text,
  discount_type text,
  discount_value integer,
  subtotal_cents integer,
  discount_cents integer,
  total_cents integer,
  starts_at timestamptz,
  ends_at timestamptz,
  timezone text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
BEGIN
  RETURN QUERY
  WITH candidates AS MATERIALIZED (
    SELECT c.id, c.voucher_id, c.name, c.description, c.starts_at, c.ends_at, c.timezone
    FROM public.promotion_campaigns c
    JOIN public.vouchers v ON v.id = c.voucher_id
    WHERE c.public_discovery IS TRUE
      AND c.status IN ('ACTIVE', 'SCHEDULED')
      AND v.is_active IS TRUE
      AND c.starts_at <= statement_timestamp()
      AND (c.ends_at IS NULL OR c.ends_at > statement_timestamp())
    ORDER BY c.starts_at ASC, c.id
    LIMIT 100
  )
  SELECT e.out_campaign_id, c.name, c.description, v.code, v.discount_type,
         v.discount_value, p.price_cents, e.out_discount_cents,
         e.out_total_cents, c.starts_at, c.ends_at, c.timezone
  FROM candidates c
  JOIN public.vouchers v ON v.id = c.voucher_id
  JOIN public.packages p ON p.id = p_package_id
  CROSS JOIN LATERAL public.evaluate_promotion_voucher(v.code, p_package_id, p_email, true) e
  WHERE e.out_valid IS TRUE
  ORDER BY e.out_discount_cents DESC, c.starts_at ASC
  LIMIT 20;
END;
$function$;
REVOKE ALL ON FUNCTION public.list_public_promotion_offers(uuid, text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.list_public_promotion_offers(uuid, text) TO anon, authenticated;

-- The old RPC accepted a caller-supplied subtotal and returned the complete
-- voucher row. New callers use validate_campaign_voucher, which loads the
-- actual package price and returns only the preview fields needed at checkout.
REVOKE ALL ON FUNCTION public.validate_voucher(text, integer, uuid, text)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION voucher_private.assert_campaign_admin(p_actor_id uuid)
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, voucher_private
AS $function$
BEGIN
  IF p_actor_id IS NULL OR NOT EXISTS (
    SELECT 1
    FROM public.admins a
    JOIN auth.users u ON u.id = a.id
    WHERE a.id = p_actor_id
      AND a.is_active IS TRUE
      AND a.role IN ('ADMIN', 'SUPER_ADMIN')
      AND u.email_confirmed_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
  END IF;
END;
$function$;
REVOKE ALL ON FUNCTION voucher_private.assert_campaign_admin(uuid)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION voucher_private.campaign_snapshot(p_campaign_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, voucher_private
AS $function$
  SELECT jsonb_build_object(
    'id', c.id,
    'voucher_id', c.voucher_id,
    'name', c.name,
    'description', c.description,
    'campaign_type', c.campaign_type,
    'status', c.status,
    'timezone', c.timezone,
    'starts_at', c.starts_at,
    'ends_at', c.ends_at,
    'eligibility_rules', c.eligibility_rules,
    'total_redemption_limit', c.total_redemption_limit,
    'per_customer_redemption_limit', c.per_customer_redemption_limit,
    'discount_budget_cents', c.discount_budget_cents,
    'public_discovery', c.public_discovery,
    'code', v.code,
    'discount_type', v.discount_type,
    'discount_value', v.discount_value,
    'min_order_cents', v.min_order_cents,
    'max_discount_cents', v.max_discount_cents,
    'game_ids', coalesce((SELECT jsonb_agg(x.game_id ORDER BY x.game_id) FROM public.promotion_campaign_games x WHERE x.campaign_id = c.id), '[]'::jsonb),
    'package_ids', coalesce((SELECT jsonb_agg(x.package_id ORDER BY x.package_id) FROM public.promotion_campaign_packages x WHERE x.campaign_id = c.id), '[]'::jsonb)
  )
  FROM public.promotion_campaigns c
  JOIN public.vouchers v ON v.id = c.voucher_id
  WHERE c.id = p_campaign_id;
$function$;
REVOKE ALL ON FUNCTION voucher_private.campaign_snapshot(uuid)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION voucher_private.store_campaign(
  p_actor_id uuid,
  p_campaign_id uuid,
  p_data jsonb,
  p_audit_action text
)
RETURNS TABLE(out_campaign_id uuid, out_voucher_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, voucher_private
AS $function$
DECLARE
  v_campaign public.promotion_campaigns%ROWTYPE;
  v_voucher public.vouchers%ROWTYPE;
  v_before jsonb;
  v_name text;
  v_description text;
  v_type text;
  v_code text;
  v_discount_type text;
  v_discount_value integer;
  v_minimum integer;
  v_max_discount integer;
  v_total_limit integer;
  v_customer_limit integer;
  v_budget bigint;
  v_starts_text text;
  v_ends_text text;
  v_starts timestamptz;
  v_ends timestamptz;
  v_timezone text;
  v_rules jsonb;
  v_public boolean;
  v_game_ids jsonb;
  v_package_ids jsonb;
  v_game_id uuid;
  v_package_id uuid;
  v_current_uses integer := 0;
  v_current_budget bigint := 0;
  v_old_type text;
  v_voucher_id uuid;
BEGIN
  PERFORM voucher_private.assert_campaign_admin(p_actor_id);
  IF p_data IS NULL OR jsonb_typeof(p_data) <> 'object'
     OR p_audit_action NOT IN ('CREATED', 'UPDATED', 'DUPLICATED') THEN
    RAISE EXCEPTION 'INVALID_CAMPAIGN' USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1 FROM jsonb_object_keys(p_data) k(key)
    WHERE k.key NOT IN (
      'name', 'description', 'campaign_type', 'code', 'discount_type', 'discount_value',
      'min_order_cents', 'max_discount_cents', 'total_redemption_limit',
      'per_customer_redemption_limit', 'discount_budget_cents', 'starts_at', 'ends_at',
      'timezone', 'eligibility_rules', 'public_discovery', 'game_ids', 'package_ids'
    )
  ) THEN
    RAISE EXCEPTION 'INVALID_CAMPAIGN_FIELD' USING ERRCODE = '22023';
  END IF;

  v_name := btrim(coalesce(p_data ->> 'name', ''));
  v_description := btrim(coalesce(p_data ->> 'description', ''));
  v_type := p_data ->> 'campaign_type';
  v_code := upper(btrim(coalesce(p_data ->> 'code', '')));
  v_discount_type := p_data ->> 'discount_type';
  v_discount_value := nullif(p_data ->> 'discount_value', '')::integer;
  v_minimum := coalesce(nullif(p_data ->> 'min_order_cents', '')::integer, 0);
  v_max_discount := nullif(p_data ->> 'max_discount_cents', '')::integer;
  v_total_limit := nullif(p_data ->> 'total_redemption_limit', '')::integer;
  v_customer_limit := nullif(p_data ->> 'per_customer_redemption_limit', '')::integer;
  v_budget := nullif(p_data ->> 'discount_budget_cents', '')::bigint;
  v_starts_text := p_data ->> 'starts_at';
  v_ends_text := nullif(p_data ->> 'ends_at', '');
  v_timezone := coalesce(nullif(p_data ->> 'timezone', ''), 'UTC');
  v_public := coalesce((p_data ->> 'public_discovery')::boolean, false);
  v_game_ids := coalesce(p_data -> 'game_ids', '[]'::jsonb);
  v_package_ids := coalesce(p_data -> 'package_ids', '[]'::jsonb);
  v_rules := coalesce(p_data -> 'eligibility_rules', '{"allow_guest":false}'::jsonb);

  IF v_name = '' OR length(v_name) > 100 OR length(v_description) > 500
     OR v_type IS NULL OR v_type NOT IN ('WELCOME', 'SEASONAL', 'GAME_SPECIFIC', 'PACKAGE_SPECIFIC',
                       'LIMITED_REDEMPTION', 'CUSTOMER_RETENTION', 'PUBLIC_PROMOTION', 'PRIVATE_CODE')
     OR v_code !~ '^[A-Z0-9][A-Z0-9-]{2,39}$'
     OR v_discount_type IS NULL OR v_discount_type NOT IN ('PERCENTAGE', 'FIXED')
     OR v_discount_value IS NULL OR v_discount_value <= 0
     OR (v_discount_type = 'PERCENTAGE' AND v_discount_value > 100)
     OR v_minimum < 0 OR (v_max_discount IS NOT NULL AND v_max_discount <= 0)
     OR (v_total_limit IS NOT NULL AND v_total_limit <= 0)
     OR (v_customer_limit IS NOT NULL AND v_customer_limit <= 0)
     OR v_budget IS NULL OR v_budget <= 0 OR v_budget > 1000000000000
     OR v_timezone NOT IN (SELECT name FROM pg_catalog.pg_timezone_names)
     OR jsonb_typeof(v_game_ids) IS DISTINCT FROM 'array' OR jsonb_array_length(v_game_ids) > 100
     OR jsonb_typeof(v_package_ids) IS DISTINCT FROM 'array' OR jsonb_array_length(v_package_ids) > 200
     OR jsonb_typeof(v_rules) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'INVALID_CAMPAIGN' USING ERRCODE = '22023';
  END IF;

  IF v_starts_text IS NULL OR v_starts_text !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}(:[0-9]{2}(\.[0-9]{1,6})?)?(Z|[+-][0-9]{2}:[0-9]{2})$'
     OR (v_ends_text IS NOT NULL AND v_ends_text !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}(:[0-9]{2}(\.[0-9]{1,6})?)?(Z|[+-][0-9]{2}:[0-9]{2})$') THEN
    RAISE EXCEPTION 'CAMPAIGN_TIMESTAMP_REQUIRES_OFFSET' USING ERRCODE = '22023';
  END IF;
  BEGIN
    v_starts := v_starts_text::timestamptz;
    v_ends := v_ends_text::timestamptz;
  EXCEPTION WHEN others THEN
    RAISE EXCEPTION 'INVALID_CAMPAIGN_TIMESTAMP' USING ERRCODE = '22023';
  END;
  IF v_ends IS NOT NULL AND v_ends <= v_starts THEN
    RAISE EXCEPTION 'CAMPAIGN_END_MUST_FOLLOW_START' USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1 FROM jsonb_object_keys(v_rules) r(key)
    WHERE r.key NOT IN ('allow_guest', 'require_authenticated', 'min_completed_orders', 'max_completed_orders')
  ) OR jsonb_typeof(v_rules -> 'allow_guest') NOT IN ('boolean', 'null')
     OR jsonb_typeof(v_rules -> 'require_authenticated') NOT IN ('boolean', 'null')
     OR jsonb_typeof(v_rules -> 'min_completed_orders') NOT IN ('number', 'null')
     OR jsonb_typeof(v_rules -> 'max_completed_orders') NOT IN ('number', 'null') THEN
    RAISE EXCEPTION 'INVALID_CAMPAIGN_ELIGIBILITY_RULES' USING ERRCODE = '22023';
  END IF;
  IF coalesce((v_rules ->> 'min_completed_orders')::integer, 0) < 0
     OR coalesce((v_rules ->> 'min_completed_orders')::integer, 0) > 100000
     OR (v_rules ->> 'max_completed_orders') IS NOT NULL
        AND ((v_rules ->> 'max_completed_orders')::integer < coalesce((v_rules ->> 'min_completed_orders')::integer, 0)
             OR (v_rules ->> 'max_completed_orders')::integer > 100000) THEN
    RAISE EXCEPTION 'INVALID_CAMPAIGN_ELIGIBILITY_RULES' USING ERRCODE = '22023';
  END IF;
  IF v_type IN ('WELCOME', 'CUSTOMER_RETENTION') THEN
    v_rules := jsonb_set(jsonb_set(v_rules, '{allow_guest}', 'false'::jsonb, true), '{require_authenticated}', 'true'::jsonb, true);
  END IF;
  IF v_type = 'WELCOME' AND coalesce((v_rules ->> 'max_completed_orders')::integer, 0) <> 0 THEN
    RAISE EXCEPTION 'INVALID_WELCOME_ELIGIBILITY' USING ERRCODE = '22023';
  END IF;
  IF (v_type = 'PUBLIC_PROMOTION' AND NOT v_public)
     OR (v_type = 'PRIVATE_CODE' AND v_public) THEN
    RAISE EXCEPTION 'INVALID_PROMOTION_VISIBILITY' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements_text(v_game_ids) AS x(value) WHERE x.value !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
     OR EXISTS (SELECT 1 FROM jsonb_array_elements_text(v_package_ids) AS x(value) WHERE x.value !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') THEN
    RAISE EXCEPTION 'INVALID_CAMPAIGN_TARGET' USING ERRCODE = '22023';
  END IF;
  IF v_type = 'GAME_SPECIFIC' AND jsonb_array_length(v_game_ids) = 0 THEN
    RAISE EXCEPTION 'GAME_TARGET_REQUIRED' USING ERRCODE = '22023';
  END IF;
  IF v_type = 'PACKAGE_SPECIFIC' AND jsonb_array_length(v_package_ids) = 0 THEN
    RAISE EXCEPTION 'PACKAGE_TARGET_REQUIRED' USING ERRCODE = '22023';
  END IF;
  IF v_type = 'LIMITED_REDEMPTION' AND v_total_limit IS NULL AND v_customer_limit IS NULL THEN
    RAISE EXCEPTION 'REDEMPTION_LIMIT_REQUIRED' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements_text(v_game_ids) AS x(value)
    LEFT JOIN public.games g ON g.id = x.value::uuid WHERE g.id IS NULL
  ) OR EXISTS (
    SELECT 1 FROM jsonb_array_elements_text(v_package_ids) AS x(value)
    LEFT JOIN public.packages p ON p.id = x.value::uuid WHERE p.id IS NULL
  ) THEN
    RAISE EXCEPTION 'CAMPAIGN_TARGET_NOT_FOUND' USING ERRCODE = '22023';
  END IF;
  IF jsonb_array_length(v_game_ids) > 0 AND jsonb_array_length(v_package_ids) > 0
     AND EXISTS (
       SELECT 1 FROM jsonb_array_elements_text(v_package_ids) AS x(value)
       JOIN public.packages p ON p.id = x.value::uuid
       WHERE NOT EXISTS (
         SELECT 1 FROM jsonb_array_elements_text(v_game_ids) AS g(value) WHERE g.value::uuid = p.game_id
       )
     ) THEN
    RAISE EXCEPTION 'PACKAGE_GAME_TARGET_MISMATCH' USING ERRCODE = '22023';
  END IF;

  IF p_campaign_id IS NOT NULL THEN
    SELECT c.* INTO v_campaign FROM public.promotion_campaigns c WHERE c.id = p_campaign_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'CAMPAIGN_NOT_FOUND' USING ERRCODE = 'P0002'; END IF;
    SELECT v.* INTO v_voucher FROM public.vouchers v WHERE v.id = v_campaign.voucher_id FOR UPDATE;
    SELECT c.* INTO v_campaign FROM public.promotion_campaigns c WHERE c.id = p_campaign_id FOR UPDATE;
    IF v_campaign.status NOT IN ('DRAFT', 'SCHEDULED', 'PAUSED') THEN
      RAISE EXCEPTION 'PAUSE_CAMPAIGN_BEFORE_EDITING' USING ERRCODE = '55000';
    END IF;
    v_before := voucher_private.campaign_snapshot(p_campaign_id);
    SELECT count(*)::integer, coalesce(sum(u.discount_cents), 0)::bigint
      INTO v_current_uses, v_current_budget
    FROM public.voucher_usages u
    WHERE u.campaign_id = p_campaign_id
      AND u.redemption_status IN ('RESERVED', 'COMMITTED');
    IF v_total_limit IS NOT NULL AND v_total_limit < v_current_uses THEN
      RAISE EXCEPTION 'CAMPAIGN_LIMIT_BELOW_RESERVED_OR_COMMITTED_USES' USING ERRCODE = '23514';
    END IF;
    IF v_budget < v_current_budget THEN
      RAISE EXCEPTION 'CAMPAIGN_BUDGET_BELOW_RESERVED_OR_COMMITTED_DISCOUNTS' USING ERRCODE = '23514';
    END IF;
    IF v_campaign.campaign_type <> v_type AND EXISTS (
      SELECT 1 FROM public.voucher_usages u WHERE u.campaign_id = p_campaign_id
    ) THEN
      RAISE EXCEPTION 'CAMPAIGN_TYPE_LOCKED_AFTER_REDEMPTION' USING ERRCODE = '55000';
    END IF;
    IF v_voucher.code <> v_code AND EXISTS (
      SELECT 1 FROM public.voucher_usages u WHERE u.voucher_id = v_voucher.id
    ) THEN
      RAISE EXCEPTION 'CAMPAIGN_CODE_LOCKED_AFTER_REDEMPTION' USING ERRCODE = '55000';
    END IF;
    v_voucher_id := v_voucher.id;

    UPDATE public.vouchers SET
      code = v_code,
      description = v_description,
      discount_type = v_discount_type,
      discount_value = v_discount_value,
      min_order_cents = v_minimum,
      max_discount_cents = v_max_discount,
      usage_limit = v_total_limit,
      per_user_limit = coalesce(v_customer_limit, 0),
      starts_at = v_starts,
      ends_at = v_ends,
      is_active = v_campaign.status IN ('SCHEDULED', 'ACTIVE'),
      applies_to_game_id = CASE WHEN jsonb_array_length(v_game_ids) = 1 THEN (v_game_ids ->> 0)::uuid ELSE NULL END
    WHERE id = v_voucher.id;

    UPDATE public.promotion_campaigns SET
      name = v_name,
      description = v_description,
      campaign_type = v_type,
      timezone = v_timezone,
      starts_at = v_starts,
      ends_at = v_ends,
      eligibility_rules = v_rules,
      total_redemption_limit = v_total_limit,
      per_customer_redemption_limit = v_customer_limit,
      discount_budget_cents = v_budget,
      public_discovery = v_public,
      updated_at = now()
    WHERE id = p_campaign_id;
    DELETE FROM public.promotion_campaign_games WHERE campaign_id = p_campaign_id;
    DELETE FROM public.promotion_campaign_packages WHERE campaign_id = p_campaign_id;
    FOR v_game_id IN SELECT x.value::uuid FROM jsonb_array_elements_text(v_game_ids) AS x(value) LOOP
      INSERT INTO public.promotion_campaign_games(campaign_id, game_id) VALUES (p_campaign_id, v_game_id);
    END LOOP;
    FOR v_package_id IN SELECT x.value::uuid FROM jsonb_array_elements_text(v_package_ids) AS x(value) LOOP
      INSERT INTO public.promotion_campaign_packages(campaign_id, package_id) VALUES (p_campaign_id, v_package_id);
    END LOOP;
    out_campaign_id := p_campaign_id;
  ELSE
    INSERT INTO public.vouchers (
      code, description, discount_type, discount_value, min_order_cents,
      max_discount_cents, usage_limit, per_user_limit, starts_at, ends_at,
      is_active, applies_to_game_id
    ) VALUES (
      v_code, v_description, v_discount_type, v_discount_value, v_minimum,
      v_max_discount, v_total_limit, coalesce(v_customer_limit, 0), v_starts, v_ends,
      false, CASE WHEN jsonb_array_length(v_game_ids) = 1 THEN (v_game_ids ->> 0)::uuid ELSE NULL END
    ) RETURNING id INTO v_voucher_id;
    INSERT INTO public.promotion_campaigns (
      voucher_id, name, description, campaign_type, status, timezone, starts_at,
      ends_at, eligibility_rules, total_redemption_limit,
      per_customer_redemption_limit, discount_budget_cents, public_discovery, created_by
    ) VALUES (
      v_voucher_id, v_name, v_description, v_type, 'DRAFT', v_timezone,
      v_starts, v_ends, v_rules, v_total_limit, v_customer_limit, v_budget,
      v_public, p_actor_id
    ) RETURNING id INTO out_campaign_id;
    FOR v_game_id IN SELECT x.value::uuid FROM jsonb_array_elements_text(v_game_ids) AS x(value) LOOP
      INSERT INTO public.promotion_campaign_games(campaign_id, game_id) VALUES (out_campaign_id, v_game_id);
    END LOOP;
    FOR v_package_id IN SELECT x.value::uuid FROM jsonb_array_elements_text(v_package_ids) AS x(value) LOOP
      INSERT INTO public.promotion_campaign_packages(campaign_id, package_id) VALUES (out_campaign_id, v_package_id);
    END LOOP;
  END IF;

  out_voucher_id := v_voucher_id;
  INSERT INTO public.promotion_campaign_audit(campaign_id, actor_id, action, before_state, after_state)
  VALUES (out_campaign_id, p_actor_id, p_audit_action, v_before,
          voucher_private.campaign_snapshot(out_campaign_id));
  RETURN NEXT;
END;
$function$;
REVOKE ALL ON FUNCTION voucher_private.store_campaign(uuid, uuid, jsonb, text)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.admin_create_promotion_campaign(p_actor_id uuid, p_data jsonb)
RETURNS TABLE(out_campaign_id uuid, out_voucher_id uuid)
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public, voucher_private
AS $function$
  SELECT * FROM voucher_private.store_campaign(p_actor_id, NULL, p_data, 'CREATED');
$function$;
CREATE OR REPLACE FUNCTION public.admin_update_promotion_campaign(p_actor_id uuid, p_campaign_id uuid, p_data jsonb)
RETURNS TABLE(out_campaign_id uuid, out_voucher_id uuid)
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public, voucher_private
AS $function$
  SELECT * FROM voucher_private.store_campaign(p_actor_id, p_campaign_id, p_data, 'UPDATED');
$function$;
REVOKE ALL ON FUNCTION public.admin_create_promotion_campaign(uuid, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_update_promotion_campaign(uuid, uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_create_promotion_campaign(uuid, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_update_promotion_campaign(uuid, uuid, jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.admin_transition_promotion_campaign(
  p_actor_id uuid,
  p_campaign_id uuid,
  p_next_status text
)
RETURNS TABLE(out_campaign_id uuid, out_status text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, voucher_private
AS $function$
DECLARE
  v_campaign public.promotion_campaigns%ROWTYPE;
  v_voucher_id uuid;
  v_before jsonb;
  v_status text := p_next_status;
  v_allowed boolean := false;
BEGIN
  PERFORM voucher_private.assert_campaign_admin(p_actor_id);
  IF p_next_status NOT IN ('DRAFT', 'SCHEDULED', 'ACTIVE', 'PAUSED', 'ENDED', 'ARCHIVED') THEN
    RAISE EXCEPTION 'INVALID_CAMPAIGN_STATUS' USING ERRCODE = '22023';
  END IF;
  SELECT c.voucher_id INTO v_voucher_id FROM public.promotion_campaigns c WHERE c.id = p_campaign_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'CAMPAIGN_NOT_FOUND' USING ERRCODE = 'P0002'; END IF;
  PERFORM 1 FROM public.vouchers v WHERE v.id = v_voucher_id FOR UPDATE;
  SELECT c.* INTO v_campaign FROM public.promotion_campaigns c WHERE c.id = p_campaign_id FOR UPDATE;
  v_before := voucher_private.campaign_snapshot(p_campaign_id);

  v_allowed := CASE v_campaign.status
    WHEN 'DRAFT' THEN p_next_status IN ('SCHEDULED', 'ACTIVE', 'ARCHIVED')
    WHEN 'SCHEDULED' THEN p_next_status IN ('ACTIVE', 'PAUSED', 'ENDED', 'ARCHIVED')
    WHEN 'ACTIVE' THEN p_next_status IN ('PAUSED', 'ENDED')
    WHEN 'PAUSED' THEN p_next_status IN ('ACTIVE', 'ENDED', 'ARCHIVED')
    WHEN 'ENDED' THEN p_next_status = 'ARCHIVED'
    ELSE false
  END;
  IF NOT v_allowed THEN
    RAISE EXCEPTION 'INVALID_CAMPAIGN_STATE_TRANSITION' USING ERRCODE = '55000';
  END IF;

  IF p_next_status = 'SCHEDULED' AND v_campaign.starts_at <= now() THEN
    RAISE EXCEPTION 'CAMPAIGN_START_IS_NOT_IN_FUTURE' USING ERRCODE = '22023';
  END IF;
  IF p_next_status = 'ACTIVE' THEN
    IF v_campaign.ends_at IS NOT NULL AND v_campaign.ends_at <= now() THEN
      RAISE EXCEPTION 'CAMPAIGN_ALREADY_ENDED' USING ERRCODE = '22023';
    END IF;
    IF v_campaign.starts_at > now() THEN
      v_status := 'SCHEDULED';
    END IF;
  END IF;
  IF p_next_status = 'ENDED' AND (v_campaign.ends_at IS NULL OR v_campaign.ends_at > now()) THEN
    RAISE EXCEPTION 'CAMPAIGN_END_TIME_HAS_NOT_PASSED' USING ERRCODE = '22023';
  END IF;

  UPDATE public.promotion_campaigns SET status = v_status, updated_at = now() WHERE id = p_campaign_id;
  UPDATE public.vouchers SET is_active = v_status IN ('SCHEDULED', 'ACTIVE') WHERE id = v_voucher_id;
  INSERT INTO public.promotion_campaign_audit(campaign_id, actor_id, action, before_state, after_state)
  VALUES (p_campaign_id, p_actor_id, 'STATUS_CHANGED', v_before,
          voucher_private.campaign_snapshot(p_campaign_id));
  out_campaign_id := p_campaign_id;
  out_status := v_status;
  RETURN NEXT;
END;
$function$;
REVOKE ALL ON FUNCTION public.admin_transition_promotion_campaign(uuid, uuid, text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_transition_promotion_campaign(uuid, uuid, text) TO service_role;

CREATE OR REPLACE FUNCTION public.admin_duplicate_promotion_campaign(
  p_actor_id uuid,
  p_campaign_id uuid,
  p_new_code text
)
RETURNS TABLE(out_campaign_id uuid, out_voucher_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, voucher_private
AS $function$
DECLARE
  v_source jsonb;
  v_data jsonb;
BEGIN
  PERFORM voucher_private.assert_campaign_admin(p_actor_id);
  v_source := voucher_private.campaign_snapshot(p_campaign_id);
  IF v_source IS NULL THEN RAISE EXCEPTION 'CAMPAIGN_NOT_FOUND' USING ERRCODE = 'P0002'; END IF;
  v_data := jsonb_build_object(
    'name', left((v_source ->> 'name') || ' (copy)', 100),
    'description', v_source ->> 'description',
    'campaign_type', v_source ->> 'campaign_type',
    'code', p_new_code,
    'discount_type', v_source ->> 'discount_type',
    'discount_value', v_source -> 'discount_value',
    'min_order_cents', v_source -> 'min_order_cents',
    'max_discount_cents', v_source -> 'max_discount_cents',
    'total_redemption_limit', v_source -> 'total_redemption_limit',
    'per_customer_redemption_limit', v_source -> 'per_customer_redemption_limit',
    'discount_budget_cents', v_source -> 'discount_budget_cents',
    'starts_at', to_char((v_source ->> 'starts_at')::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'ends_at', CASE WHEN v_source ->> 'ends_at' IS NULL THEN NULL ELSE to_char((v_source ->> 'ends_at')::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') END,
    'timezone', v_source ->> 'timezone',
    'eligibility_rules', v_source -> 'eligibility_rules',
    'public_discovery', v_source -> 'public_discovery',
    'game_ids', v_source -> 'game_ids',
    'package_ids', v_source -> 'package_ids'
  );
  RETURN QUERY SELECT * FROM voucher_private.store_campaign(p_actor_id, NULL, v_data, 'DUPLICATED');
END;
$function$;
REVOKE ALL ON FUNCTION public.admin_duplicate_promotion_campaign(uuid, uuid, text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_duplicate_promotion_campaign(uuid, uuid, text) TO service_role;

CREATE OR REPLACE FUNCTION public.admin_list_promotion_campaigns(p_actor_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, voucher_private
AS $function$
DECLARE
  v_result jsonb;
BEGIN
  PERFORM voucher_private.assert_campaign_admin(p_actor_id);
  WITH rows AS (
    SELECT c.id, c.voucher_id, c.name, c.description, c.campaign_type,
      CASE
        WHEN c.status IN ('ACTIVE', 'SCHEDULED') AND c.ends_at IS NOT NULL AND c.ends_at <= now() THEN 'ENDED'
        WHEN c.status = 'SCHEDULED' AND c.starts_at <= now() AND (c.ends_at IS NULL OR c.ends_at > now()) THEN 'ACTIVE'
        ELSE c.status
      END AS effective_status,
      c.status AS stored_status, c.timezone, c.starts_at, c.ends_at,
      c.eligibility_rules, c.total_redemption_limit,
      c.per_customer_redemption_limit, c.discount_budget_cents,
      c.public_discovery, c.legacy_compatibility, c.created_at, c.updated_at,
      v.code, v.discount_type, v.discount_value, v.min_order_cents,
      v.max_discount_cents, v.usage_limit, v.per_user_limit,
      coalesce(s.reserved_uses, 0) AS reserved_uses,
      coalesce(s.committed_uses, 0) AS committed_uses,
      coalesce(s.released_uses, 0) AS released_uses,
      coalesce(s.reserved_discount_cents, 0) AS reserved_discount_cents,
      coalesce(s.committed_discount_cents, 0) AS committed_discount_cents,
      coalesce(s.active_discount_cents, 0) AS active_discount_cents,
      CASE WHEN c.discount_budget_cents IS NULL THEN NULL
        ELSE greatest(0, c.discount_budget_cents - coalesce(s.active_discount_cents, 0)) END AS remaining_budget_cents,
      coalesce(g.games, '[]'::jsonb) AS game_ids,
      coalesce(pk.packages, '[]'::jsonb) AS package_ids
    FROM public.promotion_campaigns c
    JOIN public.vouchers v ON v.id = c.voucher_id
    LEFT JOIN LATERAL (
      SELECT count(*) FILTER (WHERE u.redemption_status = 'RESERVED')::integer AS reserved_uses,
        count(*) FILTER (WHERE u.redemption_status = 'COMMITTED')::integer AS committed_uses,
        count(*) FILTER (WHERE u.redemption_status = 'RELEASED')::integer AS released_uses,
        coalesce(sum(u.discount_cents) FILTER (WHERE u.redemption_status = 'RESERVED'), 0)::bigint AS reserved_discount_cents,
        coalesce(sum(u.discount_cents) FILTER (WHERE u.redemption_status = 'COMMITTED'), 0)::bigint AS committed_discount_cents,
        coalesce(sum(u.discount_cents) FILTER (WHERE u.redemption_status IN ('RESERVED', 'COMMITTED')), 0)::bigint AS active_discount_cents
      FROM public.voucher_usages u WHERE u.campaign_id = c.id
    ) s ON true
    LEFT JOIN LATERAL (
      SELECT jsonb_agg(x.game_id ORDER BY x.game_id) AS games
      FROM public.promotion_campaign_games x WHERE x.campaign_id = c.id
    ) g ON true
    LEFT JOIN LATERAL (
      SELECT jsonb_agg(x.package_id ORDER BY x.package_id) AS packages
      FROM public.promotion_campaign_packages x WHERE x.campaign_id = c.id
    ) pk ON true
    ORDER BY c.updated_at DESC, c.id
    LIMIT 200
  )
  SELECT coalesce(jsonb_agg(to_jsonb(rows) ORDER BY rows.updated_at DESC, rows.id), '[]'::jsonb)
  INTO v_result FROM rows;
  RETURN v_result;
END;
$function$;
REVOKE ALL ON FUNCTION public.admin_list_promotion_campaigns(uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_list_promotion_campaigns(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.admin_get_promotion_campaign_report(
  p_actor_id uuid,
  p_campaign_id uuid,
  p_limit integer DEFAULT 50
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, voucher_private
AS $function$
DECLARE
  v_campaign jsonb;
  v_redemptions jsonb;
  v_audit jsonb;
BEGIN
  PERFORM voucher_private.assert_campaign_admin(p_actor_id);
  IF NOT EXISTS (SELECT 1 FROM public.promotion_campaigns c WHERE c.id = p_campaign_id) THEN
    RAISE EXCEPTION 'CAMPAIGN_NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;
  SELECT jsonb_build_object(
    'reserved_uses', count(*) FILTER (WHERE u.redemption_status = 'RESERVED'),
    'committed_uses', count(*) FILTER (WHERE u.redemption_status = 'COMMITTED'),
    'released_uses', count(*) FILTER (WHERE u.redemption_status = 'RELEASED'),
    'reserved_discount_cents', coalesce(sum(u.discount_cents) FILTER (WHERE u.redemption_status = 'RESERVED'), 0),
    'committed_discount_cents', coalesce(sum(u.discount_cents) FILTER (WHERE u.redemption_status = 'COMMITTED'), 0),
    'released_discount_cents', coalesce(sum(u.discount_cents) FILTER (WHERE u.redemption_status = 'RELEASED'), 0)
  ) INTO v_campaign
  FROM public.voucher_usages u WHERE u.campaign_id = p_campaign_id;
  SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.created_at DESC), '[]'::jsonb)
  INTO v_redemptions
  FROM (
    SELECT u.id, o.reference, o.status AS order_status,
      u.redemption_status, u.discount_cents, u.created_at,
      u.committed_at, u.released_at, u.release_reason
    FROM public.voucher_usages u
    JOIN public.orders o ON o.id = u.order_id
    WHERE u.campaign_id = p_campaign_id
    ORDER BY u.created_at DESC
    LIMIT greatest(1, least(coalesce(p_limit, 50), 100))
  ) r;
  SELECT coalesce(jsonb_agg(jsonb_build_object(
      'id', a.id, 'actor_id', a.actor_id, 'action', a.action,
      'before_state', a.before_state, 'after_state', a.after_state, 'created_at', a.created_at
    ) ORDER BY a.created_at DESC), '[]'::jsonb)
  INTO v_audit
  FROM (
    SELECT a.* FROM public.promotion_campaign_audit a
    WHERE a.campaign_id = p_campaign_id ORDER BY a.created_at DESC LIMIT 50
  ) a;
  RETURN jsonb_build_object('summary', coalesce(v_campaign, '{}'::jsonb),
    'redemptions', v_redemptions, 'audit', v_audit);
END;
$function$;
REVOKE ALL ON FUNCTION public.admin_get_promotion_campaign_report(uuid, uuid, integer) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_get_promotion_campaign_report(uuid, uuid, integer) TO service_role;

CREATE OR REPLACE FUNCTION public.admin_preview_promotion_campaign(
  p_actor_id uuid,
  p_campaign_id uuid,
  p_package_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, voucher_private
AS $function$
DECLARE
  v_campaign public.promotion_campaigns%ROWTYPE;
  v_voucher public.vouchers%ROWTYPE;
  v_package public.packages%ROWTYPE;
  v_discount integer;
  v_total integer;
  v_minimum integer := 1;
  v_fee_bps integer;
  v_fixed_fee integer;
  v_fx numeric;
  v_supplier_release boolean;
  v_game_status text;
  v_game_active boolean;
  v_current_uses integer := 0;
  v_current_discount bigint := 0;
  v_guest boolean;
  v_min_completed integer := 0;
  v_max_completed integer;
  v_games jsonb;
  v_packages jsonb;
  v_reason text;
BEGIN
  PERFORM voucher_private.assert_campaign_admin(p_actor_id);
  SELECT c.* INTO v_campaign FROM public.promotion_campaigns c WHERE c.id = p_campaign_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'CAMPAIGN_NOT_FOUND' USING ERRCODE = 'P0002'; END IF;
  SELECT v.* INTO v_voucher FROM public.vouchers v WHERE v.id = v_campaign.voucher_id;
  SELECT p.* INTO v_package FROM public.packages p WHERE p.id = p_package_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'PACKAGE_NOT_FOUND' USING ERRCODE = 'P0002'; END IF;
  SELECT g.catalog_status, g.is_active INTO v_game_status, v_game_active
  FROM public.games g WHERE g.id = v_package.game_id;
  SELECT count(*)::integer, coalesce(sum(u.discount_cents), 0)::bigint
    INTO v_current_uses, v_current_discount
  FROM public.voucher_usages u
  WHERE u.campaign_id = p_campaign_id AND u.redemption_status IN ('RESERVED', 'COMMITTED');
  SELECT coalesce(jsonb_agg(x.game_id), '[]'::jsonb) INTO v_games
  FROM public.promotion_campaign_games x WHERE x.campaign_id = p_campaign_id;
  SELECT coalesce(jsonb_agg(x.package_id), '[]'::jsonb) INTO v_packages
  FROM public.promotion_campaign_packages x WHERE x.campaign_id = p_campaign_id;
  v_min_completed := coalesce((v_campaign.eligibility_rules ->> 'min_completed_orders')::integer, 0);
  v_max_completed := nullif(v_campaign.eligibility_rules ->> 'max_completed_orders', '')::integer;
  v_guest := coalesce((v_campaign.eligibility_rules ->> 'allow_guest')::boolean, false)
    AND NOT coalesce((v_campaign.eligibility_rules ->> 'require_authenticated')::boolean, false)
    AND v_min_completed = 0 AND v_max_completed IS NULL
    AND v_campaign.campaign_type NOT IN ('WELCOME', 'CUSTOMER_RETENTION');
  IF NOT v_package.is_active OR v_package.catalog_status <> 'PUBLISHED'
     OR v_game_status <> 'PUBLISHED' OR v_game_active IS DISTINCT FROM true
     OR v_package.price_cents <= 0 OR v_package.supplier_review_required THEN
    v_reason := 'The selected package is not saleable.';
  ELSIF jsonb_array_length(v_games) > 0 AND NOT v_games @> jsonb_build_array(v_package.game_id) THEN
    v_reason := 'The package game is outside campaign targeting.';
  ELSIF jsonb_array_length(v_packages) > 0 AND NOT v_packages @> jsonb_build_array(v_package.id) THEN
    v_reason := 'The package is outside campaign targeting.';
  ELSIF v_voucher.min_order_cents > v_package.price_cents THEN
    v_reason := 'The package does not meet the minimum purchase.';
  END IF;
  IF v_reason IS NULL THEN
    IF v_voucher.discount_type = 'PERCENTAGE' THEN
      v_discount := round((v_package.price_cents::numeric * v_voucher.discount_value::numeric) / 100)::integer;
      IF v_voucher.max_discount_cents IS NOT NULL THEN v_discount := least(v_discount, v_voucher.max_discount_cents); END IF;
    ELSE
      v_discount := v_voucher.discount_value;
    END IF;
    v_discount := greatest(0, least(v_discount, v_package.price_cents));
    v_total := v_package.price_cents - v_discount;
    IF v_total <= 0 THEN v_reason := 'The discount would create a zero or invalid price.'; END IF;
  END IF;
  IF v_reason IS NULL AND (v_package.supplier_offer_id IS NOT NULL OR v_package.supplier_category_id IS NOT NULL OR v_package.supplier_cost_usd IS NOT NULL) THEN
    SELECT a.payment_fee_reserve_bps, a.payment_fee_fixed_cents, a.reference_usd_php_rate,
           a.supplier_fulfillment_release_enabled
      INTO v_fee_bps, v_fixed_fee, v_fx, v_supplier_release FROM public.app_settings a WHERE a.id = 1;
    IF v_supplier_release IS DISTINCT FROM true
       OR v_package.supplier_offer_id IS NULL OR v_package.supplier_category_id IS NULL
       OR v_package.supplier_cost_usd IS NULL OR v_fee_bps IS NULL OR v_fixed_fee IS NULL OR v_fx IS NULL
       OR v_fee_bps < 0 OR v_fee_bps >= 10000 OR v_fx <= 0 THEN
      v_reason := 'Supplier release or pricing assumptions are not approved.';
    ELSIF NOT EXISTS (
      SELECT 1 FROM public.supplier_package_mappings m
      JOIN public.suppliers s ON s.id = m.supplier_id
      WHERE m.package_id = v_package.id AND m.supplier_product_id = v_package.supplier_offer_id
        AND m.enabled IS TRUE AND s.enabled IS TRUE
        AND m.metadata ->> 'category_id' = v_package.supplier_category_id
    ) THEN
      v_reason := 'The supplier package mapping is not approved.';
    ELSE
      v_minimum := ceil((v_package.supplier_cost_usd * v_fx * 100 + v_fixed_fee)
        / (1 - v_fee_bps::numeric / 10000))::integer;
      IF v_total < v_minimum THEN v_reason := 'The discounted total falls below supplier cost and payment-fee reserves.'; END IF;
    END IF;
  END IF;
  IF v_reason IS NULL AND (
    (v_campaign.total_redemption_limit IS NOT NULL AND v_current_uses >= v_campaign.total_redemption_limit)
    OR (v_voucher.usage_limit IS NOT NULL AND v_current_uses >= v_voucher.usage_limit)
  ) THEN
    v_reason := 'The campaign redemption limit has been reached.';
  END IF;
  IF v_reason IS NULL AND v_campaign.discount_budget_cents IS NOT NULL
     AND v_current_discount + v_discount > v_campaign.discount_budget_cents THEN
    v_reason := 'The remaining campaign discount budget is insufficient.';
  END IF;
  RETURN jsonb_build_object(
    'valid', v_reason IS NULL, 'reason', v_reason,
    'subtotal_cents', v_package.price_cents, 'discount_cents', coalesce(v_discount, 0),
    'total_cents', coalesce(v_total, v_package.price_cents),
    'eligibility_rules', v_campaign.eligibility_rules,
    'eligible_customer_modes', jsonb_build_object(
      'new_authenticated', v_campaign.campaign_type <> 'CUSTOMER_RETENTION' AND v_min_completed = 0,
      'returning_authenticated', v_campaign.campaign_type <> 'WELCOME'
        AND (v_max_completed IS NULL OR v_max_completed >= greatest(1, v_min_completed)),
      'guest', v_guest
    ),
    'campaign_status', v_campaign.status,
    'reserved_or_committed_uses', v_current_uses,
    'remaining_budget_cents', CASE WHEN v_campaign.discount_budget_cents IS NULL THEN NULL
      ELSE greatest(0, v_campaign.discount_budget_cents - v_current_discount) END,
    'note', 'Eligibility modes are rule previews, not a lookup of real customer history.'
  );
END;
$function$;
REVOKE ALL ON FUNCTION public.admin_preview_promotion_campaign(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_preview_promotion_campaign(uuid, uuid, uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.consume_voucher_validation_rate_limit(p_client_ip text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, voucher_private
AS $function$
DECLARE
  v_ip inet;
  v_hash text;
  v_salt text;
  v_window timestamptz := date_trunc('minute', statement_timestamp());
  v_attempts integer;
  v_existing_window timestamptz;
  v_total integer;
BEGIN
  IF p_client_ip IS NULL OR length(p_client_ip) > 64 THEN RETURN false; END IF;
  BEGIN
    v_ip := p_client_ip::inet;
  EXCEPTION WHEN others THEN
    RETURN false;
  END;
  SELECT s.salt::text INTO v_salt FROM voucher_private.rate_limit_salt s WHERE s.singleton;
  IF v_salt IS NULL THEN RETURN false; END IF;
  v_hash := md5(v_salt || '|' || host(v_ip));

  SELECT b.attempts, b.window_started_at INTO v_attempts, v_existing_window
  FROM voucher_private.rate_limit_buckets b WHERE b.ip_hash = v_hash FOR UPDATE;
  IF FOUND THEN
    IF v_existing_window < v_window THEN
      UPDATE voucher_private.rate_limit_buckets SET window_started_at = v_window, attempts = 1, updated_at = now()
      WHERE ip_hash = v_hash;
      RETURN true;
    END IF;
    UPDATE voucher_private.rate_limit_buckets SET attempts = attempts + 1, updated_at = now()
    WHERE ip_hash = v_hash RETURNING attempts INTO v_attempts;
    RETURN v_attempts <= 10;
  END IF;

  -- Serialize only the creation of new IP buckets. A 100k-row ceiling and
  -- bounded cleanup prevent untrusted address churn from growing this table
  -- without limit; when full, new identities fail closed until cleanup frees space.
  PERFORM pg_advisory_xact_lock(7643921, 1);
  DELETE FROM voucher_private.rate_limit_buckets b
  WHERE b.ctid IN (
    SELECT stale.ctid FROM voucher_private.rate_limit_buckets stale
    WHERE stale.window_started_at < v_window - interval '1 day'
    ORDER BY stale.window_started_at LIMIT 500
  );
  SELECT count(*)::integer INTO v_total FROM voucher_private.rate_limit_buckets;
  IF v_total >= 100000 THEN RETURN false; END IF;
  INSERT INTO voucher_private.rate_limit_buckets(ip_hash, window_started_at, attempts)
  VALUES (v_hash, v_window, 1)
  ON CONFLICT (ip_hash) DO UPDATE SET
    window_started_at = EXCLUDED.window_started_at,
    attempts = CASE WHEN voucher_private.rate_limit_buckets.window_started_at < v_window
      THEN 1 ELSE voucher_private.rate_limit_buckets.attempts + 1 END,
    updated_at = now()
  RETURNING attempts INTO v_attempts;
  RETURN v_attempts <= 10;
END;
$function$;
REVOKE ALL ON FUNCTION public.consume_voucher_validation_rate_limit(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consume_voucher_validation_rate_limit(text) TO service_role;

CREATE OR REPLACE FUNCTION public.validate_and_reserve_voucher_usage()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, voucher_private
AS $function$
DECLARE
  v_order public.orders%ROWTYPE;
  v_voucher public.vouchers%ROWTYPE;
  v_campaign_id uuid;
  v_eval record;
BEGIN
  SELECT o.* INTO v_order FROM public.orders o WHERE o.id = NEW.order_id FOR UPDATE;
  IF NOT FOUND OR v_order.voucher_id IS DISTINCT FROM NEW.voucher_id THEN
    RAISE EXCEPTION 'VOUCHER_ORDER_SNAPSHOT_MISMATCH' USING ERRCODE = '23514';
  END IF;
  SELECT v.* INTO v_voucher FROM public.vouchers v WHERE v.id = NEW.voucher_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'VOUCHER_NOT_FOUND' USING ERRCODE = '23503'; END IF;
  SELECT c.id INTO v_campaign_id FROM public.promotion_campaigns c
    WHERE c.voucher_id = NEW.voucher_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'VOUCHER_CAMPAIGN_MISSING' USING ERRCODE = '23514'; END IF;

  SELECT * INTO v_eval
  FROM public.evaluate_promotion_voucher(v_voucher.code, v_order.package_id, v_order.email, false);
  IF NOT coalesce(v_eval.out_valid, false) THEN
    RAISE EXCEPTION 'VOUCHER_REJECTED: %', coalesce(v_eval.out_error, 'promotion is unavailable') USING ERRCODE = '23514';
  END IF;
  IF v_eval.out_campaign_id IS DISTINCT FROM v_campaign_id
     OR v_eval.out_discount_cents IS DISTINCT FROM v_order.voucher_discount_cents
     OR v_eval.out_discount_cents IS DISTINCT FROM v_order.discount_cents
     OR v_eval.out_total_cents IS DISTINCT FROM v_order.total_cents
     OR v_order.total_cents <= 0
     OR v_order.voucher_code IS DISTINCT FROM v_voucher.code
     OR v_order.voucher_discount_type IS DISTINCT FROM v_voucher.discount_type
     OR v_order.voucher_discount_value IS DISTINCT FROM v_voucher.discount_value THEN
    RAISE EXCEPTION 'VOUCHER_ORDER_SNAPSHOT_MISMATCH' USING ERRCODE = '23514';
  END IF;

  NEW.campaign_id := v_campaign_id;
  NEW.customer_user_id := v_order.customer_user_id;
  NEW.customer_key := CASE
    WHEN v_order.customer_user_id IS NOT NULL THEN 'user:' || v_order.customer_user_id::text
    ELSE 'guest:' || md5(
      (SELECT s.salt::text FROM voucher_private.rate_limit_salt s WHERE s.singleton)
      || '|' || lower(btrim(coalesce(v_order.email, NEW.email)))
    )
  END;
  NEW.redemption_status := 'RESERVED';
  NEW.discount_cents := v_eval.out_discount_cents;
  NEW.reservation_expires_at := coalesce(v_order.created_at, now()) + interval '24 hours';
  NEW.committed_at := NULL;
  NEW.released_at := NULL;
  NEW.release_reason := NULL;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.validate_and_reserve_voucher_usage() FROM PUBLIC, anon, authenticated, service_role;
DROP TRIGGER IF EXISTS trg_validate_voucher_usage_before_insert ON public.voucher_usages;
CREATE TRIGGER trg_validate_voucher_usage_before_insert
  BEFORE INSERT ON public.voucher_usages
  FOR EACH ROW EXECUTE FUNCTION public.validate_and_reserve_voucher_usage();

CREATE OR REPLACE FUNCTION public.reconcile_voucher_usage_with_order()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, voucher_private
AS $function$
BEGIN
  IF NEW.voucher_id IS NULL THEN RETURN NEW; END IF;
  IF NEW.payment_status = 'FAILED' OR NEW.status IN ('FAILED', 'CANCELLED', 'EXPIRED') THEN
    UPDATE public.voucher_usages u
    SET redemption_status = 'RELEASED',
        released_at = coalesce(NEW.updated_at, now()),
        reservation_expires_at = NULL,
        release_reason = CASE
          WHEN NEW.status IN ('FAILED', 'CANCELLED', 'EXPIRED') THEN 'ORDER_' || NEW.status
          ELSE 'PAYMENT_FAILED'
        END
    WHERE u.voucher_id = NEW.voucher_id AND u.order_id = NEW.id
      AND u.redemption_status = 'RESERVED';
  ELSIF NEW.payment_status = 'VERIFIED' OR NEW.status IN ('PAID', 'PAYMENT_VERIFIED', 'PROCESSING', 'COMPLETED', 'DELIVERED') THEN
    UPDATE public.voucher_usages u
    SET redemption_status = 'COMMITTED',
        committed_at = coalesce(NEW.updated_at, now()),
        reservation_expires_at = NULL,
        released_at = NULL,
        release_reason = NULL
    WHERE u.voucher_id = NEW.voucher_id AND u.order_id = NEW.id
      AND u.redemption_status = 'RESERVED';
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.reconcile_voucher_usage_with_order() FROM PUBLIC, anon, authenticated, service_role;
DROP TRIGGER IF EXISTS trg_orders_voucher_release ON public.orders;
DROP TRIGGER IF EXISTS trg_orders_voucher_reconcile ON public.orders;
CREATE TRIGGER trg_orders_voucher_reconcile
  AFTER UPDATE OF status, payment_status ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.reconcile_voucher_usage_with_order();

CREATE OR REPLACE FUNCTION public.create_order(
  p_game_id uuid,
  p_package_id uuid,
  p_email text,
  p_customer_name text,
  p_player_inputs jsonb,
  p_payment_method text,
  p_voucher_code text DEFAULT NULL,
  p_voucher_email text DEFAULT NULL
)
RETURNS TABLE(out_reference text, out_order_id uuid, out_total_cents integer, out_error text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, voucher_private
AS $function$
DECLARE
  v_pkg public.packages%ROWTYPE;
  v_fields record;
  v_input_value text;
  v_subtotal integer;
  v_discount integer := 0;
  v_total integer;
  v_voucher public.vouchers%ROWTYPE;
  v_voucher_id uuid;
  v_campaign_id uuid;
  v_eval record;
  v_reference text;
  v_order_id uuid;
  v_pay public.payment_config%ROWTYPE;
  v_snapshot jsonb;
  v_mapping_id uuid;
  v_code text := upper(btrim(coalesce(p_voucher_code, '')));
BEGIN
  SELECT p.* INTO v_pkg FROM public.packages p WHERE p.id = p_package_id AND p.is_active = true;
  IF NOT FOUND OR v_pkg.game_id IS DISTINCT FROM p_game_id THEN
    RETURN QUERY SELECT NULL::text, NULL::uuid, NULL::integer, 'The selected package is no longer available.'::text;
    RETURN;
  END IF;

  FOR v_fields IN
    SELECT f.field_key, f.label, f.is_required
    FROM public.game_input_fields f WHERE f.game_id = p_game_id ORDER BY f.sort_order
  LOOP
    IF v_fields.is_required THEN
      v_input_value := coalesce(p_player_inputs ->> v_fields.field_key, '');
      IF btrim(v_input_value) = '' THEN
        RETURN QUERY SELECT NULL::text, NULL::uuid, NULL::integer, ('Please enter your ' || v_fields.label || '.')::text;
        RETURN;
      END IF;
    END IF;
  END LOOP;

  SELECT p.* INTO v_pay FROM public.payment_config p
  WHERE p.method_key = p_payment_method AND p.is_enabled IS TRUE;
  IF NOT FOUND THEN
    RETURN QUERY SELECT NULL::text, NULL::uuid, NULL::integer, 'The selected payment method is no longer available. Please choose another.'::text;
    RETURN;
  END IF;
  IF v_pay.min_amount_cents IS NOT NULL AND v_pkg.price_cents < v_pay.min_amount_cents THEN
    RETURN QUERY SELECT NULL::text, NULL::uuid, NULL::integer,
      ('Minimum amount for ' || v_pay.display_name || ' is ₱' || (v_pay.min_amount_cents / 100.0)::text || '.')::text;
    RETURN;
  END IF;
  IF v_pay.max_amount_cents IS NOT NULL AND v_pay.max_amount_cents > 0 AND v_pkg.price_cents > v_pay.max_amount_cents THEN
    RETURN QUERY SELECT NULL::text, NULL::uuid, NULL::integer,
      ('Maximum amount for ' || v_pay.display_name || ' is ₱' || (v_pay.max_amount_cents / 100.0)::text || '.')::text;
    RETURN;
  END IF;

  v_subtotal := v_pkg.price_cents;
  v_total := v_subtotal;
  IF v_code <> '' THEN
    IF length(v_code) > 50 THEN
      RETURN QUERY SELECT NULL::text, NULL::uuid, NULL::integer, 'Invalid or unavailable promotion code.'::text;
      RETURN;
    END IF;
    SELECT v.* INTO v_voucher FROM public.vouchers v
    WHERE upper(btrim(v.code)) = v_code FOR UPDATE;
    IF NOT FOUND THEN
      RETURN QUERY SELECT NULL::text, NULL::uuid, NULL::integer, 'Invalid or unavailable promotion code.'::text;
      RETURN;
    END IF;
    SELECT c.id INTO v_campaign_id FROM public.promotion_campaigns c
    WHERE c.voucher_id = v_voucher.id FOR UPDATE;
    IF NOT FOUND THEN
      RETURN QUERY SELECT NULL::text, NULL::uuid, NULL::integer, 'This promotion requires administrator review.'::text;
      RETURN;
    END IF;
    SELECT * INTO v_eval FROM public.evaluate_promotion_voucher(
      v_voucher.code, p_package_id, coalesce(p_voucher_email, p_email), false
    );
    IF NOT coalesce(v_eval.out_valid, false) THEN
      RETURN QUERY SELECT NULL::text, NULL::uuid, NULL::integer, v_eval.out_error;
      RETURN;
    END IF;
    v_discount := v_eval.out_discount_cents;
    v_total := v_eval.out_total_cents;
  END IF;
  IF v_total <= 0 THEN
    RETURN QUERY SELECT NULL::text, NULL::uuid, NULL::integer, 'The final order total must be greater than zero.'::text;
    RETURN;
  END IF;
  IF v_pay.min_amount_cents IS NOT NULL AND v_total < v_pay.min_amount_cents THEN
    RETURN QUERY SELECT NULL::text, NULL::uuid, NULL::integer,
      ('Discounted total is below the minimum amount for ' || v_pay.display_name || '.')::text;
    RETURN;
  END IF;

  v_reference := public.generate_order_reference();
  v_snapshot := jsonb_build_object(
    'method_key', v_pay.method_key,
    'display_name', v_pay.display_name,
    'account_name', v_pay.account_name,
    'account_number', v_pay.account_number,
    'instructions', v_pay.instructions,
    'qr_data', v_pay.qr_data,
    'provider_type', v_pay.provider_type,
    'provider_name', v_pay.provider_name
  );
  SELECT m.id INTO v_mapping_id
  FROM public.supplier_package_mappings m
  JOIN public.suppliers s ON s.id = m.supplier_id
  WHERE m.package_id = p_package_id AND m.enabled IS TRUE AND s.enabled IS TRUE
  ORDER BY m.priority DESC LIMIT 1;

  INSERT INTO public.orders (
    reference, email, customer_name, game_id, package_id, player_inputs,
    subtotal_cents, discount_cents, total_cents, payment_method, status,
    voucher_id, voucher_code, voucher_discount_type, voucher_discount_value,
    voucher_discount_cents, payment_mode, payment_provider,
    payment_config_snapshot, supplier_mapping_id
  ) VALUES (
    v_reference, lower(btrim(p_email)), coalesce(p_customer_name, 'Guest'),
    p_game_id, p_package_id, coalesce(p_player_inputs, '{}'::jsonb),
    v_subtotal, v_discount, v_total, p_payment_method, 'WAITING_PAYMENT',
    CASE WHEN v_code = '' THEN NULL ELSE v_voucher.id END,
    CASE WHEN v_code = '' THEN NULL ELSE v_voucher.code END,
    CASE WHEN v_code = '' THEN NULL ELSE v_voucher.discount_type END,
    CASE WHEN v_code = '' THEN NULL ELSE v_voucher.discount_value END,
    v_discount, v_pay.provider_type, v_pay.provider_name, v_snapshot, v_mapping_id
  ) RETURNING id INTO v_order_id;

  INSERT INTO public.order_timeline(order_id, status, actor_email, note)
  VALUES (v_order_id, 'WAITING_PAYMENT', lower(btrim(p_email)), 'Order created');
  IF v_code <> '' THEN
    INSERT INTO public.voucher_usages(voucher_id, order_id, email)
    VALUES (v_voucher.id, v_order_id, coalesce(p_voucher_email, lower(btrim(p_email))))
    ON CONFLICT (voucher_id, order_id) DO NOTHING;
  END IF;
  RETURN QUERY SELECT v_reference, v_order_id, v_total, NULL::text;
END;
$function$;
REVOKE ALL ON FUNCTION public.create_order(uuid, uuid, text, text, jsonb, text, text, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.create_order(uuid, uuid, text, text, jsonb, text, text, text)
  TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.create_order_idempotent(
  p_game_id uuid,
  p_package_id uuid,
  p_email text,
  p_customer_name text,
  p_player_inputs jsonb,
  p_payment_method text,
  p_voucher_code text,
  p_voucher_email text,
  p_request_key uuid
)
RETURNS TABLE(out_reference text, out_order_id uuid, out_total_cents integer, out_error text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, voucher_private
AS $function$
DECLARE
  v_existing public.orders%ROWTYPE;
  v_reference text;
  v_order_id uuid;
  v_total integer;
  v_error text;
  v_clean_inputs jsonb := coalesce(p_player_inputs, '{}'::jsonb) - '__rfz_order_access_hash';
  v_capability_hash text := p_player_inputs ->> '__rfz_order_access_hash';
  v_session_user uuid := auth.uid();
BEGIN
  IF p_request_key IS NULL OR p_email IS NULL OR length(btrim(p_email)) > 320
     OR lower(btrim(p_email)) !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
     OR p_payment_method IS NULL OR length(p_payment_method) > 50
     OR coalesce(p_player_inputs ->> '__rfz_order_access_hash', '') !~ '^[0-9a-f]{64}$' THEN
    RETURN QUERY SELECT NULL::text, NULL::uuid, NULL::integer, 'Invalid checkout request.'::text;
    RETURN;
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_request_key::text, 804291));

  SELECT o.* INTO v_existing
  FROM voucher_private.checkout_idempotency i
  JOIN public.orders o ON o.id = i.order_id
  WHERE i.request_key = p_request_key
  FOR UPDATE OF i, o;
  IF FOUND THEN
    IF v_existing.customer_user_id IS DISTINCT FROM v_session_user
       OR (v_session_user IS NULL AND lower(v_existing.email) <> lower(btrim(p_email)))
       OR v_existing.game_id IS DISTINCT FROM p_game_id
       OR v_existing.package_id IS DISTINCT FROM p_package_id
       OR v_existing.payment_method IS DISTINCT FROM p_payment_method
       OR v_existing.voucher_code IS DISTINCT FROM nullif(upper(btrim(coalesce(p_voucher_code, ''))), '')
       OR v_existing.customer_name IS DISTINCT FROM coalesce(p_customer_name, 'Guest')
       OR (v_existing.player_inputs - '__rfz_order_access_hash') IS DISTINCT FROM v_clean_inputs THEN
      RETURN QUERY SELECT NULL::text, NULL::uuid, NULL::integer, 'IDEMPOTENCY_KEY_CONFLICT'::text;
      RETURN;
    END IF;
    IF v_session_user IS NULL THEN
      UPDATE public.guest_order_access a
      SET revoked_at = now()
      WHERE a.order_id = v_existing.id AND a.revoked_at IS NULL;
      INSERT INTO public.guest_order_access(order_id, token_hash, expires_at, revoked_at)
      VALUES (v_existing.id, v_capability_hash, now() + interval '60 days', NULL)
      ON CONFLICT (order_id, token_hash) DO UPDATE
        SET revoked_at = NULL, expires_at = EXCLUDED.expires_at;
    END IF;
    RETURN QUERY SELECT v_existing.reference, v_existing.id, v_existing.total_cents, NULL::text;
    RETURN;
  END IF;

  SELECT o.out_reference, o.out_order_id, o.out_total_cents, o.out_error
    INTO v_reference, v_order_id, v_total, v_error
  FROM public.create_order(
    p_game_id, p_package_id, p_email, p_customer_name, p_player_inputs,
    p_payment_method, p_voucher_code, p_voucher_email
  ) o;
  IF v_reference IS NOT NULL THEN
    INSERT INTO voucher_private.checkout_idempotency(request_key, order_id)
    VALUES (p_request_key, v_order_id);
  END IF;
  RETURN QUERY SELECT v_reference, v_order_id, v_total, v_error;
END;
$function$;
REVOKE ALL ON FUNCTION public.create_order_idempotent(uuid, uuid, text, text, jsonb, text, text, text, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.create_order_idempotent(uuid, uuid, text, text, jsonb, text, text, text, uuid)
  TO anon, authenticated;
