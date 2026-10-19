/*
# Order fulfillment + payment architecture migration

1. Add payment_submissions table (customer payment proof)
2. Add payment_config table (admin-configurable payment methods)
3. Add payment_reference column to orders
4. Create admin_change_order_status RPC with transition validation
5. Seed default payment methods
*/

-- 1. Payment submissions (customer-submitted payment proof/info)
CREATE TABLE IF NOT EXISTS public.payment_submissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  payment_method text NOT NULL,
  reference_number text NOT NULL DEFAULT '',
  amount_cents integer NOT NULL DEFAULT 0,
  note text NOT NULL DEFAULT '',
  proof_url text,
  submitted_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS payment_submissions_order_idx ON public.payment_submissions(order_id);
ALTER TABLE public.payment_submissions ENABLE ROW LEVEL SECURITY;

-- 2. Payment configuration (admin-managed payment methods)
CREATE TABLE IF NOT EXISTS public.payment_config (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  method_key text UNIQUE NOT NULL,
  display_name text NOT NULL,
  provider text NOT NULL DEFAULT 'manual',
  is_enabled boolean NOT NULL DEFAULT true,
  account_name text NOT NULL DEFAULT '',
  account_number text NOT NULL DEFAULT '',
  qr_data text,
  instructions text NOT NULL DEFAULT '',
  webhook_url text,
  test_mode boolean NOT NULL DEFAULT false,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.payment_config ENABLE ROW LEVEL SECURITY;

-- 3. Add payment_reference to orders
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS payment_reference text;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS payment_submitted_at timestamptz;

-- 4. RPC for admin order status changes with transition validation
CREATE OR REPLACE FUNCTION public.admin_change_order_status(
  p_order_id uuid,
  p_new_status text,
  p_actor_email text DEFAULT 'admin',
  p_note text DEFAULT ''
)
RETURNS TABLE (id uuid, status text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_current text;
  v_allowed text[];
BEGIN
  SELECT status INTO v_current FROM orders WHERE id = p_order_id;
  IF v_current IS NULL THEN
    RAISE EXCEPTION 'ORDER_NOT_FOUND';
  END IF;

  -- Define allowed transitions
  v_allowed := CASE v_current
    WHEN 'WAITING_PAYMENT' THEN ARRAY['PAID','CANCELLED','REFUND_PENDING']
    WHEN 'PAID' THEN ARRAY['PROCESSING','CANCELLED','REFUND_PENDING']
    WHEN 'PROCESSING' THEN ARRAY['COMPLETED','CANCELLED','REFUND_PENDING']
    WHEN 'COMPLETED' THEN ARRAY['DELIVERED','REFUND_PENDING']
    WHEN 'DELIVERED' THEN ARRAY['REFUND_PENDING']
    WHEN 'REFUND_PENDING' THEN ARRAY['REFUNDED']
    WHEN 'REFUNDED' THEN ARRAY[]::text[]
    WHEN 'CANCELLED' THEN ARRAY[]::text[]
    ELSE ARRAY[]::text[]
  END;

  IF NOT (p_new_status = ANY(v_allowed)) THEN
    RAISE EXCEPTION 'INVALID_TRANSITION:%->%', v_current, p_new_status;
  END IF;

  UPDATE orders SET status = p_new_status, updated_at = now() WHERE id = p_order_id;

  INSERT INTO order_timeline (order_id, status, actor_email, note)
  VALUES (p_order_id, p_new_status, p_actor_email, p_note);

  RETURN QUERY SELECT p_order_id, p_new_status;
END;
$$;
GRANT EXECUTE ON FUNCTION public.admin_change_order_status(uuid, text, text, text) TO anon, authenticated;

-- 5. Seed default payment methods
INSERT INTO public.payment_config (method_key, display_name, provider, is_enabled, sort_order, instructions) VALUES
  ('gcash', 'GCash', 'manual', true, 1, 'Send payment to the GCash account shown on checkout.'),
  ('maya', 'Maya', 'manual', true, 2, 'Send payment to the Maya account shown on checkout.'),
  ('coinsph', 'Coins.ph', 'manual', true, 3, 'Send payment to the Coins.ph wallet shown on checkout.'),
  ('manual', 'Manual / Bank Transfer', 'manual', true, 4, 'Contact us for bank transfer details.')
ON CONFLICT (method_key) DO NOTHING;
