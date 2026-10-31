import { NextRequest, NextResponse } from 'next/server';
import { adminSupabase } from '@/lib/supabaseAdmin';
import { requireCatalogAdmin } from '@/lib/catalogAdminGuard';
import { importSupplierOffers, MOBILE_LEGENDS_CATEGORY_ID, validateSupplierOffers } from '@/lib/supplierCatalogImport';

export async function POST(req: NextRequest) {
  const auth = await requireCatalogAdmin(req);
  if (!auth.ok) return auth.response;
  if (!adminSupabase) return NextResponse.json({ error: 'Server-side catalog database access is not configured.' }, { status: 503 });
  const db = adminSupabase;
  const body = await req.json().catch(() => null) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
  const categoryId = typeof body.category_id === 'string' ? body.category_id : '';
  if (categoryId !== MOBILE_LEGENDS_CATEGORY_ID) return NextResponse.json({ error: 'Only the approved Mobile Legends supplier category can be imported.' }, { status: 400 });
  if (body.complete_snapshot !== undefined && typeof body.complete_snapshot !== 'boolean') return NextResponse.json({ error: 'complete_snapshot must be a boolean.' }, { status: 400 });
  const parsed = validateSupplierOffers(body.offers);
  if (parsed.error || !parsed.offers) return NextResponse.json({ error: parsed.error || 'Invalid offers.' }, { status: 400 });

  const [{ data: game, error: gameError }, { data: supplier, error: supplierError }, { data: settings, error: settingsError }] = await Promise.all([
    db.from('games').select('id,slug').eq('slug', 'mobile-legends').maybeSingle(),
    db.from('suppliers').select('id').eq('code', 'fazercards').maybeSingle(),
    db.from('app_settings').select('reference_usd_php_rate,payment_fee_reserve_bps,payment_fee_fixed_cents').eq('id', 1).maybeSingle(),
  ]);
  if (gameError || supplierError || settingsError || !game || !supplier || !settings) return NextResponse.json({ error: 'Catalog import is not configured.' }, { status: 503 });

  const result = await importSupplierOffers(db, {
    gameId: game.id,
    supplierId: supplier.id,
    categoryId,
    completeSnapshot: body.complete_snapshot === true,
    offers: parsed.offers,
    fxRate: Number(settings.reference_usd_php_rate),
    feeReserveBps: settings.payment_fee_reserve_bps == null ? null : Number(settings.payment_fee_reserve_bps),
    fixedFeeCents: settings.payment_fee_fixed_cents == null ? null : Number(settings.payment_fee_fixed_cents),
  });
  if (result.error) return NextResponse.json({ error: result.error }, { status: 409 });
  return NextResponse.json({ success: result.failed === 0, category_id: categoryId, ...result }, { status: result.failed ? 207 : 200 });
}
