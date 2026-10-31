/* CATALOG-001: additive catalog lifecycle and supplier review state. */

ALTER TABLE public.games
  ADD COLUMN IF NOT EXISTS catalog_status text NOT NULL DEFAULT 'DRAFT',
  ADD COLUMN IF NOT EXISTS published_at timestamptz,
  ADD COLUMN IF NOT EXISTS archived_at timestamptz,
  ADD COLUMN IF NOT EXISTS archived_by uuid;

ALTER TABLE public.games
  DROP CONSTRAINT IF EXISTS games_catalog_status_check;
ALTER TABLE public.games
  ADD CONSTRAINT games_catalog_status_check
  CHECK (catalog_status IN ('DRAFT', 'PUBLISHED', 'ARCHIVED'));

-- Existing active catalog rows remain customer-visible after the additive
-- migration. Existing inactive rows become drafts; no row is deleted.
UPDATE public.games
SET catalog_status = CASE WHEN is_active THEN 'PUBLISHED' ELSE 'DRAFT' END,
    published_at = CASE WHEN is_active THEN COALESCE(published_at, updated_at, now()) ELSE NULL END
WHERE catalog_status = 'DRAFT';

ALTER TABLE public.packages
  ADD COLUMN IF NOT EXISTS catalog_status text NOT NULL DEFAULT 'DRAFT',
  ADD COLUMN IF NOT EXISTS published_at timestamptz,
  ADD COLUMN IF NOT EXISTS archived_at timestamptz,
  ADD COLUMN IF NOT EXISTS supplier_last_seen_at timestamptz,
  ADD COLUMN IF NOT EXISTS supplier_review_required boolean NOT NULL DEFAULT false;

ALTER TABLE public.app_settings
  ADD COLUMN IF NOT EXISTS payment_fee_reserve_bps integer,
  ADD COLUMN IF NOT EXISTS payment_fee_fixed_cents integer,
  ADD COLUMN IF NOT EXISTS supplier_fulfillment_release_enabled boolean NOT NULL DEFAULT false;

ALTER TABLE public.app_settings
  DROP CONSTRAINT IF EXISTS app_settings_payment_fee_reserve_bps_check;
ALTER TABLE public.app_settings
  ADD CONSTRAINT app_settings_payment_fee_reserve_bps_check
  CHECK (payment_fee_reserve_bps IS NULL OR payment_fee_reserve_bps BETWEEN 0 AND 9999);
ALTER TABLE public.app_settings
  DROP CONSTRAINT IF EXISTS app_settings_payment_fee_fixed_cents_check;
ALTER TABLE public.app_settings
  ADD CONSTRAINT app_settings_payment_fee_fixed_cents_check
  CHECK (payment_fee_fixed_cents IS NULL OR payment_fee_fixed_cents >= 0);

ALTER TABLE public.packages
  DROP CONSTRAINT IF EXISTS packages_catalog_status_check;
ALTER TABLE public.packages
  ADD CONSTRAINT packages_catalog_status_check
  CHECK (catalog_status IN ('DRAFT', 'PUBLISHED', 'ARCHIVED'));

WITH availability AS (
  SELECT p.id,
    COALESCE(p.is_active
      AND p.price_cents > 0
      AND (
        (p.supplier_offer_id IS NULL AND p.supplier_category_id IS NULL)
        OR (
          p.supplier_offer_id IS NOT NULL
          AND p.supplier_category_id IS NOT NULL
          AND p.supplier_cost_usd > 0
          AND EXISTS (
            SELECT 1
            FROM public.supplier_package_mappings m
            JOIN public.suppliers s ON s.id = m.supplier_id
            WHERE m.package_id = p.id
              AND m.supplier_product_id = p.supplier_offer_id
              AND m.enabled IS TRUE
              AND s.enabled IS TRUE
              AND m.metadata->>'category_id' = p.supplier_category_id
          )
          AND EXISTS (
            SELECT 1 FROM public.app_settings a
            WHERE a.id = 1
              AND a.supplier_fulfillment_release_enabled IS TRUE
              AND a.payment_fee_reserve_bps IS NOT NULL
              AND a.payment_fee_fixed_cents IS NOT NULL
              AND p.price_cents >= CEIL(
                (p.supplier_cost_usd * a.reference_usd_php_rate * 100 + a.payment_fee_fixed_cents)
                / (1 - a.payment_fee_reserve_bps::numeric / 10000)
              )
          )
        )
      ), false) AS is_saleable
  FROM public.packages p
)
UPDATE public.packages p
SET catalog_status = CASE WHEN a.is_saleable AND NOT p.supplier_review_required THEN 'PUBLISHED' ELSE 'DRAFT' END,
    is_active = p.is_active AND a.is_saleable AND NOT p.supplier_review_required,
    supplier_review_required = p.supplier_review_required OR (
      (p.supplier_offer_id IS NOT NULL OR p.supplier_category_id IS NOT NULL)
      AND NOT a.is_saleable
    ),
    published_at = CASE
      WHEN a.is_saleable AND NOT p.supplier_review_required THEN COALESCE(p.published_at, p.created_at, now())
      ELSE NULL
    END
FROM availability a
WHERE p.id = a.id AND p.catalog_status = 'DRAFT';

UPDATE public.games g
SET catalog_status = CASE WHEN g.is_active AND EXISTS (
      SELECT 1 FROM public.packages p
      WHERE p.game_id = g.id AND p.catalog_status = 'PUBLISHED'
        AND p.is_active AND p.price_cents > 0 AND NOT p.supplier_review_required
    ) THEN 'PUBLISHED' ELSE 'DRAFT' END,
    is_active = g.is_active AND EXISTS (
      SELECT 1 FROM public.packages p
      WHERE p.game_id = g.id AND p.catalog_status = 'PUBLISHED'
        AND p.is_active AND p.price_cents > 0 AND NOT p.supplier_review_required
    ),
    published_at = CASE WHEN g.is_active AND EXISTS (
      SELECT 1 FROM public.packages p
      WHERE p.game_id = g.id AND p.catalog_status = 'PUBLISHED'
        AND p.is_active AND p.price_cents > 0 AND NOT p.supplier_review_required
    ) THEN COALESCE(g.published_at, g.updated_at, now()) ELSE NULL END;

-- Lifecycle filters are public storefront predicates; supplier costs,
-- mappings, fee reserves, and review flags remain server-side only.
GRANT SELECT (catalog_status) ON TABLE public.games TO anon, authenticated;
GRANT SELECT (catalog_status) ON TABLE public.packages TO anon, authenticated;

CREATE INDEX IF NOT EXISTS games_catalog_status_sort_idx
  ON public.games(catalog_status, sort_order);
CREATE INDEX IF NOT EXISTS packages_catalog_status_sort_idx
  ON public.packages(catalog_status, game_id, sort_order);

COMMENT ON COLUMN public.games.catalog_status IS 'DRAFT, PUBLISHED, or ARCHIVED; is_active is retained for compatibility.';
COMMENT ON COLUMN public.packages.catalog_status IS 'DRAFT, PUBLISHED, or ARCHIVED; imported supplier offers always start as DRAFT.';
COMMENT ON COLUMN public.packages.supplier_review_required IS 'Set when an upstream offer disappears or supplier cost/availability requires review.';
