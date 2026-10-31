import { NextRequest, NextResponse } from 'next/server';
import { adminSupabase } from '@/lib/supabaseAdmin';
import { requireCatalogAdmin } from '@/lib/catalogAdminGuard';
import { minimumSalePriceCents } from '@/lib/catalogPricing';

export async function PATCH(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const auth = await requireCatalogAdmin(req);
  if (!auth.ok) return auth.response;
  if (!adminSupabase) return NextResponse.json({ error: 'Server-side catalog database access is not configured.' }, { status: 503 });
  const { id } = await context.params;
  const db = adminSupabase;
  const body = await req.json().catch(() => null) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
  const { data: current, error: currentError } = await db.from('packages').select('id,game_id,price_cents,original_price_cents,is_active,catalog_status,supplier_cost_usd,supplier_offer_id,supplier_category_id,supplier_review_required').eq('id', id).maybeSingle();
  if (currentError) return NextResponse.json({ error: 'Could not load package.' }, { status: 500 });
  if (!current) return NextResponse.json({ error: 'Package not found.' }, { status: 404 });
  const action = typeof body.action === 'string' ? body.action : null;
  if (action) {
    if (!['publish', 'hide', 'archive', 'restore'].includes(action)) return NextResponse.json({ error: 'Unsupported package action.' }, { status: 400 });
    if (action === 'publish') {
      const price = typeof body.price_cents === 'number' ? body.price_cents : current.price_cents;
      if (!Number.isInteger(price) || price <= 0) return NextResponse.json({ error: 'A positive integer price is required.' }, { status: 400 });
      const supplierLinked = Boolean(current.supplier_offer_id || current.supplier_category_id);
      const { data: setting, error: settingError } = await db.from('app_settings').select('reference_usd_php_rate,payment_fee_reserve_bps,payment_fee_fixed_cents,supplier_fulfillment_release_enabled').eq('id', 1).maybeSingle();
      if (settingError || !setting) return NextResponse.json({ error: 'Pricing assumptions are unavailable.' }, { status: 409 });
      const cost = Number(current.supplier_cost_usd || 0);
      if (cost > 0) {
        if (setting.payment_fee_reserve_bps == null || setting.payment_fee_fixed_cents == null) return NextResponse.json({ error: 'Configure an approved payment fee reserve before publishing supplier-linked packages.' }, { status: 409 });
        const minimum = minimumSalePriceCents(cost, Number(setting.reference_usd_php_rate), Number(setting.payment_fee_reserve_bps), Number(setting.payment_fee_fixed_cents));
        if (minimum === null || price < minimum) return NextResponse.json({ error: 'Price does not cover supplier cost plus the configured payment fee reserve.' }, { status: 409 });
      }
      if (supplierLinked) {
        if (!current.supplier_offer_id || !current.supplier_category_id) return NextResponse.json({ error: 'This supplier offer does not have a valid category and offer identity.' }, { status: 409 });
        if (!Number.isFinite(cost) || cost <= 0) return NextResponse.json({ error: 'A positive supplier cost is required before this offer can be published.' }, { status: 409 });
        if (setting.payment_fee_reserve_bps == null || setting.payment_fee_fixed_cents == null) return NextResponse.json({ error: 'Configure an approved payment fee reserve before publishing supplier-linked packages.' }, { status: 409 });
        const { data: supplier } = await db.from('suppliers').select('id').eq('code', 'fazercards').maybeSingle();
        const { data: mapping } = supplier ? await db.from('supplier_package_mappings').select('id,metadata').eq('package_id', id).eq('supplier_id', supplier.id).eq('supplier_product_id', current.supplier_offer_id).maybeSingle() : { data: null };
        const metadata = mapping?.metadata as { category_id?: string } | null;
        if (!mapping || metadata?.category_id !== current.supplier_category_id) return NextResponse.json({ error: 'A matching supplier offer mapping is required.' }, { status: 409 });
        // Catalog publication makes an approved product visible only. The
        // fulfillment lock and disabled mapping remain authoritative at checkout.
      }
      if (current.supplier_review_required && body.acknowledge_supplier_review !== true) return NextResponse.json({ error: 'Acknowledge the supplier cost, FX rate, and fee reserve review before publishing.' }, { status: 409 });
    }
    const next = action === 'publish'
      ? { catalog_status: 'PUBLISHED', is_active: true, published_at: new Date().toISOString(), archived_at: null, supplier_review_required: false }
      : action === 'hide'
        ? { catalog_status: 'DRAFT', is_active: false, published_at: null }
        : action === 'archive'
          ? { catalog_status: 'ARCHIVED', is_active: false, published_at: null, archived_at: new Date().toISOString() }
          : { catalog_status: 'DRAFT', is_active: false, published_at: null, archived_at: null };
    const { data, error } = await db.from('packages').update(next).eq('id', id).select().single();
    if (error) return NextResponse.json({ error: 'Package lifecycle update failed.' }, { status: 500 });
    return NextResponse.json({ data });
  }
  const updates: Record<string, unknown> = {};
  for (const key of ['name', 'amount', 'bonus', 'badge']) if (body[key] !== undefined) {
    const value = body[key];
    if (value !== null && typeof value !== 'string') return NextResponse.json({ error: `${key} must be text.` }, { status: 400 });
    updates[key] = typeof value === 'string' ? value.trim() || null : null;
  }
  for (const key of ['price_cents', 'sort_order']) if (body[key] !== undefined) {
    if (!Number.isSafeInteger(body[key]) || Number(body[key]) < 0) return NextResponse.json({ error: `${key} must be a non-negative integer.` }, { status: 400 });
    updates[key] = body[key];
  }
  if (body.original_price_cents !== undefined) {
    if (body.original_price_cents !== null && (!Number.isSafeInteger(body.original_price_cents) || Number(body.original_price_cents) < 0)) return NextResponse.json({ error: 'original_price_cents must be null or a non-negative integer.' }, { status: 400 });
    updates.original_price_cents = body.original_price_cents;
  }
  const packageName = updates.name;
  const packageAmount = updates.amount;
  if (packageName !== undefined && (typeof packageName !== 'string' || !packageName.trim() || packageName.length > 180)) return NextResponse.json({ error: 'Package name must be 1 to 180 characters.' }, { status: 400 });
  if (packageAmount !== undefined && (typeof packageAmount !== 'string' || !packageAmount.trim() || packageAmount.length > 180)) return NextResponse.json({ error: 'Package amount must be 1 to 180 characters.' }, { status: 400 });
  for (const key of ['bonus', 'badge']) {
    const value = updates[key];
    if (typeof value === 'string' && value.length > 180) return NextResponse.json({ error: `${key} must be at most 180 characters.` }, { status: 400 });
  }
  if (body.image_url !== undefined) {
    if (body.image_url !== null && body.image_url !== '' && (typeof body.image_url !== 'string' || !body.image_url.startsWith('https://'))) return NextResponse.json({ error: 'image_url must be HTTPS.' }, { status: 400 });
    updates.image_url = typeof body.image_url === 'string' ? body.image_url.trim() || null : null;
  }
  const nextPrice = typeof updates.price_cents === 'number' ? updates.price_cents : current.price_cents;
  const nextOriginalPrice = updates.original_price_cents === null ? null : typeof updates.original_price_cents === 'number' ? updates.original_price_cents : current.original_price_cents;
  if (nextOriginalPrice !== null && nextOriginalPrice < nextPrice) return NextResponse.json({ error: 'original_price_cents cannot be below price_cents.' }, { status: 400 });
  if (typeof updates.price_cents === 'number' && updates.price_cents !== current.price_cents) {
    updates.catalog_status = 'DRAFT';
    updates.is_active = false;
    updates.published_at = null;
    if (current.supplier_offer_id || current.supplier_category_id) updates.supplier_review_required = true;
  }
  if (!Object.keys(updates).length) return NextResponse.json({ error: 'No fields to update.' }, { status: 400 });
  const { data, error } = await db.from('packages').update(updates).eq('id', id).select().single();
  if (error) return NextResponse.json({ error: 'Package could not be updated.' }, { status: 500 });
  return NextResponse.json({ data });
}
