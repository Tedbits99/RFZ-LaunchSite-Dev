import { NextRequest, NextResponse } from 'next/server';
import { adminSupabase } from '@/lib/supabaseAdmin';
import { isOrderOwner, normalizeOrderEmail } from '@/lib/orderAccess';
import { authorizeOrderRequest } from '@/lib/orderCapability';

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const client = adminSupabase;
  if (!client) {
    return NextResponse.json({ error: 'Service unavailable.' }, { status: 503 });
  }
  const { searchParams } = new URL(req.url);
  const email = normalizeOrderEmail(searchParams.get('email'));

  let orderQuery = client
    .from('orders')
    .select('id, reference, customer_user_id, status, payment_status, fulfillment_status, updated_at, email')
    .eq('id', params.id);

  const { data: order } = await orderQuery.maybeSingle();

  if (!order || (email && !isOrderOwner(email, order.email)) || !await authorizeOrderRequest(req, order)) {
    return NextResponse.json({ error: 'Order not found.' }, { status: 404 });
  }

  const { data: timeline } = await client
    .from('order_timeline')
    .select('id, status, note, created_at')
    .eq('order_id', params.id)
    .order('created_at', { ascending: true });

  return NextResponse.json({
    status: order.status,
    payment_status: order.payment_status,
    fulfillment_status: order.fulfillment_status,
    updated_at: order.updated_at,
    timeline: timeline || [],
  }, { headers: { 'Cache-Control': 'no-store' } });
}
