import { NextRequest, NextResponse } from 'next/server';
import { adminSupabase } from '@/lib/supabaseAdmin';
import { supabase } from '@/lib/supabase';
import { requireAdmin } from '@/lib/adminGuard';

export async function GET(req: NextRequest) {
  const session = await requireAdmin(req);
  if (!session.ok) return session.response;

  const db = adminSupabase || session.client;
  const { data, error } = await db.from('app_settings').select('reference_usd_php_rate').eq('id', 1).maybeSingle();
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ reference_usd_php_rate: data?.reference_usd_php_rate ?? 56 });
}

export async function PATCH(req: NextRequest) {
  const session = await requireAdmin(req);
  if (!session.ok) return session.response;

  try {
    const body = await req.json();
    const { reference_usd_php_rate } = body;

    if (typeof reference_usd_php_rate !== 'number' || reference_usd_php_rate <= 0 || reference_usd_php_rate > 1000) {
      return NextResponse.json({ error: 'A valid rate between 0 and 1000 is required' }, { status: 400 });
    }

    const db = adminSupabase || session.client;

    const { data, error } = await db
      .from('app_settings')
      .upsert({ id: 1, reference_usd_php_rate, updated_at: new Date().toISOString() }, { onConflict: 'id' })
      .select('reference_usd_php_rate')
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Auto-recalculate selling prices for all ML packages that have a
    // markup_percent and supplier_cost_usd, using the new FX rate.
    // formula: price_cents = round(supplier_cost_usd × rate × (1 + markup/100) × 100)
    const { data: mlPackages } = await db
      .from('packages')
      .select('id, supplier_cost_usd, markup_percent, supplier_category_id')
      .eq('supplier_category_id', 'mobile_legends_philippines')
      .not('markup_percent', 'is', null)
      .not('supplier_cost_usd', 'is', null);

    let recalculated = 0;
    for (const pkg of mlPackages || []) {
      const costUsd = parseFloat(String(pkg.supplier_cost_usd));
      const markup = parseFloat(String(pkg.markup_percent));
      if (costUsd > 0 && !Number.isNaN(markup)) {
        const costPHP = costUsd * reference_usd_php_rate;
        const sellingPHP = costPHP * (1 + markup / 100);
        const priceCents = Math.round(sellingPHP * 100);
        await db.from('packages').update({ price_cents: priceCents }).eq('id', pkg.id);
        recalculated++;
      }
    }

    return NextResponse.json({ success: true, reference_usd_php_rate: data.reference_usd_php_rate, recalculated });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 },
    );
  }
}
