import { NextRequest, NextResponse } from 'next/server';
import { readBoundedJson } from '@/lib/readBoundedJson';
import { voucherRequestIdentity } from '@/lib/voucherRequestClient';

export const dynamic = 'force-dynamic';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(req: NextRequest) {
  const input = await readBoundedJson(req, 8192);
  if (!input) return NextResponse.json({ error: 'Invalid or oversized JSON request.' }, { status: 400 });
  if (typeof input.packageId !== 'string' || !UUID_RE.test(input.packageId)
      || (input.email !== undefined && (typeof input.email !== 'string' || input.email.length > 320))) {
    return NextResponse.json({ error: 'Choose a valid package.' }, { status: 400 });
  }
  const identity = await voucherRequestIdentity(req);
  if (!identity.ok) return NextResponse.json({ error: identity.error }, { status: identity.status });
  const email = identity.authenticated ? identity.email : String(input.email || '').trim().toLowerCase() || null;
  if (!identity.authenticated && email !== null && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: 'Enter a valid checkout email.' }, { status: 400 });
  }
  const { data, error } = await identity.client.rpc('list_public_promotion_offers', {
    p_package_id: input.packageId,
    p_email: email,
  });
  if (error) return NextResponse.json({ error: 'Public promotions are temporarily unavailable.' }, { status: 503 });
  const response = NextResponse.json({ data: Array.isArray(data) ? data.slice(0, 20) : [] });
  response.headers.set('Cache-Control', 'no-store');
  return response;
}
