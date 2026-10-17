import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

/*
  Thin proxy to the payment-webhook Edge Function, which holds the
  PayMongo webhook secret and service-role key in the managed-secrets
  runtime. This route must never need either secret itself.

  POST ?provider=paymongo (same URL contract as before, so the PayMongo
  dashboard webhook configuration does not change).

  The Edge Function performs: HMAC signature verification (fail closed),
  order resolution, idempotency, amount validation, verify_payment,
  and fulfillment triggering.
*/

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey || !supabase) {
    return NextResponse.json({ error: 'Service unavailable.' }, { status: 503 });
  }

  try {
    const functionUrl = `${url}/functions/v1/payment-webhook${new URL(req.url).search}`;
    const res = await fetch(functionUrl, {
      method: 'POST',
      headers: {
        'Content-Type': req.headers.get('content-type') || 'application/json',
        'paymongo-signature': req.headers.get('paymongo-signature') || '',
        Authorization: `Bearer ${anonKey}`,
        apikey: anonKey,
      },
      body: await req.text(),
      signal: AbortSignal.timeout(60000),
    });

    const data = await res.json().catch(() => null);
    if (!data || typeof data !== 'object') {
      return NextResponse.json({ received: true, error: 'Webhook processing failed' }, { status: 502 });
    }
    return NextResponse.json(data, { status: res.ok ? 200 : res.status });
  } catch {
    return NextResponse.json({ received: true, error: 'Webhook processing failed' }, { status: 500 });
  }
}
