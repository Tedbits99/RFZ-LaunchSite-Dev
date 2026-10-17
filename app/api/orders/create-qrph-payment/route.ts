import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

/*
  Thin proxy to the create-qrph-payment Edge Function, which holds the
  PayMongo secret and service-role key in the managed-secrets runtime.
  This route must never need either secret itself.

  POST body: { orderReference, email }
  Response format is identical to the Edge Function's (and to the previous
  direct-PayMongo implementation), so the checkout UI is unchanged.
*/

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey || !supabase) {
    return NextResponse.json({ error: 'Service unavailable.' }, { status: 503 });
  }

  try {
    const body = await req.json();
    const { orderReference, email } = body;

    if (!orderReference || !email) {
      return NextResponse.json({ error: 'Order reference and email are required.' }, { status: 400 });
    }

    const functionUrl = `${url}/functions/v1/create-qrph-payment`;
    const res = await fetch(functionUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${anonKey}`,
        apikey: anonKey,
      },
      body: JSON.stringify({ orderReference, email }),
      // Edge function enforces order ownership via reference + email match.
      signal: AbortSignal.timeout(20000),
    });

    const data = await res.json().catch(() => null);
    if (!data || typeof data !== 'object') {
      return NextResponse.json({ error: 'QR Ph payment creation failed.' }, { status: 502 });
    }
    return NextResponse.json(data, { status: res.ok ? 200 : res.status });
  } catch {
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 });
  }
}
