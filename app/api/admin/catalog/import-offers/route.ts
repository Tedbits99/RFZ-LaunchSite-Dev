import { NextRequest, NextResponse } from 'next/server';
import { adminSupabase } from '@/lib/supabaseAdmin';
import { requireCatalogAdmin } from '@/lib/catalogAdminGuard';
import { importSupplierOffers, validateSupplierOffers } from '@/lib/supplierCatalogImport';
import {
  CatalogSourceError,
  getCompleteFazerCardsOffersSnapshot,
  getFazerCardsCategory,
} from '@/lib/suppliers/fazercardsCatalog';
import { resolveFazerCardsCatalogSource } from '@/lib/suppliers/fazercardsCatalogServer';

const ALLOWED_KEYS = new Set(['category_id', 'game_id', 'offer_ids']);
const ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,119}$/;

export async function POST(req: NextRequest) {
  const auth = await requireCatalogAdmin(req);
  if (!auth.ok) return auth.response;
  const db = adminSupabase;
  if (!db) return NextResponse.json({ error: 'Server-side catalog database access is not configured.' }, { status: 503 });

  const body = await req.json().catch(() => null) as Record<string, unknown> | null;
  if (!body || Object.keys(body).some((key) => !ALLOWED_KEYS.has(key))) {
    return NextResponse.json({ error: 'Only category_id, game_id, and offer_ids are accepted; supplier prices and snapshot flags are server-derived.' }, { status: 400 });
  }
  const categoryId = typeof body.category_id === 'string' ? body.category_id : '';
  const gameId = typeof body.game_id === 'string' ? body.game_id : '';
  const offerIds = body.offer_ids;
  if (!ID.test(categoryId) || !ID.test(gameId) || !Array.isArray(offerIds) || offerIds.length < 1 || offerIds.length > 2000
      || offerIds.some((id) => typeof id !== 'string' || !ID.test(id))
      || new Set(offerIds).size !== offerIds.length) {
    return NextResponse.json({ error: 'A valid category, target game, and unique selected offer IDs are required.' }, { status: 400 });
  }

  const source = await resolveFazerCardsCatalogSource(db);
  if (!source.mode) return NextResponse.json({ error: source.reason }, { status: 503 });
  if (!source.supplierId) return NextResponse.json({ error: 'Supplier configuration is unavailable.' }, { status: 503 });

  const [{ data: game, error: gameError }, { data: supplier, error: supplierError }] = await Promise.all([
    db.from('games').select('id,slug,catalog_status').eq('id', gameId).maybeSingle(),
    db.from('suppliers').select('id').eq('id', source.supplierId).eq('code', 'fazercards').maybeSingle(),
  ]);
  if (gameError || supplierError) return NextResponse.json({ error: 'Catalog configuration could not be verified.' }, { status: 503 });
  if (!game || game.catalog_status === 'ARCHIVED') return NextResponse.json({ error: 'The target game does not exist or is archived.' }, { status: 404 });
  if (!supplier) return NextResponse.json({ error: 'FazerCards supplier configuration is unavailable.' }, { status: 503 });

  try {
    const category = await getFazerCardsCategory(source.mode, categoryId);
    if (category.product_type !== 'game_topup') {
      return NextResponse.json({ error: `Unsupported supplier product type: ${category.product_type}. Only game top-ups may be imported.` }, { status: 422 });
    }
    const snapshot = await getCompleteFazerCardsOffersSnapshot(source.mode, category);
    const selected = new Set(offerIds as string[]);
    const resolvedOffers = snapshot.offers.filter((offer) => selected.has(offer.offer_id));
    if (resolvedOffers.length !== selected.size) {
      return NextResponse.json({ error: 'One or more selected offers are not present in the validated current supplier snapshot.' }, { status: 409 });
    }
    const parsed = validateSupplierOffers(resolvedOffers);
    if (parsed.error || !parsed.offers) return NextResponse.json({ error: 'The supplier snapshot contains invalid offers.' }, { status: 502 });

    const completeSnapshot = snapshot.complete
      && selected.size === snapshot.offers.length
      && snapshot.offers.every((offer) => selected.has(offer.offer_id));
    const result = await importSupplierOffers(db, {
      gameId: game.id,
      supplierId: supplier.id,
      categoryId: category.category_id,
      offers: parsed.offers,
      fields: snapshot.fields,
      region: category.region,
      currency: category.currency,
      completeSnapshot,
      actorId: auth.session.userId,
      source: source.mode,
    });
    if (result.error) return NextResponse.json({ error: result.error }, { status: 409 });
    return NextResponse.json({
      success: result.failed === 0,
      category_id: category.category_id,
      game_id: game.id,
      complete_snapshot: completeSnapshot,
      snapshot_offer_count: snapshot.offers.length,
      ...result,
    }, { status: result.failed ? 207 : 200, headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    const status = error instanceof CatalogSourceError ? error.status : 503;
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Supplier catalog import could not be prepared.' }, { status, headers: { 'Cache-Control': 'no-store' } });
  }
}
