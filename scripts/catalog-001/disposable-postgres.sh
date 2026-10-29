#!/usr/bin/env bash
set -euo pipefail

# Local-only fixture helper. It refuses non-loopback publication and never
# reads or writes hosted credentials. Auth identities are supplied by the
# caller's test harness; this helper only provides disposable PostgreSQL.
CONTAINER_NAME="${CATALOG_PG_CONTAINER:-rfz-catalog-001-postgres}"
PORT="${CATALOG_PG_PORT:-55432}"
PASSWORD="${CATALOG_PG_PASSWORD:-synthetic-only}"

case "$PORT" in
  127.0.0.1:*) ;;
  *) PORT="127.0.0.1:${PORT#*:}" ;;
esac

usage() {
  echo "usage: $0 start|stop|status" >&2
  exit 2
}

command -v docker >/dev/null || { echo 'docker is required' >&2; exit 1; }

case "${1:-}" in
  start)
    if docker ps --format '{{.Names}}' | grep -Fxq "$CONTAINER_NAME"; then
      echo "already running: $CONTAINER_NAME"
      exit 0
    fi
    docker run --rm -d --name "$CONTAINER_NAME" \
      -e POSTGRES_PASSWORD="$PASSWORD" \
      -e POSTGRES_DB=runfazone \
      -p "$PORT:5432" postgres:16 >/dev/null
    for _ in $(seq 1 30); do
      if docker exec "$CONTAINER_NAME" pg_isready -U postgres -d runfazone >/dev/null 2>&1; then
        echo "ready: postgresql://postgres:${PASSWORD}@${PORT}/runfazone"
        exit 0
      fi
      sleep 1
    done
    echo 'PostgreSQL did not become ready' >&2
    exit 1
    ;;
  stop)
    docker rm -f "$CONTAINER_NAME" >/dev/null 2>&1 || true
    echo "stopped: $CONTAINER_NAME"
    ;;
  status)
    docker exec "$CONTAINER_NAME" pg_isready -U postgres -d runfazone
    ;;
  *) usage ;;
esac
