/*
# RunFazone core commerce catalog

1. New Tables
- `games`: public game catalog entries with display metadata and active/featured flags.
- `game_input_fields`: configurable player information fields per game.
- `packages`: purchasable top-up denominations owned by a game.
- `orders`: customer checkout records with server-calculated totals and status.
- `order_items`: immutable game/package snapshots attached to an order.

2. Security
- Public users can read active games, fields, and packages.
- Public users may create an order through the checkout flow.
- Orders are not publicly readable; administration reads them through a protected server route.

3. Important notes
- Money is stored as integer cents to avoid floating-point rounding.
- Order totals are calculated from package prices stored in the database.
*/

CREATE TABLE IF NOT EXISTS public.games (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text UNIQUE NOT NULL,
  name text NOT NULL,
  short_name text,
  description text NOT NULL DEFAULT '',
  region text NOT NULL DEFAULT 'Global',
  currency text NOT NULL DEFAULT 'PHP',
  logo_url text,
  cover_url text,
  banner_url text,
  is_active boolean NOT NULL DEFAULT true,
  is_featured boolean NOT NULL DEFAULT false,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.game_input_fields (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id uuid NOT NULL REFERENCES public.games(id) ON DELETE CASCADE,
  label text NOT NULL,
  field_key text NOT NULL,
  placeholder text NOT NULL DEFAULT '',
  help_text text NOT NULL DEFAULT '',
  is_required boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  UNIQUE(game_id, field_key)
);

CREATE TABLE IF NOT EXISTS public.packages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id uuid NOT NULL REFERENCES public.games(id) ON DELETE CASCADE,
  name text NOT NULL,
  sku text UNIQUE NOT NULL,
  amount text NOT NULL,
  price_cents integer NOT NULL CHECK (price_cents >= 0),
  original_price_cents integer CHECK (original_price_cents IS NULL OR original_price_cents >= price_cents),
  bonus text,
  is_active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reference text UNIQUE NOT NULL,
  email text NOT NULL,
  customer_name text NOT NULL,
  game_id uuid NOT NULL REFERENCES public.games(id),
  package_id uuid NOT NULL REFERENCES public.packages(id),
  player_inputs jsonb NOT NULL DEFAULT '{}'::jsonb,
  subtotal_cents integer NOT NULL CHECK (subtotal_cents >= 0),
  discount_cents integer NOT NULL DEFAULT 0 CHECK (discount_cents >= 0),
  fee_cents integer NOT NULL DEFAULT 0 CHECK (fee_cents >= 0),
  total_cents integer NOT NULL CHECK (total_cents >= 0),
  payment_method text NOT NULL DEFAULT 'manual',
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','PAYMENT_PENDING','PAID','PROCESSING','COMPLETED','CANCELLED','FAILED','REFUND_REQUESTED','REFUNDED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS games_active_sort_idx ON public.games(is_active, is_featured, sort_order);
CREATE INDEX IF NOT EXISTS packages_game_active_sort_idx ON public.packages(game_id, is_active, sort_order);
CREATE INDEX IF NOT EXISTS orders_created_status_idx ON public.orders(created_at DESC, status);
CREATE INDEX IF NOT EXISTS orders_email_idx ON public.orders(lower(email));

ALTER TABLE public.games ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.game_input_fields ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.packages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public can read active games" ON public.games;
CREATE POLICY "Public can read active games" ON public.games FOR SELECT TO anon, authenticated USING (is_active = true);
DROP POLICY IF EXISTS "Public can read active input fields" ON public.game_input_fields;
CREATE POLICY "Public can read active input fields" ON public.game_input_fields FOR SELECT TO anon, authenticated USING (EXISTS (SELECT 1 FROM public.games WHERE games.id = game_input_fields.game_id AND games.is_active = true));
DROP POLICY IF EXISTS "Public can read active packages" ON public.packages;
CREATE POLICY "Public can read active packages" ON public.packages FOR SELECT TO anon, authenticated USING (is_active = true AND EXISTS (SELECT 1 FROM public.games WHERE games.id = packages.game_id AND games.is_active = true));
DROP POLICY IF EXISTS "Public can create orders" ON public.orders;
CREATE POLICY "Public can create orders" ON public.orders FOR INSERT TO anon, authenticated WITH CHECK (total_cents >= 0 AND length(email) > 3);

INSERT INTO public.games (slug, name, short_name, description, region, currency, logo_url, cover_url, is_featured, sort_order)
VALUES
('mobile-legends','Mobile Legends','MLBB','Bang Bang diamonds and weekly passes delivered fast.','Global','PHP','ML','MLBB',true,1),
('pubg-mobile','PUBG Mobile','PUBG','UC top-ups for your next drop.','Global','PHP','PUBG','PUBG',true,2),
('free-fire','Free Fire','FREE FIRE','Diamonds, memberships, and special packs.','Global','PHP','FF','FF',true,3),
('genshin-impact','Genshin Impact','GENSHIN','Genesis Crystals for Teyvat adventures.','Asia','PHP','GI','GI',true,4),
('valorant','Valorant','VALORANT','VP bundles for your next clutch.','Asia Pacific','PHP','VAL','VAL',false,5),
('honor-of-kings','Honor of Kings','HOK','Tokens and seasonal packs for every match.','Global','PHP','HOK','HOK',false,6),
('roblox','Roblox','ROBLOX','Robux for your favorite experiences.','Global','PHP','RBLX','RBLX',false,7),
('call-of-duty-mobile','Call of Duty Mobile','CODM','CP for ranked and battle pass drops.','Global','PHP','CODM','CODM',false,8)
ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name, is_active = true, is_featured = EXCLUDED.is_featured, sort_order = EXCLUDED.sort_order;

INSERT INTO public.game_input_fields (game_id, label, field_key, placeholder, help_text, sort_order)
SELECT id, 'User ID', 'user_id', 'Enter your User ID', 'Find it on your profile.', 1 FROM public.games WHERE slug = 'mobile-legends'
ON CONFLICT (game_id, field_key) DO NOTHING;
INSERT INTO public.game_input_fields (game_id, label, field_key, placeholder, help_text, sort_order)
SELECT id, 'Server ID', 'server_id', 'Enter your Server ID', 'The 4-digit number beside your User ID.', 2 FROM public.games WHERE slug = 'mobile-legends'
ON CONFLICT (game_id, field_key) DO NOTHING;
INSERT INTO public.game_input_fields (game_id, label, field_key, placeholder, help_text, sort_order)
SELECT id, 'Player ID', 'player_id', 'Enter your Player ID', '', 1 FROM public.games WHERE slug IN ('free-fire','pubg-mobile','roblox','call-of-duty-mobile')
ON CONFLICT (game_id, field_key) DO NOTHING;
INSERT INTO public.game_input_fields (game_id, label, field_key, placeholder, help_text, sort_order)
SELECT id, 'UID', 'uid', 'Enter your UID', '', 1 FROM public.games WHERE slug = 'genshin-impact'
ON CONFLICT (game_id, field_key) DO NOTHING;
INSERT INTO public.game_input_fields (game_id, label, field_key, placeholder, help_text, sort_order)
SELECT id, 'Server', 'server', 'Select your server', 'Asia, America, Europe, or TW/HK/MO.', 2 FROM public.games WHERE slug = 'genshin-impact'
ON CONFLICT (game_id, field_key) DO NOTHING;
INSERT INTO public.game_input_fields (game_id, label, field_key, placeholder, help_text, sort_order)
SELECT id, 'Riot ID', 'riot_id', 'Name#Tag', 'Your Riot ID and tag.', 1 FROM public.games WHERE slug = 'valorant'
ON CONFLICT (game_id, field_key) DO NOTHING;

INSERT INTO public.packages (game_id, name, sku, amount, price_cents, original_price_cents, bonus, sort_order)
SELECT id, x.name, x.sku, x.amount, x.price_cents, x.original_price_cents, x.bonus, x.sort_order
FROM public.games g CROSS JOIN (VALUES
('mobile-legends','Weekly Diamond Pass','ML-WDP','Weekly Pass',7900,9900,'+ 220 diamonds',1),
('mobile-legends','86 Diamonds','ML-86','86 Diamonds',9900,11900,NULL,2),
('mobile-legends','172 Diamonds','ML-172','172 Diamonds',18900,21900,'+ 12 bonus',3),
('pubg-mobile','325 UC','PUBG-325','325 UC',24900,29900,NULL,1),
('pubg-mobile','660 UC','PUBG-660','660 UC',47900,54900,'+ 60 bonus',2),
('free-fire','100 Diamonds','FF-100','100 Diamonds',7900,9900,NULL,1),
('free-fire','310 Diamonds','FF-310','310 Diamonds',22900,26900,'+ 20 bonus',2),
('genshin-impact','300 + 30 Genesis Crystals','GI-330','330 Crystals',24900,29900,NULL,1),
('genshin-impact','980 + 110 Genesis Crystals','GI-1090','1,090 Crystals',79900,89900,'Best value',2),
('valorant','475 VP','VAL-475','475 VP',24900,29900,NULL,1),
('honor-of-kings','80 Tokens','HOK-80','80 Tokens',9900,11900,NULL,1),
('roblox','400 Robux','RBLX-400','400 Robux',24900,29900,NULL,1),
('call-of-duty-mobile','460 CP','CODM-460','460 CP',24900,29900,NULL,1)
) AS x(slug,name,sku,amount,price_cents,original_price_cents,bonus,sort_order) WHERE g.slug = x.slug
ON CONFLICT (sku) DO UPDATE SET price_cents = EXCLUDED.price_cents, original_price_cents = EXCLUDED.original_price_cents, is_active = true;
