import { NextRequest, NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabaseServer';
import { createRecoveryServerClient } from '@/lib/authSessionClients';
import { getConfiguredAppOrigin, getConfirmationUrl } from '@/lib/authRedirect';
import { newRecoveryProofCookie, sessionFingerprint } from '@/lib/recoveryProof';

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

async function issueRecoveryProof(
  recovery: Awaited<ReturnType<typeof createRecoveryServerClient>>,
  origin: string,
  session: { access_token?: string; user?: { id?: string } | null } | null | undefined,
) {
  const accessToken = session?.access_token;
  const sessionUserId = session?.user?.id;
  if (!sessionUserId || !accessToken) return redirectToResetPassword(origin);

  const { data: recoveryUser, error: recoveryUserError } = await recovery.auth.getUser();
  if (recoveryUserError || !recoveryUser.user || recoveryUser.user.id !== sessionUserId) {
    return redirectToResetPassword(origin);
  }

  // The proof is signed over the verified recovery user ID and a SHA-256
  // fingerprint of the exchange-issued access token. The raw token never
  // enters the cookie or a redirect URL.
  try {
    const res = redirectToResetPassword(origin);
    const proof = newRecoveryProofCookie({
      userId: recoveryUser.user.id,
      sessionFingerprint: sessionFingerprint(accessToken),
    });
    res.cookies.set(proof.name, proof.value, proof.options);
    return res;
  } catch {
    return redirectToResetPassword(origin);
  }
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
  const tokenHash = params.get('token_hash');
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
  if ((!code && !tokenHash) || params.has('error')) {
    return isRecovery ? redirectToResetPassword(origin) : redirectToConfirmation('invalid');
  }

  let supabase: Awaited<ReturnType<typeof createSupabaseServerClient>> | null = null;
  let recovery: Awaited<ReturnType<typeof createRecoveryServerClient>> | null = null;
  if (isRecovery) {
    try {
      recovery = await createRecoveryServerClient();
    } catch {
      return recoveryClientError(origin);
    }
  } else {
    try {
      supabase = await createSupabaseServerClient();
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
      if (code) {
        // The documented contract: exchangeCodeForSession returns the session
        // via data.session. getUser() is used only to confirm the identity.
        const { data: exchangeData, error: recoveryExchangeError } = await recovery.auth.exchangeCodeForSession(code, exchangeOptions);
        if (recoveryExchangeError) return redirectToResetPassword(origin);
        return await issueRecoveryProof(recovery, origin, exchangeData?.session);
      }

      // Some Supabase projects retain the token-hash email template rather
      // than the PKCE code template. Accept only a recovery token hash and let
      // Supabase verify it; never accept a raw access/refresh token here.
      const { data: otpData, error: otpError } = await recovery.auth.verifyOtp({
        type: 'recovery',
        token_hash: tokenHash!,
      });
      if (otpError) return redirectToResetPassword(origin);
      return await issueRecoveryProof(recovery, origin, otpData?.session);
    }

    // Token-hash verification is recovery-only. Confirmation flows continue
    // to require the authorization code exchange and never accept a token
    // hash as a signup confirmation.
    if (!code) return redirectToConfirmation('invalid');
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
  } catch {
    // Recovery failures must stay inside the recovery boundary. Falling
    // through to signup confirmation can make an expired, cross-device, or
    // provider-error recovery link look like a registration failure and can
    // leave the wrong flow's UI/state in play.
    return recovery ? recoveryClientError(origin) : redirectToConfirmation('error');
  }
}
