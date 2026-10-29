#!/usr/bin/env bash
set -euo pipefail

merge_pattern='gh[[:space:]]+pr[[:space:]]+merge|enablePullRequestAutoMerge|mergePullRequest|/pulls/[^[:space:]]+/merge'

contains_merge_automation() {
  grep -Eiq -- "$merge_pattern" <<<"$1"
}

assert_detects_merge_automation() {
  local sample="$1"
  if ! contains_merge_automation "$sample"; then
    echo 'ERROR: merge-automation detector missed a dangerous command shape.' >&2
    return 1
  fi
}

self_test() {
  assert_detects_merge_automation 'gh pr merge 82 --squash'
  assert_detects_merge_automation 'gh api -X PUT repos/acme/site/pulls/82/merge'
  assert_detects_merge_automation 'github.graphql("mutation { mergePullRequest }")'
  if contains_merge_automation 'gh pr view 82 --json state'; then
    echo 'ERROR: merge-automation detector rejected a read-only PR query.' >&2
    return 1
  fi
  echo 'MANUAL_MERGE_POLICY_SELF_TEST_PASS'
}

if [[ "${1:-}" == '--self-test' ]]; then
  self_test
  exit 0
fi
if [[ "$#" -ne 0 ]]; then
  echo 'ERROR: unexpected argument.' >&2
  exit 2
fi

for required_path in \
  .github/workflows/auto-merge-codex.yml \
  scripts/discover-codex-pr.sh \
  scripts/verify-auto-merge-gates.sh; do
  if [[ -e "$required_path" ]]; then
    echo "BLOCKED: obsolete auto-merge implementation remains: $required_path" >&2
    exit 1
  fi
done

while IFS= read -r -d '' path; do
  [[ "$path" == 'scripts/verify-manual-merge-only.sh' ]] && continue
  if grep -nEiq -- "$merge_pattern" "$path"; then
    echo "BLOCKED: automated PR merge implementation found in $path" >&2
    exit 1
  else
    grep_status=$?
    [[ "$grep_status" -eq 1 ]] || {
      echo "ERROR: could not inspect $path" >&2
      exit "$grep_status"
    }
  fi
done < <(find .github/workflows scripts -type f -print0)

self_test
echo 'OWNER_CONTROLLED_MANUAL_MERGE_POLICY_PASS'
