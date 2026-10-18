import { NextRequest, NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabaseServer';
import { adminSupabase } from '@/lib/supabaseAdmin';
import { getAuthCallbackUrl } from '@/lib/authRedirect';
import {
  deriveCustomerConfirmationResendKey,
} from '@/lib/customerConfirmationResendKey';

const GENERIC_OK = 'If the address can receive mail, confirmation instructions will be sent.';

function json(body: Record<string, unknown>, status: number) {
  return NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
}

export async function POST(req: NextRequest) {
  let email = '';
  try {
    const body = await req.json();
    if (body && typeof body === 'object' && typeof (body as { email?: unknown }).email === 'string') {
      email = ((body as { email: string }).email).trim().toLowerCase();
    }
  } catch {
    return json({ error: 'Please provide a valid email address.' }, 400);
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 320) {
    return json({ error: 'Please provide a valid email address.' }, 400);
  }

  const emailRedirectTo = getAuthCallbackUrl();
  if (!emailRedirectTo) return json({ error: 'Confirmation resend is temporarily unavailable.' }, 503);

  let emailKey: string;
  let networkKey: string;
  try {
    emailKey = deriveCustomerConfirmationResendKey('email', email);
    const remoteAddress = (req.headers.get('x-forwarded-for') || 'unknown').split(',')[0].trim().slice(0, 128);
    networkKey = deriveCustomerConfirmationResendKey('network', remoteAddress);
  } catch {
    return json({ error: 'Confirmation resend is temporarily unavailable.' }, 503);
  }

  if (!adminSupabase) return json({ error: 'Confirmation resend is temporarily unavailable.' }, 503);

  try {
    const { data: reservation, error: rpcError } = await adminSupabase
      .rpc('reserve_customer_confirmation_resend', {
        p_email_key: emailKey,
        p_network_key: networkKey,
      })
      .maybeSingle();

    if (rpcError) return json({ error: 'Confirmation resend is temporarily unavailable.' }, 503);

    const allowed = (reservation as { allowed?: boolean } | null)?.allowed === true;
    if (!allowed) {
      const retryAfter = (reservation as { retry_after_seconds?: number } | null)
        ?.retry_after_seconds ?? 60;
      return json({ error: 'Too many requests. Please try again later.', retry_after_seconds: retryAfter }, 429);
    }

    const supabase = createSupabaseServerClient();
    // The resend result is intentionally not echoed: the response never
    // reveals whether the address has an account.
    await supabase.auth.resend({
      type: 'signup',
      email,
      options: { emailRedirectTo },
    });

    return json({ message: GENERIC_OK }, 202);
  } catch {
    return json({ error: 'Confirmation resend is temporarily unavailable.' }, 503);
  }
}

export async function GET() {
  return json({ error: 'Method not allowed.' }, 405);
}
