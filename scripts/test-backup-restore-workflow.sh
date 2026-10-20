#!/usr/bin/env bash
set -euo pipefail

project_root="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
"$project_root/scripts/backup-restore-disposable.sh" --self-test

if RFZ_DISPOSABLE_RESTORE_CONFIRM=YES \
  RESTORE_DATABASE_URL='postgresql://postgres:synthetic@203.0.113.10:54322/postgres' \
  BACKUP_FILE="$project_root/should-not-exist.dump" \
  "$project_root/scripts/backup-restore-disposable.sh" restore-verify >/dev/null 2>&1; then
  echo "ERROR: restore workflow accepted a non-loopback target" >&2; exit 1
fi
if DATABASE_URL='postgresql://postgres:synthetic@203.0.113.10:54322/postgres' \
  BACKUP_FILE="$project_root/should-not-exist.dump" \
  "$project_root/scripts/backup-restore-disposable.sh" export >/dev/null 2>&1; then
  echo "ERROR: export workflow accepted an unapproved remote target" >&2; exit 1
fi
echo "BACKUP_RESTORE_WORKFLOW_TEST_PASS"
