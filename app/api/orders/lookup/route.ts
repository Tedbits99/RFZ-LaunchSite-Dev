import { NextRequest, NextResponse } from 'next/server';
import { adminSupabase } from '@/lib/supabaseAdmin';
import { isOrderOwner, normalizeOrderEmail } from '@/lib/orderAccess';
import { authorizeOrderRequest } from '@/lib/orderCapability';

async function lookup(req: NextRequest, refValue: unknown, emailValue: unknown) {
  const db = adminSupabase;
  if (!db) {
    return NextResponse.json({ error: 'Service unavailable.' }, { status: 503 });
  }

  const ref = typeof refValue === 'string' ? refValue.trim().toUpperCase() : '';
  const email = normalizeOrderEmail(emailValue);

  if (!ref) {
    return NextResponse.json({ error: 'Reference is required.' }, { status: 400 });
  }

  const { data: order, error } = await db
    .from('orders')
    .select('id, reference, email, status, total_cents, created_at, updated_at, payment_method, customer_user_id, games(name), packages(name)')
    .eq('reference', ref)
    .maybeSingle();

  if (error || !order || (email && !isOrderOwner(email, order.email)) || !await authorizeOrderRequest(req, order)) {
    return NextResponse.json({ error: 'No order found. Check your reference and email.' }, { status: 404 });
  }

  const { data: timeline } = await db
    .from('order_timeline')
    .select('id, status, note, created_at')
    .eq('order_id', order.id)
    .order('created_at', { ascending: true });

  const { customer_user_id: _ownerId, ...safeOrder } = order;
  return NextResponse.json({ order: safeOrder, timeline: timeline || [] }, { headers: { 'Cache-Control': 'no-store' } });
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  return lookup(req, searchParams.get('ref'), searchParams.get('email'));
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    return lookup(req, body.ref, body.email);
  } catch {
    return NextResponse.json({ error: 'Reference is required.' }, { status: 400 });
  }
}
