-- Restore the minimum API-role SELECT privileges needed by the public catalog
-- and customer-owned order embeds. Row visibility continues to be governed by
-- the existing active-game and active-package RLS policies.
--
-- Games contain only customer-facing catalog fields, so grant the current
-- public columns explicitly. Packages include supplier offer/cost and pricing
-- inputs; expose only storefront columns and keep supplier metadata, costs,
-- and markup fields server-side.
GRANT SELECT (
  id,
  slug,
  name,
  short_name,
  description,
  region,
  currency,
  logo_url,
  cover_url,
  banner_url,
  is_active,
  is_featured,
  sort_order,
  created_at,
  updated_at
) ON TABLE public.games TO anon, authenticated;

GRANT SELECT (
  id,
  game_id,
  name,
  sku,
  amount,
  price_cents,
  original_price_cents,
  bonus,
  is_active,
  sort_order,
  created_at,
  badge,
  image_url
) ON TABLE public.packages TO anon, authenticated;
