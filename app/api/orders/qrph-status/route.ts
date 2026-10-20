import { NextRequest, NextResponse } from 'next/server';
import { adminSupabase } from '@/lib/supabaseAdmin';
import { authorizeOrderRequest } from '@/lib/orderCapability';

/*
  Check the status of a QR Ph payment for an order.
  Used by the checkout page to poll whether the customer has paid.

  GET ?orderReference=...&email=...

  Returns the order status so the frontend can update without relying
  solely on realtime subscriptions. The actual payment verification
  happens via webhook — this endpoint only reads current state.
*/

export async function GET(req: NextRequest) {
  if (!adminSupabase) {
    return NextResponse.json({ error: 'Service unavailable.' }, { status: 503 });
  }

  try {
    const { searchParams } = new URL(req.url);
    const orderReference = searchParams.get('orderReference');
    const email = searchParams.get('email');

    if (!orderReference) {
      return NextResponse.json({ error: 'Order reference is required.' }, { status: 400 });
    }

    const { data: order } = await adminSupabase
      .from('orders')
      .select('id, reference, customer_user_id, email, status')
      .eq('reference', String(orderReference).toUpperCase().trim())
      .maybeSingle();

    if (!order
      || (email && order.email.trim().toLowerCase() !== String(email).trim().toLowerCase())
      || !await authorizeOrderRequest(req, order)) {
      return NextResponse.json({ error: 'Order not found.' }, { status: 404 });
    }

    return NextResponse.json({ status: order.status });
  } catch {
    return NextResponse.json({ error: 'Could not check order status.' }, { status: 500 });
  }
}
