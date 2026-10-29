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

ALTER TABLE public.packages
  DROP CONSTRAINT IF EXISTS packages_catalog_status_check;
ALTER TABLE public.packages
  ADD CONSTRAINT packages_catalog_status_check
  CHECK (catalog_status IN ('DRAFT', 'PUBLISHED', 'ARCHIVED'));

UPDATE public.packages
SET catalog_status = CASE
      WHEN is_active AND price_cents > 0 THEN 'PUBLISHED'
      ELSE 'DRAFT'
    END,
    published_at = CASE WHEN is_active AND price_cents > 0 THEN COALESCE(published_at, created_at, now()) ELSE NULL END
WHERE catalog_status = 'DRAFT';

CREATE INDEX IF NOT EXISTS games_catalog_status_sort_idx
  ON public.games(catalog_status, sort_order);
CREATE INDEX IF NOT EXISTS packages_catalog_status_sort_idx
  ON public.packages(catalog_status, game_id, sort_order);

COMMENT ON COLUMN public.games.catalog_status IS 'DRAFT, PUBLISHED, or ARCHIVED; is_active is retained for compatibility.';
COMMENT ON COLUMN public.packages.catalog_status IS 'DRAFT, PUBLISHED, or ARCHIVED; imported supplier offers always start as DRAFT.';
COMMENT ON COLUMN public.packages.supplier_review_required IS 'Set when an upstream offer disappears or supplier cost/availability requires review.';
