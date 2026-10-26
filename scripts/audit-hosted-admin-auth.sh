#!/usr/bin/env bash
set -euo pipefail

: "${SUPABASE_URL:?SUPABASE_URL is required}"
: "${SUPABASE_SERVICE_ROLE_KEY:?SUPABASE_SERVICE_ROLE_KEY is required}"
: "${SUPABASE_DB_PASSWORD:?SUPABASE_DB_PASSWORD is required}"
: "${SUPABASE_POOLER_HOST:?SUPABASE_POOLER_HOST is required}"
: "${SUPABASE_POOLER_PORT:?SUPABASE_POOLER_PORT is required}"
: "${SUPABASE_DB_USER:?SUPABASE_DB_USER is required}"
: "${ADMIN_EMAIL:?ADMIN_EMAIL is required}"

normalized_email="$(printf '%s' "$ADMIN_EMAIL" | tr '[:upper:]' '[:lower:]' | sed 's/[[:space:]]//g')"
[[ "$normalized_email" =~ ^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$ ]] || {
  echo 'BLOCKED: admin_email is not a valid email address.' >&2
  exit 1
}

pages_file="$(mktemp)"
trap 'rm -f "$pages_file"' EXIT

for page in $(seq 1 100); do
  page_json="$(curl --fail --silent --show-error \
    -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" \
    -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
    -H 'Accept: application/json' \
    "$SUPABASE_URL/auth/v1/admin/users?per_page=100&page=$page")"
  jq -e '.users | type == "array"' <<<"$page_json" >/dev/null || {
    echo 'BLOCKED: Supabase Auth admin user response had an unexpected shape.' >&2
    exit 1
  }
  printf '%s\n' "$page_json" >> "$pages_file"
  page_count="$(jq '.users | length' <<<"$page_json")"
  (( page_count < 100 )) && break
done

matches="$(jq -s -c --arg email "$normalized_email" '[.[].users[] | select((.email // "" | ascii_downcase) == $email)]' "$pages_file")"
match_count="$(jq 'length' <<<"$matches")"
if [[ "$match_count" != 1 ]]; then
  if [[ "$match_count" == 0 ]]; then
    echo 'ADMIN_AUTH_AUDIT_FAIL reason=auth_user_missing' >&2
  else
    echo 'ADMIN_AUTH_AUDIT_FAIL reason=duplicate_auth_email' >&2
  fi
  exit 1
fi

user_id="$(jq -r '.[0].id // empty' <<<"$matches")"
confirmed="$(jq -r '.[0].email_confirmed_at != null' <<<"$matches")"
password_provider="$(jq -r '([.[0].identities[]?.provider?] + [.[0].app_metadata.providers[]?]) | any(. == "email" or . == "password")' <<<"$matches")"
[[ "$user_id" =~ ^[0-9a-fA-F-]{36}$ ]] || {
  echo 'BLOCKED: Supabase Auth returned an invalid user identifier.' >&2
  exit 1
}

db_connection="host=$SUPABASE_POOLER_HOST port=$SUPABASE_POOLER_PORT user=$SUPABASE_DB_USER dbname=postgres sslmode=require connect_timeout=10"
admin_state="$(PGPASSWORD="$SUPABASE_DB_PASSWORD" psql "$db_connection" \
  -v ON_ERROR_STOP=1 -v auth_uid="$user_id" -v auth_email="$normalized_email" -Atqc \
  "SELECT json_build_object(
    'uuid_match', EXISTS (SELECT 1 FROM public.admins WHERE id = :'auth_uid'::uuid),
    'email_match', EXISTS (SELECT 1 FROM public.admins WHERE id = :'auth_uid'::uuid AND lower(trim(email)) = lower(:'auth_email')),
    'active', COALESCE((SELECT is_active FROM public.admins WHERE id = :'auth_uid'::uuid LIMIT 1), false),
    'role', COALESCE((SELECT role FROM public.admins WHERE id = :'auth_uid'::uuid LIMIT 1), ''),
    'auth_email_match', EXISTS (SELECT 1 FROM auth.users WHERE id = :'auth_uid'::uuid AND lower(email) = lower(:'auth_email'))
  )")"

jq -e '.uuid_match and .email_match and .active and (.role == "ADMIN" or .role == "SUPER_ADMIN") and .auth_email_match' <<<"$admin_state" >/dev/null || {
  echo 'ADMIN_AUTH_AUDIT_FAIL reason=admin_identity_mismatch_or_inactive' >&2
  exit 1
}

[[ "$confirmed" == true ]] || {
  echo 'ADMIN_AUTH_AUDIT_FAIL reason=email_not_confirmed' >&2
  exit 1
}
[[ "$password_provider" == true ]] || {
  echo 'ADMIN_AUTH_AUDIT_FAIL reason=password_provider_missing' >&2
  exit 1
}

role="$(jq -r '.role' <<<"$admin_state")"
echo "ADMIN_AUTH_AUDIT_PASS auth_user_exists=true uuid_match=true email_confirmed=true password_provider=true admin_role=$role active=true"
