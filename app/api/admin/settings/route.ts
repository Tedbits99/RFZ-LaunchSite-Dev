import { NextRequest, NextResponse } from 'next/server';
import { adminSupabase } from '@/lib/supabaseAdmin';
import { requireCatalogAdmin } from '@/lib/catalogAdminGuard';

export async function GET(req: NextRequest) {
  const session = await requireCatalogAdmin(req);
  if (!session.ok) return session.response;

  const db = adminSupabase || session.client;
  const { data, error } = await db.from('app_settings').select('reference_usd_php_rate,payment_fee_reserve_bps,payment_fee_fixed_cents').eq('id', 1).maybeSingle();
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({
    reference_usd_php_rate: data?.reference_usd_php_rate ?? 56,
    payment_fee_reserve_bps: data?.payment_fee_reserve_bps ?? null,
    payment_fee_fixed_cents: data?.payment_fee_fixed_cents ?? null,
  });
}

export async function PATCH(req: NextRequest) {
  const session = await requireCatalogAdmin(req);
  if (!session.ok) return session.response;

  try {
    const body = await req.json();
    const reference_usd_php_rate = body.reference_usd_php_rate;
    const payment_fee_reserve_bps = body.payment_fee_reserve_bps;
    const payment_fee_fixed_cents = body.payment_fee_fixed_cents;
    if (reference_usd_php_rate !== undefined && (typeof reference_usd_php_rate !== 'number' || reference_usd_php_rate <= 0 || reference_usd_php_rate > 1000)) return NextResponse.json({ error: 'A valid rate between 0 and 1000 is required.' }, { status: 400 });
    if (payment_fee_reserve_bps !== undefined && (!Number.isInteger(payment_fee_reserve_bps) || payment_fee_reserve_bps < 0 || payment_fee_reserve_bps >= 10000)) return NextResponse.json({ error: 'Payment fee reserve must be an integer from 0 to 9999 basis points.' }, { status: 400 });
    if (payment_fee_fixed_cents !== undefined && (!Number.isInteger(payment_fee_fixed_cents) || payment_fee_fixed_cents < 0)) return NextResponse.json({ error: 'Fixed payment fee must be a non-negative integer in cents.' }, { status: 400 });
    if (reference_usd_php_rate === undefined && payment_fee_reserve_bps === undefined && payment_fee_fixed_cents === undefined) return NextResponse.json({ error: 'At least one pricing assumption is required.' }, { status: 400 });

    const db = adminSupabase || session.client;
    const { data, error } = await db.rpc('admin_update_catalog_pricing_assumptions', {
      p_fx_rate: reference_usd_php_rate ?? null,
      p_fee_reserve_bps: payment_fee_reserve_bps ?? null,
      p_fixed_fee_cents: payment_fee_fixed_cents ?? null,
    });
    if (error) return NextResponse.json({ error: 'Pricing assumptions could not be saved.' }, { status: 500 });
    const row = Array.isArray(data) ? data[0] : data;
    return NextResponse.json({
      success: true,
      reference_usd_php_rate: row?.out_fx_rate,
      payment_fee_reserve_bps: row?.out_fee_reserve_bps,
      payment_fee_fixed_cents: row?.out_fixed_fee_cents,
      packages_requiring_review: row?.out_supplier_packages_for_review ?? 0,
      recalculated: 0,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 },
    );
  }
}
