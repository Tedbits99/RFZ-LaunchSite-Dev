#!/usr/bin/env bash
set -euo pipefail

project_root="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
expected_migration_sha256='f6cb81a1d8f7f91551c1d91f678624ff7023b74e7be6b55e61fa8b78844701a9'
migration_file="$project_root/supabase/migrations/20261028113000_revoke_browser_table_ddl_privileges.sql"

actual_migration_sha256="$(sha256sum "$migration_file" | awk '{print $1}')"
if [ "$actual_migration_sha256" != "$expected_migration_sha256" ]; then
  echo 'ERROR: ACL migration checksum differs from the reviewed candidate.' >&2
  exit 3
fi

for required in docker; do
  if ! command -v "$required" >/dev/null 2>&1; then
    echo "ERROR: $required is required for the disposable ACL rehearsal." >&2
    exit 2
  fi
done

container_name="rfz-acl-remediation-${$}-${RANDOM}"
container_started=0
cleanup() {
  if [ "$container_started" -eq 1 ]; then
    docker stop "$container_name" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

# The database is not published to the host or network. Its bootstrap
# superuser is not the migration executor: the fixture creates separate
# NOSUPERUSER `postgres` and `supabase_admin` roles. The checked-in test SQL is
# mounted read-only, and all data stays in tmpfs inside this disposable
# container.
docker run --detach --rm \
  --name "$container_name" \
  --tmpfs /var/lib/postgresql/data:rw,nosuid,size=512m \
  --volume "$project_root:/rfz:ro" \
  --env POSTGRES_HOST_AUTH_METHOD=trust \
  --env POSTGRES_USER=bootstrap \
  postgres:17 >/dev/null
container_started=1

ready=0
for attempt in $(seq 1 60); do
  if docker exec "$container_name" pg_isready --host 127.0.0.1 --port 5432 --username bootstrap --dbname postgres >/dev/null 2>&1; then
    ready=1
    break
  fi
  sleep 1
done
if [ "$ready" -ne 1 ]; then
  echo "ERROR: Disposable PostgreSQL 17 did not become ready." >&2
  exit 4
fi

psql_in_container() {
  local role="$1"
  local file="$2"
  docker exec "$container_name" psql --no-psqlrc --set ON_ERROR_STOP=1 \
    "postgresql://${role}@127.0.0.1:5432/postgres" --file "/rfz/${file#"$project_root"/}"
}

psql_in_container bootstrap "$project_root/supabase/tests/database/hosted-acl-remediation-fixture.sql"
psql_in_container postgres "$project_root/supabase/tests/database/hosted-acl-remediation-rehearsal.sql"
psql_in_container postgres "$migration_file"
psql_in_container postgres "$migration_file"
psql_in_container bootstrap "$project_root/supabase/tests/database/hosted-acl-remediation-final-state.sql"

echo "HOSTED_ACL_REMEDIATION_POSTGRES17_SUPPORTED_SCOPE_PASS migration_sha256=$actual_migration_sha256 provider_defaults_preserved=24"
