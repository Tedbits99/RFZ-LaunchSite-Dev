-- Atomic supplier reconciliation finalization.
--
-- This function is intentionally narrower than the existing fulfillment RPCs:
-- it accepts only a trusted supplier transaction id and a verified terminal
-- supplier outcome. Supplier polling remains outside the database transaction.

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
  -- Authorization is enforced by the exact function signature's EXECUTE
  -- grants below. Do not authorize from request.jwt.claims or another
  -- user-controlled setting; SECURITY DEFINER makes current_user the
  -- function owner rather than the invoking role.

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

  -- Every finalization path locks the supplier transaction before the order.
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

  RETURN QUERY SELECT
    'applied', v_transaction.id, v_order.id,
    v_transaction_status, v_fulfillment_status;
END;
$function$;

REVOKE ALL ON FUNCTION public.finalize_supplier_reconciliation(uuid, text, text, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.finalize_supplier_reconciliation(uuid, text, text, text)
  TO service_role;

-- Supplier transactions are server/admin data. Remove the historical broad
-- policies and grants so clients cannot bypass the finalization boundary.
DROP POLICY IF EXISTS select_stx ON public.supplier_transactions;
DROP POLICY IF EXISTS insert_stx ON public.supplier_transactions;
DROP POLICY IF EXISTS update_stx ON public.supplier_transactions;
DROP POLICY IF EXISTS delete_stx ON public.supplier_transactions;
DROP POLICY IF EXISTS "select_stx" ON public.supplier_transactions;
DROP POLICY IF EXISTS "insert_stx" ON public.supplier_transactions;
DROP POLICY IF EXISTS "update_stx" ON public.supplier_transactions;
DROP POLICY IF EXISTS "delete_stx" ON public.supplier_transactions;
DROP POLICY IF EXISTS admin_select_supplier_transactions ON public.supplier_transactions;
DROP POLICY IF EXISTS "admin_select_supplier_transactions" ON public.supplier_transactions;

REVOKE ALL ON TABLE public.supplier_transactions FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.supplier_transactions TO authenticated;

CREATE POLICY admin_select_supplier_transactions
  ON public.supplier_transactions FOR SELECT TO authenticated
  USING (public.is_admin());
