import { NextRequest, NextResponse } from 'next/server';
import { createRecoveryServerClient } from '@/lib/authSessionClients';
import { getConfiguredAppOrigin } from '@/lib/authRedirect';
import { clearRecoveryProofCookie, sessionFingerprint, verifyRecoveryProof } from '@/lib/recoveryProof';
import { RECOVERY_PROOF_COOKIE } from '@/lib/authSessionConfig';
import { logAuthFlowFailure } from '@/lib/authFlowDiagnostics';

const GENERIC_INVALID = 'This reset link is invalid or has expired. Please request a new one.';
const GENERIC_503 = 'Password reset is temporarily unavailable. Please try again later.';

const PASSWORD_MIN = 8;
const PASSWORD_MAX = 128;
const RECOVERY_SESSION_COOKIE_PREFIX = 'rfz-recovery-auth';

function json(body: Record<string, string>, status: number) {
  return NextResponse.json(body, {
    status,
    headers: { 'Cache-Control': 'no-store' },
  });
}

function isAcceptablePassword(value: unknown): value is string {
  return typeof value === 'string' && value.length >= PASSWORD_MIN && value.length <= PASSWORD_MAX;
}

function clearRecoverySessionCookies(response: NextResponse, request: NextRequest) {
  for (const { name } of request.cookies.getAll()) {
    if (name === RECOVERY_SESSION_COOKIE_PREFIX || new RegExp(`^${RECOVERY_SESSION_COOKIE_PREFIX}\\.\\d+$`).test(name)) {
      response.cookies.set(name, '', {
        path: '/',
        secure: true,
        sameSite: 'lax',
        maxAge: 0,
        expires: new Date(0),
      });
    }
  }
}

export async function POST(request: NextRequest) {
  const origin = getConfiguredAppOrigin();
  if (!origin || request.headers.get('origin') !== origin) {
    return json({ error: GENERIC_INVALID }, 403);
  }

  const contentType = request.headers.get('content-type') ?? '';
  if (!contentType.startsWith('application/json')) {
    return json({ error: GENERIC_INVALID }, 400);
  }

  let password: unknown;
  let stage = 'recovery_session';
  try {
    const body = (await request.json()) as { password?: unknown } | null;
    password = body?.password;
  } catch {
    return json({ error: GENERIC_INVALID }, 400);
  }
  if (!isAcceptablePassword(password)) {
    return json({ error: GENERIC_INVALID }, 400);
  }

  let recovery: Awaited<ReturnType<typeof createRecoveryServerClient>>;
  try {
    recovery = await createRecoveryServerClient();
  } catch {
    return json({ error: GENERIC_503 }, 503);
  }

  try {
    // The recovery namespace is the ONLY trusted source of reset authority.
    // Customer, admin and default-namespace cookies are invisible to this
    // client and can never satisfy these checks.
    const { data: sessionData, error: sessionError } = await recovery.auth.getSession();
    const session = sessionData?.session;
    const accessToken = session?.access_token;
    if (sessionError || !session?.user?.id || !accessToken) {
      logAuthFlowFailure('password_recovery', stage, sessionError);
      return json({ error: GENERIC_INVALID }, 403);
    }

    stage = 'verified_user_lookup';
    // Bind identity verification to the same token used for proof validation.
    // A session-less getUser() may reload/refresh cookie storage and rotate
    // the access token after it was captured above.
    const { data: userData, error: userError } = await recovery.auth.getUser(accessToken);
    const user = userData?.user;
    if (userError || !user?.id || user.id !== session.user.id) {
      logAuthFlowFailure('password_recovery', stage, userError);
      return json({ error: GENERIC_INVALID }, 403);
    }

    // The signed proof must be valid, unexpired, issued for exactly this
    // recovery user and this recovery session (SHA-256 stable Supabase
    // session_id fingerprint, same derivation as the callback), and carry the
    // password-reset purpose. Fail closed on any mismatch.
    stage = 'proof_validation';
    const recoverySessionFingerprint = sessionFingerprint(accessToken);
    if (!recoverySessionFingerprint) {
      logAuthFlowFailure('password_recovery', 'proof_validation_session_binding');
      return json({ error: GENERIC_INVALID }, 403);
    }
    const proof = verifyRecoveryProof(request.cookies.get(RECOVERY_PROOF_COOKIE)?.value, {
      userId: user.id,
      sessionFingerprint: recoverySessionFingerprint,
    });
    if (!proof.ok) {
      // The reason is a fixed, non-sensitive enum. It helps distinguish a
      // cookie transport/configuration defect from a genuine session mismatch
      // without logging proof contents, user IDs, tokens or secret material.
      logAuthFlowFailure('password_recovery', `${stage}_${proof.reason}`);
      return json({ error: GENERIC_INVALID }, 403);
    }

    stage = 'password_update';
    const { error: updateError } = await recovery.auth.updateUser({ password });
    if (updateError) {
      logAuthFlowFailure('password_recovery', stage, updateError);
      return json({ error: GENERIC_INVALID }, 403);
    }

    // The password update is already committed at this point. A local cookie
    // cleanup failure must not turn that successful operation into a reported
    // failure; explicitly expire only this flow's recovery cookies below.
    stage = 'recovery_session_logout';
    try {
      const { error: signOutError } = await recovery.auth.signOut({ scope: 'local' });
      if (signOutError) logAuthFlowFailure('password_recovery', stage, signOutError);
    } catch (error) {
      logAuthFlowFailure('password_recovery', stage, error);
    }

    const res = json({ message: 'Password updated.' }, 200);
    const cleared = clearRecoveryProofCookie();
    res.cookies.set(cleared.name, cleared.value, cleared.options);
    clearRecoverySessionCookies(res, request);
    return res;
  } catch (error) {
    logAuthFlowFailure('password_recovery', stage, error);
    return json({ error: GENERIC_503 }, 503);
  }
}

export async function GET() {
  return json({ error: 'Method not allowed.' }, 405);
}
