#!/usr/bin/env bash
set -euo pipefail

project_root="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"

if ! command -v supabase >/dev/null 2>&1; then
  echo "ERROR: Supabase CLI is required." >&2
  exit 2
fi

if ! command -v psql >/dev/null 2>&1; then
  echo "ERROR: psql is required for role and RPC integration assertions." >&2
  exit 2
fi

tmp_parent="${RUNNER_TEMP:-${TMPDIR:-$project_root}}"
test_root="$(mktemp -d "$tmp_parent/runfazone-supabase.XXXXXX")"

cleanup() {
  if [ -d "$test_root" ]; then
    (cd "$test_root" && supabase stop --no-backup >/dev/null 2>&1) || true
    rm -rf -- "$test_root"
  fi
}
trap cleanup EXIT

mkdir -p "$test_root/supabase/migrations" "$test_root/supabase/tests/database"

cat > "$test_root/supabase/config.toml" <<'EOF'
project_id = "runfazone-security-test"

[api]
enabled = true
port = 54321

[db]
port = 54322

[studio]
enabled = false

[inbucket]
enabled = false

[storage]
enabled = false

[analytics]
enabled = false
EOF

excluded_scheduler="20261008142813_20261008150000_schedule_auto_reconciliation.sql.sql"
excluded_incomplete_fulfillment="20260928071820_20260928_order_fulfillment_schema.sql"
excluded_ambiguous_status_rpc="20260928072329_20260928_fix_rpc_ambiguous_column.sql"
excluded_hardcoded_hok_uid="20260928124803_honor_of_kings_uid_input_field.sql"
required_hok_uid_correction="20260929131902_20260928124803_honor_of_kings_uid_input_field.sql.sql"
excluded_count=0

if [ ! -f "$project_root/supabase/migrations/$required_hok_uid_correction" ]; then
  echo "ERROR: Required corrected Honor of Kings migration is missing: $required_hok_uid_correction" >&2
  exit 3
fi

while IFS= read -r migration; do
  basename="$(basename "$migration")"
  case "$basename" in
    "$excluded_scheduler"|"$excluded_incomplete_fulfillment"|"$excluded_ambiguous_status_rpc"|"$excluded_hardcoded_hok_uid")
      echo "Excluding reviewed historical migration from disposable baseline: $basename"
      excluded_count=$((excluded_count + 1))
      continue
      ;;
  esac

  if grep -Eiq '(cron\.schedule|net\.http|http_post|http_get|https://[^[:space:]]+/functions/)' "$migration"; then
    echo "ERROR: Found an unapproved outbound/scheduled migration: $basename" >&2
    exit 3
  else
    cp "$migration" "$test_root/supabase/migrations/$basename"
  fi
done < <(find "$project_root/supabase/migrations" -maxdepth 1 -type f -name '*.sql' -print | sort)

if [ "$excluded_count" -ne 4 ]; then
  echo "ERROR: Expected exactly four reviewed baseline exclusions; found $excluded_count." >&2
  exit 3
fi

cp "$project_root/supabase/tests/database/privileged-rpc-security.sql" \
  "$test_root/supabase/tests/database/privileged-rpc-security.sql"
cp "$project_root/supabase/tests/privileged-rpc-security.sql" \
  "$test_root/supabase/tests/privileged-rpc-security.sql"

cd "$test_root"
echo "Starting isolated Supabase services..."
supabase start

status_env="$(supabase status -o env)"
db_url="$(printf '%s\n' "$status_env" | sed -n 's/^DB_URL=//p' | sed 's/^"//; s/"$//')"

case "$db_url" in
  *localhost*|*127.0.0.1*|*::1*) ;;
  *)
    echo "ERROR: Refusing to run: resolved DB_URL is not local." >&2
    exit 4
    ;;
esac

echo "Applying the isolated migration baseline..."
supabase db reset

echo "Executing database security integration assertions..."
PGOPTIONS='-c statement_timeout=30000' psql "$db_url" \
  --set ON_ERROR_STOP=1 \
  --file supabase/tests/database/privileged-rpc-security.sql

echo "Reapplying the isolated baseline to verify reset/retry behavior..."
supabase db reset >/dev/null

echo "PASS: RunFazone database security integration tests completed."
