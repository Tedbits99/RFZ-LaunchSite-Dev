import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import console from 'node:console';
import process from 'node:process';
import { URL } from 'node:url';
import { createClient } from '@supabase/supabase-js';

const url = process.env.CATALOG_SUPABASE_URL || '';
const parsed = new URL(url);
assert(parsed.protocol === 'http:' && parsed.hostname === '127.0.0.1' && parsed.port === process.env.CATALOG_LOCAL_API_PORT, 'catalog seed refuses non-loopback Supabase');
const key = process.env.CATALOG_SERVICE_ROLE_KEY || '';
assert(JSON.parse(Buffer.from(key.split('.')[1] || '', 'base64url').toString('utf8')).role === 'service_role', 'catalog seed requires the disposable service role');
const db = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });

const games = [
  { id: 'c0010000-0000-4000-8000-000000000001', slug: 'catalog-001-seed-draft', name: 'Synthetic Seed Draft', catalog_status: 'DRAFT', is_active: false, published_at: null, archived_at: null },
  { id: 'c0010000-0000-4000-8000-000000000002', slug: 'catalog-001-seed-published', name: 'Synthetic Seed Published', catalog_status: 'PUBLISHED', is_active: true, published_at: new Date(0).toISOString(), archived_at: null },
  { id: 'c0010000-0000-4000-8000-000000000003', slug: 'catalog-001-seed-archived', name: 'Synthetic Seed Archived', catalog_status: 'ARCHIVED', is_active: false, published_at: null, archived_at: new Date(0).toISOString() },
];
for (const game of games) {
  const { error } = await db.from('games').upsert({
    ...game, short_name: 'SYN', description: 'Disposable deterministic catalog seed.', region: 'Synthetic Region',
    currency: 'PHP', logo_url: null, cover_url: null, banner_url: null, is_featured: false, sort_order: 900,
  }, { onConflict: 'id' });
  if (error) throw new Error(`Catalog game seed failed (SQLSTATE ${error.code}).`);
}

const { error: fieldError } = await db.from('game_input_fields').upsert({
  id: 'c0010000-0000-4000-8000-000000000011', game_id: games[1].id, label: 'Player ID',
  field_key: 'player_id', placeholder: 'Synthetic player ID', help_text: 'Disposable fixture only.',
  is_required: true, sort_order: 0,
}, { onConflict: 'id' });
if (fieldError) throw new Error(`Catalog field seed failed (SQLSTATE ${fieldError.code}).`);

const packages = [
  { id: 'c0010000-0000-4000-8000-000000000021', game_id: games[0].id, name: 'Synthetic Draft Package', sku: 'CATALOG-001-SEED-DRAFT', price_cents: 0, catalog_status: 'DRAFT', is_active: false },
  { id: 'c0010000-0000-4000-8000-000000000022', game_id: games[1].id, name: 'Synthetic Published Package', sku: 'CATALOG-001-SEED-PUBLISHED', price_cents: 400, catalog_status: 'PUBLISHED', is_active: true },
  { id: 'c0010000-0000-4000-8000-000000000023', game_id: games[2].id, name: 'Synthetic Archived Package', sku: 'CATALOG-001-SEED-ARCHIVED', price_cents: 700, catalog_status: 'PUBLISHED', is_active: true },
];
for (const pkg of packages) {
  const { error } = await db.from('packages').upsert({
    ...pkg, amount: pkg.name, original_price_cents: null, bonus: null, sort_order: 0, badge: null,
    image_url: null, supplier_offer_id: null, supplier_category_id: null, supplier_cost_usd: null,
    supplier_review_required: false, published_at: pkg.is_active ? new Date(0).toISOString() : null,
  }, { onConflict: 'id' });
  if (error) throw new Error(`Catalog package seed failed (SQLSTATE ${error.code}).`);
}

const { error: pricingError } = await db.from('app_settings').update({
  reference_usd_php_rate: 56, payment_fee_reserve_bps: 250, payment_fee_fixed_cents: 25,
  supplier_fulfillment_release_enabled: false,
}).eq('id', 1);
if (pricingError) throw new Error(`Catalog pricing seed failed (SQLSTATE ${pricingError.code}).`);

const { data: lock, error: lockError } = await db.from('app_settings').select('supplier_fulfillment_release_enabled').eq('id', 1).single();
if (lockError || lock.supplier_fulfillment_release_enabled !== false) throw new Error('Catalog supplier release lock was not disabled after fixture setup.');
console.log('CATALOG_DETERMINISTIC_SEED_PASS games=3 packages=3 release_locks=supplier-off');
