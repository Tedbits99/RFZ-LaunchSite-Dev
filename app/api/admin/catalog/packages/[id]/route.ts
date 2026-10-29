import { NextRequest, NextResponse } from 'next/server';
import { adminSupabase } from '@/lib/supabaseAdmin';
import { requireAdmin } from '@/lib/adminGuard';

export async function PATCH(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin(req);
  if (!auth.ok) return auth.response;
  const { id } = await context.params;
  const db = adminSupabase || auth.client;
  const body = await req.json().catch(() => null) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
  const { data: current, error: currentError } = await db.from('packages').select('id,game_id,price_cents,is_active,catalog_status,supplier_cost_usd,supplier_offer_id').eq('id', id).maybeSingle();
  if (currentError) return NextResponse.json({ error: 'Could not load package.' }, { status: 500 });
  if (!current) return NextResponse.json({ error: 'Package not found.' }, { status: 404 });
  const action = typeof body.action === 'string' ? body.action : null;
  if (action) {
    if (!['publish', 'hide', 'archive', 'restore'].includes(action)) return NextResponse.json({ error: 'Unsupported package action.' }, { status: 400 });
    if (action === 'publish') {
      const price = typeof body.price_cents === 'number' ? body.price_cents : current.price_cents;
      if (!Number.isInteger(price) || price <= 0) return NextResponse.json({ error: 'A positive integer price is required.' }, { status: 400 });
      const cost = Number(current.supplier_cost_usd || 0);
      const { data: setting } = await db.from('app_settings').select('reference_usd_php_rate').eq('id', 1).maybeSingle();
      const rate = Number(setting?.reference_usd_php_rate || 56);
      if (cost > 0 && price < Math.round(cost * rate * 100)) return NextResponse.json({ error: 'Negative-margin packages require a reviewed price.' }, { status: 409 });
    }
    const next = action === 'publish'
      ? { catalog_status: 'PUBLISHED', is_active: true, published_at: new Date().toISOString(), archived_at: null }
      : action === 'hide'
        ? { catalog_status: 'DRAFT', is_active: false }
        : action === 'archive'
          ? { catalog_status: 'ARCHIVED', is_active: false, archived_at: new Date().toISOString() }
          : { catalog_status: 'DRAFT', is_active: false, archived_at: null };
    const { data, error } = await db.from('packages').update(next).eq('id', id).select().single();
    if (error) return NextResponse.json({ error: 'Package lifecycle update failed.' }, { status: 500 });
    return NextResponse.json({ data });
  }
  const updates: Record<string, unknown> = {};
  for (const key of ['name', 'amount', 'bonus', 'badge', 'image_url']) if (body[key] !== undefined) updates[key] = body[key] || null;
  for (const key of ['price_cents', 'original_price_cents', 'sort_order']) if (body[key] !== undefined) {
    if (!Number.isInteger(body[key]) || Number(body[key]) < 0) return NextResponse.json({ error: `${key} must be a non-negative integer.` }, { status: 400 });
    updates[key] = body[key];
  }
  if (!Object.keys(updates).length) return NextResponse.json({ error: 'No fields to update.' }, { status: 400 });
  const { data, error } = await db.from('packages').update(updates).eq('id', id).select().single();
  if (error) return NextResponse.json({ error: 'Package could not be updated.' }, { status: 500 });
  return NextResponse.json({ data });
}
