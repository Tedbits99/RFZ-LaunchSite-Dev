/*
# Payment System Enhancement

Adds new columns to payment_config for automated provider configuration,
creates a payment_transactions table for tracking automated payments,
and adds payment-related columns to orders.

1. Modified Tables

  ## `payment_config`
  Add columns for automated payment provider configuration:
  - `provider_type` (text, default 'manual') — 'manual' or 'automated'
  - `provider_name` (text, default '') — provider identifier (e.g. 'hitpay', 'paymongo')
  - `api_url` (text, default '') — provider API base URL
  - `is_test_mode` (boolean, default false) — sandbox vs live
  - `currency` (text, default 'PHP') — currency code
  - `supported_methods` (text[], default '{}') — list of sub-methods this provider supports

  ## `orders`
  Add columns for tracking payment provider details:
  - `payment_provider` (text, nullable) — which provider processed the payment
  - `payment_mode` (text, default 'manual') — 'manual' or 'automated'
  - `provider_checkout_url` (text, nullable) — redirect URL for automated payments
  - `payment_verified_at` (timestamptz, nullable) — when payment was confirmed
  - `payment_verified_by` (text, nullable) — who/what confirmed it (admin email or 'webhook:provider')

2. New Tables

  ## `payment_transactions`
  Tracks every payment attempt and provider interaction for idempotency and audit.
  - `id` (uuid, PK)
  - `order_id` (uuid, FK → orders)
  - `idempotency_key` (text, unique) — prevents duplicate payment creation
  - `provider_name` (text) — which provider
  - `provider_reference` (text, nullable) — provider's transaction/payment ID
  - `action` (text) — 'create', 'verify', 'webhook', 'refund'
  - `status` (text) — 'pending', 'processing', 'paid', 'failed', 'expired', 'refunded'
  - `amount_cents` (int)
  - `currency` (text, default 'PHP')
  - `checkout_url` (text, nullable) — redirect URL from provider
  - `webhook_payload` (jsonb, nullable) — raw webhook data for audit
  - `error_message` (text, nullable)
  - `metadata` (jsonb, default '{}')
  - `created_at` / `updated_at` (timestamptz)

3. Security
  - RLS enabled on payment_transactions with anon+authenticated policies.

4. Important Notes
  - API keys and secrets are stored in server-side env vars, NEVER in the database.
  - payment_config stores only non-secret config like API URLs and currency.
  - The provider_type field distinguishes manual vs automated payment methods.
*/

-- Add columns to payment_config
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='payment_config' AND column_name='provider_type') THEN
    ALTER TABLE payment_config ADD COLUMN provider_type text NOT NULL DEFAULT 'manual';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='payment_config' AND column_name='provider_name') THEN
    ALTER TABLE payment_config ADD COLUMN provider_name text NOT NULL DEFAULT '';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='payment_config' AND column_name='api_url') THEN
    ALTER TABLE payment_config ADD COLUMN api_url text NOT NULL DEFAULT '';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='payment_config' AND column_name='is_test_mode') THEN
    ALTER TABLE payment_config ADD COLUMN is_test_mode boolean NOT NULL DEFAULT false;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='payment_config' AND column_name='currency') THEN
    ALTER TABLE payment_config ADD COLUMN currency text NOT NULL DEFAULT 'PHP';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='payment_config' AND column_name='supported_methods') THEN
    ALTER TABLE payment_config ADD COLUMN supported_methods text[] NOT NULL DEFAULT '{}';
  END IF;
END $$;

-- Add columns to orders
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='orders' AND column_name='payment_provider') THEN
    ALTER TABLE orders ADD COLUMN payment_provider text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='orders' AND column_name='payment_mode') THEN
    ALTER TABLE orders ADD COLUMN payment_mode text NOT NULL DEFAULT 'manual';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='orders' AND column_name='provider_checkout_url') THEN
    ALTER TABLE orders ADD COLUMN provider_checkout_url text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='orders' AND column_name='payment_verified_at') THEN
    ALTER TABLE orders ADD COLUMN payment_verified_at timestamptz;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='orders' AND column_name='payment_verified_by') THEN
    ALTER TABLE orders ADD COLUMN payment_verified_by text;
  END IF;
END $$;

-- Payment transactions table
CREATE TABLE IF NOT EXISTS payment_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  idempotency_key text UNIQUE,
  provider_name text NOT NULL DEFAULT '',
  provider_reference text,
  action text NOT NULL DEFAULT 'create',
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'paid', 'failed', 'expired', 'refunded', 'cancelled')),
  amount_cents int NOT NULL DEFAULT 0,
  currency text NOT NULL DEFAULT 'PHP',
  checkout_url text,
  webhook_payload jsonb,
  error_message text,
  metadata jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE payment_transactions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_payment_tx" ON payment_transactions;
CREATE POLICY "select_payment_tx" ON payment_transactions FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "insert_payment_tx" ON payment_transactions;
CREATE POLICY "insert_payment_tx" ON payment_transactions FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "update_payment_tx" ON payment_transactions;
CREATE POLICY "update_payment_tx" ON payment_transactions FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "delete_payment_tx" ON payment_transactions;
CREATE POLICY "delete_payment_tx" ON payment_transactions FOR DELETE TO anon, authenticated USING (true);

CREATE INDEX IF NOT EXISTS idx_payment_tx_order_id ON payment_transactions(order_id);
CREATE INDEX IF NOT EXISTS idx_payment_tx_provider_ref ON payment_transactions(provider_reference);
CREATE INDEX IF NOT EXISTS idx_payment_tx_idempotency ON payment_transactions(idempotency_key);