import { NextRequest, NextResponse } from 'next/server';
import { adminSupabase } from '@/lib/supabaseAdmin';
import { requireAdmin } from '@/lib/adminGuard';

export async function PATCH(req: NextRequest) {
  const session = await requireAdmin(req);
  if (!session.ok) return session.response;

  try {
    const body = await req.json();
    const { id, price_cents, is_active, sort_order, badge, original_price_cents, markup_percent, image_url } = body;

    if (!id || typeof id !== 'string') {
      return NextResponse.json({ error: 'Package id is required' }, { status: 400 });
    }

    const db = adminSupabase || session.client;

    const { data: current, error: currentError } = await db
      .from('packages')
      .select('id, price_cents, is_active, supplier_offer_id, supplier_category_id, supplier_cost_usd, markup_percent, games!inner(slug)')
      .eq('id', id)
      .maybeSingle();
    if (currentError) return NextResponse.json({ error: currentError.message }, { status: 500 });
    if (!current) return NextResponse.json({ error: 'Package not found' }, { status: 404 });

    const updates: Record<string, unknown> = {};

    if (typeof price_cents === 'number' && price_cents >= 0) {
      updates.price_cents = price_cents;
    }
    if (typeof is_active === 'boolean') {
      updates.is_active = is_active;
    }
    if (typeof sort_order === 'number') {
      updates.sort_order = sort_order;
    }
    if (badge !== undefined) {
      updates.badge = badge || null;
    }
    if (typeof original_price_cents === 'number') {
      updates.original_price_cents = original_price_cents || null;
    }
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
    const nextActive = typeof updates.is_active === 'boolean' ? updates.is_active : current.is_active;
    const game = Array.isArray(current.games) ? current.games[0] : current.games;

    if (nextActive && (game?.slug === 'mobile-legends' || game?.slug === 'mlbb')) {
      if (!current.supplier_offer_id || current.supplier_category_id !== 'mobile_legends_philippines') {
        return NextResponse.json({ error: 'This package has no valid Mobile Legends FazerCards offer.' }, { status: 400 });
      }

      const { data: supplier } = await db
        .from('suppliers')
        .select('id')
        .eq('code', 'fazercards')
        .eq('enabled', true)
        .maybeSingle();
      if (!supplier) return NextResponse.json({ error: 'FazerCards supplier is not enabled.' }, { status: 400 });

      const { data: mapping } = await db
        .from('supplier_package_mappings')
        .select('id')
        .eq('package_id', id)
        .eq('supplier_id', supplier.id)
        .eq('enabled', true)
        .eq('supplier_product_id', current.supplier_offer_id)
        .maybeSingle();
      if (!mapping) return NextResponse.json({ error: 'Configure the FazerCards mapping before activating this package.' }, { status: 400 });
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
