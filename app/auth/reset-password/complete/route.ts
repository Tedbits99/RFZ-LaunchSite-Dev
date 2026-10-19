import { NextRequest, NextResponse } from 'next/server';
import { createRecoveryServerClient } from '@/lib/authSessionClients';
import { getConfiguredAppOrigin } from '@/lib/authRedirect';
import { clearRecoveryProofCookie, sessionFingerprint, verifyRecoveryProof } from '@/lib/recoveryProof';
import { RECOVERY_PROOF_COOKIE } from '@/lib/authSessionConfig';

const GENERIC_INVALID = 'This reset link is invalid or has expired. Please request a new one.';
const GENERIC_503 = 'Password reset is temporarily unavailable. Please try again later.';

const PASSWORD_MIN = 8;
const PASSWORD_MAX = 128;

function json(body: Record<string, string>, status: number) {
  return NextResponse.json(body, {
    status,
    headers: { 'Cache-Control': 'no-store' },
  });
}

function isAcceptablePassword(value: unknown): value is string {
  return typeof value === 'string' && value.length >= PASSWORD_MIN && value.length <= PASSWORD_MAX;
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
  try {
    const body = (await request.json()) as { password?: unknown } | null;
    password = body?.password;
  } catch {
    return json({ error: GENERIC_INVALID }, 400);
  }
  if (!isAcceptablePassword(password)) {
    return json({ error: GENERIC_INVALID }, 400);
  }

  let recovery: ReturnType<typeof createRecoveryServerClient>;
  try {
    recovery = createRecoveryServerClient();
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
      return json({ error: GENERIC_INVALID }, 403);
    }

    const { data: userData, error: userError } = await recovery.auth.getUser();
    const user = userData?.user;
    if (userError || !user?.id || user.id !== session.user.id) {
      return json({ error: GENERIC_INVALID }, 403);
    }

    // The signed proof must be valid, unexpired, issued for exactly this
    // recovery user and this recovery session (SHA-256 access-token
    // fingerprint, same derivation as the callback), and carry the
    // password-reset purpose. Fail closed on any mismatch.
    const proof = verifyRecoveryProof(request.cookies.get(RECOVERY_PROOF_COOKIE)?.value, {
      userId: user.id,
      sessionFingerprint: sessionFingerprint(accessToken),
    });
    if (!proof.ok) return json({ error: GENERIC_INVALID }, 403);

    const { error: updateError } = await recovery.auth.updateUser({ password });
    if (updateError) return json({ error: GENERIC_INVALID }, 403);

    // Success: end the recovery session locally and clear the HttpOnly proof
    // cookie server-side. Customer/admin/default sessions live in separate
    // cookies and are never touched. An app endpoint cannot revoke a Supabase
    // Auth bearer token that was obtained outside this flow; this is not a
    // provider-level authorization boundary.
    await recovery.auth.signOut({ scope: 'local' });

    const res = json({ message: 'Password updated.' }, 200);
    const cleared = clearRecoveryProofCookie();
    res.cookies.set(cleared.name, cleared.value, cleared.options);
    return res;
  } catch {
    return json({ error: GENERIC_503 }, 503);
  }
}

export async function GET() {
  return json({ error: 'Method not allowed.' }, 405);
}
