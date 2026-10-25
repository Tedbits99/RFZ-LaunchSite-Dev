#!/usr/bin/env bash
set -euo pipefail

: "${SUPABASE_URL:?SUPABASE_URL is required}"
: "${SUPABASE_ANON_KEY:?SUPABASE_ANON_KEY is required}"
: "${SUPABASE_SERVICE_ROLE_KEY:?SUPABASE_SERVICE_ROLE_KEY is required}"
: "${SUPABASE_DB_PASSWORD:?SUPABASE_DB_PASSWORD is required}"
: "${SUPABASE_POOLER_HOST:?SUPABASE_POOLER_HOST is required}"
: "${SUPABASE_POOLER_PORT:?SUPABASE_POOLER_PORT is required}"
: "${SUPABASE_DB_USER:?SUPABASE_DB_USER is required}"

export PGPASSWORD="$SUPABASE_DB_PASSWORD"
db_connection="host=$SUPABASE_POOLER_HOST port=$SUPABASE_POOLER_PORT user=$SUPABASE_DB_USER dbname=postgres sslmode=require connect_timeout=10"
run_id="${GITHUB_RUN_ID:-local}"
email_a="rfz-gate-b-a-${run_id}@example.invalid"
email_b="rfz-gate-b-b-${run_id}@example.invalid"
password_a="$(openssl rand -hex 24)"
password_b="$(openssl rand -hex 24)"
user_a=''
user_b=''
order_id="$(cat /proc/sys/kernel/random/uuid)"
payment_submission_id="$(cat /proc/sys/kernel/random/uuid)"
response_file="$(mktemp)"
cleanup_attempted=false

cleanup() {
  local cleanup_status=0 profile_count auth_status uid

  [[ "$cleanup_attempted" = false ]] || return 0
  cleanup_attempted=true

  rm -f "$response_file"
  if ! psql "$db_connection" -v ON_ERROR_STOP=1 -Atqc \
    "DELETE FROM public.payment_submissions WHERE id = '$payment_submission_id'; DELETE FROM public.orders WHERE id = '$order_id';" \
    >/dev/null 2>&1; then
    cleanup_status=1
  fi

  for uid in "$user_a" "$user_b"; do
    [[ -n "$uid" ]] || continue
    if ! auth_status="$(curl --silent --show-error -o /dev/null -w '%{http_code}' \
      -X DELETE "$SUPABASE_URL/auth/v1/admin/users/$uid" \
      -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" \
      -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY")" || [[ "$auth_status" != 2* && "$auth_status" != 404 ]]; then
      cleanup_status=1
    fi
    if ! auth_status="$(curl --silent --show-error -o /dev/null -w '%{http_code}' \
      "$SUPABASE_URL/auth/v1/admin/users/$uid" \
      -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" \
      -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY")" || [[ "$auth_status" != 404 ]]; then
      cleanup_status=1
    fi
  done

  if [[ -n "$user_a" || -n "$user_b" ]]; then
    if ! profile_count="$(psql "$db_connection" -v ON_ERROR_STOP=1 -Atqc \
      "SELECT count(*) FROM public.customer_profiles WHERE user_id IN ('$user_a', '$user_b')")" \
      || [[ "$profile_count" != 0 ]]; then
      cleanup_status=1
    fi
  fi

  if [[ "$cleanup_status" -eq 0 ]]; then
    echo 'HOSTED_CUSTOMER_SECURITY_CLEANUP_PASS synthetic_users=2 synthetic_profiles=0 synthetic_order=removed' >&2
  else
    echo 'HOSTED_CUSTOMER_SECURITY_CLEANUP_FAIL' >&2
  fi
  return "$cleanup_status"
}

trap cleanup EXIT

admin_create_user() {
  local email="$1" password="$2" response
  response="$(curl --fail --silent --show-error -X POST "$SUPABASE_URL/auth/v1/admin/users" -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" -H 'Content-Type: application/json' --data "$(jq -cn --arg email "$email" --arg password "$password" '{email:$email,password:$password,email_confirm:true,user_metadata:{full_name:"Gate B synthetic customer"}}')")"
  jq -er '.id' <<<"$response"
}

login_user() {
  local email="$1" password="$2" response
  response="$(curl --fail --silent --show-error -X POST "$SUPABASE_URL/auth/v1/token?grant_type=password" -H "apikey: $SUPABASE_ANON_KEY" -H 'Content-Type: application/json' --data "$(jq -cn --arg email "$email" --arg password "$password" '{email:$email,password:$password}')")"
  jq -er '.access_token' <<<"$response"
}

request_json() {
  local method="$1" token="$2" url="$3" body="${4:-}" status
  if [[ -n "$body" ]]; then
    status="$(curl --silent --show-error -o "$response_file" -w '%{http_code}' -X "$method" "$url" -H "apikey: $SUPABASE_ANON_KEY" -H "Authorization: Bearer $token" -H 'Content-Type: application/json' -H 'Prefer: return=representation' --data "$body")"
  else
    status="$(curl --silent --show-error -o "$response_file" -w '%{http_code}' -X "$method" "$url" -H "apikey: $SUPABASE_ANON_KEY" -H "Authorization: Bearer $token")"
  fi
  printf '%s' "$status"
}

expect_one() {
  local status="$1" label="$2"
  [[ "$status" = 200 ]] && jq -e 'type == "array" and length == 1' "$response_file" >/dev/null || { echo "HOSTED_CUSTOMER_SECURITY_FAIL=$label" >&2; exit 1; }
}

expect_zero_or_denied() {
  local status="$1" label="$2"
  if [[ "$status" = 200 ]]; then
    jq -e 'type == "array" and length == 0' "$response_file" >/dev/null || { echo "HOSTED_CUSTOMER_SECURITY_FAIL=$label" >&2; exit 1; }
  elif [[ "$status" != 401 && "$status" != 403 ]]; then
    echo "HOSTED_CUSTOMER_SECURITY_FAIL=$label status=$status" >&2
    exit 1
  fi
}

user_a="$(admin_create_user "$email_a" "$password_a")"
user_b="$(admin_create_user "$email_b" "$password_b")"
token_a="$(login_user "$email_a" "$password_a")"
token_b="$(login_user "$email_b" "$password_b")"

for token in "$token_a" "$token_b"; do
  activation_status="$(curl --silent --show-error -o "$response_file" -w '%{http_code}' -X POST "$SUPABASE_URL/rest/v1/rpc/activate_customer_profile" -H "apikey: $SUPABASE_ANON_KEY" -H "Authorization: Bearer $token" -H 'Content-Type: application/json' --data '{}')"
  [[ "$activation_status" = 200 ]] && jq -e '.[0].out_status == "active"' "$response_file" >/dev/null || { echo 'HOSTED_CUSTOMER_SECURITY_FAIL=customer_profile_activation' >&2; exit 1; }
done

game_id="$(psql "$db_connection" -v ON_ERROR_STOP=1 -Atqc "SELECT id FROM public.games WHERE is_active = true ORDER BY sort_order, id LIMIT 1")"
package_id="$(psql "$db_connection" -v ON_ERROR_STOP=1 -Atqc "SELECT id FROM public.packages WHERE game_id = '$game_id' ORDER BY sort_order, id LIMIT 1")"
[[ -n "$game_id" && -n "$package_id" ]] || { echo 'HOSTED_CUSTOMER_SECURITY_BLOCKED=missing_catalog_fixture' >&2; exit 1; }
player_inputs="$(psql "$db_connection" -v ON_ERROR_STOP=1 -Atqc "SELECT COALESCE(jsonb_object_agg(field_key, 'synthetic'), '{}'::jsonb) FROM public.game_input_fields WHERE game_id = '$game_id' AND is_required")"
capability_hash="$(openssl rand -hex 32)"
player_inputs="$(jq -ce --arg capability_hash "$capability_hash" '. + {__rfz_order_access_hash: $capability_hash}' <<<"$player_inputs")"
create_status="$(curl --silent --show-error -o "$response_file" -w '%{http_code}' -X POST "$SUPABASE_URL/rest/v1/rpc/create_order" -H "apikey: $SUPABASE_ANON_KEY" -H "Authorization: Bearer $token_a" -H 'Content-Type: application/json' --data "$(jq -cn --arg game "$game_id" --arg package "$package_id" --arg email "$email_a" --argjson inputs "$player_inputs" '{p_game_id:$game,p_package_id:$package,p_email:$email,p_customer_name:"Gate B synthetic customer A",p_player_inputs:$inputs,p_payment_method:"manual",p_voucher_code:null,p_voucher_email:null}')")"
[[ "$create_status" = 200 ]] && jq -e '.[0].out_error == null and .[0].out_order_id != null' "$response_file" >/dev/null || { echo 'HOSTED_CUSTOMER_SECURITY_FAIL=authenticated_order_creation' >&2; exit 1; }
order_id="$(jq -er '.[0].out_order_id' "$response_file")"
psql "$db_connection" -v ON_ERROR_STOP=1 -c "INSERT INTO public.payment_submissions (id, order_id, payment_method, reference_number, amount_cents, note) VALUES ('$payment_submission_id', '$order_id', 'manual', 'RFZ-GATE-B-$run_id', 1, 'synthetic security fixture');" >/dev/null

status="$(request_json GET "$token_a" "$SUPABASE_URL/rest/v1/customer_profiles?select=user_id&user_id=eq.$user_a")"; expect_one "$status" customer_a_profile
status="$(request_json GET "$token_b" "$SUPABASE_URL/rest/v1/customer_profiles?select=user_id&user_id=eq.$user_a")"; expect_zero_or_denied "$status" customer_b_profile_isolation
status="$(request_json GET "$token_a" "$SUPABASE_URL/rest/v1/orders?select=id,customer_user_id&id=eq.$order_id")"; expect_one "$status" customer_a_order
status="$(request_json GET "$token_b" "$SUPABASE_URL/rest/v1/orders?select=id,customer_user_id&id=eq.$order_id")"; expect_zero_or_denied "$status" customer_b_order_isolation
status="$(request_json GET "$token_b" "$SUPABASE_URL/rest/v1/payment_submissions?select=id&order_id=eq.$order_id")"; expect_zero_or_denied "$status" customer_b_payment_isolation
status="$(request_json GET "" "$SUPABASE_URL/rest/v1/orders?select=id&id=eq.$order_id")"; expect_zero_or_denied "$status" anonymous_order_denial
status="$(request_json GET "" "$SUPABASE_URL/rest/v1/customer_profiles?select=user_id&user_id=eq.$user_a")"; expect_zero_or_denied "$status" anonymous_profile_denial
status="$(request_json PATCH "$token_b" "$SUPABASE_URL/rest/v1/customer_profiles?user_id=eq.$user_a" '{"display_name":"forged customer"}')"; expect_zero_or_denied "$status" customer_b_profile_mutation
rpc_status="$(curl --silent --show-error -o "$response_file" -w '%{http_code}' -X POST "$SUPABASE_URL/rest/v1/rpc/admin_get_all_games" -H "apikey: $SUPABASE_ANON_KEY" -H "Authorization: Bearer $token_a" -H 'Content-Type: application/json' --data '{}')"
[[ "$rpc_status" != 2* ]] || { echo 'HOSTED_CUSTOMER_SECURITY_FAIL=customer_admin_rpc_escalation' >&2; exit 1; }

cleanup
trap - EXIT
echo 'HOSTED_CUSTOMER_SECURITY_PASS sessions=2 ownership=profiles_orders_payments anonymous=denied customer_admin_rpc=denied cleanup=pass'
