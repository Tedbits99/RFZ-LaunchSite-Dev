import { NextResponse } from 'next/server';
import { adminSupabase } from '@/lib/supabaseAdmin';
import { getActiveCustomerSession } from '@/lib/customerSession';
import { rfCoinErrorMessage } from '@/lib/rfCoins';
import { isMissingRfCoinTable } from '@/lib/rfCoinSchema';
import { RF_COINS_FUNDING_RELEASE_ENABLED, RF_COINS_SPENDING_RELEASE_ENABLED } from '@/lib/rfCoinFundingRelease';

function unavailable(status: 'not_deployed' | 'not_configured' | 'disabled' | 'incomplete') {
  return NextResponse.json({
    wallet: null,
    packages: [],
    enabled: false,
    databaseEnabled: false,
    infrastructureReady: false,
    fundingEnabled: false,
    spendingEnabled: false,
    topupsEnabled: false,
    centavosPerCoin: null,
    walletStatus: status,
  }, { headers: { 'Cache-Control': 'no-store' } });
}

export async function GET() {
  const session = await getActiveCustomerSession();
  if (!session) return NextResponse.json({ error: 'Sign in required.' }, { status: 401 });
  if (!adminSupabase) return NextResponse.json({ error: 'Service unavailable.' }, { status: 503 });

  try {
    // Settings are server-only. A missing settings relation is distinct from
    // an installed-but-release-locked wallet; never turn either into a fake
    // zero balance.
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
    if (!settings) return unavailable('not_configured');

    const topupsAvailable = RF_COINS_FUNDING_RELEASE_ENABLED && enabled && settings.topups_enabled === true;
    const spendingAvailable = RF_COINS_SPENDING_RELEASE_ENABLED && enabled && settings.spending_enabled === true;

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
      // Only create a real zero wallet when a separately released operation
      // actually needs it. Merely viewing the wallet while money features
      // are locked must not initialize financial state.
      if (topupsAvailable || spendingAvailable) {
        const { error: initializeError } = await session.client.rpc('rf_coin_get_or_create_wallet', {
          p_user_id: session.user.id,
        });
        if (initializeError) return unavailable('incomplete');
        walletRes = await session.client
          .from('rf_coin_wallets')
          .select('user_id, balance_coins, total_purchased_coins, total_spent_coins, total_manual_credited_coins, total_manual_debited_coins, total_reversed_coins')
          .eq('user_id', session.user.id)
          .maybeSingle();
        if (walletRes.error) {
          if (isMissingRfCoinTable(walletRes.error, 'rf_coin_wallets')) return unavailable('incomplete');
          return NextResponse.json({ error: rfCoinErrorMessage(null, 'Could not load your wallet.') }, { status: 500, headers: { 'Cache-Control': 'no-store' } });
        }
      }
    }

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
      databaseEnabled: enabled,
      infrastructureReady: true,
      fundingEnabled: topupsAvailable,
      packages: topupsAvailable ? (packagesRes.data || []) : [],
      topupsEnabled: topupsAvailable,
      spendingEnabled: spendingAvailable,
      centavosPerCoin: Number.isSafeInteger(settings.centavos_per_coin) && settings.centavos_per_coin > 0
        ? settings.centavos_per_coin
        : null,
      walletStatus: 'ready',
    }, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 });
  }
}
