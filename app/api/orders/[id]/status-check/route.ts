import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { adminSupabase } from '@/lib/supabaseAdmin';
import { isOrderOwner, normalizeOrderEmail } from '@/lib/orderAccess';

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const client = adminSupabase || supabase;
  if (!client) {
    return NextResponse.json({ error: 'Service unavailable.' }, { status: 503 });
  }
  const { searchParams } = new URL(req.url);
  const email = normalizeOrderEmail(searchParams.get('email'));
  if (!email) {
    return NextResponse.json({ error: 'Email is required to verify order ownership.' }, { status: 401 });
  }

  let orderQuery = client
    .from('orders')
    .select('id, status, payment_status, fulfillment_status, updated_at, email')
    .eq('id', params.id);

  const { data: order } = await orderQuery.maybeSingle();

  if (!order || !isOrderOwner(email, order.email)) {
    return NextResponse.json({ error: 'Order not found.' }, { status: 404 });
  }

  const { data: timeline } = await client
    .from('order_timeline')
    .select('id, status, actor_email, note, created_at')
    .eq('order_id', params.id)
    .order('created_at', { ascending: true });

  return NextResponse.json({
    status: order.status,
    payment_status: order.payment_status,
    fulfillment_status: order.fulfillment_status,
    updated_at: order.updated_at,
    timeline: timeline || [],
  });
}
