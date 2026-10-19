import { NextRequest, NextResponse } from 'next/server';
import { createCustomerServerClient } from '@/lib/authSessionClients';
import { rfCoinErrorMessage } from '@/lib/rfCoins';

/*
  Thin proxy to the create-coin-topup-payment Edge Function, which holds the
  PayMongo secret and service-role key in the managed-secrets runtime.

  POST body: { packageId }
  Requires an active, verified customer session (rfz-customer-auth).
*/
export async function POST(req: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    return NextResponse.json({ error: 'Service unavailable.' }, { status: 503 });
  }

  const session = await getActiveCustomerSessionForRequest(req);
  if (!session) {
    return NextResponse.json({ error: 'Sign in with a verified account to buy RF Coins.' }, { status: 401 });
  }

  try {
    const body = await req.json().catch(() => null);
    const packageId = typeof (body as { packageId?: unknown })?.packageId === 'string'
      ? (body as { packageId: string }).packageId.trim()
      : '';
    if (!packageId) {
      return NextResponse.json({ error: 'Choose a coin package first.' }, { status: 400 });
    }

    const res = await fetch(`${url}/functions/v1/create-coin-topup-payment`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.accessToken}`,
        apikey: anonKey,
      },
      body: JSON.stringify({ packageId, userId: session.userId }),
      signal: AbortSignal.timeout(20000),
    });
    const data = await res.json().catch(() => null);
    if (!data || typeof data !== 'object') {
      return NextResponse.json({ error: 'RF Coins payment could not be created.' }, { status: 502 });
    }
    return NextResponse.json(data, { status: res.ok ? 200 : res.status });
  } catch {
    return NextResponse.json({ error: 'Something went wrong. Please try again.' }, { status: 500 });
  }
}

async function getActiveCustomerSessionForRequest(req: NextRequest) {
  const hasCustomerAuthCookie = req.cookies.getAll().some(({ name }) =>
    /^rfz-customer-auth(?:\.\d+)?$/.test(name));
  if (!hasCustomerAuthCookie) return null;
  try {
    const client = createCustomerServerClient();
    const { data, error } = await client.auth.getUser();
    if (error || !data.user || !data.user.email_confirmed_at) return null;
    const { data: profile } = await client
      .from('customer_profiles')
      .select('status')
      .eq('user_id', data.user.id)
      .maybeSingle();
    if (!profile || profile.status !== 'active') return null;
    // Session access token authorizes the Edge Function call for this customer.
    const { data: sessionData } = await client.auth.getSession();
    return {
      client,
      userId: data.user.id,
      accessToken: sessionData.session?.access_token || '',
    };
  } catch {
    return null;
  }
}
