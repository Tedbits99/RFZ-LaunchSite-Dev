import { NextRequest, NextResponse } from 'next/server';
import { createCustomerServerClient, createRecoveryServerClient } from '@/lib/authSessionClients';
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

function redirectToAccount(origin: string) {
  return NextResponse.redirect(`${origin}/account`);
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
  const tokenHash = params.get('token_hash');
  const tokenType = params.get('type');
  const isRecovery = tokenType === 'recovery';
  const isSupportedConfirmationTokenType = tokenType === 'email' || tokenType === 'signup' || tokenType === 'invite';
  // The SDK appends sb_flow_id to the email link when the PKCE flow starts so
  // the exchange reads the matching verifier slot. A tampered value simply
  // fails the exchange; it can never select another flow's verifier.
  const flowId = params.get('sb_flow_id');
  const exchangeOptions = flowId ? { flowId } : undefined;

  // This route intentionally accepts the authorization-code callback emitted
  // by Supabase Auth email links. type=recovery is an internal marker set by
  // the forgot-password redirect target, not a caller-controlled destination;
  // all redirects from this route stay on the configured application origin.
  if ((!code && !tokenHash) || params.has('error') || (tokenHash && (!tokenType || !isRecovery && !isSupportedConfirmationTokenType))) {
    return isRecovery ? redirectToResetPassword(origin) : redirectToConfirmation('invalid');
  }

  let supabase: Awaited<ReturnType<typeof createCustomerServerClient>> | null = null;
  let recovery: Awaited<ReturnType<typeof createRecoveryServerClient>> | null = null;
  if (isRecovery) {
    try {
      recovery = await createRecoveryServerClient();
    } catch {
      return recoveryClientError(origin);
    }
  } else {
    try {
      // Signup confirmation must use the customer namespace. This keeps the
      // exchanged session in the same cookie jar used by /api/auth/login and
      // protected account routes, instead of the retired legacy namespace.
      supabase = await createCustomerServerClient();
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
      const recoveryResult = tokenHash
        ? await recovery.auth.verifyOtp({ token_hash: tokenHash, type: 'recovery' })
        : await recovery.auth.exchangeCodeForSession(code!, exchangeOptions);
      if (recoveryResult.error) return redirectToResetPassword(origin);

      // The documented contract: exchangeCodeForSession returns the session
      // via data.session. getUser() is used only to confirm the identity.
      const session = recoveryResult.data?.session;
      const accessToken = session?.access_token;
      if (!session?.user?.id || !accessToken) return redirectToResetPassword(origin);

      const { data: recoveryUser, error: recoveryUserError } = await recovery.auth.getUser();
      if (recoveryUserError || !recoveryUser.user) return redirectToResetPassword(origin);
      if (recoveryUser.user.id !== session.user.id) return redirectToResetPassword(origin);

      // The proof is signed over the verified recovery user ID and a SHA-256
      // fingerprint of the exchange-issued access token, so the reset
      // endpoint can re-verify both against its own recovery-namespace
      // session. The raw token never enters the cookie. If signing fails
      // (e.g. the HMAC secret is missing) no proof is issued.
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

    const confirmationResult = tokenHash
      ? await supabase!.auth.verifyOtp({ token_hash: tokenHash, type: tokenType as 'signup' | 'email' | 'invite' })
      : await supabase!.auth.exchangeCodeForSession(code!, exchangeOptions);
    if (confirmationResult.error) return redirectToConfirmation('invalid');

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
    if (result.status === 'active' && result.error === null) return redirectToAccount(origin);
    return redirectToConfirmation('error');
  } catch {
    return redirectToConfirmation('error');
  }
}
