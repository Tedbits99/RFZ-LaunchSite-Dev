import { NextRequest, NextResponse } from 'next/server';
import { adminSupabase } from '@/lib/supabaseAdmin';
import { requireAdmin } from '@/lib/adminGuard';

function cents(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null;
}

function validHttps(value: unknown): boolean {
  return value === undefined || value === null || value === '' || (typeof value === 'string' && value.startsWith('https://'));
}

export async function POST(req: NextRequest) {
  const auth = await requireAdmin(req);
  if (!auth.ok) return auth.response;
  const db = adminSupabase || auth.client;
  const body = await req.json().catch(() => null) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
  const gameId = typeof body.game_id === 'string' ? body.game_id : '';
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const sku = typeof body.sku === 'string' ? body.sku.trim() : '';
  const price = cents(body.price_cents);
  if (!gameId || !name || !sku || price === null) return NextResponse.json({ error: 'game_id, name, sku, and integer price_cents are required.' }, { status: 400 });
  if (price <= 0) return NextResponse.json({ error: 'A package must have a positive price before publication.' }, { status: 400 });
  if (!validHttps(body.image_url)) return NextResponse.json({ error: 'image_url must be HTTPS.' }, { status: 400 });
  const { data: game } = await db.from('games').select('id').eq('id', gameId).maybeSingle();
  if (!game) return NextResponse.json({ error: 'Game not found.' }, { status: 404 });
  const { data, error } = await db.from('packages').insert({
    game_id: gameId, name, sku, amount: typeof body.amount === 'string' ? body.amount.trim() : name,
    price_cents: price, original_price_cents: cents(body.original_price_cents), bonus: typeof body.bonus === 'string' ? body.bonus.trim() || null : null,
    sort_order: typeof body.sort_order === 'number' ? Math.round(body.sort_order) : 100, badge: typeof body.badge === 'string' ? body.badge.trim() || null : null,
    image_url: typeof body.image_url === 'string' ? body.image_url.trim() || null : null, is_active: false, catalog_status: 'DRAFT',
  }).select().single();
  if (error) return NextResponse.json({ error: error.code === '23505' ? 'A package with this SKU already exists.' : 'Package could not be created.' }, { status: error.code === '23505' ? 409 : 500 });
  return NextResponse.json({ data }, { status: 201 });
}
