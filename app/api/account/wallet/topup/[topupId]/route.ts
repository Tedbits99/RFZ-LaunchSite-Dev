import { NextResponse } from 'next/server';
import { getActiveCustomerSession } from '@/lib/customerSession';

const allowedStatuses = new Set([
  'PENDING', 'PAID', 'FAILED', 'EXPIRED', 'CANCELLED', 'REFUND_PENDING', 'REFUNDED',
]);

export async function GET(_request: Request, { params }: { params: Promise<{ topupId: string }> }) {
  const session = await getActiveCustomerSession();
  if (!session) return NextResponse.json({ error: 'Sign in required.' }, { status: 401 });

  const { topupId } = await params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(topupId)) {
    return NextResponse.json({ error: 'Top-up not found.' }, { status: 404, headers: { 'Cache-Control': 'no-store' } });
  }

  try {
    const { data, error } = await session.client
      .from('rf_coin_topups')
      .select('id, coins, bonus_coins, price_cents, status, created_at, updated_at, credited_at')
      .eq('id', topupId)
      .eq('user_id', session.user.id)
      .maybeSingle();

    if (error) return NextResponse.json({ error: 'Could not verify the top-up status.' }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
    if (!data || !allowedStatuses.has(data.status)) {
      return NextResponse.json({ error: 'Top-up not found.' }, { status: 404, headers: { 'Cache-Control': 'no-store' } });
    }

    return NextResponse.json({
      topup: {
        id: data.id,
        coins: data.coins,
        bonusCoins: data.bonus_coins,
        priceCents: data.price_cents,
        status: data.status,
        createdAt: data.created_at,
        updatedAt: data.updated_at,
        creditedAt: data.credited_at,
      },
    }, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return NextResponse.json({ error: 'Could not verify the top-up status.' }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
  }
}
