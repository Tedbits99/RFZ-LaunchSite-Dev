#!/usr/bin/env bash
set -euo pipefail

# Discover an open, same-repository codex PR for a completed workflow head.
# workflow_run also fires for pushes to main, so an empty API response means
# there is no candidate. Non-empty malformed JSON fails closed.
parse_response() {
  local response="$1" repository="$2"
  if [[ -z "$response" ]]; then
    echo "NO_PR: commit-to-PR API returned an empty response" >&2
    return 0
  fi
  if ! jq -e 'type == "array"' <<<"$response" >/dev/null 2>&1; then
    echo "BLOCKED: commit-to-PR API returned invalid JSON" >&2
    printf 'response_bytes=%s\n' "${#response}" >&2
    return 1
  fi
  jq -r --arg repository "$repository" '[.[] | select(.state == "open" and .base.ref == "main" and .head.repo.full_name == $repository and (.head.ref | startswith("codex/")) and .draft == false)] | first | .number // empty' <<<"$response"
}

self_test() {
  local repo="Tedbits99/RFZ-LaunchSite-Dev"
  [[ -z "$(parse_response "" "$repo")" ]]
  [[ -z "$(parse_response '[]' "$repo")" ]]
  ! parse_response '{' "$repo" >/dev/null 2>&1
  [[ "$(parse_response '[{"number":12,"state":"open","base":{"ref":"main"},"head":{"repo":{"full_name":"Tedbits99/RFZ-LaunchSite-Dev"},"ref":"codex/test"},"draft":false}]' "$repo")" == "12" ]]
  [[ -z "$(parse_response '[{"number":13,"state":"open","base":{"ref":"main"},"head":{"repo":{"full_name":"someone-else/repo"},"ref":"codex/test"},"draft":false}]' "$repo")" ]]
  echo "DISCOVER_CODEX_PR_SELF_TEST_PASS"
}

if [[ "${1:-}" == "--self-test" ]]; then self_test; exit 0; fi

repository="${REPOSITORY:?REPOSITORY is required}"
head_sha="${HEAD_SHA:?HEAD_SHA is required}"
response="$(gh api "repos/$repository/commits/$head_sha/pulls" 2> >(tee "$RUNNER_TEMP/discover-pr-error.log" >&2))" || {
  echo "BLOCKED: commit-to-PR API request failed for head $head_sha" >&2
  exit 1
}
parse_response "$response" "$repository"
