import { NextRequest, NextResponse } from 'next/server';
import { adminSupabase } from '@/lib/supabaseAdmin';
import { readBoundedJson } from '@/lib/readBoundedJson';
import { voucherRequestIdentity } from '@/lib/voucherRequestClient';

export const dynamic = 'force-dynamic';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(req: NextRequest) {
  const input = await readBoundedJson(req, 8192);
  if (!input) return NextResponse.json({ error: 'Invalid or oversized JSON request.' }, { status: 400 });
  if (typeof input.code !== 'string' || input.code.trim().length < 3 || input.code.trim().length > 50
      || typeof input.packageId !== 'string' || !UUID_RE.test(input.packageId)
      || (input.email !== undefined && (typeof input.email !== 'string' || input.email.length > 320))) {
    return NextResponse.json({ error: 'Enter a valid promotion code and choose a package.' }, { status: 400 });
  }

  // Cloudflare overwrites this reserved edge header. Never accept X-Forwarded-For
  // or an arbitrary browser IP as an identity. Local development is loopback-only.
  const edgeIp = req.headers.get('cf-connecting-ip')?.trim();
  const clientIp = edgeIp || (process.env.NODE_ENV !== 'production' ? '127.0.0.1' : '');
  if (!clientIp || clientIp.length > 64) {
    return NextResponse.json({ error: 'Promotion validation is temporarily unavailable.' }, { status: 503 });
  }
  if (!adminSupabase) return NextResponse.json({ error: 'Promotion service is unavailable.' }, { status: 503 });
  const { data: rateAllowed, error: rateError } = await adminSupabase.rpc('consume_voucher_validation_rate_limit', {
    p_client_ip: clientIp,
  });
  if (rateError) return NextResponse.json({ error: 'Promotion validation is temporarily unavailable.' }, { status: 503 });
  if (rateAllowed !== true) {
    return NextResponse.json({ error: 'Too many attempts. Please try again in a minute.' }, {
      status: 429,
      headers: { 'Retry-After': '60', 'Cache-Control': 'no-store' },
    });
  }

  const identity = await voucherRequestIdentity(req);
  if (!identity.ok) return NextResponse.json({ error: identity.error }, { status: identity.status });
  const email = identity.authenticated ? identity.email : String(input.email || '').trim().toLowerCase();
  if (!identity.authenticated && (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 320)) {
    return NextResponse.json({ error: 'Enter a valid checkout email.' }, { status: 400 });
  }

  // This RPC is service-role-only. `userId` comes only from auth.getUser()
  // inside voucherRequestIdentity; browser-supplied identity fields are ignored.
  const { data, error } = await adminSupabase.rpc('validate_campaign_voucher_for_server', {
    p_code: input.code.trim().toUpperCase(),
    p_package_id: input.packageId,
    p_email: email,
    p_customer_user_id: identity.userId,
  });
  const result = (Array.isArray(data) ? data[0] : data) as {
    out_valid?: boolean;
    out_error?: string | null;
    out_discount_cents?: number;
    out_total_cents?: number;
    out_starts_at?: string | null;
    out_ends_at?: string | null;
    out_timezone?: string | null;
  } | null;
  if (error || !result) return NextResponse.json({ error: 'Could not check this promotion. Please try again.' }, { status: 503 });
  if (!result.out_valid) return NextResponse.json({ error: result.out_error || 'Invalid or unavailable promotion code.' }, { status: 400 });

  const response = NextResponse.json({
    success: true,
    voucher: { code: input.code.trim().toUpperCase() },
    discount: result.out_discount_cents,
    total: result.out_total_cents,
    startsAt: result.out_starts_at,
    endsAt: result.out_ends_at,
    timezone: result.out_timezone || 'UTC',
  });
  response.headers.set('Cache-Control', 'no-store');
  return response;
}
