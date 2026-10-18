import { NextRequest, NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabaseServer';
import { createRecoveryServerClient } from '@/lib/authSessionClients';
import { getConfiguredAppOrigin, getConfirmationUrl } from '@/lib/authRedirect';
import { newRecoveryProofCookie } from '@/lib/recoveryProof';
import type { Session } from '@supabase/supabase-js';

type ConfirmationStatus = 'success' | 'pending' | 'restricted' | 'invalid' | 'error';

function redirectToConfirmation(status: ConfirmationStatus) {
  const url = getConfirmationUrl(status);
  if (!url) return new NextResponse('Authentication is temporarily unavailable.', { status: 503 });
  return NextResponse.redirect(url);
}

function redirectToResetPassword(origin: string) {
  return NextResponse.redirect(`${origin}/auth/reset-password`);
}

function recoveryClientError(origin: string) {
  return NextResponse.redirect(`${origin}/auth/reset-password?unavailable=1`);
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
  // The SDK appends sb_flow_id to the email link when the PKCE flow starts so
  // the exchange reads the matching verifier slot. A tampered value simply
  // fails the exchange; it can never select another flow's verifier.
  const flowId = params.get('sb_flow_id');
  const exchangeOptions = flowId ? { flowId } : undefined;

  // This route intentionally accepts the authorization-code callback emitted
  // by Supabase Auth email links. type=recovery is an internal marker set by
  // the forgot-password redirect target, not a caller-controlled destination;
  // all redirects from this route stay on the configured application origin.
  if (!code || params.has('error')) {
    return isRecovery ? redirectToResetPassword(origin) : redirectToConfirmation('invalid');
  }

  let supabase: ReturnType<typeof createSupabaseServerClient> | null = null;
  let recovery: ReturnType<typeof createRecoveryServerClient> | null = null;
  if (isRecovery) {
    try {
      recovery = createRecoveryServerClient();
    } catch {
      return recoveryClientError(origin);
    }
  } else {
    try {
      supabase = createSupabaseServerClient();
    } catch {
      return redirectToConfirmation('error');
    }
  }

  try {
    // Recovery exchanges its code against the dedicated recovery namespace's
    // PKCE verifier. A signup-confirmation code has no verifier there and a
    // recovery code has none in the default namespace, so editing type= in
    // the URL can never cross the flows.
    if (recovery) {
      const { error: recoveryExchangeError } = await recovery.auth.exchangeCodeForSession(code, exchangeOptions);
      if (recoveryExchangeError) return redirectToResetPassword(origin);

      const { data: recoveryUser, error: recoveryUserError } = await recovery.auth.getUser();
      if (recoveryUserError || !recoveryUser.user) return redirectToResetPassword(origin);

      // The proof is signed over the verified recovery user ID and the
      // recovery session ID so the reset endpoint can re-verify both. If
      // signing fails (e.g. the HMAC secret is missing) no proof is issued.
      const session = (recoveryUser.data as { session?: Session | null } | null)?.session;
      console.log('DEBUG-ROUTE session:', JSON.stringify(session), 'data:', JSON.stringify(recoveryUser.data).slice(0, 120));
      if (!session?.session_id) return redirectToResetPassword(origin);

      try {
        const res = redirectToResetPassword(origin);
        const proof = newRecoveryProofCookie({
          userId: recoveryUser.user.id,
          sessionId: session.session_id,
        });
        res.cookies.set(proof.name, proof.value, proof.options);
        return res;
      } catch {
        return redirectToResetPassword(origin);
      }
    }

    const { error: exchangeError } = await supabase!.auth.exchangeCodeForSession(code, exchangeOptions);
    if (exchangeError) return redirectToConfirmation('invalid');

    const { data: userData, error: userError } = await supabase!.auth.getUser();
    if (userError || !userData.user) return redirectToConfirmation('error');
    if (!userData.user.email_confirmed_at) return redirectToConfirmation('pending');

    const { data, error } = await supabase!.rpc('activate_customer_profile');
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
  } catch (e) {
    console.log('DEBUG-CATCH:', String(e).slice(0, 400));
    return redirectToConfirmation('error');
  }
}
