import { NextRequest, NextResponse } from 'next/server';
import { adminSupabase } from '@/lib/supabaseAdmin';
import { requireCatalogAdmin } from '@/lib/catalogAdminGuard';
import { minimumSalePriceCents } from '@/lib/catalogPricing';

export async function GET(req: NextRequest) {
  const auth = await requireCatalogAdmin(req);
  if (!auth.ok) return auth.response;
  if (!adminSupabase) return NextResponse.json({ error: 'Server-side catalog database access is not configured.' }, { status: 503 });
  const gameId = new URL(req.url).searchParams.get('game_id') || '';
  if (!/^[0-9a-f-]{36}$/i.test(gameId)) return NextResponse.json({ error: 'A valid game_id is required.' }, { status: 400 });

  const db = adminSupabase;
  const [{ data: game, error: gameError }, { data: packages, error: packagesError }, { data: fields, error: fieldsError }, { data: settings, error: settingsError }, { data: supplier, error: supplierError }] = await Promise.all([
    db.from('games').select('id,slug,name,currency,region,is_active,catalog_status').eq('id', gameId).maybeSingle(),
    db.from('packages').select('id,name,amount,price_cents,original_price_cents,bonus,badge,catalog_status,is_active,supplier_offer_id,supplier_category_id,supplier_cost_usd,supplier_review_required').eq('game_id', gameId).order('sort_order'),
    db.from('game_input_fields').select('id,label,field_key,placeholder,help_text,is_required,sort_order').eq('game_id', gameId).order('sort_order'),
    db.from('app_settings').select('reference_usd_php_rate,payment_fee_reserve_bps,payment_fee_fixed_cents,supplier_fulfillment_release_enabled').eq('id', 1).maybeSingle(),
    db.from('suppliers').select('id,enabled').eq('code', 'fazercards').maybeSingle(),
  ]);
  if (gameError || packagesError || fieldsError || settingsError || supplierError) return NextResponse.json({ error: 'Storefront preview could not be loaded.' }, { status: 500 });
  if (!game) return NextResponse.json({ error: 'Game not found.' }, { status: 404 });

  const linked = (packages || []).filter((pkg) => pkg.supplier_offer_id || pkg.supplier_category_id);
  const releaseReady = process.env.RUNFAZONE_SUPPLIER_FULFILLMENT_RELEASE === 'enabled'
    && settings?.supplier_fulfillment_release_enabled === true
    && supplier?.enabled === true
    && settings.payment_fee_reserve_bps !== null
    && settings.payment_fee_fixed_cents !== null;
  const { data: mappings, error: mappingsError } = releaseReady && supplier && linked.length
    ? await db.from('supplier_package_mappings').select('package_id,supplier_product_id,enabled,metadata').eq('supplier_id', supplier.id).eq('enabled', true).in('package_id', linked.map((pkg) => pkg.id))
    : { data: [], error: null };
  if (mappingsError) return NextResponse.json({ error: 'Storefront availability could not be verified.' }, { status: 500 });
  const eligibleIds = new Set((mappings || []).filter((mapping) => {
    const pkg = linked.find((item) => item.id === mapping.package_id);
    const metadata = mapping.metadata as { category_id?: string } | null;
    const minimum = !pkg?.supplier_cost_usd || !settings?.reference_usd_php_rate
      || settings.payment_fee_reserve_bps == null || settings.payment_fee_fixed_cents == null
      ? null
      : minimumSalePriceCents(Number(pkg.supplier_cost_usd), Number(settings.reference_usd_php_rate), Number(settings.payment_fee_reserve_bps), Number(settings.payment_fee_fixed_cents));
    return Boolean(pkg?.supplier_offer_id && pkg.supplier_category_id
      && pkg.supplier_review_required === false
      && mapping.supplier_product_id === pkg.supplier_offer_id
      && metadata?.category_id === pkg.supplier_category_id
      && minimum !== null && pkg.price_cents >= minimum);
  }).map((mapping) => mapping.package_id));

  const previewPackages = (packages || []).map((pkg) => {
    const linkedSupplier = Boolean(pkg.supplier_offer_id || pkg.supplier_category_id);
    const storefrontVisible = game.is_active && game.catalog_status === 'PUBLISHED'
      && pkg.is_active && pkg.catalog_status === 'PUBLISHED' && pkg.price_cents > 0 && !pkg.supplier_review_required;
    return {
      id: pkg.id,
      name: pkg.name,
      amount: pkg.amount,
      price_cents: pkg.price_cents,
      original_price_cents: pkg.original_price_cents,
      bonus: pkg.bonus,
      badge: pkg.badge,
      catalog_status: pkg.catalog_status,
      storefront_visible: storefrontVisible,
      saleable: storefrontVisible && (!linkedSupplier || eligibleIds.has(pkg.id)),
      locked_reason: storefrontVisible && linkedSupplier && !eligibleIds.has(pkg.id) ? 'Supplier operations are locked.' : null,
    };
  });
  return NextResponse.json({
    game: { id: game.id, slug: game.slug, name: game.name, currency: game.currency, region: game.region, is_active: game.is_active, catalog_status: game.catalog_status },
    fields: fields || [],
    packages: previewPackages,
    storefront_url: `/games/${game.slug}`,
  }, { headers: { 'Cache-Control': 'no-store' } });
}
