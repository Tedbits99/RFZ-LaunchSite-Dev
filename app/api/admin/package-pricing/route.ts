import { NextRequest, NextResponse } from 'next/server';
import { adminSupabase } from '@/lib/supabaseAdmin';
import { requireCatalogAdmin } from '@/lib/catalogAdminGuard';

export async function PATCH(req: NextRequest) {
  const session = await requireCatalogAdmin(req);
  if (!session.ok) return session.response;
  if (!adminSupabase) return NextResponse.json({ error: 'Server-side catalog database access is not configured.' }, { status: 503 });

  try {
    const body = await req.json();
    const { id, price_cents, is_active, sort_order, badge, original_price_cents, markup_percent, image_url } = body;

    if (!id || typeof id !== 'string') {
      return NextResponse.json({ error: 'Package id is required' }, { status: 400 });
    }

    const db = adminSupabase;

    if (typeof is_active === 'boolean') {
      return NextResponse.json({ error: 'Direct publication toggles are disabled. Use the catalog lifecycle endpoint.' }, { status: 409 });
    }

    const { data: current, error: currentError } = await db
      .from('packages')
      .select('id, price_cents, original_price_cents, is_active, catalog_status, supplier_offer_id, supplier_category_id, supplier_cost_usd, supplier_review_required, markup_percent, games!inner(slug)')
      .eq('id', id)
      .maybeSingle();
    if (currentError) return NextResponse.json({ error: currentError.message }, { status: 500 });
    if (!current) return NextResponse.json({ error: 'Package not found' }, { status: 404 });

    const updates: Record<string, unknown> = {};

    if (price_cents !== undefined && (!Number.isSafeInteger(price_cents) || price_cents < 0)) return NextResponse.json({ error: 'price_cents must be a non-negative integer.' }, { status: 400 });
    if (price_cents !== undefined) updates.price_cents = price_cents;
    if (sort_order !== undefined && (!Number.isSafeInteger(sort_order) || sort_order < 0)) return NextResponse.json({ error: 'sort_order must be a non-negative integer.' }, { status: 400 });
    if (sort_order !== undefined) updates.sort_order = sort_order;
    if (badge !== undefined) {
      updates.badge = badge || null;
    }
    if (original_price_cents !== undefined && original_price_cents !== null && (!Number.isSafeInteger(original_price_cents) || original_price_cents < 0)) return NextResponse.json({ error: 'original_price_cents must be null or a non-negative integer.' }, { status: 400 });
    if (original_price_cents !== undefined) updates.original_price_cents = original_price_cents;
    if (image_url !== undefined) {
      const trimmed = typeof image_url === 'string' ? image_url.trim() : '';
      updates.image_url = trimmed.startsWith('https://') ? trimmed : null;
    }

    // Back-calculate markup_percent from the new selling price so the
    // current margin is preserved on future FX-rate recalculations.
    // cost_php = supplier_cost_usd × usd_php_rate; we need the rate to compute it.
    if (typeof price_cents === 'number' && price_cents > 0 && current.supplier_cost_usd) {
      const costUsd = parseFloat(String(current.supplier_cost_usd));
      if (costUsd > 0) {
        const { data: settings } = await db
          .from('app_settings')
          .select('reference_usd_php_rate')
          .eq('id', 1)
          .maybeSingle();
        const rate = settings?.reference_usd_php_rate ? parseFloat(String(settings.reference_usd_php_rate)) : 56;
        const costPHP = costUsd * rate;
        const sellingPHP = price_cents / 100;
        if (costPHP > 0) {
          const computedMarkup = ((sellingPHP / costPHP) - 1) * 100;
          updates.markup_percent = Math.round(computedMarkup * 100) / 100;
        }
      }
    }
    // Allow explicit markup_percent override if provided
    if (typeof markup_percent === 'number' && markup_percent >= 0) {
      updates.markup_percent = markup_percent;
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: 'No fields to update' }, { status: 400 });
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

    const { data: updatedRows, error } = await db
      .from('packages')
      .update(updates)
      .eq('id', id)
      .select('id, price_cents, is_active, sort_order, badge, original_price_cents, markup_percent, image_url');

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!updatedRows || updatedRows.length !== 1) {
      return NextResponse.json({ error: 'Package was not updated. Please refresh and try again.' }, { status: 409 });
    }
    return NextResponse.json({ success: true, data: updatedRows[0] });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 },
    );
  }
}
