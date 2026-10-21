/*
# Schedule canonical auto-reconciliation (FazerCards only)

## Purpose
Schedules the pg_cron job that fires the auto-reconciliation Edge Function
every 3 minutes. This is the ONE canonical reconciliation path; older
trigger-based versions were never applied and have been removed.

## Security
- The trigger function is SECURITY DEFINER and callable only by postgres.
- The secret is read from the _cron_secrets table (RLS deny-by-default).
- The edge function validates the X-Cron-Secret header.
*/

CREATE TABLE IF NOT EXISTS public._cron_secrets (
  key text PRIMARY KEY,
  value text NOT NULL
);

ALTER TABLE public._cron_secrets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "_cron_secrets_select" ON public._cron_secrets;
DROP POLICY IF EXISTS "_cron_secrets_insert" ON public._cron_secrets;
DROP POLICY IF EXISTS "_cron_secrets_update" ON public._cron_secrets;
DROP POLICY IF EXISTS "_cron_secrets_delete" ON public._cron_secrets;

INSERT INTO public._cron_secrets (key, value)
VALUES ('auto_recon_secret', 'rfz_recon_a8f3k2m9x7q1w4z6b5c8d0e2f3a1b4c7')
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;

CREATE OR REPLACE FUNCTION public.trigger_auto_reconciliation()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_url text;
  v_secret text;
  v_request_id bigint;
BEGIN
  v_url := 'https://ftbvxkxxzotwkdcdgaot.supabase.co/functions/v1/auto-reconciliation';

  SELECT value INTO v_secret FROM public._cron_secrets WHERE key = 'auto_recon_secret';
  IF v_secret IS NULL THEN
    RAISE NOTICE 'No auto_recon_secret found in _cron_secrets';
    RETURN;
  END IF;

  -- Fire-and-forget: the cron job only needs to trigger the edge function.
  v_request_id := net.http_post(
    url := v_url,
    body := '{}'::jsonb,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'X-Cron-Secret', v_secret
    ),
    timeout_milliseconds := 30000
  );

  RAISE NOTICE 'Auto-reconciliation request sent (id=%)', v_request_id;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.trigger_auto_reconciliation() TO postgres;

SELECT cron.schedule(
  'auto-reconciliation',
  '*/3 * * * *',
  $$SELECT public.trigger_auto_reconciliation()$$
);
