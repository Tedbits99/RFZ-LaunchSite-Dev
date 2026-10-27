import { NextResponse } from 'next/server';
import { adminSupabase } from '@/lib/supabaseAdmin';
import { getActiveCustomerSession } from '@/lib/customerSession';
import { rfCoinErrorMessage } from '@/lib/rfCoins';
import { isMissingRfCoinTable } from '@/lib/rfCoinSchema';

function unavailable(status: 'not_deployed' | 'not_configured' | 'disabled' | 'incomplete') {
  return NextResponse.json({
    wallet: null,
    packages: [],
    enabled: false,
    spendingEnabled: false,
    topupsEnabled: false,
    walletStatus: status,
  }, { headers: { 'Cache-Control': 'no-store' } });
}

export async function GET() {
  const session = await getActiveCustomerSession();
  if (!session) return NextResponse.json({ error: 'Sign in required.' }, { status: 401 });
  if (!adminSupabase) return NextResponse.json({ error: 'Service unavailable.' }, { status: 503 });

  try {
    // Settings are server-only and decide whether wallet relations should be
    // queried at all. This safely supports a project where the wallet schema
    // has not yet been deployed without mistaking infrastructure failures for
    // an empty, working wallet.
    const settingsRes = await adminSupabase
      .from('rf_coin_settings')
      .select('enabled, topups_enabled, spending_enabled, centavos_per_coin')
      .eq('id', 1)
      .maybeSingle();

    if (settingsRes.error) {
      if (isMissingRfCoinTable(settingsRes.error, 'rf_coin_settings')) return unavailable('not_deployed');
      return NextResponse.json({ error: 'Could not load wallet settings.' }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
    }

    const settings = settingsRes.data as { enabled: boolean; topups_enabled: boolean; spending_enabled: boolean; centavos_per_coin: number } | null;
    const enabled = Boolean(settings?.enabled);
    if (!enabled) return unavailable(settings ? 'disabled' : 'not_configured');

    const [walletRes, packagesRes] = await Promise.all([
      session.client
        .from('rf_coin_wallets')
        .select('user_id, balance_coins, total_purchased_coins, total_spent_coins, total_manual_credited_coins, total_manual_debited_coins, total_reversed_coins')
        .eq('user_id', session.user.id)
        .maybeSingle(),
      settings?.topups_enabled
        ? session.client
          .from('rf_coin_packages')
          .select('id, name, coins, bonus_coins, price_cents, is_active, sort_order')
          .eq('is_active', true)
          .order('sort_order', { ascending: true })
        : Promise.resolve({ data: [], error: null }),
    ]);

    if (walletRes.error) {
      if (isMissingRfCoinTable(walletRes.error, 'rf_coin_wallets')) return unavailable('incomplete');
      return NextResponse.json({ error: rfCoinErrorMessage(null, 'Could not load your wallet.') }, { status: 500, headers: { 'Cache-Control': 'no-store' } });
    }
    if (settings?.topups_enabled && packagesRes.error) {
      return NextResponse.json({ error: 'Could not load available coin packages.' }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
    }

    return NextResponse.json({
      wallet: walletRes.data || null,
      enabled,
      packages: settings?.topups_enabled ? (packagesRes.data || []) : [],
      topupsEnabled: enabled && Boolean(settings?.topups_enabled),
      spendingEnabled: enabled && Boolean(settings?.spending_enabled),
      centavosPerCoin: settings?.centavos_per_coin ?? 100,
      walletStatus: 'ready',
    }, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 });
  }
}
