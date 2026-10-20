/*
# Expand Mobile Legends package catalog

1. Data changes
- Adds the five Mobile Legends Special Item packages requested by the MLBB top-up experience.
- Adds the complete Mobile Legends diamond package catalog from 223 through 20,524 diamonds.
- Stores retail price, original price, bonus copy, and ordering in the existing `packages` table.

2. Security
- Reuses the existing package table and its existing row-level security policy.
- No new public write access is introduced.

3. Important notes
- Prices are integer cents and are read by the MLBB page from PostgreSQL.
- Existing packages are updated by SKU, so this migration is safe to re-run.
*/

WITH mlbb AS (SELECT id FROM public.games WHERE slug = 'mobile-legends')
INSERT INTO public.packages (game_id, name, sku, amount, price_cents, original_price_cents, bonus, is_active, sort_order)
SELECT mlbb.id, x.name, x.sku, x.amount, x.price_cents, x.original_price_cents, x.bonus, true, x.sort_order
FROM mlbb CROSS JOIN (VALUES
  ('Weekly Pass','ML-WP-1','Weekly Pass',7900,9900,'+ 220 diamonds',1),
  ('Weekly Pass x2','ML-WP-2','2 Weekly Passes',14900,19800,'+ 440 diamonds',2),
  ('Weekly Pass x3','ML-WP-3','3 Weekly Passes',21900,29700,'+ 660 diamonds',3),
  ('Weekly Pass x4','ML-WP-4','4 Weekly Passes',28900,39600,'+ 880 diamonds',4),
  ('Weekly Pass x5','ML-WP-5','5 Weekly Passes',34900,49500,'+ 1,100 diamonds',5),
  ('223 Diamonds','ML-D-223','223 Diamonds',19900,23900,NULL,10),
  ('301 Diamonds','ML-D-301','301 Diamonds',25900,29900,NULL,11),
  ('336 Diamonds','ML-D-336','336 Diamonds',28900,33900,'+ 12 bonus',12),
  ('448 Diamonds','ML-D-448','448 Diamonds',37900,44900,NULL,13),
  ('570 Diamonds','ML-D-570','570 Diamonds',47900,55900,'Popular',14),
  ('626 Diamonds','ML-D-626','626 Diamonds',51900,59900,NULL,15),
  ('682 Diamonds','ML-D-682','682 Diamonds',55900,64900,NULL,16),
  ('738 Diamonds','ML-D-738','738 Diamonds',59900,69900,NULL,17),
  ('793 Diamonds','ML-D-793','793 Diamonds',63900,74900,NULL,18),
  ('849 Diamonds','ML-D-849','849 Diamonds',67900,79900,'Popular',19),
  ('906 Diamonds','ML-D-906','906 Diamonds',71900,84900,NULL,20),
  ('1,018 Diamonds','ML-D-1018','1,018 Diamonds',79900,94900,NULL,21),
  ('1,163 Diamonds','ML-D-1163','1,163 Diamonds',89900,104900,'Best Value',22),
  ('1,733 Diamonds','ML-D-1733','1,733 Diamonds',129900,149900,NULL,23),
  ('2,398 Diamonds','ML-D-2398','2,398 Diamonds',179900,204900,'Best Value',24),
  ('3,561 Diamonds','ML-D-3561','3,561 Diamonds',259900,294900,NULL,25),
  ('4,131 Diamonds','ML-D-4131','4,131 Diamonds',299900,339900,NULL,26),
  ('5,132 Diamonds','ML-D-5132','5,132 Diamonds',369900,419900,'Popular',27),
  ('6,042 Diamonds','ML-D-6042','6,042 Diamonds',429900,489900,NULL,28),
  ('7,205 Diamonds','ML-D-7205','7,205 Diamonds',499900,569900,NULL,29),
  ('8,440 Diamonds','ML-D-8440','8,440 Diamonds',579900,659900,'Best Value',30),
  ('9,710 Diamonds','ML-D-9710','9,710 Diamonds',659900,749900,NULL,31),
  ('10,173 Diamonds','ML-D-10173','10,173 Diamonds',689900,789900,NULL,32),
  ('12,084 Diamonds','ML-D-12084','12,084 Diamonds',799900,909900,'Popular',33),
  ('15,052 Diamonds','ML-D-15052','15,052 Diamonds',999900,1139900,NULL,34),
  ('20,524 Diamonds','ML-D-20524','20,524 Diamonds',1299900,1479900,'Best Value',35)
) AS x(name, sku, amount, price_cents, original_price_cents, bonus, sort_order)
ON CONFLICT (sku) DO UPDATE SET
  name = EXCLUDED.name,
  amount = EXCLUDED.amount,
  price_cents = EXCLUDED.price_cents,
  original_price_cents = EXCLUDED.original_price_cents,
  bonus = EXCLUDED.bonus,
  sort_order = EXCLUDED.sort_order,
  is_active = true;
