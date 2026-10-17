/*
# Add last_polled_at to supplier_test_runs

## Purpose
Track when each test run was last polled for supplier status,
separate from the auto-updated updated_at timestamp.

## Changes
1. Add `last_polled_at` column (timestamptz, nullable) to supplier_test_runs.
2. No new policies needed — RLS already enabled, existing policies cover the new column.

## Security
- No security changes. RLS already enabled with anon/authenticated CRUD policies.
*/

ALTER TABLE supplier_test_runs ADD COLUMN IF NOT EXISTS last_polled_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_test_runs_last_polled_at ON supplier_test_runs(last_polled_at);
