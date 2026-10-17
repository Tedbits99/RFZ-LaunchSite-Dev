/*
# Fix Fulfillment Advisory Lock — v3

## Purpose
Previous attempts to derive a bigint from a UUID failed because:
  1. UUID text contains dashes (hex parse error)
  2. uuid::bytea cast is not supported directly

This version uses the simplest reliable approach: hash the UUID text
with md5, take the first 16 hex characters, and cast to a bigint.
This gives a stable, well-distributed key per order UUID.

## Security
- No new tables or columns.
- SECURITY DEFINER, callable by authenticated.
*/

CREATE OR REPLACE FUNCTION public.try_fulfillment_lock(p_order_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_lock_key bigint;
BEGIN
  -- Derive a stable bigint from the UUID using md5 hash.
  -- Take the first 16 hex digits of the md5 hash and cast to bigint.
  v_lock_key := ('x' || substr(md5(p_order_id::text), 1, 16))::bit(64)::bigint;

  IF pg_try_advisory_xact_lock(v_lock_key) THEN
    RETURN true;
  ELSE
    RETURN false;
  END IF;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.try_fulfillment_lock(uuid) TO authenticated;
