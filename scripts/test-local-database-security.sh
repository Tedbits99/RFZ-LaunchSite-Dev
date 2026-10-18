#!/usr/bin/env bash
set -euo pipefail

project_root="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
exec "$project_root/scripts/test-github-actions-database-security.sh"
