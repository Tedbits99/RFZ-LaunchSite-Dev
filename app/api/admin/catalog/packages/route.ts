import { NextRequest, NextResponse } from 'next/server';
import { adminSupabase } from '@/lib/supabaseAdmin';
import { requireCatalogAdmin } from '@/lib/catalogAdminGuard';

function cents(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function validHttps(value: unknown): boolean {
  return value === undefined || value === null || value === '' || (typeof value === 'string' && value.startsWith('https://'));
}

export async function POST(req: NextRequest) {
  const auth = await requireCatalogAdmin(req);
  if (!auth.ok) return auth.response;
  if (!adminSupabase) return NextResponse.json({ error: 'Server-side catalog database access is not configured.' }, { status: 503 });
  const db = adminSupabase;
  const body = await req.json().catch(() => null) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
  const gameId = typeof body.game_id === 'string' ? body.game_id : '';
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const sku = typeof body.sku === 'string' ? body.sku.trim() : '';
  const price = cents(body.price_cents);
  if (!gameId || !name || name.length > 180 || !sku || sku.length > 180 || price === null) return NextResponse.json({ error: 'game_id, name (1–180 characters), SKU (1–180 characters), and non-negative integer price_cents are required.' }, { status: 400 });
  if (!validHttps(body.image_url)) return NextResponse.json({ error: 'image_url must be HTTPS.' }, { status: 400 });
  const { data: game, error: gameError } = await db.from('games').select('id').eq('id', gameId).maybeSingle();
  if (gameError) return NextResponse.json({ error: 'Could not validate the target game.' }, { status: 500 });
  if (!game) return NextResponse.json({ error: 'Game not found.' }, { status: 404 });
  const originalPrice = body.original_price_cents === undefined || body.original_price_cents === null ? null : cents(body.original_price_cents);
  if (body.original_price_cents !== undefined && body.original_price_cents !== null && originalPrice === null) return NextResponse.json({ error: 'original_price_cents must be a non-negative integer.' }, { status: 400 });
  if (originalPrice !== null && originalPrice < price) return NextResponse.json({ error: 'original_price_cents cannot be below price_cents.' }, { status: 400 });
  if (body.sort_order !== undefined && (!Number.isSafeInteger(body.sort_order) || Number(body.sort_order) < 0)) return NextResponse.json({ error: 'sort_order must be a non-negative integer.' }, { status: 400 });
  const { data, error } = await db.from('packages').insert({
    game_id: gameId, name, sku, amount: typeof body.amount === 'string' && body.amount.trim() ? body.amount.trim() : name,
    price_cents: price, original_price_cents: originalPrice, bonus: typeof body.bonus === 'string' ? body.bonus.trim() || null : null,
    sort_order: typeof body.sort_order === 'number' ? body.sort_order : 100, badge: typeof body.badge === 'string' ? body.badge.trim() || null : null,
    image_url: typeof body.image_url === 'string' ? body.image_url.trim() || null : null, is_active: false, catalog_status: 'DRAFT',
  }).select().single();
  if (error) return NextResponse.json({ error: error.code === '23505' ? 'A package with this SKU already exists.' : 'Package could not be created.' }, { status: error.code === '23505' ? 409 : 500 });
  return NextResponse.json({ data }, { status: 201 });
}
