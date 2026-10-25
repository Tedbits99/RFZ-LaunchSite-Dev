#!/usr/bin/env bash
set -euo pipefail

: "${SUPABASE_URL:?SUPABASE_URL is required}"
: "${SUPABASE_SERVICE_ROLE_KEY:?SUPABASE_SERVICE_ROLE_KEY is required}"
: "${SUPABASE_DB_PASSWORD:?SUPABASE_DB_PASSWORD is required}"
: "${SUPABASE_POOLER_HOST:?SUPABASE_POOLER_HOST is required}"
: "${SUPABASE_POOLER_PORT:?SUPABASE_POOLER_PORT is required}"
: "${SUPABASE_DB_USER:?SUPABASE_DB_USER is required}"

cleanup_run_id="${1:-}"
[[ "$cleanup_run_id" = 40167500569 ]] || {
  echo 'BLOCKED: cleanup script only accepts the positively identified failed run 40167500569.' >&2
  exit 1
}

export PGPASSWORD="$SUPABASE_DB_PASSWORD"
db_connection="host=$SUPABASE_POOLER_HOST port=$SUPABASE_POOLER_PORT user=$SUPABASE_DB_USER dbname=postgres sslmode=require connect_timeout=10"
email_a="rfz-gate-b-a-${cleanup_run_id}@example.invalid"
email_b="rfz-gate-b-b-${cleanup_run_id}@example.invalid"

list_users() {
  curl --fail --silent --show-error \
    "$SUPABASE_URL/auth/v1/admin/users?page=1&per_page=1000" \
    -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" \
    -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY"
}

users_before="$(list_users)"
mapfile -t user_ids < <(jq -r --arg a "$email_a" --arg b "$email_b" \
  '.users[] | select(.email == $a or .email == $b) | .id' <<<"$users_before")

# The emails are reserved synthetic identities for this single failed run.
# Delete only orders/profiles carrying one of these exact identities.
psql "$db_connection" -v ON_ERROR_STOP=1 -c "
  BEGIN;
  DELETE FROM public.payment_submissions
   WHERE order_id IN (SELECT id FROM public.orders WHERE email IN ('$email_a', '$email_b'));
  DELETE FROM public.orders WHERE email IN ('$email_a', '$email_b');
  DELETE FROM public.customer_profiles WHERE email_snapshot IN ('$email_a', '$email_b');
  COMMIT;
" >/dev/null

for user_id in "${user_ids[@]}"; do
  curl --fail --silent --show-error -X DELETE \
    "$SUPABASE_URL/auth/v1/admin/users/$user_id" \
    -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" \
    -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" >/dev/null
done

users_after="$(list_users)"
remaining_users="$(jq -r --arg a "$email_a" --arg b "$email_b" \
  '[.users[] | select(.email == $a or .email == $b)] | length' <<<"$users_after")"
remaining_rows="$(psql "$db_connection" -v ON_ERROR_STOP=1 -Atqc "
  SELECT (SELECT count(*) FROM public.customer_profiles WHERE email_snapshot IN ('$email_a', '$email_b'))
       + (SELECT count(*) FROM public.orders WHERE email IN ('$email_a', '$email_b'))
       + (SELECT count(*) FROM public.payment_submissions ps JOIN public.orders o ON o.id = ps.order_id WHERE o.email IN ('$email_a', '$email_b'))
  ")"

[[ "$remaining_users" = 0 && "$remaining_rows" = 0 ]] || {
  echo 'HOSTED_CUSTOMER_SECURITY_CLEANUP_FAIL remaining_exact_fixture_rows' >&2
  exit 1
}

echo "HOSTED_CUSTOMER_SECURITY_CLEANUP_PASS run_id=$cleanup_run_id users_removed=${#user_ids[@]} rows_removed=verified"
