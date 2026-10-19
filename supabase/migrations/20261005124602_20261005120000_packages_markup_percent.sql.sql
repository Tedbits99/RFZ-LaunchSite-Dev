/*
# Add markup_percent to packages for USD→PHP auto-pricing

1. Purpose
   Allow the ML Offer Pricing admin page to auto-calculate selling
   prices from supplier cost (USD) and a configurable markup percent,
   using the reference USD→PHP rate from app_settings.

2. Column added to `packages`
   - `markup_percent` (numeric(10,2), nullable, default NULL)
     Stores the admin-configured markup percentage per package.
     When NULL, the package's selling price is treated as manually
     set and not auto-recalculated.

3. Formula
   cost_php      = supplier_cost_usd × reference_usd_php_rate
   selling_price = cost_php × (1 + markup_percent / 100)
   margin_php    = selling_price − cost_php

4. Notes
   - `supplier_cost_usd` is never modified by this feature.
   - `price_cents` (customer-facing PHP cents) is the computed output.
   - Existing packages keep their current price_cents; the new column
     defaults to NULL so existing manually-priced packages are unaffected
     until an admin sets a markup or saves a price through the UI.
   - No data is lost; all existing packages continue to work as before.
*/

ALTER TABLE packages
  ADD COLUMN IF NOT EXISTS markup_percent numeric(10, 2);
