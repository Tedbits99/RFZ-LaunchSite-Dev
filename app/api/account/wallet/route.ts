import { NextResponse } from 'next/server';
import { adminSupabase } from '@/lib/supabaseAdmin';
import { getActiveCustomerSession } from '@/lib/customerSession';
import { rfCoinErrorMessage } from '@/lib/rfCoins';
import { isMissingRfCoinTable } from '@/lib/rfCoinSchema';
import { RF_COINS_FUNDING_RELEASE_ENABLED } from '@/lib/rfCoinFundingRelease';

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

    let walletRes = await session.client
      .from('rf_coin_wallets')
      .select('user_id, balance_coins, total_purchased_coins, total_spent_coins, total_manual_credited_coins, total_manual_debited_coins, total_reversed_coins')
      .eq('user_id', session.user.id)
      .maybeSingle();

    if (walletRes.error) {
      if (isMissingRfCoinTable(walletRes.error, 'rf_coin_wallets')) return unavailable('incomplete');
      return NextResponse.json({ error: rfCoinErrorMessage(null, 'Could not load your wallet.') }, { status: 500, headers: { 'Cache-Control': 'no-store' } });
    }

    if (!walletRes.data) {
      // Create a real, zero-balance wallet only for this verified active
      // customer. The SECURITY DEFINER RPC checks auth.uid() = p_user_id;
      // direct browser INSERT remains revoked and the follow-up read stays
      // under the customer's own RLS session.
      const { error: initializeError } = await session.client.rpc('rf_coin_get_or_create_wallet', {
        p_user_id: session.user.id,
      });
      if (initializeError) return unavailable('incomplete');
      walletRes = await session.client
        .from('rf_coin_wallets')
        .select('user_id, balance_coins, total_purchased_coins, total_spent_coins, total_manual_credited_coins, total_manual_debited_coins, total_reversed_coins')
        .eq('user_id', session.user.id)
        .maybeSingle();
      if (walletRes.error || !walletRes.data) return unavailable('incomplete');
    }

    const topupsAvailable = RF_COINS_FUNDING_RELEASE_ENABLED && enabled && Boolean(settings?.topups_enabled);
    const packagesRes = topupsAvailable
      ? await session.client
        .from('rf_coin_packages')
        .select('id, name, coins, bonus_coins, price_cents, is_active, sort_order')
        .eq('is_active', true)
        .order('sort_order', { ascending: true })
      : { data: [], error: null };

    if (topupsAvailable && packagesRes.error) {
      return NextResponse.json({ error: 'Could not load available coin packages.' }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
    }

    return NextResponse.json({
      wallet: walletRes.data || null,
      enabled,
      packages: topupsAvailable ? (packagesRes.data || []) : [],
      topupsEnabled: topupsAvailable,
      spendingEnabled: enabled && Boolean(settings?.spending_enabled),
      centavosPerCoin: settings?.centavos_per_coin ?? 100,
      walletStatus: 'ready',
    }, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 });
  }
}
