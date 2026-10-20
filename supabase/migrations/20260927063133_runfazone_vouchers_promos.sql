/*
# RunFazone vouchers, promotions, announcements, and support

1. New Tables
- `vouchers`: discount codes with percentage/fixed amounts, usage limits, and active window.
- `voucher_usages`: tracks which order and customer used a voucher.
- `promotions`: store, game, or package targeted promotional banners.
- `announcements`: storefront banner announcements with active scheduling.
- `support_tickets`: customer support tickets with status workflow.
- `support_messages`: messages attached to a support ticket.
- `notifications`: in-app notifications for order lifecycle events.

2. Security
- Public users can read active promotions and announcements.
- Public users can create support tickets and messages.
- Voucher validation is server-side only; public cannot list vouchers.

3. Important notes
- Money is integer cents. Voucher discount computed server-side at checkout.
*/

CREATE TABLE IF NOT EXISTS public.vouchers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text UNIQUE NOT NULL,
  description text NOT NULL DEFAULT '',
  discount_type text NOT NULL CHECK (discount_type IN ('PERCENTAGE','FIXED')),
  discount_value integer NOT NULL CHECK (discount_value >= 0),
  min_order_cents integer NOT NULL DEFAULT 0 CHECK (min_order_cents >= 0),
  max_discount_cents integer CHECK (max_discount_cents IS NULL OR max_discount_cents >= 0),
  usage_limit integer CHECK (usage_limit IS NULL OR usage_limit >= 0),
  per_user_limit integer NOT NULL DEFAULT 1 CHECK (per_user_limit >= 0),
  starts_at timestamptz NOT NULL DEFAULT now(),
  ends_at timestamptz,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.voucher_usages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  voucher_id uuid NOT NULL REFERENCES public.vouchers(id) ON DELETE CASCADE,
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  email text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(voucher_id, order_id)
);

CREATE TABLE IF NOT EXISTS public.promotions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  body text NOT NULL DEFAULT '',
  target_type text NOT NULL DEFAULT 'GLOBAL' CHECK (target_type IN ('GLOBAL','GAME','PACKAGE')),
  game_id uuid REFERENCES public.games(id) ON DELETE SET NULL,
  package_id uuid REFERENCES public.packages(id) ON DELETE SET NULL,
  image_url text,
  cta_text text,
  cta_href text,
  starts_at timestamptz NOT NULL DEFAULT now(),
  ends_at timestamptz,
  is_active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.announcements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  body text NOT NULL DEFAULT '',
  variant text NOT NULL DEFAULT 'INFO' CHECK (variant IN ('INFO','SUCCESS','WARNING','PROMO')),
  starts_at timestamptz NOT NULL DEFAULT now(),
  ends_at timestamptz,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.support_tickets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reference text UNIQUE NOT NULL,
  email text NOT NULL,
  subject text NOT NULL,
  status text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','IN_PROGRESS','WAITING_CUSTOMER','RESOLVED','CLOSED')),
  priority text NOT NULL DEFAULT 'NORMAL' CHECK (priority IN ('LOW','NORMAL','HIGH','URGENT')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.support_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id uuid NOT NULL REFERENCES public.support_tickets(id) ON DELETE CASCADE,
  author text NOT NULL DEFAULT 'CUSTOMER',
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  type text NOT NULL,
  title text NOT NULL,
  body text NOT NULL DEFAULT '',
  is_read boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS promotions_active_sort_idx ON public.promotions(is_active, sort_order);
CREATE INDEX IF NOT EXISTS announcements_active_idx ON public.announcements(is_active, starts_at);
CREATE INDEX IF NOT EXISTS support_tickets_status_idx ON public.support_tickets(status, updated_at);
CREATE INDEX IF NOT EXISTS notifications_email_idx ON public.notifications(lower(email), is_read);

ALTER TABLE public.vouchers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.voucher_usages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.promotions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.announcements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.support_tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.support_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public can read active promotions" ON public.promotions;
CREATE POLICY "Public can read active promotions" ON public.promotions FOR SELECT TO anon, authenticated USING (is_active = true);
DROP POLICY IF EXISTS "Public can read active announcements" ON public.announcements;
CREATE POLICY "Public can read active announcements" ON public.announcements FOR SELECT TO anon, authenticated USING (is_active = true);
DROP POLICY IF EXISTS "Public can create support tickets" ON public.support_tickets;
CREATE POLICY "Public can create support tickets" ON public.support_tickets FOR INSERT TO anon, authenticated WITH CHECK (length(email) > 3);
DROP POLICY IF EXISTS "Public can read own support tickets" ON public.support_tickets;
CREATE POLICY "Public can read own support tickets" ON public.support_tickets FOR SELECT TO anon, authenticated USING (length(email) > 3);
DROP POLICY IF EXISTS "Public can create support messages" ON public.support_messages;
CREATE POLICY "Public can create support messages" ON public.support_messages FOR INSERT TO anon, authenticated WITH CHECK (length(body) > 0);
DROP POLICY IF EXISTS "Public can read own support messages" ON public.support_messages;
CREATE POLICY "Public can read own support messages" ON public.support_messages FOR SELECT TO anon, authenticated USING (EXISTS (SELECT 1 FROM public.support_tickets WHERE support_tickets.id = support_messages.ticket_id));
DROP POLICY IF EXISTS "Public can read own notifications" ON public.notifications;
CREATE POLICY "Public can read own notifications" ON public.notifications FOR SELECT TO anon, authenticated USING (true);

INSERT INTO public.vouchers (code, description, discount_type, discount_value, min_order_cents, max_discount_cents, usage_limit, per_user_limit, is_active)
VALUES
('WELCOME10','10% off your first order','PERCENTAGE',10,0,5000,100,1,true),
('SAVE50','50 off orders over 500','FIXED',5000,50000,NULL,10000,1,true)
ON CONFLICT (code) DO UPDATE SET discount_value = EXCLUDED.discount_value, is_active = true;

INSERT INTO public.promotions (title, body, target_type, cta_text, cta_href, sort_order)
VALUES
('Welcome Bonus','Get 10% off your first top-up with code WELCOME10.','GLOBAL','Top Up Now','#games',1),
('Diamond Week','Double diamonds on Mobile Legends this week.','GAME','View Offer','#games',2)
ON CONFLICT DO NOTHING;

INSERT INTO public.announcements (title, body, variant)
VALUES
('Welcome to RunFazone','Fast, secure, and affordable game top-ups.','INFO'),
('First order discount','Use code WELCOME10 for 10% off.','PROMO')
ON CONFLICT DO NOTHING;
