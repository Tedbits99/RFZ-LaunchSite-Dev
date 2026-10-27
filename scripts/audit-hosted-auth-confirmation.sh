#!/usr/bin/env bash
set -euo pipefail

: "${SUPABASE_ACCESS_TOKEN:?SUPABASE_ACCESS_TOKEN is required}"
: "${PROJECT_ID:?PROJECT_ID is required}"
: "${AUTH_ORIGIN:?AUTH_ORIGIN is required}"

source "$(dirname "$0")/lib/auth-preview-origin.sh"
auth_preview_origin_parse "$AUTH_ORIGIN" || {
  echo 'BLOCKED: only the exact protected PR69 or PR82 candidate origin may be audited.' >&2
  exit 1
}

callback_url="${AUTH_ORIGIN%/}/auth/callback"
response="$RUNNER_TEMP/hosted-auth-config.json"
status="$(curl --silent --show-error --max-time 30 \
  --output "$response" --write-out '%{http_code}' \
  -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
  -H 'Accept: application/json' \
  "https://api.supabase.com/v1/projects/$PROJECT_ID/config/auth")"

if [[ ! "$status" =~ ^2 ]]; then
  api_code="$(jq -r '.code // .error_code // empty' "$response" 2>/dev/null || true)"
  if [[ -n "$api_code" ]]; then
    echo "BLOCKED: Supabase Auth configuration read failed (HTTP $status, code=$api_code)." >&2
  else
    echo "BLOCKED: Supabase Auth configuration read failed (HTTP $status)." >&2
  fi
  exit 1
fi

# The Management API has returned settings at the top level and under result
# over time. Extract only non-secret metadata; never print the template,
# allowlist, tokens, email addresses, or provider credentials.
config="$(jq -c 'if (.result | type) == "object" then .result else . end' "$response")"
site_url="$(jq -r '.site_url // empty' <<<"$config")"
allowlist_json="$(jq -c '.uri_allow_list // empty' <<<"$config")"
template="$(jq -r '.mailer_templates_confirmation_content // empty' <<<"$config")"
recovery_template="$(jq -r '.mailer_templates_recovery_content // empty' <<<"$config")"

test -n "$site_url" || {
  echo 'BLOCKED: Auth configuration response did not contain site_url.' >&2
  exit 1
}
[[ "$allowlist_json" != null && -n "$allowlist_json" ]] || {
  echo 'BLOCKED: Auth configuration response did not contain uri_allow_list.' >&2
  exit 1
}
test -n "$template" || {
  echo 'BLOCKED: Auth configuration response did not contain the confirmation template.' >&2
  exit 1
}
test -n "$recovery_template" || {
  echo 'BLOCKED: Auth configuration response did not contain the password recovery template.' >&2
  exit 1
}

template_lower="${template,,}"
template_token_hash=false
template_email_type=false
template_confirmation_url=false
template_redirect_to=false
[[ "$template_lower" == *tokenhash* || "$template_lower" == *token_hash* ]] && template_token_hash=true
[[ "$template_lower" == *'type=email'* ]] && template_email_type=true
[[ "$template_lower" == *confirmationurl* ]] && template_confirmation_url=true
[[ "$template_lower" == *redirectto* ]] && template_redirect_to=true
recovery_lower="${recovery_template,,}"
recovery_token_hash=false
recovery_redirect_to=false
recovery_confirmation_url=false
[[ "$recovery_lower" == *tokenhash* || "$recovery_lower" == *token_hash* ]] && recovery_token_hash=true
[[ "$recovery_lower" == *redirectto* ]] && recovery_redirect_to=true
[[ "$recovery_lower" == *confirmationurl* ]] && recovery_confirmation_url=true
recovery_contract="$(node scripts/lib/auth-recovery-template.mjs validate "$callback_url" <<<"$recovery_template")"
recovery_url_contract="$(jq -r '.valid == true and .reason == "valid"' <<<"$recovery_contract")"
recovery_structure="$(node scripts/lib/auth-recovery-template.mjs inspect "$callback_url" <<<"$recovery_template")"

site_origin="$(python3 - "$site_url" <<'PY'
from urllib.parse import urlsplit
import sys
parsed = urlsplit(sys.argv[1])
print(f'{parsed.scheme}://{parsed.netloc}')
PY
)"
candidate_host="${AUTH_ORIGIN#https://}"
candidate_wildcard="$AUTH_PREVIEW_CALLBACK_WILDCARD"
allowlist_summary="$(node scripts/lib/auth-redirect-allowlist.mjs inspect "$callback_url" "$candidate_wildcard" <<<"$allowlist_json")"
allowlist_format="$(jq -r '.format' <<<"$allowlist_summary")"
allowlist_rule_count="$(jq -r '.ruleCount' <<<"$allowlist_summary")"
exact_rule="$(jq -r '.exactCallback' <<<"$allowlist_summary")"
wildcard_rule="$(jq -r '.wildcardRule' <<<"$allowlist_summary")"
callback_allowed="$(jq -r '.callbackAllowed' <<<"$allowlist_summary")"

echo "AUTH_CONFIG_PROJECT=$PROJECT_ID"
echo "AUTH_SITE_ORIGIN=$site_origin"
echo "AUTH_CANDIDATE_HOST=$candidate_host"
echo "AUTH_REDIRECT_LIST_FORMAT=$allowlist_format"
echo "AUTH_REDIRECT_RULE_COUNT=$allowlist_rule_count"
echo "AUTH_CALLBACK_EXACT_RULE_PRESENT=$exact_rule"
echo "AUTH_PR${AUTH_PREVIEW_PR}_WILDCARD_RULE_PRESENT=$wildcard_rule"
echo "AUTH_CALLBACK_GLOB_MATCHED=$callback_allowed"
echo "AUTH_CALLBACK_ALLOWLISTED=$callback_allowed"
echo "AUTH_CONFIRMATION_TEMPLATE_HAS_TOKEN_HASH=$template_token_hash"
echo "AUTH_CONFIRMATION_TEMPLATE_HAS_EMAIL_TYPE=$template_email_type"
echo "AUTH_CONFIRMATION_TEMPLATE_HAS_CONFIRMATION_URL=$template_confirmation_url"
echo "AUTH_CONFIRMATION_TEMPLATE_HAS_REDIRECT_TO=$template_redirect_to"
echo "AUTH_RECOVERY_TEMPLATE_HAS_TOKEN_HASH=$recovery_token_hash"
echo "AUTH_RECOVERY_TEMPLATE_HAS_REDIRECT_TO=$recovery_redirect_to"
echo "AUTH_RECOVERY_TEMPLATE_USES_CONFIRMATION_URL=$recovery_confirmation_url"
echo "AUTH_RECOVERY_TEMPLATE_RENDERED_URL_CONTRACT=$recovery_url_contract"
echo "AUTH_RECOVERY_TEMPLATE_STRUCTURE=$recovery_structure"

if [[ "$callback_allowed" != true ]]; then
  echo "OWNER_ACTION_REQUIRED: add the exact protected PR${AUTH_PREVIEW_PR} candidate callback or its narrowly scoped wildcard to Supabase Auth redirect URLs." >&2
  exit 1
fi
if [[ "$template_token_hash" != true || "$template_email_type" != true ]]; then
  echo 'OWNER_ACTION_REQUIRED: configure Confirm signup to link the supplied TokenHash to the trusted callback with type=email.' >&2
  exit 1
fi
if [[ "$recovery_token_hash" != true || "$recovery_redirect_to" != true || "$recovery_confirmation_url" == true || "$recovery_url_contract" != true ]]; then
  echo 'OWNER_ACTION_REQUIRED: configure Password recovery to render exactly one TokenHash link to the HTTPS /auth/callback with type=recovery, not the provider ConfirmationURL.' >&2
  exit 1
fi

echo 'HOSTED_AUTH_CONFIRMATION_AUDIT_PASS callback_allowlisted=true signup_token_hash=true recovery_url_contract=true'
