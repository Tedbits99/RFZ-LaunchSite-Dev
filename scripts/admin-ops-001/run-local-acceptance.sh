#!/usr/bin/env bash
set -euo pipefail

export ADMIN_OPS_ACCEPTANCE=1
exec bash scripts/catalog-001/run-local-acceptance.sh
