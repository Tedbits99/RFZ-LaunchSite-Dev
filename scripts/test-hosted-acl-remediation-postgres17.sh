#!/usr/bin/env bash
set -euo pipefail

project_root="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"

for required in docker psql pg_isready; do
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

# The container binds only a random host port on loopback and keeps its data in
# tmpfs. --rm removes this uniquely named container; no persistent volume is
# created or touched.
docker run --detach --rm \
  --name "$container_name" \
  --publish 127.0.0.1::5432 \
  --tmpfs /var/lib/postgresql/data:rw,nosuid,size=512m \
  --env POSTGRES_HOST_AUTH_METHOD=trust \
  postgres:17 >/dev/null
container_started=1

mapping="$(docker port "$container_name" 5432/tcp)"
if [[ ! "$mapping" =~ ^127\.0\.0\.1:([0-9]+)$ ]]; then
  echo "ERROR: Disposable PostgreSQL port did not bind exclusively to loopback." >&2
  exit 3
fi
db_port="${BASH_REMATCH[1]}"
db_url="postgresql://postgres@127.0.0.1:${db_port}/postgres"

ready=0
for attempt in $(seq 1 60); do
  if pg_isready --host 127.0.0.1 --port "$db_port" --username postgres --dbname postgres >/dev/null 2>&1; then
    ready=1
    break
  fi
  sleep 1
done
if [ "$ready" -ne 1 ]; then
  echo "ERROR: Disposable PostgreSQL 17 did not become ready." >&2
  exit 4
fi

psql --no-psqlrc --set ON_ERROR_STOP=1 "$db_url" \
  --file "$project_root/supabase/tests/database/hosted-acl-remediation-fixture.sql"
psql --no-psqlrc --set ON_ERROR_STOP=1 "$db_url" \
  --file "$project_root/supabase/tests/database/hosted-acl-remediation-rehearsal.sql"

echo "HOSTED_ACL_REMEDIATION_POSTGRES17_REHEARSAL_PASS"
