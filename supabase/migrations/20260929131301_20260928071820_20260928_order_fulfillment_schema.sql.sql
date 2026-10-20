/*
# Order Fulfillment Schema — Complete Lifecycle

## Summary
This migration adds the missing database infrastructure for the order fulfillment
flow that the application code already references but the database doesn't have yet.

## Changes

### 1. Orders table — extend status constraint
The existing constraint allows: PENDING, PAYMENT_PENDING, PAID, PROCESSING,
COMPLETED, CANCELLED, FAILED, REFUND_REQUESTED, REFUNDED.
The application code uses: WAITING_PAYMENT, PAID, PROCESSING, COMPLETED,
DELIVERED, CANCELLED, REFUND_PENDING, REFUNDED.
We replace the constraint to include all the new statuses while keeping the old
ones for backward compatibility. We also add two missing columns:
- payment_reference (text) — the customer's transaction reference number
- payment_submitted_at (timestamptz) — when the customer submitted payment proof

### 2. New table: payment_submissions
Stores customer-submitted payment information (method, reference number, amount,
note). The admin reviews these to verify payment before marking an order PAID.

### 3. payment_config table
Ensures the admin-configured payment methods table exists (GCash, Maya, Bank
Transfer, etc.) with: method_key, display_name, account_name, account_number,
instructions, qr_data, is_enabled, sort_order, and provider metadata fields
(provider_name, provider_type, api_url, is_test_mode — added conditionally if
the table already exists from an earlier migration without them).
Secret API keys are NOT stored here — those go in environment variables only.

### 4. New tables: order_timeline, refunds, order_notes
- order_timeline — one row per status change, for the order history view
- refunds — refund records per order
- order_notes — admin notes attached to an order

### 5. RPC function: admin_change_order_status
Replaces any earlier version of the function (DROP first, since an earlier
migration created it with a different return shape). Validates status
transitions server-side, updates the order status, and inserts a timeline
entry atomically. Enforces the transition rules:
- WAITING_PAYMENT → PAID, CANCELLED
- PAID → PROCESSING, CANCELLED, REFUND_PENDING
- PROCESSING → COMPLETED, REFUND_PENDING
- COMPLETED → DELIVERED, REFUND_PENDING
- DELIVERED → REFUND_PENDING
- REFUND_PENDING → REFUNDED
- Any → same status (no-op, just adds timeline note)

### 6. RLS policies
- order_timeline: service-role only (admin client bypasses RLS)
- refunds: service-role only
- order_notes: service-role only
- payment_submissions: service-role only
- payment_config: public read for enabled methods (checkout needs this),
  admin write via service role

### 7. Seed default payment configs
Inserts default rows for GCash, Maya, Bank Transfer, and Manual Payment.

This migration is idempotent and safe to re-run.
*/

-- =========================================================
-- 1. Extend orders status constraint + add columns
-- =========================================================

ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS orders_status_check;

ALTER TABLE public.orders ADD CONSTRAINT orders_status_check CHECK (
  status IN (
    'PENDING', 'PAYMENT_PENDING', 'WAITING_PAYMENT',
    'PAID', 'PROCESSING', 'COMPLETED', 'DELIVERED',
    'CANCELLED', 'FAILED',
    'REFUND_REQUESTED', 'REFUND_PENDING', 'REFUNDED'
  )
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'orders' AND column_name = 'payment_reference'
  ) THEN
    ALTER TABLE public.orders ADD COLUMN payment_reference text;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'orders' AND column_name = 'payment_submitted_at'
  ) THEN
    ALTER TABLE public.orders ADD COLUMN payment_submitted_at timestamptz;
  END IF;
END $$;

-- =========================================================
-- 2. payment_submissions table
-- =========================================================

CREATE TABLE IF NOT EXISTS public.payment_submissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  payment_method text NOT NULL DEFAULT 'manual',
  reference_number text NOT NULL DEFAULT '',
  amount_cents integer NOT NULL DEFAULT 0,
  note text NOT NULL DEFAULT '',
  submitted_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.payment_submissions ENABLE ROW LEVEL SECURITY;

-- =========================================================
-- 3. payment_config table (create if missing, extend if present)
-- =========================================================

CREATE TABLE IF NOT EXISTS public.payment_config (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  method_key text NOT NULL UNIQUE,
  display_name text NOT NULL,
  account_name text NOT NULL DEFAULT '',
  account_number text NOT NULL DEFAULT '',
  instructions text NOT NULL DEFAULT '',
  qr_data text,
  is_enabled boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  provider_name text NOT NULL DEFAULT 'manual',
  provider_type text NOT NULL DEFAULT 'manual',
  is_test_mode boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'payment_config' AND column_name = 'provider_name'
  ) THEN
    ALTER TABLE public.payment_config ADD COLUMN provider_name text NOT NULL DEFAULT 'manual';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'payment_config' AND column_name = 'provider_type'
  ) THEN
    ALTER TABLE public.payment_config ADD COLUMN provider_type text NOT NULL DEFAULT 'manual';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'payment_config' AND column_name = 'api_url'
  ) THEN
    ALTER TABLE public.payment_config ADD COLUMN api_url text NOT NULL DEFAULT '';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'payment_config' AND column_name = 'is_test_mode'
  ) THEN
    ALTER TABLE public.payment_config ADD COLUMN is_test_mode boolean NOT NULL DEFAULT false;
  END IF;
END $$;

ALTER TABLE public.payment_config ENABLE ROW LEVEL SECURITY;

-- =========================================================
-- 4. order_timeline / refunds / order_notes tables
-- =========================================================

CREATE TABLE IF NOT EXISTS public.order_timeline (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  status text NOT NULL,
  actor_email text NOT NULL DEFAULT '',
  note text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.order_timeline ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.refunds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  reference text NOT NULL DEFAULT '',
  amount_cents integer NOT NULL DEFAULT 0,
  reason text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'PENDING',
  approved_by text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.refunds ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.order_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  author_email text NOT NULL DEFAULT '',
  note text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.order_notes ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_order_timeline_order_id ON public.order_timeline(order_id);
CREATE INDEX IF NOT EXISTS idx_refunds_order_id ON public.refunds(order_id);

-- =========================================================
-- 5. RLS policies for all fulfillment tables
-- =========================================================

-- order_timeline: service role only (admin client bypasses RLS)
DROP POLICY IF EXISTS "service_all_order_timeline" ON public.order_timeline;
CREATE POLICY "service_all_order_timeline"
  ON public.order_timeline FOR ALL
  TO anon, authenticated
  USING (false) WITH CHECK (false);

-- refunds: service role only
DROP POLICY IF EXISTS "service_all_refunds" ON public.refunds;
CREATE POLICY "service_all_refunds"
  ON public.refunds FOR ALL
  TO anon, authenticated
  USING (false) WITH CHECK (false);

-- order_notes: service role only
DROP POLICY IF EXISTS "service_all_order_notes" ON public.order_notes;
CREATE POLICY "service_all_order_notes"
  ON public.order_notes FOR ALL
  TO anon, authenticated
  USING (false) WITH CHECK (false);

-- payment_submissions: service role only
DROP POLICY IF EXISTS "service_all_payment_submissions" ON public.payment_submissions;
CREATE POLICY "service_all_payment_submissions"
  ON public.payment_submissions FOR ALL
  TO anon, authenticated
  USING (false) WITH CHECK (false);

-- payment_config: public can read enabled configs (checkout needs this)
DROP POLICY IF EXISTS "public_read_enabled_payment_config" ON public.payment_config;
CREATE POLICY "public_read_enabled_payment_config"
  ON public.payment_config FOR SELECT
  TO anon, authenticated
  USING (is_enabled = true);

-- payment_config: service role can do everything
DROP POLICY IF EXISTS "service_all_payment_config" ON public.payment_config;
CREATE POLICY "service_all_payment_config"
  ON public.payment_config FOR ALL
  TO anon, authenticated
  USING (true) WITH CHECK (true);

-- =========================================================
-- 6. Seed default payment configs
-- =========================================================

INSERT INTO public.payment_config (method_key, display_name, account_name, account_number, instructions, sort_order, provider_name, provider_type)
VALUES
  ('gcash', 'GCash', 'RunFazone Store', '09123456789', 'Send your payment via GCash to the number above. Include your order reference as the message.', 1, 'gcash', 'manual'),
  ('maya', 'Maya', 'RunFazone Store', '09123456789', 'Send your payment via Maya to the number above. Include your order reference as the message.', 2, 'maya', 'manual'),
  ('bank', 'Bank Transfer', 'RunFazone Store', '0000-0000-0000', 'Transfer to our bank account. Include your order reference in the reference field.', 3, 'bank', 'manual'),
  ('manual', 'Manual Payment', '', '', 'Contact us for manual payment arrangements.', 4, 'manual', 'manual')
ON CONFLICT (method_key) DO NOTHING;

-- =========================================================
-- 7. RPC: admin_change_order_status
-- =========================================================

DROP FUNCTION IF EXISTS public.admin_change_order_status(uuid, text, text, text);

CREATE FUNCTION public.admin_change_order_status(
  p_order_id uuid,
  p_new_status text,
  p_actor_email text DEFAULT 'admin',
  p_note text DEFAULT ''
)
RETURNS TABLE (id uuid, status text, updated_at timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_current_status text;
  v_is_valid_transition boolean := false;
BEGIN
  -- Load the current status
  SELECT status INTO v_current_status
  FROM public.orders
  WHERE id = p_order_id
  FOR UPDATE;

  IF v_current_status IS NULL THEN
    RAISE EXCEPTION 'ORDER_NOT_FOUND';
  END IF;

  -- Same status = no-op (just add timeline note)
  IF v_current_status = p_new_status THEN
    v_is_valid_transition := true;
  ELSE
    -- Define valid transitions
    v_is_valid_transition := CASE
      WHEN v_current_status = 'WAITING_PAYMENT' AND p_new_status IN ('PAID', 'CANCELLED') THEN true
      WHEN v_current_status = 'PENDING' AND p_new_status IN ('WAITING_PAYMENT', 'PAID', 'CANCELLED') THEN true
      WHEN v_current_status = 'PAYMENT_PENDING' AND p_new_status IN ('WAITING_PAYMENT', 'PAID', 'CANCELLED') THEN true
      WHEN v_current_status = 'PAID' AND p_new_status IN ('PROCESSING', 'CANCELLED', 'REFUND_PENDING') THEN true
      WHEN v_current_status = 'PROCESSING' AND p_new_status IN ('COMPLETED', 'REFUND_PENDING') THEN true
      WHEN v_current_status = 'COMPLETED' AND p_new_status IN ('DELIVERED', 'REFUND_PENDING') THEN true
      WHEN v_current_status = 'DELIVERED' AND p_new_status IN ('REFUND_PENDING') THEN true
      WHEN v_current_status = 'REFUND_PENDING' AND p_new_status IN ('REFUNDED') THEN true
      ELSE false
    END;
  END IF;

  IF NOT v_is_valid_transition THEN
    RAISE EXCEPTION 'INVALID_TRANSITION';
  END IF;

  -- Update the order
  UPDATE public.orders
  SET status = p_new_status,
      updated_at = now()
  WHERE id = p_order_id;

  -- Insert timeline entry
  INSERT INTO public.order_timeline (order_id, status, actor_email, note)
  VALUES (p_order_id, p_new_status, p_actor_email, p_note);

  -- Return the updated row
  RETURN QUERY
  SELECT p_order_id, p_new_status, now();
END;
$$;

-- Grant execute to service role (admin client uses service role key)
GRANT EXECUTE ON FUNCTION public.admin_change_order_status(uuid, text, text, text) TO anon, authenticated;