import { NextRequest, NextResponse } from 'next/server';
import { adminSupabase } from '@/lib/supabaseAdmin';
import { requireCatalogAdmin } from '@/lib/catalogAdminGuard';

const ML_GAME_SLUGS = ['mobile-legends', 'mlbb'];
const ML_CATEGORY_ID = 'mobile_legends_philippines';

export async function POST(req: NextRequest) {
  const session = await requireCatalogAdmin(req);
  if (!session.ok) return session.response;

  // The live diagnostic edge function is intentionally disabled. Do not make
  // even an internal hosted request from this admin action; imported offer
  // snapshots use /api/admin/catalog/import-offers with explicit review.
  return NextResponse.json({ error: 'Live supplier sync is disabled. Import a reviewed offer snapshot instead.' }, { status: 503 });
}

export async function GET(req: NextRequest) {
  const session = await requireCatalogAdmin(req);
  if (!session.ok) return session.response;
  if (!adminSupabase) return NextResponse.json({ error: 'Server-side catalog database access is not configured.' }, { status: 503 });

  const db = adminSupabase;

  const { data: mlGame } = await db
    .from('games')
    .select('id')
    .in('slug', ML_GAME_SLUGS)
    .limit(1)
    .maybeSingle();
  if (!mlGame) {
    return NextResponse.json({ error: 'Mobile Legends game not found in the catalog' }, { status: 404 });
  }

  const { data, error } = await db
    .from('packages')
    .select('id, name, sku, amount, price_cents, original_price_cents, bonus, is_active, catalog_status, supplier_review_required, sort_order, badge, supplier_offer_id, supplier_category_id, supplier_cost_usd, markup_percent')
    .eq('game_id', mlGame.id)
    .eq('supplier_category_id', ML_CATEGORY_ID)
    .not('supplier_offer_id', 'is', null)
    .order('sort_order');

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ data });
}
