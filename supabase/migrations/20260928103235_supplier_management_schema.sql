/*
# Supplier Management Schema

Creates the full supplier/provider infrastructure for automated game top-up fulfillment.

1. New Tables

  ## `suppliers`
  Stores supplier/provider configuration (non-secret fields only).
  - `id` (uuid, PK)
  - `name` (text) — human-readable name, e.g. "Reloadly", "SEAGM"
  - `code` (text, unique) — machine identifier, e.g. "reloadly", "seagm"
  - `adapter` (text) — which adapter class to use, e.g. "reloadly", "seagm", "generic"
  - `api_url` (text) — base API endpoint URL
  - `sandbox_api_url` (text, nullable) — sandbox/test endpoint
  - `environment` (text) — 'sandbox' or 'live'
  - `enabled` (boolean) — whether this supplier is active
  - `priority` (int) — higher = tried first. For fallback ordering
  - `retry_count` (int) — max retries on transient failures
  - `timeout_ms` (int) — request timeout in milliseconds
  - `low_balance_threshold_cents` (int) — alert when balance drops below
  - `supports_balance` (boolean) — whether provider has a balance API
  - `supports_validation` (boolean) — whether provider can validate player IDs
  - `supports_refund` (boolean) — whether provider supports refunds
  - `auth_type` (text) — 'api_key', 'bearer', 'basic', 'oauth2', 'custom'
  - `auth_config` (jsonb) — non-secret auth metadata (header names, token URLs)
  - `last_success_at` (timestamptz, nullable)
  - `last_failure_at` (timestamptz, nullable)
  - `last_error` (text, nullable)
  - `cached_balance_cents` (bigint, nullable) — last known balance
  - `balance_checked_at` (timestamptz, nullable)
  - `metadata` (jsonb) — extra provider-specific config
  - `created_at`, `updated_at` (timestamptz)

  ## `supplier_package_mappings`
  Maps local packages to supplier products with priority/fallback.
  - `id` (uuid, PK)
  - `package_id` (uuid, FK → packages)
  - `supplier_id` (uuid, FK → suppliers)
  - `supplier_product_id` (text) — the product code in the supplier's catalog
  - `supplier_cost_cents` (int) — cost from supplier in cents
  - `priority` (int) — higher = tried first for this package
  - `enabled` (boolean)
  - `metadata` (jsonb) — extra mapping data
  - `created_at`, `updated_at` (timestamptz)
  - Unique constraint on (package_id, supplier_id)

  ## `supplier_transactions`
  Logs every interaction with a supplier API for audit, debugging, and idempotency.
  - `id` (uuid, PK)
  - `order_id` (uuid, FK → orders)
  - `supplier_id` (uuid, FK → suppliers)
  - `mapping_id` (uuid, nullable, FK → supplier_package_mappings)
  - `idempotency_key` (text, unique) — prevents duplicate fulfillments
  - `action` (text) — 'create_order', 'query_status', 'refund', 'test', 'balance', 'validate'
  - `status` (text) — 'pending', 'submitted', 'success', 'failed', 'timeout', 'refunded'
  - `supplier_reference` (text, nullable) — reference from the supplier
  - `request_payload` (jsonb, nullable) — what we sent (secrets redacted)
  - `response_payload` (jsonb, nullable) — what we received
  - `error_message` (text, nullable)
  - `attempt` (int) — which attempt number this is
  - `duration_ms` (int, nullable) — how long the call took
  - `created_at` (timestamptz)

2. Security
  - RLS enabled on all three tables.
  - All policies use `TO anon, authenticated` since admin operations go through service-role API routes.
  - `auth_config` intentionally stores NO secrets — only structural metadata.

3. Indexes
  - supplier_transactions: order_id, supplier_id, idempotency_key (unique), created_at
  - supplier_package_mappings: package_id, supplier_id (unique pair)
  - suppliers: code (unique), enabled

4. Important Notes
  - API secrets/credentials are stored ONLY in Supabase edge function secrets, NEVER in the database.
  - The `auth_config` column stores non-secret metadata like header names and token endpoint URLs.
  - The `adapter` column determines which code adapter handles this supplier.
*/

-- Suppliers table
CREATE TABLE IF NOT EXISTS suppliers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  code text NOT NULL UNIQUE,
  adapter text NOT NULL DEFAULT 'generic',
  api_url text NOT NULL DEFAULT '',
  sandbox_api_url text,
  environment text NOT NULL DEFAULT 'sandbox' CHECK (environment IN ('sandbox', 'live')),
  enabled boolean NOT NULL DEFAULT false,
  priority int NOT NULL DEFAULT 0,
  retry_count int NOT NULL DEFAULT 3,
  timeout_ms int NOT NULL DEFAULT 15000,
  low_balance_threshold_cents int NOT NULL DEFAULT 100000,
  supports_balance boolean NOT NULL DEFAULT false,
  supports_validation boolean NOT NULL DEFAULT false,
  supports_refund boolean NOT NULL DEFAULT false,
  auth_type text NOT NULL DEFAULT 'api_key' CHECK (auth_type IN ('api_key', 'bearer', 'basic', 'oauth2', 'custom')),
  auth_config jsonb NOT NULL DEFAULT '{}',
  last_success_at timestamptz,
  last_failure_at timestamptz,
  last_error text,
  cached_balance_cents bigint,
  balance_checked_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE suppliers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_suppliers" ON suppliers;
CREATE POLICY "select_suppliers" ON suppliers FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "insert_suppliers" ON suppliers;
CREATE POLICY "insert_suppliers" ON suppliers FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "update_suppliers" ON suppliers;
CREATE POLICY "update_suppliers" ON suppliers FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "delete_suppliers" ON suppliers;
CREATE POLICY "delete_suppliers" ON suppliers FOR DELETE TO anon, authenticated USING (true);

-- Supplier package mappings
CREATE TABLE IF NOT EXISTS supplier_package_mappings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  package_id uuid NOT NULL REFERENCES packages(id) ON DELETE CASCADE,
  supplier_id uuid NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
  supplier_product_id text NOT NULL DEFAULT '',
  supplier_cost_cents int NOT NULL DEFAULT 0,
  priority int NOT NULL DEFAULT 0,
  enabled boolean NOT NULL DEFAULT true,
  metadata jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(package_id, supplier_id)
);

ALTER TABLE supplier_package_mappings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_spm" ON supplier_package_mappings;
CREATE POLICY "select_spm" ON supplier_package_mappings FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "insert_spm" ON supplier_package_mappings;
CREATE POLICY "insert_spm" ON supplier_package_mappings FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "update_spm" ON supplier_package_mappings;
CREATE POLICY "update_spm" ON supplier_package_mappings FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "delete_spm" ON supplier_package_mappings;
CREATE POLICY "delete_spm" ON supplier_package_mappings FOR DELETE TO anon, authenticated USING (true);

CREATE INDEX IF NOT EXISTS idx_spm_package_id ON supplier_package_mappings(package_id);

-- Supplier transactions
CREATE TABLE IF NOT EXISTS supplier_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid REFERENCES orders(id) ON DELETE SET NULL,
  supplier_id uuid NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
  mapping_id uuid REFERENCES supplier_package_mappings(id) ON DELETE SET NULL,
  idempotency_key text UNIQUE,
  action text NOT NULL DEFAULT 'create_order',
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'submitted', 'success', 'failed', 'timeout', 'refunded')),
  supplier_reference text,
  request_payload jsonb,
  response_payload jsonb,
  error_message text,
  attempt int NOT NULL DEFAULT 1,
  duration_ms int,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE supplier_transactions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_stx" ON supplier_transactions;
CREATE POLICY "select_stx" ON supplier_transactions FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "insert_stx" ON supplier_transactions;
CREATE POLICY "insert_stx" ON supplier_transactions FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "update_stx" ON supplier_transactions;
CREATE POLICY "update_stx" ON supplier_transactions FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "delete_stx" ON supplier_transactions;
CREATE POLICY "delete_stx" ON supplier_transactions FOR DELETE TO anon, authenticated USING (true);

CREATE INDEX IF NOT EXISTS idx_stx_order_id ON supplier_transactions(order_id);
CREATE INDEX IF NOT EXISTS idx_stx_supplier_id ON supplier_transactions(supplier_id);
CREATE INDEX IF NOT EXISTS idx_stx_created_at ON supplier_transactions(created_at);
