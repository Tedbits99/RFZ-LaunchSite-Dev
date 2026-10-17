/*
# Fix Fulfillment Advisory Lock Key Derivation

## Purpose
The previous version of try_fulfillment_lock used string manipulation
on the UUID text (which contains dashes) and failed with a hex parse error.
This replaces it with a simpler, reliable approach: cast the UUID to
two int8 values via the internal UUID byte layout, then XOR them.

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
  -- Derive a stable bigint lock key from the UUID.
  -- Split the UUID into two 64-bit halves and XOR them.
  -- UUIDs are 16 bytes; cast to two int8 values via substring on bytea.
  SELECT (
    ('x' || encode(substring(p_order_id::bytea, 1, 8), 'hex'))::bit(64)::bigint
    #
    ('x' || encode(substring(p_order_id::bytea, 9, 8), 'hex'))::bit(64)::bigint
  )
  INTO v_lock_key;

  IF pg_try_advisory_xact_lock(v_lock_key) THEN
    RETURN true;
  ELSE
    RETURN false;
  END IF;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.try_fulfillment_lock(uuid) TO authenticated;
