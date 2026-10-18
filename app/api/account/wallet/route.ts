import { NextResponse } from 'next/server';
import { adminSupabase } from '@/lib/supabaseAdmin';
import { getActiveCustomerSession } from '@/lib/customerSession';
import { rfCoinErrorMessage } from '@/lib/rfCoins';

export async function GET() {
  const session = await getActiveCustomerSession();
  if (!session) return NextResponse.json({ error: 'Sign in required.' }, { status: 401 });
  if (!adminSupabase) return NextResponse.json({ error: 'Service unavailable.' }, { status: 503 });

  try {
    // Wallet and packages are RLS-readable by the customer's own JWT; the
    // settings row has no client policy (fail closed) and is read server-side.
    const [walletRes, packagesRes, settingsRes] = await Promise.all([
      session.client
        .from('rf_coin_wallets')
        .select('user_id, balance_coins, total_purchased_coins, total_spent_coins, total_manual_credited_coins, total_manual_debited_coins, total_reversed_coins')
        .eq('user_id', session.user.id)
        .maybeSingle(),
      session.client
        .from('rf_coin_packages')
        .select('id, name, coins, bonus_coins, price_cents, is_active, sort_order')
        .eq('is_active', true)
        .order('sort_order', { ascending: true }),
      adminSupabase
        .from('rf_coin_settings')
        .select('enabled, topups_enabled, spending_enabled, centavos_per_coin')
        .eq('id', 1)
        .maybeSingle(),
    ]);

    if (walletRes.error) {
      return NextResponse.json({ error: rfCoinErrorMessage(null, 'Could not load your wallet.') }, { status: 500 });
    }

    const settings = settingsRes.data as { enabled: boolean; topups_enabled: boolean; spending_enabled: boolean; centavos_per_coin: number } | null;
    const enabled = Boolean(settings?.enabled);

    return NextResponse.json({
      wallet: walletRes.data || null,
      packages: enabled ? (packagesRes.data || []) : [],
      topupsEnabled: enabled && Boolean(settings?.topups_enabled),
      spendingEnabled: enabled && Boolean(settings?.spending_enabled),
      centavosPerCoin: settings?.centavos_per_coin ?? 100,
    }, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 });
  }
}
