#!/usr/bin/env bash

# The only preview origins that may be added to hosted Supabase Auth are the
# immutable candidates built for the explicitly approved draft PRs. Keep the
# Worker/account suffix pinned so an arbitrary host can never enter the Auth
# redirect allowlist.
auth_preview_origin_parse() {
  local origin="${1:-}"
  if [[ "$origin" =~ ^https://pr(69|82)-([0-9a-f]{12})-runfazone-preview\.mondigoted732\.workers\.dev$ ]]; then
    AUTH_PREVIEW_PR="${BASH_REMATCH[1]}"
    AUTH_PREVIEW_SHA_PREFIX="${BASH_REMATCH[2]}"
    AUTH_PREVIEW_ORIGIN="$origin"
    AUTH_PREVIEW_CALLBACK_WILDCARD="https://pr${AUTH_PREVIEW_PR}-*-runfazone-preview.mondigoted732.workers.dev/auth/callback"
    return 0
  fi
  return 1
}
