import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { adminSupabase } from '@/lib/supabaseAdmin';
import { requireAdmin } from '@/lib/adminGuard';
import { rfCoinErrorMessage } from '@/lib/rfCoins';

/*
  SUPER ADMIN API for the RF Coins center. All mutations run as SUPER ADMIN
  RPCs on the admin's own authenticated client, so rf_coin_assert_super_admin()
  and the audit log are enforced by the database, not the UI.
*/
  // Settings and audit have NO client policies (fail closed): read them with
  // the service-role client; everything else stays RLS-scoped.
  const db = () => adminSupabase || supabase;

export async function GET(req: NextRequest) {
  const session = await requireAdmin(req, ['SUPER_ADMIN']);
  if (!session.ok) return session.response;
  const client = db();
  if (!client) return NextResponse.json({ error: 'Database not configured.' }, { status: 503 });
  try {
    const [settingsRes, walletsRes, topupsRes, packagesRes, requestsRes, auditRes, ledgerStatsRes, ledgerRes] = await Promise.all([
      client.from('rf_coin_settings').select('*').eq('id', 1).maybeSingle(),
      client.from('rf_coin_wallets').select('user_id, balance_coins, total_purchased_coins, total_spent_coins, total_manual_credited_coins, total_manual_debited_coins, total_reversed_coins, updated_at'),
      client.from('rf_coin_topups').select('id, user_id, coins, bonus_coins, price_cents, status, provider_reference, credited_at, created_at').order('created_at', { ascending: false }).limit(100),
      client.from('rf_coin_packages').select('*').order('sort_order'),
      client.from('rf_coin_adjustment_requests').select('*').order('created_at', { ascending: false }).limit(100),
      client.from('rf_coin_admin_audit').select('*').order('created_at', { ascending: false }).limit(100),
      client.from('rf_coin_ledger').select('direction, amount_coins, kind').limit(5000),
      client.from('rf_coin_ledger').select('id, wallet_user_id, direction, amount_coins, kind, balance_after, reason, reference_type, reference_id, actor_type, idempotency_key, created_at').order('created_at', { ascending: false }).limit(100),
    ]);

    if (settingsRes.error || walletsRes.error || topupsRes.error || packagesRes.error || requestsRes.error || auditRes.error || ledgerStatsRes.error || ledgerRes.error) {
      return NextResponse.json({ error: 'RF Coins tables are not available. Feature not applied/activated.' }, { status: 503 });
    }

    const wallets = (walletsRes.data || []) as Array<Record<string, unknown>>;
    const ledgerStats = (ledgerStatsRes.data || []) as Array<{ direction: string; amount_coins: number; kind: string }>;

    const sum = (pred: (x: { direction: string; amount_coins: number; kind: string }) => boolean) =>
      ledgerStats.filter(pred).reduce((s, x) => s + Number(x.amount_coins), 0);

    return NextResponse.json({
      settings: settingsRes.data,
      wallets,
      topups: topupsRes.data || [],
      packages: packagesRes.data || [],
      adjustmentRequests: requestsRes.data || [],
      audit: auditRes.data || [],
      ledger: ledgerRes.data || [],
      metrics: {
        outstanding: wallets.reduce((s, w) => s + Number(w.balance_coins), 0),
        purchased: sum((x) => x.kind === 'topup_purchase'),
        spent: sum((x) => x.kind === 'order_payment'),
        manualCredited: sum((x) => x.kind === 'manual_credit'),
        manualDebited: sum((x) => x.kind === 'manual_debit'),
        reversed: sum((x) => x.kind === 'order_reversal' || x.kind === 'chargeback_reversal'),
        pendingTopups: (topupsRes.data || []).filter((t) => (t as { status: string }).status === 'PENDING').length,
      },
      emails: (walletsRes.data || []).length,
    }, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const session = await requireAdmin(req, ['SUPER_ADMIN']);
  if (!session.ok) return session.response;
  // rf_coin_* mutation RPCs verify the SUPER_ADMIN role inside Postgres via
  // rf_coin_assert_super_admin(), which needs the CALLER's JWT — the
  // service-role client has no auth.uid(). requireAdmin's client carries the
  // admin's own session cookies, so run every mutation through it.
  const adminClient = session.client;

  try {
    const body = await req.json();
    const action = body.action;

    if (action === 'settings') {
      const { error } = await adminClient.rpc('rf_coin_set_settings', {
        p_enabled: body.enabled ?? null,
        p_topups_enabled: body.topups_enabled ?? null,
        p_spending_enabled: body.spending_enabled ?? null,
        p_centavos_per_coin: body.centavos_per_coin ?? null,
        p_high_value_adjustment_coins: body.high_value_adjustment_coins ?? null,
        p_max_daily_admin_adjustments: body.max_daily_admin_adjustments ?? null,
      });
      if (error) return NextResponse.json({ error: rfCoinErrorMessage(error.message, 'Settings update failed.') }, { status: 400 });
      return NextResponse.json({ ok: true });
    }

    if (action === 'adjustment') {
      const { data, error } = await adminClient.rpc('rf_coin_request_adjustment', {
        p_target_user_id: body.target_user_id,
        p_direction: body.direction,
        p_amount_coins: Number(body.amount_coins),
        p_reason: body.reason,
        p_category: body.category,
        p_idempotency_key: body.idempotency_key || null,
      });
      if (error) return NextResponse.json({ error: rfCoinErrorMessage(error.message, 'Adjustment failed.') }, { status: 400 });
      const row = Array.isArray(data) ? data[0] : data;
      if (row?.out_error) return NextResponse.json({ error: rfCoinErrorMessage(row.out_error, 'Adjustment failed.') }, { status: 400 });
      return NextResponse.json({ ok: true, requestId: row?.out_request_id, status: row?.out_status });
    }

    if (action === 'decide') {
      const { data, error } = await adminClient.rpc('rf_coin_decide_adjustment', {
        p_request_id: body.request_id,
        p_approve: Boolean(body.approve),
        p_note: body.note || null,
      });
      if (error) return NextResponse.json({ error: rfCoinErrorMessage(error.message, 'Decision failed.') }, { status: 400 });
      const row = Array.isArray(data) ? data[0] : data;
      if (row?.out_error) return NextResponse.json({ error: rfCoinErrorMessage(row.out_error, 'Decision failed.') }, { status: 400 });
      return NextResponse.json({ ok: true, status: row?.out_status });
    }

    if (action === 'package') {
      const { data, error } = await adminClient.rpc('rf_coin_upsert_package', {
        p_package_id: body.package_id || null,
        p_name: body.name ?? null,
        p_coins: body.coins ?? null,
        p_bonus_coins: body.bonus_coins ?? null,
        p_price_cents: body.price_cents ?? null,
        p_is_active: body.is_active ?? null,
        p_sort_order: body.sort_order ?? null,
      });
      if (error) return NextResponse.json({ error: rfCoinErrorMessage(error.message, 'Package update failed.') }, { status: 400 });
      return NextResponse.json({ ok: true, packageId: data });
    }

    return NextResponse.json({ error: 'Unknown action.' }, { status: 400 });
  } catch {
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 });
  }
}
