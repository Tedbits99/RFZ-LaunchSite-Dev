-- STATUS: PENDING — NOT applied to the live database. Requires separate owner approval.
-- Apply via the Supabase migration tool with filename 20261018160000_rf_coins_schema.sql
/*
# RF Coins — Schema (Phase 3, feature DISABLED by default)

1. Purpose
   Closed-loop virtual currency ("RF Coins") for signed-in, verified, active
   customers. Coins are purchased with PayMongo QRPh, held in a per-customer
   wallet, spent on product orders, and managed by Super Admins through an
   append-only ledger. NOT cashback points; a dedicated purchasable currency.

2. New Tables
   - rf_coin_settings (singleton row id=1)
     - enabled               boolean default FALSE  (master kill switch)
     - topups_enabled        boolean default FALSE  (new coin purchases)
     - spending_enabled      boolean default FALSE  (paying orders with coins)
     - centavos_per_coin     integer default 100    (1 RF Coin = PHP 1.00)
     - high_value_adjustment_coins integer default 5000 (2nd-admin approval threshold)
     - max_daily_admin_adjustments integer default 50 (rate control per admin/day)
     - updated_by uuid, updated_at (audit of last settings change)

   - rf_coin_wallets (one per customer, created lazily by server functions)
     - user_id uuid PRIMARY KEY -> auth.users(id) ON DELETE CASCADE
     - balance_coins bigint NOT NULL DEFAULT 0 CHECK (>= 0)  (no negative balances)
     - lifetime counters: total_purchased_coins, total_spent_coins,
       total_manual_credited_coins, total_manual_debited_coins,
       total_reversed_coins (all bigint DEFAULT 0, >= 0)
     - created_at, updated_at

   - rf_coin_ledger (append-only; source of truth for every movement)
     - id uuid PK, wallet_user_id -> rf_coin_wallets ON DELETE RESTRICT
     - direction CHECK ('credit','debit'), amount_coins bigint CHECK (> 0)
     - kind CHECK ('topup_purchase','order_payment','order_reversal',
       'manual_credit','manual_debit','rounding_refund','chargeback_reversal')
     - balance_after bigint NOT NULL (post-movement balance snapshot)
     - reason text, reference_type text, reference_id text
     - actor_type CHECK ('system','customer','admin'), actor_id uuid NULL
     - idempotency_key text NOT NULL UNIQUE (exactly-once settlement)
     - created_at
     Append-only enforced by trigger raising RF_COIN_LEDGER_IMMUTABLE.

   - rf_coin_packages (admin-managed purchasable coin bundles)
     - id uuid PK, name text, coins integer CHECK (> 0),
       bonus_coins integer DEFAULT 0 CHECK (>= 0), price_cents integer CHECK (> 0)
     - is_active boolean DEFAULT true, sort_order integer DEFAULT 0
     Historical topup rows snapshot coins/price at purchase time, so later
     package edits never alter already-paid purchases.

   - rf_coin_topups (one row per attempted coin purchase)
     - id uuid PK, user_id -> auth.users, package_id -> rf_coin_packages NULL
     - coins integer (>0), bonus_coins integer (>=0), price_cents integer (>0)
       (snapshotted at creation; immune to later package/price changes)
     - status CHECK ('PENDING','PAID','FAILED','EXPIRED','CANCELLED',
       'REFUND_PENDING','REFUNDED')
     - provider text DEFAULT 'paymongo', provider_reference text NULL,
       idempotency_key text UNIQUE, credited_at timestamptz NULL
     - Unique partial index on provider_reference WHERE NOT NULL.

   - Modified Tables
     - payment_transactions: order_id becomes NULLABLE, and a new nullable
       rf_coin_topup_id column (FK -> rf_coin_topups ON DELETE SET NULL) is
       added so coin top-up payment events can be logged in the same table
       without inventing fake orders. Existing order rows are untouched;
       existing order flows keep requiring order_id.

   - rf_coin_adjustment_requests (manual admin credits/debits)
     - id uuid PK, target_user_id -> auth.users
     - direction CHECK ('credit','debit'), amount_coins integer CHECK (> 0)
     - reason text CHECK (3..1000 chars), category CHECK
       ('promotion','compensation','correction')
     - status CHECK ('PENDING','APPROVED','REJECTED','APPLIED','CANCELLED')
     - requested_by(+email), approved_by(+email, at), rejected_by(+email, at)
     - is_high_value boolean (threshold snapshot at request time)
     - applied_ledger_id uuid NULL, idempotency_key text UNIQUE

   - rf_coin_admin_audit (insert-only audit trail)
     - id uuid PK, actor_admin_id uuid, actor_admin_email text, action text,
       target_user_id uuid NULL, entity_type text, entity_id text,
       details jsonb, created_at
     Insert-only enforced by trigger raising RF_COIN_AUDIT_IMMUTABLE.

3. Security
   - RLS ENABLED on every table.
   - Wallets/ledger/topups: customer SELECT scoped to own rows via auth.uid();
     NO client writes — all mutations go through SECURITY DEFINER functions
     (companion migration 20261018160100_rf_coins_functions.sql).
   - Packages: authenticated SELECT of active rows only.
   - Adjustment requests: requester SELECT own rows only.
   - Settings & audit: no client policies at all (fail closed).
   - Direct INSERT/UPDATE/DELETE revoked from anon + authenticated on ALL
     rf_coin tables.

4. Important Notes
   - Master switch enabled = FALSE: the whole feature stays dormant until the
     owner activates it. Top-ups and spending are additionally gated by their
     own flags.
   - No historical order migration: existing orders never earn coins.
   - Integer coin units only; money in integer centavos.
*/

-- ============ SETTINGS (singleton, fail-closed defaults) ============
CREATE TABLE IF NOT EXISTS rf_coin_settings (
  id integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  enabled boolean NOT NULL DEFAULT false,
  topups_enabled boolean NOT NULL DEFAULT false,
  spending_enabled boolean NOT NULL DEFAULT false,
  centavos_per_coin integer NOT NULL DEFAULT 100 CHECK (centavos_per_coin > 0),
  high_value_adjustment_coins integer NOT NULL DEFAULT 5000 CHECK (high_value_adjustment_coins > 0),
  max_daily_admin_adjustments integer NOT NULL DEFAULT 50 CHECK (max_daily_admin_adjustments > 0),
  updated_by uuid REFERENCES auth.users(id),
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO rf_coin_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

-- ============ WALLETS ============
CREATE TABLE IF NOT EXISTS rf_coin_wallets (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  balance_coins bigint NOT NULL DEFAULT 0 CHECK (balance_coins >= 0),
  total_purchased_coins bigint NOT NULL DEFAULT 0 CHECK (total_purchased_coins >= 0),
  total_spent_coins bigint NOT NULL DEFAULT 0 CHECK (total_spent_coins >= 0),
  total_manual_credited_coins bigint NOT NULL DEFAULT 0 CHECK (total_manual_credited_coins >= 0),
  total_manual_debited_coins bigint NOT NULL DEFAULT 0 CHECK (total_manual_debited_coins >= 0),
  total_reversed_coins bigint NOT NULL DEFAULT 0 CHECK (total_reversed_coins >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS rf_coin_wallets_balance_idx ON rf_coin_wallets (balance_coins DESC);

-- ============ LEDGER (append-only) ============
CREATE TABLE IF NOT EXISTS rf_coin_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_user_id uuid NOT NULL REFERENCES rf_coin_wallets(user_id) ON DELETE RESTRICT,
  direction text NOT NULL CHECK (direction IN ('credit','debit')),
  amount_coins bigint NOT NULL CHECK (amount_coins > 0),
  kind text NOT NULL CHECK (kind IN (
    'topup_purchase','order_payment','order_reversal',
    'manual_credit','manual_debit','rounding_refund','chargeback_reversal')),
  balance_after bigint NOT NULL CHECK (balance_after >= 0),
  reason text,
  reference_type text,
  reference_id text,
  actor_type text NOT NULL CHECK (actor_type IN ('system','customer','admin')),
  actor_id uuid,
  idempotency_key text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS rf_coin_ledger_wallet_created_idx
  ON rf_coin_ledger (wallet_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS rf_coin_ledger_reference_idx
  ON rf_coin_ledger (reference_type, reference_id);

CREATE OR REPLACE FUNCTION rf_coin_ledger_append_only()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'RF_COIN_LEDGER_IMMUTABLE';
END;
$$;

DROP TRIGGER IF EXISTS rf_coin_ledger_no_mutation ON rf_coin_ledger;
CREATE TRIGGER rf_coin_ledger_no_mutation
  BEFORE UPDATE OR DELETE ON rf_coin_ledger
  FOR EACH ROW EXECUTE FUNCTION rf_coin_ledger_append_only();

-- ============ PACKAGES ============
CREATE TABLE IF NOT EXISTS rf_coin_packages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  coins integer NOT NULL CHECK (coins > 0),
  bonus_coins integer NOT NULL DEFAULT 0 CHECK (bonus_coins >= 0),
  price_cents integer NOT NULL CHECK (price_cents > 0),
  is_active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS rf_coin_packages_active_idx
  ON rf_coin_packages (is_active, sort_order);

-- ============ TOP-UPS ============
CREATE TABLE IF NOT EXISTS rf_coin_topups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  package_id uuid REFERENCES rf_coin_packages(id) ON DELETE SET NULL,
  coins integer NOT NULL CHECK (coins > 0),
  bonus_coins integer NOT NULL DEFAULT 0 CHECK (bonus_coins >= 0),
  price_cents integer NOT NULL CHECK (price_cents > 0),
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN (
    'PENDING','PAID','FAILED','EXPIRED','CANCELLED','REFUND_PENDING','REFUNDED')),
  provider text NOT NULL DEFAULT 'paymongo',
  provider_reference text,
  idempotency_key text NOT NULL UNIQUE,
  credited_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS rf_coin_topups_provider_reference_unique
  ON rf_coin_topups (provider_reference) WHERE provider_reference IS NOT NULL;
CREATE INDEX IF NOT EXISTS rf_coin_topups_user_created_idx
  ON rf_coin_topups (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS rf_coin_topups_status_idx ON rf_coin_topups (status);

-- ============ ADJUSTMENT REQUESTS ============
CREATE TABLE IF NOT EXISTS rf_coin_adjustment_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  target_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  direction text NOT NULL CHECK (direction IN ('credit','debit')),
  amount_coins integer NOT NULL CHECK (amount_coins > 0),
  reason text NOT NULL CHECK (length(reason) BETWEEN 3 AND 1000),
  category text NOT NULL CHECK (category IN ('promotion','compensation','correction')),
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN (
    'PENDING','APPROVED','REJECTED','APPLIED','CANCELLED')),
  requested_by uuid NOT NULL REFERENCES auth.users(id),
  requested_by_email text NOT NULL,
  approved_by uuid REFERENCES auth.users(id),
  approved_by_email text,
  approved_at timestamptz,
  rejected_by uuid REFERENCES auth.users(id),
  rejected_by_email text,
  rejected_at timestamptz,
  is_high_value boolean NOT NULL DEFAULT false,
  applied_ledger_id uuid,
  idempotency_key text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS rf_coin_adjust_requests_status_idx
  ON rf_coin_adjustment_requests (status, created_at DESC);
CREATE INDEX IF NOT EXISTS rf_coin_adjust_requests_target_idx
  ON rf_coin_adjustment_requests (target_user_id, created_at DESC);

-- ============ ADMIN AUDIT (insert-only) ============
CREATE TABLE IF NOT EXISTS rf_coin_admin_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_admin_id uuid NOT NULL,
  actor_admin_email text NOT NULL,
  action text NOT NULL,
  target_user_id uuid,
  entity_type text NOT NULL,
  entity_id text,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS rf_coin_audit_created_idx ON rf_coin_admin_audit (created_at DESC);

CREATE OR REPLACE FUNCTION rf_coin_audit_append_only()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'RF_COIN_AUDIT_IMMUTABLE';
END;
$$;

DROP TRIGGER IF EXISTS rf_coin_audit_no_mutation ON rf_coin_admin_audit;
CREATE TRIGGER rf_coin_audit_no_mutation
  BEFORE UPDATE OR DELETE ON rf_coin_admin_audit
  FOR EACH ROW EXECUTE FUNCTION rf_coin_audit_append_only();

-- ============ payment_transactions compatibility for coin top-ups ============
-- order_id stays required for all existing order flows; new top-up events
-- use rf_coin_topup_id instead. Both nullable together for top-up rows.
ALTER TABLE payment_transactions ALTER COLUMN order_id DROP NOT NULL;
ALTER TABLE payment_transactions ADD COLUMN IF NOT EXISTS rf_coin_topup_id
  uuid REFERENCES rf_coin_topups(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_payment_tx_rf_coin_topup
  ON payment_transactions (rf_coin_topup_id);

-- Register the RF Coins wallet as a payment method, DISABLED. create_order
-- only accepts payment methods present in payment_config with is_enabled =
-- true, so the method stays invisible/unusable until a Super Admin enables
-- it deliberately (together with the RF Coins spending flag).
INSERT INTO public.payment_config
  (method_key, display_name, provider, is_enabled, provider_name, provider_type, instructions, sort_order)
VALUES
  ('rf_coin_wallet', 'RF Coins Wallet', 'rf_coin_wallet', false, 'rf_coin_wallet', 'rf_coins',
   'Pay the full order total with your RF Coins wallet balance.', 50)
ON CONFLICT (method_key) DO NOTHING;

-- ============ RLS ============
ALTER TABLE rf_coin_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE rf_coin_wallets ENABLE ROW LEVEL SECURITY;
ALTER TABLE rf_coin_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE rf_coin_packages ENABLE ROW LEVEL SECURITY;
ALTER TABLE rf_coin_topups ENABLE ROW LEVEL SECURITY;
ALTER TABLE rf_coin_adjustment_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE rf_coin_admin_audit ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "rf_coin_wallet_select_own" ON rf_coin_wallets;
CREATE POLICY "rf_coin_wallet_select_own" ON rf_coin_wallets
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "rf_coin_ledger_select_own" ON rf_coin_ledger;
CREATE POLICY "rf_coin_ledger_select_own" ON rf_coin_ledger
  FOR SELECT TO authenticated USING (auth.uid() = wallet_user_id);

DROP POLICY IF EXISTS "rf_coin_packages_select_active" ON rf_coin_packages;
CREATE POLICY "rf_coin_packages_select_active" ON rf_coin_packages
  FOR SELECT TO authenticated USING (is_active = true);

DROP POLICY IF EXISTS "rf_coin_topups_select_own" ON rf_coin_topups;
CREATE POLICY "rf_coin_topups_select_own" ON rf_coin_topups
  FOR SELECT TO authenticated USING (auth.uid() = user_id);


DROP POLICY IF EXISTS "rf_coin_adjust_select_own" ON rf_coin_adjustment_requests;
CREATE POLICY "rf_coin_adjust_select_own" ON rf_coin_adjustment_requests
  FOR SELECT TO authenticated USING (auth.uid() = requested_by);

-- Settings and audit: NO client policies (fail closed; RLS blocks everyone).
-- Admin UI reads these through the existing service-role admin client.

REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON rf_coin_settings,
  rf_coin_wallets, rf_coin_ledger, rf_coin_packages, rf_coin_topups,
  rf_coin_adjustment_requests, rf_coin_admin_audit
  FROM anon, authenticated;
