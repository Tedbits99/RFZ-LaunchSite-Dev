/*
# Supplier Test Runs Table

## Purpose
Persist controlled supplier test executions separately from customer orders.
This gives admins a visible history of FazerCards test orders without
polluting the customer `orders` table.

## New Table: supplier_test_runs
- id (uuid PK)
- supplier_id (uuid FK → suppliers)
- supplier_code (text, denormalized for quick display)
- category_id (text, e.g. "mobile_legends_philippines")
- offer_id (text, e.g. "10_1_diamonds")
- player_inputs (jsonb, masked player/server fields)
- supplier_reference (text, the FazerCards order ID returned by supplier)
- local_status (text: CREATED, PROCESSING, SUCCESS, FAILED, UNKNOWN)
- supplier_status (text: raw status from supplier, e.g. "created", "processing", "completed", "failed")
- error (text, error message if any)
- response_payload (jsonb, full raw supplier response)
- status_payload (jsonb, full raw supplier status response)
- created_at (timestamptz)
- updated_at (timestamptz)

## Security
- RLS enabled
- TO anon, authenticated CRUD (admin panel uses anon key via server-side)
- No customer data, no sensitive credentials — only test run metadata
*/

CREATE TABLE IF NOT EXISTS supplier_test_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_id uuid NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
  supplier_code text NOT NULL DEFAULT '',
  category_id text NOT NULL,
  offer_id text NOT NULL,
  player_inputs jsonb NOT NULL DEFAULT '{}'::jsonb,
  supplier_reference text,
  local_status text NOT NULL DEFAULT 'CREATED',
  supplier_status text,
  error text,
  response_payload jsonb,
  status_payload jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE supplier_test_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_select_test_runs" ON supplier_test_runs;
CREATE POLICY "anon_select_test_runs" ON supplier_test_runs FOR SELECT
TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "anon_insert_test_runs" ON supplier_test_runs;
CREATE POLICY "anon_insert_test_runs" ON supplier_test_runs FOR INSERT
TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "anon_update_test_runs" ON supplier_test_runs;
CREATE POLICY "anon_update_test_runs" ON supplier_test_runs FOR UPDATE
TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "anon_delete_test_runs" ON supplier_test_runs;
CREATE POLICY "anon_delete_test_runs" ON supplier_test_runs FOR DELETE
TO anon, authenticated USING (true);

CREATE INDEX IF NOT EXISTS idx_test_runs_supplier_id ON supplier_test_runs(supplier_id);
CREATE INDEX IF NOT EXISTS idx_test_runs_created_at ON supplier_test_runs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_test_runs_local_status ON supplier_test_runs(local_status);

-- Add updated_at auto-update trigger
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_test_runs_updated_at ON supplier_test_runs;
CREATE TRIGGER trg_test_runs_updated_at
  BEFORE UPDATE ON supplier_test_runs
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
