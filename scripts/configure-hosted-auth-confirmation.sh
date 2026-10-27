#!/usr/bin/env bash
set -euo pipefail

: "${SUPABASE_ACCESS_TOKEN:?SUPABASE_ACCESS_TOKEN is required}"
: "${PROJECT_ID:?PROJECT_ID is required}"
: "${AUTH_ORIGIN:?AUTH_ORIGIN is required}"
: "${APPLY_CONFIRMATION:?APPLY_CONFIRMATION is required}"

source "$(dirname "$0")/lib/auth-preview-origin.sh"
auth_preview_origin_parse "$AUTH_ORIGIN" || {
  echo 'BLOCKED: only the exact protected PR69 or PR82 candidate origin may be configured.' >&2
  exit 1
}
[[ "$APPLY_CONFIRMATION" == "CONFIGURE_PR${AUTH_PREVIEW_PR}_EMAIL_CONFIRMATION" ]] || {
  echo 'BLOCKED: exact Auth confirmation configuration phrase is required.' >&2
  exit 1
}

api_url="https://api.supabase.com/v1/projects/$PROJECT_ID/config/auth"
before="$RUNNER_TEMP/hosted-auth-config-before.json"
after="$RUNNER_TEMP/hosted-auth-config-after.json"
status="$(curl --silent --show-error --max-time 30 \
  --output "$before" --write-out '%{http_code}' \
  -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
  -H 'Accept: application/json' "$api_url")"
[[ "$status" =~ ^2 ]] || { echo "BLOCKED: Auth configuration read failed (HTTP $status)." >&2; exit 1; }

config="$(jq -c 'if (.result | type) == "object" then .result else . end' "$before")"
allowlist_json="$(jq -c '.uri_allow_list // empty' <<<"$config")"
existing_template="$(jq -r '.mailer_templates_confirmation_content // empty' <<<"$config")"
existing_recovery_template="$(jq -r '.mailer_templates_recovery_content // empty' <<<"$config")"
test -n "$existing_template" || { echo 'BLOCKED: existing Confirm signup template is unavailable.' >&2; exit 1; }
test -n "$existing_recovery_template" || { echo 'BLOCKED: existing Password recovery template is unavailable.' >&2; exit 1; }
[[ "$allowlist_json" != null && -n "$allowlist_json" ]] || { echo 'BLOCKED: existing Auth redirect allowlist is unavailable.' >&2; exit 1; }

candidate_callback="${AUTH_ORIGIN%/}/auth/callback"
candidate_wildcard="$AUTH_PREVIEW_CALLBACK_WILDCARD"
new_allowlist="$(node scripts/lib/auth-redirect-allowlist.mjs merge "$candidate_callback" "$candidate_wildcard" <<<"$allowlist_json")"

# RedirectTo is exactly the trusted /auth/callback URL without a query. Repair
# only the recovery anchor's href so all approved branding and layout remain
# byte-for-byte unchanged outside that href. The helper fails closed if it
# cannot identify exactly one existing recovery link.
recovery_template="$(node scripts/lib/auth-recovery-template.mjs repair "$candidate_callback" <<<"$existing_recovery_template")"
payload="$(jq -n --arg uri_allow_list "$new_allowlist" --arg recovery_template "$recovery_template" \
  '{uri_allow_list: $uri_allow_list, mailer_templates_recovery_content: $recovery_template}')"

patch_status="$(curl --silent --show-error --max-time 30 -X PATCH \
  --output "$after" --write-out '%{http_code}' \
  -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
  -H 'Content-Type: application/json' -H 'Accept: application/json' \
  --data "$payload" "$api_url")"
if [[ ! "$patch_status" =~ ^2 ]]; then
  api_code="$(jq -r '.code // .error_code // empty' "$after" 2>/dev/null || true)"
  api_message="$(jq -r '.message // .error // .error_description // .errors[0].message // empty' "$after" 2>/dev/null \
    | tr '\r\n' ' ' | cut -c1-160 \
    | sed -E 's#https?://[^[:space:]]+#URL_REDACTED#g; s/<[^>]*>/[TEMPLATE_REDACTED]/g; s/\{\{[^}]+\}\}/[TEMPLATE_VARIABLE]/g')"
  echo "BLOCKED: Auth confirmation configuration update failed (HTTP $patch_status${api_code:+, code=$api_code}${api_message:+, message=$api_message})." >&2
  exit 1
fi

# Read back the persisted result and verify only the intended invariants.
verify="$(curl --silent --show-error --max-time 30 \
  -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
  -H 'Accept: application/json' "$api_url")"
verify_config="$(jq -c 'if (.result | type) == "object" then .result else . end' <<<"$verify")"
verify_allowlist_json="$(jq -c '.uri_allow_list // empty' <<<"$verify_config")"
verify_template="$(jq -r '.mailer_templates_confirmation_content // empty' <<<"$verify_config")"
verify_recovery_template="$(jq -r '.mailer_templates_recovery_content // empty' <<<"$verify_config")"
verify_template_hash="$(printf '%s' "$verify_template" | sha256sum | cut -d' ' -f1)"
verify_summary="$(node scripts/lib/auth-redirect-allowlist.mjs inspect "$candidate_callback" "$candidate_wildcard" <<<"$verify_allowlist_json")"
jq -e '.exactCallback and .wildcardRule and .callbackAllowed' <<<"$verify_summary" >/dev/null || {
  echo "BLOCKED: Auth redirect allowlist read-back did not contain the PR${AUTH_PREVIEW_PR} callback rules." >&2
  exit 1
}
normalized_allowlist="$(node scripts/lib/auth-redirect-allowlist.mjs normalize <<<"$verify_allowlist_json")"
verify_allowlist_hash="$(printf '%s' "$normalized_allowlist" | sha256sum | cut -d' ' -f1)"
verify_template_lower="${verify_template,,}"
[[ "$verify_template_lower" == *token_hash* || "$verify_template_lower" == *tokenhash* ]] || {
  echo 'BLOCKED: Confirm signup template read-back is not TokenHash based.' >&2
  exit 1
}
[[ "$verify_template_lower" == *'type=email'* ]] || {
  echo 'BLOCKED: Confirm signup template read-back is missing type=email.' >&2
  exit 1
}
verify_recovery_lower="${verify_recovery_template,,}"
recovery_contract="$(node scripts/lib/auth-recovery-template.mjs validate "$candidate_callback" <<<"$verify_recovery_template")"
jq -e '.valid == true and .reason == "valid"' <<<"$recovery_contract" >/dev/null || {
  echo 'BLOCKED: Password recovery template read-back does not render the canonical HTTPS callback URL.' >&2
  exit 1
}
[[ "$verify_recovery_lower" != *confirmationurl* ]] || {
  echo 'BLOCKED: Password recovery template still routes through the provider ConfirmationURL.' >&2
  exit 1
}

verify_recovery_hash="$(printf '%s' "$verify_recovery_template" | sha256sum | cut -d' ' -f1)"
echo "HOSTED_AUTH_RECOVERY_TEMPLATE_CONFIGURED project=$PROJECT_ID allowlist_sha256=$verify_allowlist_hash confirmation_template_sha256=$verify_template_hash recovery_template_sha256=$verify_recovery_hash signup_template_preserved=true recovery_branding_preserved=true recovery_url_contract=PASS"
