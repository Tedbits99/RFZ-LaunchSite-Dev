/*
# Create app_settings table for configurable FX reference rate

1. Purpose
   Store a configurable "Reference USD → PHP rate" used ONLY for
   estimated margin display in the admin ML Offer Pricing page.
   This rate never modifies supplier orders, supplier cost, or
   customer pricing.

2. New Table: app_settings
   - id (int, primary key, always 1 — singleton row)
   - reference_usd_php_rate (numeric(10,4), not null, default 56.0000)
   - updated_at (timestamptz)

3. Security
   - RLS enabled.
   - SELECT: anon + authenticated (the rate is non-sensitive display config).
   - UPDATE/INSERT: authenticated only (admin-only writes).
*/

CREATE TABLE IF NOT EXISTS app_settings (
  id int PRIMARY KEY DEFAULT 1,
  reference_usd_php_rate numeric(10, 4) NOT NULL DEFAULT 56.0000,
  updated_at timestamptz DEFAULT now(),
  CONSTRAINT single_row CHECK (id = 1)
);

ALTER TABLE app_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_read_settings" ON app_settings;
CREATE POLICY "anon_read_settings" ON app_settings FOR SELECT
  TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "auth_update_settings" ON app_settings;
CREATE POLICY "auth_update_settings" ON app_settings FOR UPDATE
  TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "auth_insert_settings" ON app_settings;
CREATE POLICY "auth_insert_settings" ON app_settings FOR INSERT
  TO authenticated WITH CHECK (true);

-- Seed the singleton row
INSERT INTO app_settings (id, reference_usd_php_rate)
VALUES (1, 56.0000)
ON CONFLICT (id) DO NOTHING;
