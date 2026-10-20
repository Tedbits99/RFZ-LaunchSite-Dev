#!/usr/bin/env bash
set -euo pipefail

# Manual logical backup and disposable restore rehearsal.
# Credentials are supplied only through the environment at invocation time.
# Backup files and manifests must remain outside this repository.

project_root="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
command_name="${1:-}"
backup_file="${BACKUP_FILE:-}"

die() { echo "ERROR: $*" >&2; exit 2; }
require_command() { command -v "$1" >/dev/null 2>&1 || die "$1 is required"; }

parse_database_url() {
  local database_url="$1" parsed
  parsed="$(printf '%s' "$database_url" | node -e '
let raw = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", chunk => raw += chunk);
process.stdin.on("end", () => {
  try {
    const u = new URL(raw);
    if (!["postgres:", "postgresql:"].includes(u.protocol)
      || !u.hostname || !u.pathname || u.pathname === "/"
      || u.search || u.hash || /[\s\u0000-\u001f\u007f]/.test(raw)) process.exit(1);
    process.stdout.write(`${u.hostname}\t${u.port || "5432"}\t${u.pathname.slice(1)}\n`);
  } catch { process.exit(1); }
});
' 2>/dev/null)" || die "DATABASE_URL is not a valid PostgreSQL URL"
  IFS=$'\t' read -r database_host database_port database_name <<<"$parsed"
  [ -n "$database_host" ] && [ -n "$database_port" ] && [ -n "$database_name" ] || die "DATABASE_URL is incomplete"
}

is_loopback_host() {
  case "$1" in localhost|127.0.0.1|\[::1\]) return 0 ;; *) return 1 ;; esac
}

ensure_output_is_external() {
  local target="$1" absolute_target
  absolute_target="$(CDPATH= cd -- "$(dirname -- "$target")" 2>/dev/null && pwd)/$(basename -- "$target")" || die "cannot resolve backup output directory"
  case "$absolute_target" in "$project_root"|"$project_root"/*) return 1 ;; esac
}

self_test() {
  local temp_root
  temp_root="$(mktemp -d "${TMPDIR:-/tmp}/runfazone-backup-test.XXXXXX")"
  trap 'rm -rf "$temp_root"' EXIT
  parse_database_url 'postgresql://postgres:synthetic@127.0.0.1:54322/postgres'
  is_loopback_host "$database_host"
  ensure_output_is_external "$temp_root/test.dump" || die "self-test rejected an external backup path"
  if ensure_output_is_external "$project_root/backup.dump"; then die "self-test accepted a repository backup path"; fi
  parse_database_url 'postgresql://postgres:synthetic@remote.example:5432/postgres'
  rm -rf -- "$temp_root"
  trap - EXIT
  echo "BACKUP_RESTORE_WORKFLOW_SELF_TEST_PASS"
}

export_backup() {
  require_command node; require_command pg_dump; require_command sha256sum
  [ -n "${DATABASE_URL:-}" ] || die "DATABASE_URL is required"
  parse_database_url "$DATABASE_URL"
  if ! is_loopback_host "$database_host" && [ "${RFZ_REMOTE_EXPORT_APPROVED:-}" != "YES" ]; then
    die "remote export requires RFZ_REMOTE_EXPORT_APPROVED=YES"
  fi
  local output_dir="${BACKUP_OUTPUT_DIR:-${TMPDIR:-/tmp}/runfazone-backups}"
  mkdir -p -- "$output_dir"; chmod 700 -- "$output_dir"
  backup_file="${BACKUP_FILE:-$output_dir/runfazone-$(date -u +%Y%m%dT%H%M%SZ).dump}"
  ensure_output_is_external "$backup_file" || die "backup output must be outside the repository"
  [ ! -e "$backup_file" ] || die "backup file already exists; choose a new path"
  mkdir -p -- "$(dirname -- "$backup_file")"; chmod 700 -- "$(dirname -- "$backup_file")"
  local partial_file="${backup_file}.partial"
  rm -f -- "$partial_file"
  umask 077
  pg_dump --format=custom --no-owner --no-privileges --dbname="$DATABASE_URL" --file="$partial_file"
  mv -- "$partial_file" "$backup_file"; chmod 600 -- "$backup_file"
  local digest; digest="$(sha256sum -- "$backup_file" | awk '{print $1}')"
  cat >"${backup_file}.manifest" <<EOF
format=custom
created_at_utc=$(date -u +%Y-%m-%dT%H:%M:%SZ)
source_host=$database_host
source_port=$database_port
source_database=$database_name
sha256=$digest
EOF
  chmod 600 -- "${backup_file}.manifest"
  printf 'BACKUP_CREATED=%s\nMANIFEST_CREATED=%s\n' "$backup_file" "${backup_file}.manifest"
}

restore_verify() {
  require_command node; require_command pg_restore; require_command psql
  [ -n "$backup_file" ] || die "BACKUP_FILE is required"
  [ -f "$backup_file" ] || die "backup file does not exist"
  [ "${RFZ_DISPOSABLE_RESTORE_CONFIRM:-}" = "YES" ] || die "set RFZ_DISPOSABLE_RESTORE_CONFIRM=YES for a disposable restore"
  [ -n "${RESTORE_DATABASE_URL:-}" ] || die "RESTORE_DATABASE_URL is required"
  parse_database_url "$RESTORE_DATABASE_URL"
  is_loopback_host "$database_host" || die "restore target must be loopback"
  [ "$database_name" = "postgres" ] || die "restore target database must be postgres"
  local manifest="${backup_file}.manifest" expected actual
  [ -f "$manifest" ] || die "backup manifest is required"
  expected="$(awk -F= '$1 == "sha256" { print $2 }' "$manifest")"
  actual="$(sha256sum -- "$backup_file" | awk '{print $1}')"
  [ -n "$expected" ] && [ "$expected" = "$actual" ] || die "backup checksum does not match manifest"
  pg_restore --clean --if-exists --no-owner --no-privileges --exit-on-error --single-transaction \
    --dbname="$RESTORE_DATABASE_URL" "$backup_file"
  local table_count migration_count
  table_count="$(psql --no-psqlrc --tuples-only --no-align --dbname="$RESTORE_DATABASE_URL" \
    --command="SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public';")"
  migration_count="$(psql --no-psqlrc --tuples-only --no-align --dbname="$RESTORE_DATABASE_URL" \
    --command="SELECT count(*) FROM supabase_migrations.schema_migrations;" 2>/dev/null || true)"
  case "$table_count" in *[!0-9]*|'') die "restore verification returned an invalid table count" ;; esac
  printf 'RESTORE_VERIFIED=YES\nPUBLIC_TABLE_COUNT=%s\nMIGRATION_HISTORY_COUNT=%s\n' "$table_count" "${migration_count:-unavailable}"
}

case "$command_name" in
  --self-test) self_test ;;
  export) export_backup ;;
  restore-verify) restore_verify ;;
  *)
    cat >&2 <<'USAGE'
Usage:
  scripts/backup-restore-disposable.sh --self-test
  DATABASE_URL=... BACKUP_FILE=/outside/repo/file.dump scripts/backup-restore-disposable.sh export
  RFZ_DISPOSABLE_RESTORE_CONFIRM=YES RESTORE_DATABASE_URL=postgresql://... \
    BACKUP_FILE=/outside/repo/file.dump scripts/backup-restore-disposable.sh restore-verify
USAGE
    exit 2
    ;;
esac
