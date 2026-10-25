#!/usr/bin/env bash
set -euo pipefail

# Read-only verifier. Logs contain only HTTP status, counts, destination types,
# and API error codes; credentials, IDs of Access applications, and identities
# are never printed.
: "${CLOUDFLARE_API_TOKEN:?CLOUDFLARE_API_TOKEN is required}"
: "${CLOUDFLARE_ACCOUNT_ID:?CLOUDFLARE_ACCOUNT_ID is required}"

api_root='https://api.cloudflare.com/client/v4'
response_file="$(mktemp)"
status_file="$(mktemp)"
apps_items="$(mktemp)"
apps_json="$(mktemp)"
policies_items="$(mktemp)"
trap 'rm -f "$response_file" "$status_file" "$apps_items" "$apps_json" "$policies_items"' EXIT

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

curl_api "/accounts/$CLOUDFLARE_ACCOUNT_ID"
api_account_id="$(jq -r '.result.id // empty' "$response_file")"
[[ "$api_account_id" == "$CLOUDFLARE_ACCOUNT_ID" ]] || {
  echo 'CLOUDFLARE_ACCESS_BLOCKED: token account identity did not match the configured account ID.' >&2
  exit 1
}
echo 'CLOUDFLARE_ACCESS_ACCOUNT_MATCH: true'

# The Access applications endpoint is paginated. Collect only application JSON
# objects, then use the aggregate for all subsequent checks.
: >"$apps_items"
page=1
total_pages=1
api_total_count='unknown'
apps_pagination='metadata'
while (( page <= total_pages )); do
  curl_api "/accounts/$CLOUDFLARE_ACCOUNT_ID/access/apps?page=$page&per_page=100"
  jq -c '.result[]?' "$response_file" >>"$apps_items"
  result_count="$(jq '[.result[]?] | length' "$response_file")"
  metadata_total_pages="$(jq -r '.result_info.total_pages // empty' "$response_file")"
  metadata_total_count="$(jq -r '.result_info.total_count // empty' "$response_file")"
  if [[ "$metadata_total_pages" =~ ^[0-9]+$ && "$metadata_total_pages" -ge 1 ]]; then
    total_pages="$metadata_total_pages"
    [[ "$metadata_total_count" =~ ^[0-9]+$ ]] && api_total_count="$metadata_total_count"
  elif (( result_count < 100 )); then
    # Some Access application responses omit result_info even though the
    # endpoint is still page-addressable. A short page is a safe terminal
    # condition; a full page means another page must be fetched.
    total_pages="$page"
    apps_pagination='inferred-from-page-size'
  else
    total_pages=$((page + 1))
    apps_pagination='inferred-from-page-size'
  fi
  page=$((page + 1))
  (( page <= 101 )) || {
    echo 'CLOUDFLARE_ACCESS_BLOCKED: Access applications pagination exceeded the safety bound.' >&2
    exit 1
  }
done
jq -s '.' "$apps_items" >"$apps_json"
cp "$apps_json" "$response_file"

application_total="$(jq 'length' "$response_file")"
destination_types="$(jq -r '[.[].destinations[]?.type] | unique | if length == 0 then "none" else join(",") end' "$response_file")"
application_types="$(jq -r '[.[].type // "unknown"] | unique | join(",")' "$response_file")"
inline_policy_apps="$(jq '[.[] | select(.policies | type == "array")] | length' "$response_file")"
echo "CLOUDFLARE_ACCESS_API_SUMMARY: application_total=$application_total api_total_count=$api_total_count pages=$total_pages pagination=$apps_pagination application_types=$application_types destination_types=$destination_types inline_policy_apps=$inline_policy_apps"

all_workers_count="$(jq '[.[] | select(any(.destinations[]?; .type == "all_workers"))] | length' "$response_file")"
all_preview_workers_count="$(jq '[.[] | select(any(.destinations[]?; .type == "all_preview_workers"))] | length' "$response_file")"
echo "CLOUDFLARE_ACCESS_DESTINATIONS: all_workers=$all_workers_count all_preview_workers=$all_preview_workers_count"
[[ "$all_workers_count" == 1 ]] || {
  echo "CLOUDFLARE_ACCESS_BLOCKED: expected exactly one account-wide all_workers application; found $all_workers_count." >&2
  exit 1
}

target_app_id="$(jq -r '[.[] | select(any(.destinations[]?; .type == "all_workers"))][0].id // empty' "$response_file")"
test -n "$target_app_id" || {
  echo 'CLOUDFLARE_ACCESS_BLOCKED: account-wide application did not expose an application ID.' >&2
  exit 1
}

jq -e '
  [.[] | select(any(.destinations[]?; .type == "all_workers"))][0]
  | (.destinations // [])
  | length == 1
    and .[0].type == "all_workers"
    and ((.[0].overrides // []) | length == 0)
' "$response_file" >/dev/null || {
  echo 'CLOUDFLARE_ACCESS_BLOCKED: the account-wide application has an unexpected destination or public override.' >&2
  exit 1
}

# The application policy endpoint returns both application-scoped and reusable
# policies used by the application. Prefer that authoritative response; fall
# back to inline policies only if the endpoint legitimately returns no entries.
: >"$policies_items"
policy_page=1
policy_total_pages=1
policy_api_total_count='unknown'
policy_pagination='metadata'
while (( policy_page <= policy_total_pages )); do
  curl_api "/accounts/$CLOUDFLARE_ACCOUNT_ID/access/apps/$target_app_id/policies?page=$policy_page&per_page=1000"
  jq -c 'if (.result | type) == "array" then .result[]? elif (.result.policies | type) == "array" then .result.policies[]? else empty end' "$response_file" >>"$policies_items"
  policy_result_count="$(jq 'if (.result | type) == "array" then (.result | length) elif (.result.policies | type) == "array" then (.result.policies | length) else 0 end' "$response_file")"
  policy_metadata_total_pages="$(jq -r '.result_info.total_pages // empty' "$response_file")"
  policy_metadata_total_count="$(jq -r '.result_info.total_count // empty' "$response_file")"
  if [[ "$policy_metadata_total_pages" =~ ^[0-9]+$ && "$policy_metadata_total_pages" -ge 1 ]]; then
    policy_total_pages="$policy_metadata_total_pages"
    [[ "$policy_metadata_total_count" =~ ^[0-9]+$ ]] && policy_api_total_count="$policy_metadata_total_count"
  elif (( policy_result_count < 1000 )); then
    policy_total_pages="$policy_page"
    policy_pagination='inferred-from-page-size'
  else
    policy_total_pages=$((policy_page + 1))
    policy_pagination='inferred-from-page-size'
  fi
  policy_page=$((policy_page + 1))
  (( policy_page <= 101 )) || {
    echo 'CLOUDFLARE_ACCESS_BLOCKED: Access policy pagination exceeded the safety bound.' >&2
    exit 1
  }
done
jq -s '.' "$policies_items" >"$response_file"
policy_source='application-policy-endpoint'
if [[ "$(jq 'length' "$response_file")" == 0 ]]; then
  inline_policies="$(jq -c '[.[] | select(any(.destinations[]?; .type == "all_workers"))][0].policies // []' "$apps_json" 2>/dev/null || echo '[]')"
  jq -c '.[]' <<<"$inline_policies" >"$policies_items"
  jq -s '.' "$policies_items" >"$response_file"
  policy_source='inline-application-response'
fi

echo "CLOUDFLARE_ACCESS_POLICY_SUMMARY: policy_total=$(jq 'length' "$response_file") api_total_count=$policy_api_total_count pages=$policy_total_pages pagination=$policy_pagination source=$policy_source"

# Cloudflare's documented email rule is {email:{email:"..."}}. Some API
# responses use the legacy {_type:"email",email:"..."} representation. Both
# are accepted only when every include rule is an email rule and exactly two
# unique email identities are present.
jq -e '
  length == 1
  and .[0].decision == "allow"
  and ((.[0].exclude // []) | length == 0)
  and ((.[0].require // []) | length == 0)
  and ((.[0].include // []) | length == 2)
  and (
    [.[0].include[] |
      if ((._type? == "email") and (.email | type == "string")) then .email
      elif ((.email | type == "object") and (.email.email | type == "string")) then .email.email
      else empty
      end
    ] | length == 2
  )
  and (
    [.[0].include[] |
      if ((._type? == "email") and (.email | type == "string")) then .email
      elif ((.email | type == "object") and (.email.email | type == "string")) then .email.email
      else empty
      end
      | ascii_downcase
    ] | unique | length == 2
  )
' "$response_file" >/dev/null || {
  echo 'CLOUDFLARE_ACCESS_BLOCKED: account-wide policy is not exactly one allow policy for two unique email identities.' >&2
  exit 1
}

# A public workers.dev destination or public path override takes precedence over
# account-wide protection and can create an unprotected alternate route.
public_worker_destinations="$(jq '[.[] | .destinations[]? | select(.type == "public" and ((.uri // "") | test("workers\\.dev|^\\*$"; "i")))] | length' "$apps_json")"
public_overrides="$(jq '[.[] | .destinations[]?.overrides[]? | select(.behavior == "public")] | length' "$apps_json")"
[[ "$public_worker_destinations" == 0 && "$public_overrides" == 0 ]] || {
  echo "CLOUDFLARE_ACCESS_BLOCKED: public workers.dev destinations=$public_worker_destinations public_overrides=$public_overrides." >&2
  exit 1
}

echo 'CLOUDFLARE_ACCESS_PASS: one account-wide all_workers application, two unique email identities, no public overrides.'
