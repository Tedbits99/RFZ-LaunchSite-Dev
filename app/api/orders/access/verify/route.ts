import { createHash, randomBytes } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { adminSupabase } from '@/lib/supabaseAdmin';
import { isOrderOwner, normalizeOrderEmail } from '@/lib/orderAccess';
import { orderCapabilityCookieName } from '@/lib/orderCapability';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  if (!adminSupabase) {
    return NextResponse.json({ error: 'Order recovery is temporarily unavailable.' }, { status: 503 });
  }

  try {
    const body = await req.json();
    const reference = typeof body.reference === 'string' ? body.reference.trim().toUpperCase() : '';
    const email = normalizeOrderEmail(body.email);
    const code = typeof body.code === 'string' ? body.code.trim() : '';
    if (!/^RF-[A-HJ-NP-Z2-9]{6}$/.test(reference) || !email || !/^[A-Za-z0-9_-]{40,64}$/.test(code)) {
      return NextResponse.json({ error: 'The recovery code is invalid or expired.' }, { status: 400 });
    }

    const capability = randomBytes(32).toString('base64url');
    const { data: orderId, error } = await adminSupabase.rpc('consume_guest_order_access_challenge', {
      p_reference: reference,
      p_email: email,
      p_code_hash: createHash('sha256').update(code).digest('hex'),
      p_capability_hash: createHash('sha256').update(capability).digest('hex'),
    });
    if (error || typeof orderId !== 'string') {
      return NextResponse.json({ error: 'The recovery code is invalid or expired.' }, { status: 400 });
    }

    const { data: order } = await adminSupabase
      .from('orders')
      .select('id, reference, email')
      .eq('id', orderId)
      .maybeSingle();
    if (!order || !isOrderOwner(email, order.email)) {
      return NextResponse.json({ error: 'The recovery code is invalid or expired.' }, { status: 400 });
    }

    const response = NextResponse.json({ success: true, message: 'Order access verified.' }, {
      headers: { 'Cache-Control': 'no-store' },
    });
    response.cookies.set(orderCapabilityCookieName(order.reference), capability, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 60 * 24 * 60 * 60,
    });
    return response;
  } catch {
    return NextResponse.json({ error: 'The recovery code is invalid or expired.' }, { status: 400 });
  }
}
