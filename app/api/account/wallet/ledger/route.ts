import { NextResponse } from 'next/server';
import { getActiveCustomerSession } from '@/lib/customerSession';

export async function GET() {
  const session = await getActiveCustomerSession();
  if (!session) return NextResponse.json({ error: 'Sign in required.' }, { status: 401 });

  try {
    const { data, error } = await session.client
      .from('rf_coin_ledger')
      .select('id, direction, amount_coins, kind, balance_after, reason, reference_type, reference_id, created_at')
      .eq('wallet_user_id', session.user.id)
      .order('created_at', { ascending: false })
      .limit(100);

    if (error) return NextResponse.json({ error: 'Could not load your transaction history.' }, { status: 500 });
    return NextResponse.json({ entries: data || [] }, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 });
  }
}
