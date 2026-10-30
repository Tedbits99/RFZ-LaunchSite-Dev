import { NextRequest, NextResponse } from 'next/server';
import { adminSupabase } from '@/lib/supabaseAdmin';
import { requireCatalogAdmin } from '@/lib/catalogAdminGuard';
import {
  CatalogSourceError,
  getCompleteFazerCardsOffersSnapshot,
  getFazerCardsCategory,
  listFazerCardsOffers,
} from '@/lib/suppliers/fazercardsCatalog';
import { resolveFazerCardsCatalogSource } from '@/lib/suppliers/fazercardsCatalogServer';

export async function GET(req: NextRequest) {
  const auth = await requireCatalogAdmin(req);
  if (!auth.ok) return auth.response;
  const source = await resolveFazerCardsCatalogSource(adminSupabase || auth.client);
  if (!source.mode) return NextResponse.json({ error: source.reason }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
  const params = new URL(req.url).searchParams;
  const categoryId = params.get('category_id') || '';
  if (!categoryId) return NextResponse.json({ error: 'category_id is required.' }, { status: 400 });
  try {
    const category = await getFazerCardsCategory(source.mode, categoryId);
    const page = params.get('all') === '1'
      ? await getCompleteFazerCardsOffersSnapshot(source.mode, category).then((snapshot) => ({
        category,
        ...snapshot,
        meta: { total: snapshot.offers.length, total_known: true, limit: snapshot.offers.length, next_cursor: null, has_more: false },
      }))
      : await listFazerCardsOffers({ mode: source.mode, category, cursor: params.get('cursor') });
    return NextResponse.json({
      ok: true,
      kind: 'offers',
      category_id: category.category_id,
      name: category.name,
      product_type: category.product_type,
      region: category.region,
      currency: category.currency,
      note: category.product_type === 'game_topup' ? category.note : `${category.product_type} is not supported for game top-up imports.`,
      ...page,
      source: source.mode,
    }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    const status = error instanceof CatalogSourceError ? error.status : 503;
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Catalog offers are unavailable.' }, { status, headers: { 'Cache-Control': 'no-store' } });
  }
}
