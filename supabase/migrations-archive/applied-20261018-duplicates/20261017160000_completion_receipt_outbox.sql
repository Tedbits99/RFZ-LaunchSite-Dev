-- ALREADY APPLIED to live database as: 20261018152514_20261017160000_completion_receipt_outbox.sql
-- Do not re-execute this original file. Kept for history only.

-- Durable completion-receipt outbox.
--
-- Rows are created only by the trusted supplier reconciliation boundary below.
-- Sending, retries, and provider interaction are intentionally deferred to a
-- later worker milestone.

CREATE TABLE public.order_email_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  template text NOT NULL CHECK (template = 'completion_receipt'),
  recipient_email text NOT NULL CHECK (char_length(recipient_email) BETWEEN 3 AND 320),
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'sent', 'dead_letter')),
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  lease_until timestamptz,
  provider_message_id text,
  last_error text CHECK (last_error IS NULL OR char_length(last_error) <= 1000),
  completed_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz,
  receipt_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT order_email_outbox_order_template_key UNIQUE (order_id, template)
);

ALTER TABLE public.order_email_outbox ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.order_email_outbox
  FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.order_email_outbox TO service_role;
GRANT UPDATE (
  status,
  attempt_count,
  next_attempt_at,
  lease_until,
  provider_message_id,
  last_error,
  sent_at
) ON TABLE public.order_email_outbox TO service_role;

CREATE INDEX order_email_outbox_claim_idx
  ON public.order_email_outbox (status, next_attempt_at, lease_until, created_at);

-- Recreate the exact trusted completion boundary with the durable outbox write
-- inside the same transaction as the supplier/order/timeline updates.
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
      lower(btrim(v_order.email)),
      now(),
      jsonb_build_object(
        'reference', v_order.reference,
        'total_cents', v_order.total_cents,
        'payment_method', v_order.payment_method
      )
    )
    ON CONFLICT (order_id, template) DO NOTHING;
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
