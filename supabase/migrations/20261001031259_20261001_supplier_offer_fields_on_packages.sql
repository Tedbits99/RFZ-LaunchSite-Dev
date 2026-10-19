/*
# Add supplier offer fields to packages table

1. Purpose
   Link each package to its FazerCards offer so the customer-facing
   Mobile Legends page can display database-driven packages with
   admin-configured selling prices, while the fulfillment layer
   uses the supplier offer_id + category_id to place real orders.

2. Columns added to `packages`
   - `supplier_offer_id`   (text, nullable) — FazerCards offer_id (e.g. "10_1_diamonds")
   - `supplier_category_id` (text, nullable) — FazerCards category_id (e.g. "mobile_legends_philippines")
   - `supplier_cost_usd`   (numeric(10,4), nullable) — real supplier cost in USD (admin-only, never shown to customers)
   - `badge`               (text, nullable) — admin-configured badge label (e.g. "Popular", "Best Value")

3. Notes
   - `price_cents` remains the customer-facing selling price in PHP cents (unchanged).
   - `supplier_cost_usd` is for admin margin reporting only — never exposed to the frontend.
   - Existing packages keep their current values; new columns default to NULL.
   - No data is lost; all existing packages continue to work as before.
*/

ALTER TABLE packages
  ADD COLUMN IF NOT EXISTS supplier_offer_id text,
  ADD COLUMN IF NOT EXISTS supplier_category_id text,
  ADD COLUMN IF NOT EXISTS supplier_cost_usd numeric(10, 4),
  ADD COLUMN IF NOT EXISTS badge text;

-- Index for quick lookup of packages by supplier offer
CREATE INDEX IF NOT EXISTS idx_packages_supplier_offer_id
  ON packages (supplier_offer_id)
  WHERE supplier_offer_id IS NOT NULL;
