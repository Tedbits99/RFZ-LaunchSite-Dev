import { NextRequest, NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabaseServer';
import { getConfiguredAppOrigin, getConfirmationUrl } from '@/lib/authRedirect';

type ConfirmationStatus = 'success' | 'pending' | 'restricted' | 'invalid' | 'error';

function redirectToConfirmation(status: ConfirmationStatus) {
  const url = getConfirmationUrl(status);
  if (!url) return new NextResponse('Authentication is temporarily unavailable.', { status: 503 });
  return NextResponse.redirect(url);
}

function redirectToResetPassword(origin: string) {
  return NextResponse.redirect(`${origin}/auth/reset-password`);
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
  const origin = getConfiguredAppOrigin();
  if (!origin) return new NextResponse('Authentication is temporarily unavailable.', { status: 503 });

  const params = request.nextUrl.searchParams;
  const code = params.get('code');
  const isRecovery = params.get('type') === 'recovery';

  // This route intentionally accepts the authorization-code callback emitted
  // by Supabase Auth email links. type=recovery is an internal marker set by
  // the forgot-password redirect target, not a caller-controlled destination;
  // all redirects from this route stay on the configured application origin.
  if (!code || params.has('error')) {
    return isRecovery ? redirectToResetPassword(origin) : redirectToConfirmation('invalid');
  }

  let supabase: ReturnType<typeof createSupabaseServerClient>;
  try {
    supabase = createSupabaseServerClient();
  } catch {
    return isRecovery ? redirectToResetPassword(origin) : redirectToConfirmation('error');
  }

  try {
    const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
    if (exchangeError) {
      return isRecovery ? redirectToResetPassword(origin) : redirectToConfirmation('invalid');
    }

    // Password recovery only needs the exchanged session; profile activation
    // remains exclusive to the signup confirmation path below.
    if (isRecovery) return redirectToResetPassword(origin);

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
