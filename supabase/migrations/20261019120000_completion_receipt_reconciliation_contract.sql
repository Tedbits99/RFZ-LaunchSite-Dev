-- Enforce the authoritative completion-receipt contract at the reconciliation
-- boundary. Supplier completion must never be reversed because receipt data is
-- incomplete or malformed; invalid receipts are quarantined instead.

-- Keep the final contract self-contained. The quarantine path intentionally
-- stores no recipient, so a legacy database that reached this migration with
-- the original NOT NULL column definition must still be able to apply it.
ALTER TABLE public.order_email_outbox
  ALTER COLUMN recipient_email DROP NOT NULL;

CREATE OR REPLACE FUNCTION public.finalize_supplier_reconciliation(
  p_supplier_transaction_id uuid,
  p_outcome text,
  p_actor text DEFAULT 'auto-reconciliation',
  p_fail_reason text DEFAULT NULL
)
RETURNS TABLE(
  out_outcome text,
  out_transaction_id uuid,
  out_order_id uuid,
  out_transaction_status text,
  out_fulfillment_status text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_transaction public.supplier_transactions%ROWTYPE;
  v_supplier public.suppliers%ROWTYPE;
  v_order public.orders%ROWTYPE;
  v_transaction_status text;
  v_fulfillment_status text;
  v_order_status text;
  v_error_message text;
  v_recipient_email text;
  v_player_identifier text;
  v_masked_player_identifier text;
  v_game_name text;
  v_package_name text;
  v_completed_at timestamptz;
BEGIN
  IF p_outcome IS NULL OR p_outcome NOT IN ('completed', 'failed') THEN
    RETURN QUERY SELECT
      'inconsistent', p_supplier_transaction_id, NULL::uuid, NULL::text, NULL::text;
    RETURN;
  END IF;

  IF p_actor IS NULL OR p_actor NOT IN ('auto-reconciliation', 'fulfillment_system') THEN
    RETURN QUERY SELECT
      'inconsistent', p_supplier_transaction_id, NULL::uuid, NULL::text, NULL::text;
    RETURN;
  END IF;

  IF p_outcome = 'failed' AND NULLIF(btrim(COALESCE(p_fail_reason, '')), '') IS NULL THEN
    RETURN QUERY SELECT
      'retryable', p_supplier_transaction_id, NULL::uuid, NULL::text, NULL::text;
    RETURN;
  END IF;

  SELECT st.*
  INTO v_transaction
  FROM public.supplier_transactions st
  WHERE st.id = p_supplier_transaction_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN QUERY SELECT
      'inconsistent', p_supplier_transaction_id, NULL::uuid, NULL::text, NULL::text;
    RETURN;
  END IF;

  SELECT s.*
  INTO v_supplier
  FROM public.suppliers s
  WHERE s.id = v_transaction.supplier_id;

  IF NOT FOUND
     OR v_supplier.enabled IS NOT TRUE
     OR v_supplier.code <> 'fazercards'
     OR v_supplier.adapter <> 'custom' THEN
    RETURN QUERY SELECT
      'inconsistent', v_transaction.id, v_transaction.order_id,
      v_transaction.status, NULL::text;
    RETURN;
  END IF;

  IF v_transaction.status IN ('success', 'failed') THEN
    IF (p_outcome = 'completed' AND v_transaction.status = 'success')
       OR (p_outcome = 'failed' AND v_transaction.status = 'failed') THEN
      SELECT o.fulfillment_status INTO v_fulfillment_status
      FROM public.orders o
      WHERE o.id = v_transaction.order_id;

      RETURN QUERY SELECT
        'already-finalized', v_transaction.id, v_transaction.order_id,
        v_transaction.status, v_fulfillment_status;
    END IF;

    RETURN QUERY SELECT
      'inconsistent', v_transaction.id, v_transaction.order_id,
      v_transaction.status, NULL::text;
    RETURN;
  END IF;

  IF v_transaction.status NOT IN ('submitted', 'pending') THEN
    RETURN QUERY SELECT
      'retryable', v_transaction.id, v_transaction.order_id,
      v_transaction.status, NULL::text;
    RETURN;
  END IF;

  IF v_transaction.order_id IS NULL THEN
    RETURN QUERY SELECT
      'inconsistent', v_transaction.id, NULL::uuid,
      v_transaction.status, NULL::text;
    RETURN;
  END IF;

  SELECT o.*
  INTO v_order
  FROM public.orders o
  WHERE o.id = v_transaction.order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN QUERY SELECT
      'inconsistent', v_transaction.id, v_transaction.order_id,
      v_transaction.status, NULL::text;
    RETURN;
  END IF;

  -- A supplier terminal result is only applied to a paid order currently in
  -- the fulfillment phase. Terminal or unpaid orders are never regressed.
  IF v_order.payment_status <> 'VERIFIED'
     OR v_order.fulfillment_status <> 'PROCESSING' THEN
    RETURN QUERY SELECT
      'inconsistent', v_transaction.id, v_order.id,
      v_transaction.status, v_order.fulfillment_status;
    RETURN;
  END IF;

  v_transaction_status := CASE WHEN p_outcome = 'completed' THEN 'success' ELSE 'failed' END;
  v_fulfillment_status := CASE WHEN p_outcome = 'completed' THEN 'COMPLETED' ELSE 'FAILED' END;
  v_order_status := CASE WHEN p_outcome = 'completed' THEN 'COMPLETED' ELSE 'FULFILLMENT_FAILED' END;
  v_error_message := CASE WHEN p_outcome = 'failed' THEN btrim(p_fail_reason) ELSE NULL END;

  UPDATE public.supplier_transactions
  SET status = v_transaction_status,
      error_message = v_error_message
  WHERE id = v_transaction.id;

  UPDATE public.orders
  SET fulfillment_status = v_fulfillment_status,
      status = v_order_status,
      updated_at = now()
  WHERE id = v_order.id;

  INSERT INTO public.order_timeline (order_id, status, actor_email, note)
  VALUES (
    v_order.id,
    v_fulfillment_status,
    p_actor,
    CASE
      WHEN p_outcome = 'completed'
        THEN 'Supplier confirmed completion: ' || COALESCE(v_transaction.supplier_reference, v_transaction.id::text)
      ELSE 'Supplier reported failure (' || COALESCE(v_transaction.supplier_reference, v_transaction.id::text) || '): ' || btrim(p_fail_reason)
    END
  );

  IF p_outcome = 'completed' THEN
    v_recipient_email := NULLIF(lower(btrim(COALESCE(v_order.email, ''))), '');
    v_player_identifier := COALESCE(
      NULLIF(btrim(v_order.player_inputs->>'user_id'), ''),
      NULLIF(btrim(v_order.player_inputs->>'player_id'), ''),
      NULLIF(btrim(v_order.player_inputs->>'uid'), ''),
      NULLIF(btrim(v_order.player_inputs->>'riot_id'), '')
    );

    IF v_order.quantity IS DISTINCT FROM 1 THEN
      INSERT INTO public.order_email_outbox (
        order_id, template, recipient_email, status, last_error, completed_at, receipt_snapshot
      )
      VALUES (
        v_order.id, 'completion_receipt', NULL, 'dead_letter',
        'Receipt quantity unavailable for legacy order', now(), '{}'::jsonb
      )
      ON CONFLICT (order_id, template) DO NOTHING;
    ELSIF v_recipient_email IS NULL
       OR v_recipient_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' THEN
      INSERT INTO public.order_email_outbox (
        order_id, template, recipient_email, status, last_error, completed_at, receipt_snapshot
      )
      VALUES (
        v_order.id, 'completion_receipt', NULL, 'dead_letter',
        'Receipt recipient unavailable', now(), '{}'::jsonb
      )
      ON CONFLICT (order_id, template) DO NOTHING;
    ELSIF v_player_identifier IS NULL THEN
      INSERT INTO public.order_email_outbox (
        order_id, template, recipient_email, status, last_error, completed_at, receipt_snapshot
      )
      VALUES (
        v_order.id, 'completion_receipt', NULL, 'dead_letter',
        'Receipt player identifier unavailable', now(), '{}'::jsonb
      )
      ON CONFLICT (order_id, template) DO NOTHING;
    ELSE
      SELECT g.name INTO v_game_name
      FROM public.games g
      WHERE g.id = v_order.game_id;

      SELECT p.name INTO v_package_name
      FROM public.packages p
      WHERE p.id = v_order.package_id;

      v_masked_player_identifier := CASE
        WHEN length(v_player_identifier) <= 4 THEN repeat('*', length(v_player_identifier))
        ELSE repeat('*', length(v_player_identifier) - 4) || right(v_player_identifier, 4)
      END;
      v_completed_at := now();

      IF NULLIF(btrim(COALESCE(v_game_name, '')), '') IS NULL
         OR NULLIF(btrim(COALESCE(v_package_name, '')), '') IS NULL
         OR v_order.quantity <> 1
         OR NULLIF(v_masked_player_identifier, '') IS NULL THEN
        INSERT INTO public.order_email_outbox (
          order_id, template, recipient_email, status, last_error, completed_at, receipt_snapshot
        )
        VALUES (
          v_order.id, 'completion_receipt', NULL, 'dead_letter',
          'Receipt snapshot data unavailable', v_completed_at, '{}'::jsonb
        )
        ON CONFLICT (order_id, template) DO NOTHING;
      ELSE
        INSERT INTO public.order_email_outbox (
          order_id,
          template,
          recipient_email,
          completed_at,
          receipt_snapshot
        )
        VALUES (
          v_order.id,
          'completion_receipt',
          v_recipient_email,
          v_completed_at,
          jsonb_build_object(
            'reference', v_order.reference,
            'total_cents', v_order.total_cents,
            'payment_method', v_order.payment_method,
            'game_name', v_game_name,
            'package_name', v_package_name,
            'quantity', v_order.quantity,
            'masked_player_identifier', v_masked_player_identifier,
            'completed_at', v_completed_at
          )
        )
        ON CONFLICT (order_id, template) DO NOTHING;
      END IF;
    END IF;
  END IF;

  RETURN QUERY SELECT
    'applied', v_transaction.id, v_order.id,
    v_transaction_status, v_fulfillment_status;
END;
$function$;

REVOKE ALL ON FUNCTION public.finalize_supplier_reconciliation(uuid, text, text, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.finalize_supplier_reconciliation(uuid, text, text, text)
  TO service_role;
