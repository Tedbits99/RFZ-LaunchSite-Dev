#!/usr/bin/env bash
set -euo pipefail

source "$(dirname "$0")/lib/auth-preview-origin.sh"

auth_preview_origin_parse 'https://pr69-0123456789ab-runfazone-preview.mondigoted732.workers.dev'
[[ "$AUTH_PREVIEW_PR" == 69 && "$AUTH_PREVIEW_SHA_PREFIX" == 0123456789ab ]]
[[ "$AUTH_PREVIEW_CALLBACK_WILDCARD" == 'https://pr69-*-runfazone-preview.mondigoted732.workers.dev/auth/callback' ]]

auth_preview_origin_parse 'https://pr82-abcdef012345-runfazone-preview.mondigoted732.workers.dev'
[[ "$AUTH_PREVIEW_PR" == 82 && "$AUTH_PREVIEW_SHA_PREFIX" == abcdef012345 ]]
[[ "$AUTH_PREVIEW_CALLBACK_WILDCARD" == 'https://pr82-*-runfazone-preview.mondigoted732.workers.dev/auth/callback' ]]

for invalid in \
  'https://pr83-0123456789ab-runfazone-preview.mondigoted732.workers.dev' \
  'https://pr82-0123456789a-runfazone-preview.mondigoted732.workers.dev' \
  'https://pr82-0123456789ab-runfazone-preview.attacker.workers.dev' \
  'http://pr82-0123456789ab-runfazone-preview.mondigoted732.workers.dev' \
  'https://pr82-0123456789ab-runfazone-preview.mondigoted732.workers.dev/path'; do
  if auth_preview_origin_parse "$invalid"; then
    echo 'AUTH_PREVIEW_ORIGIN_TEST_FAIL unexpected origin acceptance' >&2
    exit 1
  fi
done

echo 'AUTH_PREVIEW_ORIGIN_TEST_PASS allowed_prs=69,82 account_host=pinned invalid_origins=rejected'
