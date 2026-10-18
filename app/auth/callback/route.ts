import { NextRequest, NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabaseServer';
import { getConfiguredAppOrigin, getConfirmationUrl } from '@/lib/authRedirect';

type ConfirmationStatus = 'success' | 'pending' | 'restricted' | 'invalid' | 'error';

function redirectToConfirmation(status: ConfirmationStatus) {
  const url = getConfirmationUrl(status);
  if (!url) return new NextResponse('Authentication is temporarily unavailable.', { status: 503 });
  return NextResponse.redirect(url);
}

function activationResult(data: unknown): { status?: string; error?: string | null } | null {
  const row = Array.isArray(data) ? data[0] : data;
  if (!row || typeof row !== 'object') return null;
  const record = row as Record<string, unknown>;
  return {
    status: typeof record.out_status === 'string' ? record.out_status : undefined,
    error: typeof record.out_error === 'string' ? record.out_error : record.out_error === null ? null : undefined,
  };
}

export async function GET(request: NextRequest) {
  if (!getConfiguredAppOrigin()) return new NextResponse('Authentication is temporarily unavailable.', { status: 503 });

  const params = request.nextUrl.searchParams;
  const code = params.get('code');

  // This route intentionally accepts the authorization-code callback emitted
  // by signUp(emailRedirectTo). It does not accept token_hash, next, or any
  // caller-supplied account identifier.
  if (!code || params.has('error')) return redirectToConfirmation('invalid');

  let supabase: ReturnType<typeof createSupabaseServerClient>;
  try {
    supabase = createSupabaseServerClient();
  } catch {
    return redirectToConfirmation('error');
  }

  try {
    const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
    if (exchangeError) return redirectToConfirmation('invalid');

    const { data: userData, error: userError } = await supabase.auth.getUser();
    if (userError || !userData.user) return redirectToConfirmation('error');
    if (!userData.user.email_confirmed_at) return redirectToConfirmation('pending');

    const { data, error } = await supabase.rpc('activate_customer_profile');
    if (error) return redirectToConfirmation('error');

    const result = activationResult(data);
    if (!result) return redirectToConfirmation('error');
    if (result.error === 'ACCOUNT_RESTRICTED' || result.status === 'suspended' || result.status === 'deactivated') {
      return redirectToConfirmation('restricted');
    }
    if (result.error === 'EMAIL_NOT_VERIFIED' || result.status === 'pending_verification') {
      return redirectToConfirmation('pending');
    }
    if (result.status === 'active' && result.error === null) return redirectToConfirmation('success');
    return redirectToConfirmation('error');
  } catch {
    return redirectToConfirmation('error');
  }
}
