#!/usr/bin/env bash
set -euo pipefail

# Real disposable PostgreSQL backup/restore rehearsal. This creates two
# uniquely named containers, never uses a hosted endpoint, and removes only
# containers carrying its unique disposable-test label.

project_root="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
backup_tool="$project_root/scripts/backup-restore-disposable.sh"
test_root="$(mktemp -d "${RUNNER_TEMP:-${TMPDIR:-/tmp}}/runfazone-backup-e2e.XXXXXX")"
token="$(date -u +%Y%m%d%H%M%S)-${RANDOM}-${RANDOM}"
label_key="runfazone.disposable-backup-test"
label_value="$token"
source_container="runfazone-backup-source-$token"
restore_container="runfazone-backup-restore-$token"
unrelated_container="runfazone-backup-unrelated-$token"
source_db="runfazone_source_${RANDOM}"
restore_db="runfazone_restore_${RANDOM}"
password="synthetic_${RANDOM}_${RANDOM}"
source_port=""
restore_port=""
unrelated_exists=false

die() { echo "ERROR: $*" >&2; exit 1; }
require_command() { command -v "$1" >/dev/null 2>&1 || die "$1 is required"; }

container_has_label() {
  [ "$(docker inspect --format "{{index .Config.Labels \"$label_key\"}}" "$1" 2>/dev/null || true)" = "$label_value" ]
}

remove_owned_container() {
  local container="$1"
  if docker inspect "$container" >/dev/null 2>&1; then
    container_has_label "$container" || { echo "ERROR: refusing to remove unowned container $container" >&2; return 1; }
    docker rm --force "$container" >/dev/null
  fi
}

cleanup() {
  local status=$?
  set +e
  remove_owned_container "$source_container"
  remove_owned_container "$restore_container"
  if [ "$unrelated_exists" = true ] && docker inspect "$unrelated_container" >/dev/null 2>&1; then
    docker rm --force "$unrelated_container" >/dev/null
  fi
  rm -rf -- "$test_root"
  exit "$status"
}
trap cleanup EXIT

start_postgres() {
  local container="$1" database="$2" port_var="$3"
  docker run --detach --rm \
    --name "$container" \
    --label "$label_key=$label_value" \
    --env POSTGRES_PASSWORD="$password" \
    --env POSTGRES_DB="$database" \
    --publish 127.0.0.1::5432 \
    postgres:16-alpine >/dev/null
  local port=""
  for _ in $(seq 1 60); do
    port="$(docker inspect --format '{{(index (index .NetworkSettings.Ports "5432/tcp") 0).HostPort}}' "$container" 2>/dev/null || true)"
    if [ -n "$port" ] && PGPASSWORD="$password" pg_isready -h 127.0.0.1 -p "$port" -U postgres -d "$database" >/dev/null 2>&1; then
      printf -v "$port_var" '%s' "$port"
      return 0
    fi
    sleep 1
  done
  die "PostgreSQL container did not become ready: $container"
}

psql_run() {
  local port="$1" database="$2"
  shift 2
  PGPASSWORD="$password" psql --no-psqlrc --set ON_ERROR_STOP=1 -h 127.0.0.1 -p "$port" -U postgres -d "$database" "$@"
}

require_command docker
require_command pg_isready
require_command psql
require_command pg_restore
require_command sha256sum
require_command jq
docker image inspect postgres:16-alpine >/dev/null 2>&1 || docker pull postgres:16-alpine >/dev/null

start_postgres "$source_container" "$source_db" source_port
source_url="postgresql://postgres:${password}@127.0.0.1:${source_port}/${source_db}"

cat >"$test_root/fixture.sql" <<'SQL'
CREATE SCHEMA supabase_migrations;
CREATE TABLE public.games (id uuid PRIMARY KEY, slug text NOT NULL UNIQUE, name text NOT NULL);
CREATE TABLE public.orders (
  id uuid PRIMARY KEY,
  game_id uuid NOT NULL REFERENCES public.games(id),
  reference text NOT NULL UNIQUE,
  total_cents integer NOT NULL CHECK (total_cents >= 0),
  status text NOT NULL DEFAULT 'WAITING_PAYMENT'
);
CREATE TABLE public.order_timeline (
  id uuid PRIMARY KEY,
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  status text NOT NULL,
  note text NOT NULL DEFAULT ''
);
CREATE TABLE supabase_migrations.schema_migrations (version text PRIMARY KEY, name text NOT NULL);
CREATE FUNCTION public.order_total_cents(p_order_id uuid)
RETURNS integer LANGUAGE sql STABLE AS $$ SELECT total_cents FROM public.orders WHERE id = p_order_id; $$;
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
CREATE POLICY orders_customer_read ON public.orders FOR SELECT USING (true);
INSERT INTO public.games VALUES ('00000000-0000-0000-0000-000000000001', 'mobile-legends', 'Mobile Legends');
INSERT INTO public.orders VALUES ('00000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000001', 'RFZ-TEST-0001', 12500, 'WAITING_PAYMENT');
INSERT INTO public.order_timeline VALUES ('00000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000002', 'WAITING_PAYMENT', 'synthetic fixture');
INSERT INTO supabase_migrations.schema_migrations VALUES ('20260927062024', 'runfazone_core_catalog'), ('20260928071820', 'order_fulfillment_schema');
SQL
psql_run "$source_port" "$source_db" --file "$test_root/fixture.sql" >/dev/null

backup_file="$test_root/runfazone-source.dump"
DATABASE_URL="$source_url" BACKUP_FILE="$backup_file" "$backup_tool" export >/dev/null
[ -s "$backup_file" ] || die "pg_dump did not create a dump"
pg_restore --list "$backup_file" >"$test_root/archive.list"
grep -q 'TABLE public.games' "$test_root/archive.list" || die "dump is missing games table"
grep -q 'TABLE public.orders' "$test_root/archive.list" || die "dump is missing orders table"
grep -q 'FUNCTION public.order_total_cents' "$test_root/archive.list" || die "dump is missing function"
expected_sha="$(awk -F= '$1 == "sha256" { print $2 }' "$backup_file.manifest")"
actual_sha="$(sha256sum "$backup_file" | awk '{print $1}')"
[ -n "$expected_sha" ] && [ "$expected_sha" = "$actual_sha" ] || die "dump checksum mismatch"

start_postgres "$restore_container" postgres restore_port
restore_db="runfazone_restore_${RANDOM}"
PGPASSWORD="$password" createdb -h 127.0.0.1 -p "$restore_port" -U postgres "$restore_db"
restore_url="postgresql://postgres:${password}@127.0.0.1:${restore_port}/${restore_db}"
cat >"$test_root/restore-proof.json" <<EOF
{"instance_id":"$restore_container","database":"$restore_db","purpose":"runfazone-disposable-restore","expires_at":"$(date -u -d '+15 minutes' --iso-8601=seconds)"}
EOF
RFZ_DISPOSABLE_RESTORE_CONFIRM=YES RESTORE_DATABASE_URL="$restore_url" \
  RESTORE_PROOF_FILE="$test_root/restore-proof.json" BACKUP_FILE="$backup_file" \
  "$backup_tool" restore-verify >/dev/null

psql_run "$restore_port" "$restore_db" --command="
DO \$$ BEGIN
  IF (SELECT count(*) FROM public.games) <> 1 THEN RAISE EXCEPTION 'games row count mismatch'; END IF;
  IF (SELECT count(*) FROM public.orders) <> 1 THEN RAISE EXCEPTION 'orders row count mismatch'; END IF;
  IF (SELECT public.order_total_cents('00000000-0000-0000-0000-000000000002')) <> 12500 THEN RAISE EXCEPTION 'function result mismatch'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'orders_total_cents_check') THEN RAISE EXCEPTION 'constraint missing'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'orders' AND policyname = 'orders_customer_read') THEN RAISE EXCEPTION 'policy missing'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'order_total_cents') THEN RAISE EXCEPTION 'function missing'; END IF;
  IF (SELECT count(*) FROM supabase_migrations.schema_migrations) <> 2 THEN RAISE EXCEPTION 'migration ledger mismatch'; END IF;
  IF (SELECT reference FROM public.orders LIMIT 1) <> 'RFZ-TEST-0001' THEN RAISE EXCEPTION 'sample data mismatch'; END IF;
END \$$;" >/dev/null

if RFZ_DISPOSABLE_RESTORE_CONFIRM=YES RESTORE_DATABASE_URL="$restore_url" \
  RESTORE_PROOF_FILE="$test_root/restore-proof.json" BACKUP_FILE="$test_root/missing.dump" \
  "$backup_tool" restore-verify >/dev/null 2>&1; then die "missing dump was accepted"; fi
cp -- "$backup_file" "$test_root/corrupt.dump"
head -c 64 "$backup_file" >"$test_root/corrupt.dump"
sha256sum "$test_root/corrupt.dump" | awk '{print "sha256=" $1}' >"$test_root/corrupt.dump.manifest"
if RFZ_DISPOSABLE_RESTORE_CONFIRM=YES RESTORE_DATABASE_URL="$restore_url" \
  RESTORE_PROOF_FILE="$test_root/restore-proof.json" BACKUP_FILE="$test_root/corrupt.dump" \
  "$backup_tool" restore-verify >/dev/null 2>&1; then die "corrupt dump was accepted"; fi
printf 'not a PostgreSQL archive' >"$test_root/incompatible.dump"
sha256sum "$test_root/incompatible.dump" | awk '{print "sha256=" $1}' >"$test_root/incompatible.dump.manifest"
if RFZ_DISPOSABLE_RESTORE_CONFIRM=YES RESTORE_DATABASE_URL="$restore_url" \
  RESTORE_PROOF_FILE="$test_root/restore-proof.json" BACKUP_FILE="$test_root/incompatible.dump" \
  "$backup_tool" restore-verify >/dev/null 2>&1; then die "incompatible dump was accepted"; fi

docker create --name "$unrelated_container" --label "$label_key=unrelated" postgres:16-alpine >/dev/null
unrelated_exists=true
remove_owned_container "$source_container"
remove_owned_container "$restore_container"
docker inspect "$unrelated_container" >/dev/null 2>&1 || die "cleanup touched unrelated container"
docker rm --force "$unrelated_container" >/dev/null
unrelated_exists=false
echo "DISPOSABLE_BACKUP_RESTORE_E2E_PASS"
