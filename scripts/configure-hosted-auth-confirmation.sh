#!/usr/bin/env bash
set -euo pipefail

: "${SUPABASE_ACCESS_TOKEN:?SUPABASE_ACCESS_TOKEN is required}"
: "${PROJECT_ID:?PROJECT_ID is required}"
: "${AUTH_ORIGIN:?AUTH_ORIGIN is required}"
: "${APPLY_CONFIRMATION:?APPLY_CONFIRMATION is required}"

[[ "$APPLY_CONFIRMATION" == CONFIGURE_PR69_EMAIL_CONFIRMATION ]] || {
  echo 'BLOCKED: exact Auth confirmation configuration phrase is required.' >&2
  exit 1
}
[[ "$AUTH_ORIGIN" =~ ^https://pr69-[0-9a-f]{12}-runfazone-preview\.[a-z0-9-]+\.workers\.dev$ ]] || {
  echo 'BLOCKED: only a protected PR69 candidate origin may be configured.' >&2
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
test -n "$existing_template" || { echo 'BLOCKED: existing Confirm signup template is unavailable.' >&2; exit 1; }
[[ "$allowlist_json" != null && -n "$allowlist_json" ]] || { echo 'BLOCKED: existing Auth redirect allowlist is unavailable.' >&2; exit 1; }

allowlist="$RUNNER_TEMP/hosted-auth-allowlist-before.txt"
if [[ "$(jq -r 'type' <<<"$allowlist_json")" == array ]]; then
  jq -r '.[]' <<<"$allowlist_json" > "$allowlist"
else
  jq -r 'split("\\n")[]' <<<"$allowlist_json" > "$allowlist"
fi

candidate_callback="${AUTH_ORIGIN%/}/auth/callback"
candidate_wildcard='https://pr69-*-runfazone-preview.mondigoted732.workers.dev/auth/callback'
grep -Fxq "$candidate_wildcard" "$allowlist" || printf '%s\n' "$candidate_wildcard" >> "$allowlist"
grep -Fxq "$candidate_callback" "$allowlist" || printf '%s\n' "$candidate_callback" >> "$allowlist"
new_allowlist="$(awk 'NF && !seen[$0]++ { printf "%s%s", sep, $0; sep="\n" }' "$allowlist")"

# This is the documented Supabase server-side confirmation pattern. The
# supplied RedirectTo is the already trusted /auth/callback URL from signup;
# no request-controlled destination is introduced here.
confirmation_template='<h2>Confirm your signup</h2><p>Follow this link to confirm your user:</p><p><a href="{{ .RedirectTo }}?token_hash={{ .TokenHash }}&amp;type=email">Confirm your email address</a></p>'
payload="$(jq -n --arg uri_allow_list "$new_allowlist" --arg template "$confirmation_template" \
  '{uri_allow_list: $uri_allow_list, mailer_templates_confirmation_content: $template}')"

patch_status="$(curl --silent --show-error --max-time 30 -X PATCH \
  --output "$after" --write-out '%{http_code}' \
  -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
  -H 'Content-Type: application/json' -H 'Accept: application/json' \
  --data "$payload" "$api_url")"
if [[ ! "$patch_status" =~ ^2 ]]; then
  api_code="$(jq -r '.code // .error_code // empty' "$after" 2>/dev/null || true)"
  echo "BLOCKED: Auth confirmation configuration update failed (HTTP $patch_status${api_code:+, code=$api_code})." >&2
  exit 1
fi

# Read back the persisted result and verify only the intended invariants.
verify="$(curl --silent --show-error --max-time 30 \
  -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
  -H 'Accept: application/json' "$api_url")"
verify_config="$(jq -c 'if (.result | type) == "object" then .result else . end' <<<"$verify")"
verify_allowlist="$(jq -r '.uri_allow_list // empty' <<<"$verify_config")"
verify_template="$(jq -r '.mailer_templates_confirmation_content // empty' <<<"$verify_config")"
verify_allowlist_hash="$(printf '%s' "$verify_allowlist" | sha256sum | cut -d' ' -f1)"
verify_template_hash="$(printf '%s' "$verify_template" | sha256sum | cut -d' ' -f1)"
[[ "$verify_allowlist" == *"$candidate_wildcard"* && "$verify_allowlist" == *"$candidate_callback"* ]] || {
  echo 'BLOCKED: Auth redirect allowlist read-back did not contain the PR69 callback rules.' >&2
  exit 1
}
verify_template_lower="${verify_template,,}"
[[ "$verify_template_lower" == *token_hash* || "$verify_template_lower" == *tokenhash* ]] || {
  echo 'BLOCKED: Confirm signup template read-back is not TokenHash based.' >&2
  exit 1
}
[[ "$verify_template_lower" == *'type=email'* ]] || {
  echo 'BLOCKED: Confirm signup template read-back is missing type=email.' >&2
  exit 1
}

echo "HOSTED_AUTH_CONFIRMATION_CONFIGURED project=$PROJECT_ID allowlist_sha256=$verify_allowlist_hash template_sha256=$verify_template_hash token_hash=true type=email=true"
