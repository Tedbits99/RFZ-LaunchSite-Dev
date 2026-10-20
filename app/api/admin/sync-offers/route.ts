import { NextRequest, NextResponse } from 'next/server';
import { adminSupabase } from '@/lib/supabaseAdmin';
import { requireAdmin } from '@/lib/adminGuard';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const EDGE_URL = `${SUPABASE_URL}/functions/v1/fazercards-test`;

const ML_GAME_SLUGS = ['mobile-legends', 'mlbb'];
const ML_CATEGORY_ID = 'mobile_legends_philippines';

interface Offer {
  offer_id: string;
  name: string;
  price_usd: string;
}

interface OffersResponse {
  ok: boolean;
  category_id: string;
  name: string;
  offers: Offer[];
  fields: { key: string; label: string; type: string }[];
}

interface ExistingPackage {
  id: string;
  name: string;
  sku: string;
  supplier_offer_id: string | null;
  supplier_category_id: string | null;
  is_active: boolean;
}

export async function POST(req: NextRequest) {
  const session = await requireAdmin(req);
  if (!session.ok) return session.response;

  try {
    const body = await req.json().catch(() => ({}));
    const categoryId = (body.category_id as string) || ML_CATEGORY_ID;

    if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
      return NextResponse.json({ error: 'Server not configured' }, { status: 503 });
    }

    // Fetch offers from FazerCards via edge function
    const res = await fetch(
      `${EDGE_URL}/offers?category_id=${encodeURIComponent(categoryId)}`,
      { headers: { Authorization: `Bearer ${SERVICE_ROLE_KEY}`, apikey: SERVICE_ROLE_KEY } },
    );
    const json = await res.json().catch(() => null);
    if (!res.ok || !json?.success) {
      return NextResponse.json({ error: 'Failed to fetch FazerCards offers' }, { status: 502 });
    }

    const data = json.data as OffersResponse;
    const offers = data.offers || [];
    if (offers.length === 0) {
      return NextResponse.json({ error: 'No offers found for this category' }, { status: 404 });
    }

    const db = adminSupabase || session.client;

    // Resolve the Mobile Legends game row by slug (never hardcode UUIDs)
    const { data: mlGame, error: gameError } = await db
      .from('games')
      .select('id')
      .in('slug', ML_GAME_SLUGS)
      .limit(1)
      .maybeSingle();
    if (gameError) {
      return NextResponse.json({ error: gameError.message }, { status: 500 });
    }
    if (!mlGame) {
      return NextResponse.json({ error: 'Mobile Legends game not found in the catalog' }, { status: 404 });
    }
    const ML_GAME_ID = mlGame.id;

    // Load all packages for this game once; match by supplier offer ID OR SKU
    // (SKU encodes category + offer id, so it catches rows whose offer id was never set)
    const { data: existingPackages, error: existingError } = await db
      .from('packages')
      .select('id, name, sku, supplier_offer_id, supplier_category_id, is_active')
      .eq('game_id', ML_GAME_ID);
    if (existingError) {
      return NextResponse.json({ error: existingError.message }, { status: 500 });
    }
    const existing = (existingPackages || []) as ExistingPackage[];

    const byOffer = new Map<string, ExistingPackage>();
    const bySku = new Map<string, ExistingPackage>();
    for (const pkg of existing) {
      if (pkg.supplier_offer_id) byOffer.set(`${pkg.supplier_category_id}:${pkg.supplier_offer_id}`, pkg);
      bySku.set(pkg.sku, pkg);
    }

    const syncedSkuFor = (offerId: string) => `FC-${categoryId}-${offerId}`;

    let created = 0;
    let updated = 0;
    let failed = 0;
    const failures: string[] = [];

    for (let i = 0; i < offers.length; i++) {
      const offer = offers[i];
      const sku = syncedSkuFor(offer.offer_id);
      const cost = parseFloat(offer.price_usd);
      const match = byOffer.get(`${categoryId}:${offer.offer_id}`) || bySku.get(sku);

      if (match) {
        // Update in place — keep selling price, active flag, sort, badge unchanged
        const { error } = await db
          .from('packages')
          .update({
            name: offer.name,
            amount: offer.name,
            supplier_offer_id: offer.offer_id,
            supplier_category_id: categoryId,
            supplier_cost_usd: Number.isFinite(cost) ? cost : null,
          })
          .eq('id', match.id);
        if (error) {
          failed++;
          failures.push(`${offer.offer_id}: ${error.message}`);
          console.error(`Failed to update package for offer ${offer.offer_id}:`, error.message);
        } else {
          updated++;
        }
      } else {
        // Create new package — inactive by default, no selling price set
        const { error } = await db.from('packages').insert({
          game_id: ML_GAME_ID,
          name: offer.name,
          amount: offer.name,
          sku,
          price_cents: 0,
          is_active: false,
          sort_order: 100 + i,
          supplier_offer_id: offer.offer_id,
          supplier_category_id: categoryId,
          supplier_cost_usd: Number.isFinite(cost) ? cost : null,
          badge: null,
        });
        if (error) {
          failed++;
          failures.push(`${offer.offer_id}: ${error.message}`);
          console.error(`Failed to insert package for offer ${offer.offer_id}:`, error.message);
        } else {
          created++;
        }
      }
    }

    // Ensure the FazerCards supplier row exists before writing mappings
    const { data: fazercardsSupplier, error: supplierError } = await db
      .from('suppliers')
      .select('id')
      .eq('code', 'fazercards')
      .maybeSingle();
    if (supplierError || !fazercardsSupplier) {
      return NextResponse.json({
        success: created + updated > 0,
        category_id: categoryId,
        offers_found: offers.length,
        packages_created: created,
        packages_updated: updated,
        packages_failed: failed,
        failures,
        skipped: 0,
        warning: 'FazerCards supplier is not configured — packages synced but supplier mappings were not created',
      });
    }
    const FAZERCARDS_SUPPLIER_ID = fazercardsSupplier.id;

    // Mappings + deactivation: reload packages now linked to this category
    const { data: linkedPackages } = await db
      .from('packages')
      .select('id, supplier_offer_id, supplier_category_id')
      .eq('game_id', ML_GAME_ID)
      .eq('supplier_category_id', categoryId)
      .not('supplier_offer_id', 'is', null);

    const { data: existingMappings } = await db
      .from('supplier_package_mappings')
      .select('id, package_id')
      .eq('supplier_id', FAZERCARDS_SUPPLIER_ID);

    const mappedPackageIds = new Set((existingMappings || []).map((m) => m.package_id));

    let mappingsCreated = 0;
    let packagesDeactivated = 0;

    const syncedOfferIds = new Set(offers.map((offer) => offer.offer_id));
    for (const pkg of linkedPackages || []) {
      if (pkg.supplier_offer_id && !syncedOfferIds.has(pkg.supplier_offer_id)) {
        const { error: deactivateError } = await db
          .from('packages')
          .update({ is_active: false })
          .eq('id', pkg.id);
        if (!deactivateError) packagesDeactivated++;
      }
    }
    for (const pkg of linkedPackages || []) {
      if (mappedPackageIds.has(pkg.id)) continue;
      const { error: mapErr } = await db.from('supplier_package_mappings').insert({
        package_id: pkg.id,
        supplier_id: FAZERCARDS_SUPPLIER_ID,
        supplier_product_id: pkg.supplier_offer_id,
        supplier_cost_cents: 0,
        priority: 1,
        enabled: true,
        metadata: {
          category_id: pkg.supplier_category_id,
          offer_id: pkg.supplier_offer_id,
        },
      });
      if (mapErr) {
        console.error(`Failed to create mapping for package ${pkg.id}:`, mapErr.message);
      } else {
        mappingsCreated++;
      }
    }

    return NextResponse.json({
      success: failed === 0,
      category_id: categoryId,
      offers_found: offers.length,
      packages_created: created,
      packages_updated: updated,
      packages_failed: failed,
      failures,
      mappings_created: mappingsCreated,
      packages_deactivated: packagesDeactivated,
      skipped: 0,
    });
  } catch (err) {
    console.error('sync-offers error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 },
    );
  }
}

export async function GET(req: NextRequest) {
  const session = await requireAdmin(req);
  if (!session.ok) return session.response;

  const db = adminSupabase || session.client;

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
    .select('id, name, sku, amount, price_cents, original_price_cents, bonus, is_active, sort_order, badge, supplier_offer_id, supplier_category_id, supplier_cost_usd, markup_percent')
    .eq('game_id', mlGame.id)
    .eq('supplier_category_id', ML_CATEGORY_ID)
    .not('supplier_offer_id', 'is', null)
    .order('sort_order');

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ data });
}
