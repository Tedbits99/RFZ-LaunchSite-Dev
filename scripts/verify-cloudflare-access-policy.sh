#!/usr/bin/env bash
set -euo pipefail

# This verifier is intentionally read-only. It prints only sanitized counts and
# HTTP/API status information; Access identities and bearer credentials never
# enter the log.
: "${CLOUDFLARE_API_TOKEN:?CLOUDFLARE_API_TOKEN is required}"
: "${CLOUDFLARE_ACCOUNT_ID:?CLOUDFLARE_ACCOUNT_ID is required}"

api_root='https://api.cloudflare.com/client/v4'
response_file="$(mktemp)"
status_file="$(mktemp)"
trap 'rm -f "$response_file" "$status_file"' EXIT

curl_api() {
  local path="$1"
  local status
  status="$(curl --silent --show-error --max-time 30 \
    --output "$response_file" --write-out '%{http_code}' \
    -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
    -H 'Content-Type: application/json' \
    "$api_root$path")" || status=000
  printf '%s' "$status" >"$status_file"
  [[ "$status" =~ ^2 ]] || {
    local code
    code="$(jq -r '.errors[0].code // "unknown"' "$response_file" 2>/dev/null || echo unknown)"
    echo "CLOUDFLARE_ACCESS_API_FAILED: endpoint=$path http=$status api_code=$code" >&2
    return 1
  }
  jq -e '.success == true' "$response_file" >/dev/null || {
    echo "CLOUDFLARE_ACCESS_API_FAILED: endpoint=$path response_success=false" >&2
    return 1
  }
}

curl_api "/accounts/$CLOUDFLARE_ACCOUNT_ID/access/apps?per_page=100"
apps_json="$response_file"

all_workers_count="$(jq '[.result[]? | select(any(.destinations[]?; .type == "all_workers"))] | length' "$apps_json")"
[[ "$all_workers_count" == 1 ]] || {
  echo "CLOUDFLARE_ACCESS_BLOCKED: expected exactly one account-wide all_workers application; found $all_workers_count." >&2
  exit 1
}

jq -e '
  [.result[]? | select(any(.destinations[]?; .type == "all_workers"))][0]
  | (.destinations // [])
  | length == 1
    and .[0].type == "all_workers"
    and ((.[0].overrides // []) | length == 0)
' "$apps_json" >/dev/null || {
  echo 'CLOUDFLARE_ACCESS_BLOCKED: the account-wide application has an unexpected destination or public override.' >&2
  exit 1
}

jq -e '
  [.result[]? | select(any(.destinations[]?; .type == "all_workers"))][0]
  | (.policies // [])
  | length == 1
    and .[0].decision == "allow"
    and ((.[0].exclude // []) | length == 0)
    and ((.[0].require // []) | length == 0)
    and ((.[0].include // []) | length == 2)
    and ([.[0].include[] | select(._type == "email" and (.email | type == "string"))] | length == 2)
    and ([.[0].include[].email | ascii_downcase] | unique | length == 2)
' "$apps_json" >/dev/null || {
  echo 'CLOUDFLARE_ACCESS_BLOCKED: account-wide policy is not exactly one allow policy for two unique email identities.' >&2
  exit 1
}

# A public workers.dev destination or a public path override would take
# precedence over the account-wide application and could create an unprotected
# alternate route. Reject it rather than attempting to infer intent.
public_worker_destinations="$(jq '[.result[]? | .destinations[]? | select(.type == "public" and ((.uri // "") | test("workers\\.dev|^\\*$"; "i")))] | length' "$apps_json")"
public_overrides="$(jq '[.result[]? | .destinations[]?.overrides[]? | select(.behavior == "public")] | length' "$apps_json")"
[[ "$public_worker_destinations" == 0 && "$public_overrides" == 0 ]] || {
  echo "CLOUDFLARE_ACCESS_BLOCKED: public workers.dev destinations=$public_worker_destinations public_overrides=$public_overrides." >&2
  exit 1
}

echo 'CLOUDFLARE_ACCESS_PASS: one account-wide all_workers application, two unique email identities, no public overrides.'
