#!/usr/bin/env bash
set -euo pipefail

# Executes the staged SQL on a disposable PostgreSQL server using independent
# concurrent connections. No host port is published; HTTP integration calls
# are stubbed and the container has no provider credentials.
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONTAINER="rfz-coins-concurrency-${RANDOM}-${RANDOM}-$$"
TEMP_DIR="$(mktemp -d /tmp/rfz-coins-concurrency-XXXXXX)"
CUSTOMER='81000000-0000-4000-8000-000000000001'
CUSTOMER_REFUND='81000000-0000-4000-8000-000000000002'
CUSTOMER_ADJUST='81000000-0000-4000-8000-000000000003'
SUPER_ONE='82000000-0000-4000-8000-000000000001'
SUPER_TWO='82000000-0000-4000-8000-000000000002'
GAME='83000000-0000-4000-8000-000000000001'
CATALOG_PACKAGE='84000000-0000-4000-8000-000000000001'
COIN_PACKAGE='85000000-0000-4000-8000-000000000001'

cleanup() { docker rm -f "$CONTAINER" >/dev/null 2>&1 || true; }
trap cleanup EXIT

if ! command -v docker >/dev/null 2>&1; then
  echo 'RF_COINS_CONCURRENCY_BLOCKED: Docker is required for multi-connection tests.' >&2
  exit 1
fi
if ! grep -Fq 'RF_COINS_FUNDING_RELEASE_ENABLED = false' "$ROOT_DIR/lib/rfCoinFundingRelease.ts"; then
  echo 'RF_COINS_CONCURRENCY_FAIL: funding release lock is not false in source.' >&2
  exit 1
fi

docker run --rm -d --network none --name "$CONTAINER" -e POSTGRES_PASSWORD=local_test_only postgres:16 >/dev/null
ready=false
for _ in $(seq 1 60); do
  if docker exec "$CONTAINER" psql -X -qAt -U postgres -d postgres -c 'SELECT 1' >/dev/null 2>&1; then ready=true; break; fi
  sleep 1
done
if [[ "$ready" != true ]]; then echo 'RF_COINS_CONCURRENCY_FAIL: PostgreSQL did not become ready.' >&2; exit 1; fi

db_sql() { docker exec "$CONTAINER" psql -X -qAt -v ON_ERROR_STOP=1 -U postgres -d postgres -c "$1"; }
run_many() {
  local count="$1" label="$2" statement="$3"; local pids=()
  for index in $(seq 1 "$count"); do (db_sql "$statement" >"$TEMP_DIR/$label-$index.out") & pids+=("$!"); done
  for pid in "${pids[@]}"; do wait "$pid"; done
}
assert_value() {
  local label="$1" expected="$2" actual="$3"
  if [[ "$actual" != "$expected" ]]; then echo "RF_COINS_CONCURRENCY_FAIL: $label expected=$expected actual=$actual" >&2; exit 1; fi
}

docker exec -i "$CONTAINER" psql -X -v ON_ERROR_STOP=1 -U postgres -d postgres <<'SQL'
CREATE SCHEMA auth;
CREATE TABLE auth.users (id uuid PRIMARY KEY, email text, email_confirmed_at timestamptz);
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('request.jwt.claims', true)::json ->> 'sub', '')::uuid;
$$;
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
CREATE TABLE games (id uuid PRIMARY KEY, slug text UNIQUE NOT NULL, name text NOT NULL,
  is_active boolean NOT NULL DEFAULT true, sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE packages (id uuid PRIMARY KEY, game_id uuid NOT NULL REFERENCES games(id), name text NOT NULL,
  price_cents integer NOT NULL CHECK (price_cents >= 0), is_active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE admins (id uuid PRIMARY KEY, email text UNIQUE NOT NULL, name text NOT NULL DEFAULT 'Admin',
  role text NOT NULL DEFAULT 'SUPER_ADMIN', claimed_at timestamptz NOT NULL DEFAULT now(), is_active boolean NOT NULL DEFAULT true);
CREATE TABLE orders (id uuid PRIMARY KEY, reference text UNIQUE NOT NULL, email text NOT NULL,
  customer_name text NOT NULL, game_id uuid NOT NULL REFERENCES games(id), package_id uuid NOT NULL REFERENCES packages(id),
  player_inputs jsonb NOT NULL DEFAULT '{}'::jsonb, quantity integer NOT NULL DEFAULT 1,
  subtotal_cents integer NOT NULL CHECK (subtotal_cents >= 0), discount_cents integer NOT NULL DEFAULT 0,
  fee_cents integer NOT NULL DEFAULT 0, total_cents integer NOT NULL CHECK (total_cents >= 0),
  payment_method text NOT NULL DEFAULT 'manual', status text NOT NULL DEFAULT 'WAITING_PAYMENT',
  payment_status text NOT NULL DEFAULT 'UNPAID', payment_verification_method text, payment_verified_at timestamptz,
  payment_verified_by text, fulfillment_status text NOT NULL DEFAULT 'NOT_STARTED', customer_user_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE order_timeline (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), order_id uuid NOT NULL REFERENCES orders(id),
  status text NOT NULL, actor_email text, note text, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE payment_config (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), method_key text UNIQUE NOT NULL,
  display_name text NOT NULL, provider text NOT NULL DEFAULT 'manual', provider_name text NOT NULL DEFAULT 'manual',
  provider_type text NOT NULL DEFAULT 'manual', api_url text, currency text NOT NULL DEFAULT 'PHP', is_test_mode boolean NOT NULL DEFAULT false,
  min_amount_cents integer, max_amount_cents integer, is_enabled boolean NOT NULL DEFAULT true, account_name text NOT NULL DEFAULT '',
  account_number text NOT NULL DEFAULT '', qr_data text, instructions text NOT NULL DEFAULT '', webhook_url text,
  test_mode boolean NOT NULL DEFAULT false, sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE payment_transactions (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), order_id uuid REFERENCES orders(id) ON DELETE CASCADE,
  idempotency_key text UNIQUE, provider_name text NOT NULL DEFAULT '', provider_reference text, action text NOT NULL DEFAULT 'create',
  status text NOT NULL DEFAULT 'pending', amount_cents integer NOT NULL DEFAULT 0, currency text NOT NULL DEFAULT 'PHP',
  checkout_url text, webhook_payload jsonb, error_message text, metadata jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE supplier_transactions (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), order_id uuid REFERENCES orders(id) ON DELETE CASCADE,
  supplier_id uuid NOT NULL, mapping_id uuid, idempotency_key text UNIQUE, action text NOT NULL DEFAULT 'create_order',
  status text NOT NULL DEFAULT 'pending', supplier_reference text, request_payload jsonb, response_payload jsonb,
  error_message text, attempt integer NOT NULL DEFAULT 1, duration_ms integer,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
CREATE SCHEMA cron;
CREATE FUNCTION cron.schedule(name text, schedule text, command text) RETURNS bigint LANGUAGE sql AS $$ SELECT 1::bigint $$;
CREATE SCHEMA net;
CREATE FUNCTION net.http_post(url text, body jsonb, headers jsonb, timeout_milliseconds integer)
  RETURNS bigint LANGUAGE sql AS $$ SELECT 1::bigint $$;
CREATE SCHEMA extensions;
SQL

docker exec -i "$CONTAINER" psql -X -v ON_ERROR_STOP=1 -U postgres -d postgres < "$ROOT_DIR/supabase/migrations-pending/20261028120000_rf_coins_schema.sql" >/dev/null
# Exercise the future transaction bodies only inside this fresh local DB. The
# committed release constants remain false and are checked above.
sed -e 's/v_funding_release_enabled CONSTANT boolean := false/v_funding_release_enabled CONSTANT boolean := true/g' \
    -e 's/v_spending_release_enabled CONSTANT boolean := false/v_spending_release_enabled CONSTANT boolean := true/g' \
  "$ROOT_DIR/supabase/migrations-pending/20261028120100_rf_coins_functions.sql" \
  | docker exec -i "$CONTAINER" psql -X -v ON_ERROR_STOP=1 -U postgres -d postgres >/dev/null
docker exec -i "$CONTAINER" psql -X -v ON_ERROR_STOP=1 -U postgres -d postgres < "$ROOT_DIR/supabase/migrations-pending/20261028120200_rf_coin_admin_center_read.sql" >/dev/null

docker exec -i "$CONTAINER" psql -X -v ON_ERROR_STOP=1 -U postgres -d postgres <<SQL >/dev/null
INSERT INTO auth.users (id, email, email_confirmed_at) VALUES
  ('$CUSTOMER', 'concurrency-customer@example.invalid', now()),
  ('$CUSTOMER_REFUND', 'refund-customer@example.invalid', now()),
  ('$CUSTOMER_ADJUST', 'adjust-customer@example.invalid', now()),
  ('$SUPER_ONE', 'first-admin@example.invalid', now()), ('$SUPER_TWO', 'second-admin@example.invalid', now());
INSERT INTO admins (id, email, name, role, is_active) VALUES
  ('$SUPER_ONE', 'first-admin@example.invalid', 'First Admin', 'SUPER_ADMIN', true),
  ('$SUPER_TWO', 'second-admin@example.invalid', 'Second Admin', 'SUPER_ADMIN', true);
INSERT INTO games (id, slug, name) VALUES ('$GAME', 'concurrency-test', 'Concurrency Test');
INSERT INTO packages (id, game_id, name, price_cents) VALUES ('$CATALOG_PACKAGE', '$GAME', 'Test Product', 5000);
INSERT INTO rf_coin_packages (id, name, coins, bonus_coins, price_cents, is_active)
  VALUES ('$COIN_PACKAGE', 'Disposable 100 RF', 100, 10, 10000, true);
UPDATE rf_coin_settings SET enabled = true, topups_enabled = true, spending_enabled = true WHERE id = 1;
INSERT INTO orders (id, reference, email, customer_name, game_id, package_id, subtotal_cents, total_cents, payment_method, customer_user_id)
  VALUES ('86000000-0000-4000-8000-000000000001', 'RF-CONCURRENT-ORDER', 'concurrency-customer@example.invalid',
    'Synthetic Customer', '$GAME', '$CATALOG_PACKAGE', 5000, 5000, 'rf_coin_wallet', '$CUSTOMER');
SQL

wallet_sql="SET ROLE authenticated; SELECT set_config('request.jwt.claims', '{\"sub\":\"$CUSTOMER\",\"role\":\"authenticated\"}', false); SELECT user_id FROM rf_coin_get_or_create_wallet('$CUSTOMER');"
run_many 20 wallet "$wallet_sql"
assert_value 'single initialized wallet' '1' "$(db_sql "SELECT count(*) FROM rf_coin_wallets WHERE user_id = '$CUSTOMER'")"
assert_value 'real zero wallet balance' '0' "$(db_sql "SELECT balance_coins FROM rf_coin_wallets WHERE user_id = '$CUSTOMER'")"

topup_create_sql="SET ROLE authenticated; SELECT set_config('request.jwt.claims', '{\"sub\":\"$CUSTOMER\",\"role\":\"authenticated\"}', false); SELECT out_topup_id FROM rf_coin_create_topup('$CUSTOMER', '$COIN_PACKAGE');"
run_many 16 topup-create "$topup_create_sql"
assert_value 'one pending package top-up' '1' "$(db_sql "SELECT count(*) FROM rf_coin_topups WHERE user_id = '$CUSTOMER' AND package_id = '$COIN_PACKAGE' AND status = 'PENDING'")"
TOPUP_ID="$(db_sql "SELECT id FROM rf_coin_topups WHERE user_id = '$CUSTOMER' AND package_id = '$COIN_PACKAGE' AND status = 'PENDING'")"
db_sql "UPDATE rf_coin_topups SET provider_reference = 'local-concurrency-pay-ref' WHERE id = '$TOPUP_ID'" >/dev/null
credit_sql="SET ROLE service_role; SELECT out_credited FROM rf_coin_credit_paid_topup('$TOPUP_ID', 'local-concurrency-pay-ref');"
run_many 16 topup-credit "$credit_sql"
assert_value 'one credited top-up ledger entry' '1' "$(db_sql "SELECT count(*) FROM rf_coin_ledger WHERE idempotency_key = 'topup:$TOPUP_ID'")"
assert_value 'single top-up balance update' '110' "$(db_sql "SELECT balance_coins FROM rf_coin_wallets WHERE user_id = '$CUSTOMER'")"

order_sql="SET ROLE authenticated; SELECT set_config('request.jwt.claims', '{\"sub\":\"$CUSTOMER\",\"role\":\"authenticated\"}', false); SELECT out_error FROM rf_coin_settle_order_payment_and_enqueue('86000000-0000-4000-8000-000000000001', '$CUSTOMER');"
run_many 12 order-settle "$order_sql"
assert_value 'one order debit ledger entry' '1' "$(db_sql "SELECT count(*) FROM rf_coin_ledger WHERE idempotency_key = 'order:86000000-0000-4000-8000-000000000001'")"
assert_value 'no lost or negative balance update' '60' "$(db_sql "SELECT balance_coins FROM rf_coin_wallets WHERE user_id = '$CUSTOMER'")"

refund_create_sql="SET ROLE authenticated; SELECT set_config('request.jwt.claims', '{\"sub\":\"$CUSTOMER_REFUND\",\"role\":\"authenticated\"}', false); SELECT out_topup_id FROM rf_coin_create_topup('$CUSTOMER_REFUND', '$COIN_PACKAGE');"
run_many 8 refund-topup-create "$refund_create_sql"
REFUND_TOPUP_ID="$(db_sql "SELECT id FROM rf_coin_topups WHERE user_id = '$CUSTOMER_REFUND' AND status = 'PENDING'")"
db_sql "UPDATE rf_coin_topups SET provider_reference = 'local-concurrency-refund-ref' WHERE id = '$REFUND_TOPUP_ID'" >/dev/null
refund_credit_sql="SET ROLE service_role; SELECT out_credited FROM rf_coin_credit_paid_topup('$REFUND_TOPUP_ID', 'local-concurrency-refund-ref');"
run_many 8 refund-credit "$refund_credit_sql"
refund_sql="SET ROLE service_role; SELECT out_ok FROM rf_coin_mark_topup_status('$REFUND_TOPUP_ID', 'REFUNDED', 'local-concurrency-refund-ref');"
run_many 12 refund-reversal "$refund_sql"
assert_value 'refund terminal state' 'REFUNDED' "$(db_sql "SELECT status FROM rf_coin_topups WHERE id = '$REFUND_TOPUP_ID'")"
assert_value 'one exact refund reversal' '110' "$(db_sql "SELECT coalesce(sum(amount_coins), 0) FROM rf_coin_ledger WHERE reference_id = '$REFUND_TOPUP_ID' AND kind = 'chargeback_reversal'")"
assert_value 'refund does not create negative balance' '0' "$(db_sql "SELECT balance_coins FROM rf_coin_wallets WHERE user_id = '$CUSTOMER_REFUND'")"

request_sql="SET ROLE authenticated; SELECT set_config('request.jwt.claims', '{\"sub\":\"$SUPER_ONE\",\"role\":\"authenticated\"}', false); SELECT out_request_id FROM rf_coin_request_adjustment('$CUSTOMER_ADJUST', 'credit', 5000, 'concurrent approval test', 'correction', 'concurrency-adjustment-key-0001');"
db_sql "$request_sql" >/dev/null
REQUEST_ID="$(db_sql "SELECT id FROM rf_coin_adjustment_requests WHERE idempotency_key = 'concurrency-adjustment-key-0001'")"
approve_sql="SET ROLE authenticated; SELECT set_config('request.jwt.claims', '{\"sub\":\"$SUPER_TWO\",\"role\":\"authenticated\"}', false); SELECT out_status FROM rf_coin_decide_adjustment('$REQUEST_ID', true, 'concurrency test');"
run_many 12 adjustment-approval "$approve_sql"
assert_value 'one applied adjustment ledger entry' '1' "$(db_sql "SELECT count(*) FROM rf_coin_ledger WHERE reference_id = '$REQUEST_ID' AND kind = 'manual_credit'")"
assert_value 'adjustment applied once' 'APPLIED' "$(db_sql "SELECT status FROM rf_coin_adjustment_requests WHERE id = '$REQUEST_ID'")"
assert_value 'exact adjusted balance' '5000' "$(db_sql "SELECT balance_coins FROM rf_coin_wallets WHERE user_id = '$CUSTOMER_ADJUST'")"

echo 'RF_COINS_POSTGRES_CONCURRENCY_PASS wallet_init=20 topup_create=16 topup_credit=16 order_settle=12 refund_credit=8 refund=12 adjustment_approve=12'
