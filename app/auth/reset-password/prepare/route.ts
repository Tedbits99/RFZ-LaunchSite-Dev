import { NextRequest, NextResponse } from 'next/server';
import { createRecoveryServerClient } from '@/lib/authSessionClients';
import { getConfiguredAppOrigin } from '@/lib/authRedirect';
import { newRecoveryProofCookie, sessionFingerprint } from '@/lib/recoveryProof';

const GENERIC_INVALID = 'This reset link is invalid or has expired. Please request a new one.';
const GENERIC_503 = 'Password reset is temporarily unavailable. Please try again later.';

function json(body: Record<string, boolean | string>, status: number) {
  return NextResponse.json(body, {
    status,
    headers: { 'Cache-Control': 'no-store' },
  });
}

/**
 * Rebind the short-lived application proof to the current recovery session.
 * Supabase may refresh a recovery access token while the reset page is open;
 * doing this immediately before submission avoids rejecting a valid provider
 * recovery session because its token fingerprint changed.
 */
export async function POST(request: NextRequest) {
  const origin = getConfiguredAppOrigin();
  if (!origin || request.headers.get('origin') !== origin) {
    return json({ error: GENERIC_INVALID }, 403);
  }

  let recovery: Awaited<ReturnType<typeof createRecoveryServerClient>>;
  try {
    recovery = await createRecoveryServerClient();
  } catch {
    return json({ error: GENERIC_503 }, 503);
  }

  try {
    const { data: firstSessionData, error: firstSessionError } = await recovery.auth.getSession();
    const firstSession = firstSessionData?.session;
    if (firstSessionError || !firstSession?.user?.id || !firstSession.access_token) {
      return json({ error: GENERIC_INVALID }, 403);
    }

    const { data: userData, error: userError } = await recovery.auth.getUser();
    if (userError || !userData.user || userData.user.id !== firstSession.user.id) {
      return json({ error: GENERIC_INVALID }, 403);
    }

    // Read the session again after getUser(). The SDK can refresh the token
    // during that verification call, and the proof must bind to the current
    // token that the completion endpoint will see.
    const { data: currentSessionData, error: currentSessionError } = await recovery.auth.getSession();
    const currentSession = currentSessionData?.session;
    if (currentSessionError || !currentSession?.user?.id || currentSession.user.id !== userData.user.id || !currentSession.access_token) {
      return json({ error: GENERIC_INVALID }, 403);
    }

    const response = json({ ready: true }, 200);
    const proof = newRecoveryProofCookie({
      userId: userData.user.id,
      sessionFingerprint: sessionFingerprint(currentSession.access_token),
    });
    response.cookies.set(proof.name, proof.value, proof.options);
    return response;
  } catch {
    return json({ error: GENERIC_503 }, 503);
  }
}

export async function GET() {
  return json({ error: 'Method not allowed.' }, 405);
}
