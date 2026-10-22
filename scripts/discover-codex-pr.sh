#!/usr/bin/env bash
set -euo pipefail

# workflow_run fires on both PR validation and main pushes. Only PR validation
# can yield an auto-merge candidate. Never query the flaky commit-to-PR API for
# main pushes, and match PRs by exact head SHA from an authenticated PR listing.
parse_response() {
  local response="$1" repository="$2" head_sha="$3"
  if [[ -z "$response" ]]; then
    echo "BLOCKED: open PR listing was empty instead of valid JSON" >&2
    return 1
  fi
  # gh api --paginate can emit multiple JSON arrays, one per page.
  if ! jq -s -e 'length > 0 and all(.[]; type == "array")' <<<"$response" >/dev/null 2>&1; then
    echo "BLOCKED: open PR API returned malformed JSON" >&2
    printf 'response_bytes=%s\n' "${#response}" >&2
    return 1
  fi
  jq -sr --arg repository "$repository" --arg head_sha "$head_sha" '
    [.[][] | select(
      .state == "open"
      and .base.ref == "main"
      and .head.sha == $head_sha
      and .head.repo.full_name == $repository
      and ((.head.ref // "") | startswith("codex/"))
      and .draft == false
    )] | first | .number // empty
  ' <<<"$response"
}

self_test() {
  local repo="Tedbits99/RFZ-LaunchSite-Dev"
  local sha="0123456789012345678901234567890123456789"
  local valid='[{"number":12,"state":"open","base":{"ref":"main"},"head":{"sha":"0123456789012345678901234567890123456789","repo":{"full_name":"Tedbits99/RFZ-LaunchSite-Dev"},"ref":"codex/test"},"draft":false}]'
  [[ -z "$(parse_response '[]' "$repo" "$sha")" ]]
  [[ "$(parse_response "$valid" "$repo" "$sha")" == "12" ]]
  [[ "$(parse_response "$valid"$'\n''[]' "$repo" "$sha")" == "12" ]]
  [[ -z "$(parse_response "$valid" "$repo" "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")" ]]
  [[ -z "$(parse_response "${valid/Tedbits99\/RFZ-LaunchSite-Dev/outsider\/repo}" "$repo" "$sha")" ]]
  [[ -z "$(parse_response "${valid/codex\/test/feature\/test}" "$repo" "$sha")" ]]
  [[ -z "$(parse_response "${valid/\"draft\":false/\"draft\":true}" "$repo" "$sha")" ]]
  ! parse_response "" "$repo" "$sha" >/dev/null 2>&1
  ! parse_response "{" "$repo" "$sha" >/dev/null 2>&1
  ! parse_response '{"error":"unauthorized"}' "$repo" "$sha" >/dev/null 2>&1
  echo "DISCOVER_CODEX_PR_SELF_TEST_PASS"
}

if [[ "${1:-}" == "--self-test" ]]; then self_test; exit 0; fi

repository="${REPOSITORY:?REPOSITORY is required}"
head_sha="${HEAD_SHA:?HEAD_SHA is required}"

if [[ "${SOURCE_EVENT:-}" == "push" && "${SOURCE_BRANCH:-}" == "main" ]]; then
  echo "NO_PR: main push does not represent an open PR head" >&2
  exit 0
fi

response="$(gh api --paginate "repos/$repository/pulls?state=open&per_page=100" \
  2> >(tee "${RUNNER_TEMP:-/tmp}/discover-pr-error.log" >&2))" || {
  echo "BLOCKED: open PR API request failed" >&2
  exit 1
}
parse_response "$response" "$repository" "$head_sha"
