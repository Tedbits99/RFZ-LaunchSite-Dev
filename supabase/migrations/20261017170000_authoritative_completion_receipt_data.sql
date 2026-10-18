-- Authoritative receipt data contract for future completion receipts.
--
-- Existing orders intentionally remain quantity-unknown (NULL).  The current
-- checkout creates exactly one package per order, so new orders are persisted
-- as quantity 1 without changing create_order's public signature.

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS quantity integer;

ALTER TABLE public.orders
  DROP CONSTRAINT IF EXISTS orders_quantity_single_package_check;

ALTER TABLE public.orders
  ADD CONSTRAINT orders_quantity_single_package_check
  CHECK (quantity IS NULL OR quantity = 1);

-- A malformed legacy recipient must be quarantinable without rolling back a
-- genuine supplier completion.  Only dead-letter rows may omit a recipient.
ALTER TABLE public.order_email_outbox
  ALTER COLUMN recipient_email DROP NOT NULL;

ALTER TABLE public.order_email_outbox
  DROP CONSTRAINT IF EXISTS order_email_outbox_recipient_email_check;

ALTER TABLE public.order_email_outbox
  ADD CONSTRAINT order_email_outbox_recipient_email_check
  CHECK (
    (recipient_email IS NOT NULL AND char_length(recipient_email) BETWEEN 3 AND 320)
    OR (recipient_email IS NULL AND status = 'dead_letter')
  );

CREATE OR REPLACE FUNCTION public.set_new_order_quantity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
BEGIN
  IF NEW.quantity IS NULL THEN
    NEW.quantity := 1;
  ELSIF NEW.quantity <> 1 THEN
    RAISE EXCEPTION 'ORDER_QUANTITY_UNSUPPORTED';
  END IF;
  RETURN NEW;
END;
$function$;

ALTER FUNCTION public.set_new_order_quantity() OWNER TO postgres;

DROP TRIGGER IF EXISTS orders_set_new_quantity ON public.orders;
CREATE TRIGGER orders_set_new_quantity
BEFORE INSERT ON public.orders
FOR EACH ROW
EXECUTE FUNCTION public.set_new_order_quantity();

-- Build the customer-facing snapshot from persisted order/catalog data at the
-- trusted completion boundary.  Missing receipt data never changes the order
-- or supplier state: the outbox row is retained as dead_letter for review.
CREATE OR REPLACE FUNCTION public.populate_completion_receipt_snapshot()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_order record;
  v_player_identifier text;
  v_masked_player_identifier text;
  v_receipt_error text;
BEGIN
  SELECT
    o.reference,
    o.email,
    o.total_cents,
    o.payment_method,
    o.quantity,
    o.player_inputs,
    g.name AS game_name,
    p.name AS package_name
  INTO v_order
  FROM public.orders o
  LEFT JOIN public.games g ON g.id = o.game_id
  LEFT JOIN public.packages p ON p.id = o.package_id
  WHERE o.id = NEW.order_id;

  IF NOT FOUND THEN
    NEW.status := 'dead_letter';
    NEW.last_error := 'Receipt order data unavailable';
    RETURN NEW;
  END IF;

  v_player_identifier := NULLIF(btrim(COALESCE(
    v_order.player_inputs ->> 'user_id',
    v_order.player_inputs ->> 'player_id',
    v_order.player_inputs ->> 'uid',
    v_order.player_inputs ->> 'riot_id'
  )), '');

  IF v_player_identifier IS NULL THEN
    v_masked_player_identifier := NULL;
  ELSIF length(v_player_identifier) <= 4 THEN
    v_masked_player_identifier := repeat('*', length(v_player_identifier));
  ELSE
    v_masked_player_identifier := repeat('*', length(v_player_identifier) - 4)
      || right(v_player_identifier, 4);
  END IF;

  IF NULLIF(btrim(v_order.email), '') IS NULL THEN
    v_receipt_error := 'Receipt recipient unavailable';
  ELSIF v_order.reference IS NULL OR v_order.total_cents IS NULL
     OR v_order.payment_method IS NULL THEN
    v_receipt_error := 'Receipt order fields unavailable';
  ELSIF v_order.game_name IS NULL OR v_order.package_name IS NULL THEN
    v_receipt_error := 'Receipt catalog fields unavailable';
  ELSIF v_order.quantity IS NULL THEN
    v_receipt_error := 'Receipt quantity unavailable for legacy order';
  ELSIF v_masked_player_identifier IS NULL THEN
    v_receipt_error := 'Receipt player identifier unavailable';
  END IF;

  NEW.recipient_email := NULLIF(lower(btrim(v_order.email)), '');
  NEW.receipt_snapshot := jsonb_build_object(
    'reference', v_order.reference,
    'total_cents', v_order.total_cents,
    'payment_method', v_order.payment_method,
    'game_name', v_order.game_name,
    'package_name', v_order.package_name,
    'quantity', v_order.quantity,
    'masked_player_identifier', v_masked_player_identifier,
    'completed_at', NEW.completed_at
  );

  IF v_receipt_error IS NOT NULL THEN
    NEW.status := 'dead_letter';
    NEW.last_error := v_receipt_error;
  END IF;

  RETURN NEW;
END;
$function$;

ALTER FUNCTION public.populate_completion_receipt_snapshot() OWNER TO postgres;

DROP TRIGGER IF EXISTS completion_receipt_snapshot ON public.order_email_outbox;
CREATE TRIGGER completion_receipt_snapshot
BEFORE INSERT ON public.order_email_outbox
FOR EACH ROW
WHEN (NEW.template = 'completion_receipt')
EXECUTE FUNCTION public.populate_completion_receipt_snapshot();
