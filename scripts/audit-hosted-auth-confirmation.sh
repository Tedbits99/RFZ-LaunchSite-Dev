#!/usr/bin/env bash
set -euo pipefail

: "${SUPABASE_ACCESS_TOKEN:?SUPABASE_ACCESS_TOKEN is required}"
: "${PROJECT_ID:?PROJECT_ID is required}"
: "${AUTH_ORIGIN:?AUTH_ORIGIN is required}"

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

allowlist="$RUNNER_TEMP/hosted-auth-allowlist.txt"
if [[ "$(jq -r 'type' <<<"$allowlist_json")" == array ]]; then
  jq -r '.[]' <<<"$allowlist_json" > "$allowlist"
else
  jq -r 'split("\\n")[]' <<<"$allowlist_json" > "$allowlist"
fi

# Supabase redirect rules use * as the documented wildcard. Match the exact
# callback against each rule without echoing the rules themselves.
callback_allowed="$(python3 - "$callback_url" "$allowlist" <<'PY'
import re
import sys

callback, path = sys.argv[1:]
for raw in open(path, encoding='utf-8'):
    rule = raw.strip()
    if not rule:
        continue
    pattern = '^' + re.escape(rule).replace(r'\*', '.*') + '$'
    if re.fullmatch(pattern[1:-1], callback):
        print('true')
        raise SystemExit(0)
print('false')
PY
)"

template_lower="${template,,}"
template_token_hash=false
template_email_type=false
template_confirmation_url=false
template_redirect_to=false
[[ "$template_lower" == *tokenhash* || "$template_lower" == *token_hash* ]] && template_token_hash=true
[[ "$template_lower" == *'type=email'* ]] && template_email_type=true
[[ "$template_lower" == *confirmationurl* ]] && template_confirmation_url=true
[[ "$template_lower" == *redirectto* ]] && template_redirect_to=true

site_origin="$(python3 - "$site_url" <<'PY'
from urllib.parse import urlsplit
import sys
parsed = urlsplit(sys.argv[1])
print(f'{parsed.scheme}://{parsed.netloc}')
PY
)"
candidate_host="$(python3 - "$callback_url" <<'PY'
from urllib.parse import urlsplit
import sys
print(urlsplit(sys.argv[1]).netloc)
PY
)"

echo "AUTH_CONFIG_PROJECT=$PROJECT_ID"
echo "AUTH_SITE_ORIGIN=$site_origin"
echo "AUTH_CANDIDATE_HOST=$candidate_host"
echo "AUTH_CALLBACK_ALLOWLISTED=$callback_allowed"
echo "AUTH_CONFIRMATION_TEMPLATE_HAS_TOKEN_HASH=$template_token_hash"
echo "AUTH_CONFIRMATION_TEMPLATE_HAS_EMAIL_TYPE=$template_email_type"
echo "AUTH_CONFIRMATION_TEMPLATE_HAS_CONFIRMATION_URL=$template_confirmation_url"
echo "AUTH_CONFIRMATION_TEMPLATE_HAS_REDIRECT_TO=$template_redirect_to"

if [[ "$callback_allowed" != true ]]; then
  echo 'OWNER_ACTION_REQUIRED: add the exact protected candidate callback or a narrowly scoped PR69 wildcard to Supabase Auth redirect URLs.' >&2
  exit 1
fi
if [[ "$template_token_hash" != true || "$template_email_type" != true ]]; then
  echo 'OWNER_ACTION_REQUIRED: configure Confirm signup to link the supplied TokenHash to the trusted callback with type=email.' >&2
  exit 1
fi

echo 'HOSTED_AUTH_CONFIRMATION_AUDIT_PASS callback_allowlisted=true token_hash_template=true type=email=true'
