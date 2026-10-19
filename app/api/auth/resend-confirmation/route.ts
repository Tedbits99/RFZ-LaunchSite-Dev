import { NextRequest, NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabaseServer';
import { adminSupabase } from '@/lib/supabaseAdmin';
import { getAuthCallbackUrl, getConfiguredAppOrigin } from '@/lib/authRedirect';
import { validateEmailInput } from '@/lib/authValidation';
import {
  deriveCustomerConfirmationResendKey,
} from '@/lib/customerConfirmationResendKey';

const GENERIC_OK = 'If the address can receive mail, confirmation instructions will be sent.';
const GENERIC_503 = 'Confirmation resend is temporarily unavailable.';

function json(body: Record<string, unknown>, status: number) {
  return NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
}

function hasTrustedOrigin(request: NextRequest): boolean {
  const origin = getConfiguredAppOrigin();
  return Boolean(origin && request.headers.get('origin') === origin);
}

export async function POST(req: NextRequest) {
  if (!hasTrustedOrigin(req)) return json({ error: 'Request origin is not allowed.' }, 403);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Invalid request.' }, 400);
  }

  const values = body && typeof body === 'object' && !Array.isArray(body)
    ? body as Record<string, unknown>
    : {};
  const validation = validateEmailInput(values.email);
  if (!validation.ok) return json({ error: 'Please provide a valid email address.' }, 400);

  const emailRedirectTo = getAuthCallbackUrl();
  if (!emailRedirectTo) return json({ error: GENERIC_503 }, 503);

  let emailKey: string;
  let networkKey: string;
  try {
    emailKey = deriveCustomerConfirmationResendKey('email', validation.value);
    const remoteAddress = (req.headers.get('x-forwarded-for') || 'unknown').split(',')[0].trim().slice(0, 128);
    networkKey = deriveCustomerConfirmationResendKey('network', remoteAddress);
  } catch {
    return json({ error: GENERIC_503 }, 503);
  }

  if (!adminSupabase) return json({ error: GENERIC_503 }, 503);

  try {
    const { data: reservation, error: rpcError } = await adminSupabase
      .rpc('reserve_customer_confirmation_resend', {
        p_email_key: emailKey,
        p_network_key: networkKey,
      })
      .maybeSingle();

    if (rpcError) return json({ error: GENERIC_503 }, 503);

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
      email: validation.value,
      options: { emailRedirectTo },
    });

    return json({ message: GENERIC_OK }, 202);
  } catch {
    return json({ error: GENERIC_503 }, 503);
  }
}

export async function GET() {
  return json({ error: 'Method not allowed.' }, 405);
}
