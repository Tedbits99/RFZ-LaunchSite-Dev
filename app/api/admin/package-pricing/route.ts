import { NextRequest, NextResponse } from 'next/server';
import { adminSupabase } from '@/lib/supabaseAdmin';
import { requireCatalogAdmin } from '@/lib/catalogAdminGuard';

export async function PATCH(req: NextRequest) {
  const session = await requireCatalogAdmin(req, 'pricing.manage');
  if (!session.ok) return session.response;
  if (!adminSupabase) return NextResponse.json({ error: 'Server-side catalog database access is not configured.' }, { status: 503 });

  try {
    const body = await req.json();
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return NextResponse.json({ error: 'A JSON object is required.' }, { status: 400 });
    }
    const supportedKeys = new Set(['id', 'price_cents', 'is_active', 'sort_order', 'badge', 'original_price_cents', 'markup_percent', 'image_url']);
    if (Object.keys(body).some((key) => !supportedKeys.has(key))) {
      return NextResponse.json({ error: 'Unsupported package pricing field.' }, { status: 400 });
    }
    const { id, price_cents, is_active, sort_order, badge, original_price_cents, markup_percent, image_url } = body;

    if (!id || typeof id !== 'string') {
      return NextResponse.json({ error: 'Package id is required' }, { status: 400 });
    }

    const db = adminSupabase;

    if (typeof is_active === 'boolean') {
      return NextResponse.json({ error: 'Direct publication toggles are disabled. Use the catalog lifecycle endpoint.' }, { status: 409 });
    }

    const hasPrice = price_cents !== undefined || original_price_cents !== undefined;
    if (hasPrice) {
      const supportedKeys = new Set(['id', 'price_cents', 'original_price_cents']);
      if (Object.keys(body).some((key) => !supportedKeys.has(key))) {
        return NextResponse.json({ error: 'Price changes must be saved separately from display metadata.' }, { status: 400 });
      }
      if (!Number.isSafeInteger(price_cents) || price_cents < 1) {
        return NextResponse.json({ error: 'price_cents must be a positive integer.' }, { status: 400 });
      }
      if (original_price_cents !== undefined && original_price_cents !== null && (!Number.isSafeInteger(original_price_cents) || original_price_cents < price_cents)) {
        return NextResponse.json({ error: 'original_price_cents must be null or an integer not below price_cents.' }, { status: 400 });
      }
      const { data, error } = await db.rpc('admin_update_package_price', {
        p_actor_id: session.session.userId,
        p_package_id: id,
        p_price_cents: price_cents,
        p_original_price_cents: original_price_cents ?? null,
        p_update_original_price: original_price_cents !== undefined,
      });
      if (error) {
        if (error.code === 'P0002') return NextResponse.json({ error: 'Package not found.' }, { status: 404 });
        if (error.code === '23514') return NextResponse.json({ error: 'Original price cannot be below the retail price.' }, { status: 409 });
        if (error.code === '42501') return NextResponse.json({ error: 'The current admin role cannot change package pricing.' }, { status: 403 });
        if (error.code === '22023') return NextResponse.json({ error: 'A positive whole-cent retail price is required.' }, { status: 400 });
        return NextResponse.json({ error: 'Package price could not be saved.' }, { status: 500 });
      }
      return NextResponse.json({ success: true, data });
    }

    const { data: current, error: currentError } = await db
      .from('packages')
      .select('id, price_cents, original_price_cents, is_active, catalog_status, supplier_offer_id, supplier_category_id, supplier_cost_usd, supplier_review_required, markup_percent, games!inner(slug)')
      .eq('id', id)
      .maybeSingle();
    if (currentError) return NextResponse.json({ error: 'Package details are temporarily unavailable.' }, { status: 500 });
    if (!current) return NextResponse.json({ error: 'Package not found' }, { status: 404 });

    const updates: Record<string, unknown> = {};

    if (price_cents !== undefined && (!Number.isSafeInteger(price_cents) || price_cents < 0)) return NextResponse.json({ error: 'price_cents must be a non-negative integer.' }, { status: 400 });
    if (price_cents !== undefined) updates.price_cents = price_cents;
    if (sort_order !== undefined && (!Number.isSafeInteger(sort_order) || sort_order < 0)) return NextResponse.json({ error: 'sort_order must be a non-negative integer.' }, { status: 400 });
    if (sort_order !== undefined) updates.sort_order = sort_order;
    if (badge !== undefined) {
      if (badge !== null && (typeof badge !== 'string' || badge.length > 80)) return NextResponse.json({ error: 'badge must be null or text up to 80 characters.' }, { status: 400 });
      updates.badge = badge || null;
    }
    if (original_price_cents !== undefined && original_price_cents !== null && (!Number.isSafeInteger(original_price_cents) || original_price_cents < 0)) return NextResponse.json({ error: 'original_price_cents must be null or a non-negative integer.' }, { status: 400 });
    if (original_price_cents !== undefined) updates.original_price_cents = original_price_cents;
    if (image_url !== undefined) {
      if (image_url !== null && image_url !== '' && typeof image_url !== 'string') return NextResponse.json({ error: 'image_url must be an HTTPS URL, empty, or null.' }, { status: 400 });
      const trimmed = typeof image_url === 'string' ? image_url.trim() : '';
      if (trimmed) {
        try {
          if (new URL(trimmed).protocol !== 'https:') throw new Error('HTTPS required');
        } catch {
          return NextResponse.json({ error: 'image_url must be a valid HTTPS URL.' }, { status: 400 });
        }
      }
      updates.image_url = trimmed || null;
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
    if (markup_percent !== undefined) {
      if (typeof markup_percent !== 'number' || !Number.isFinite(markup_percent) || markup_percent < 0 || markup_percent > 10000) return NextResponse.json({ error: 'markup_percent must be between 0 and 10000.' }, { status: 400 });
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

    if (error) return NextResponse.json({ error: 'Package display settings could not be saved.' }, { status: 500 });
    if (!updatedRows || updatedRows.length !== 1) {
      return NextResponse.json({ error: 'Package was not updated. Please refresh and try again.' }, { status: 409 });
    }
    return NextResponse.json({ success: true, data: updatedRows[0] });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof SyntaxError ? 'A valid JSON object is required.' : 'Package settings could not be saved.' },
      { status: err instanceof SyntaxError ? 400 : 500 },
    );
  }
}
