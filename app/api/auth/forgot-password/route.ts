import { NextRequest, NextResponse } from 'next/server';
import { createRecoveryServerClient } from '@/lib/authSessionClients';
import { getConfiguredAppOrigin } from '@/lib/authRedirect';
import { validateEmailInput } from '@/lib/authValidation';
import { logAuthFlowFailure } from '@/lib/authFlowDiagnostics';

const GENERIC_OK = 'If the address can receive mail, reset instructions will be sent.';
const GENERIC_503 = 'Password reset is temporarily unavailable.';

function json(body: Record<string, string>, status: number) {
  return NextResponse.json(body, {
    status,
    headers: { 'Cache-Control': 'no-store' },
  });
}

function hasTrustedOrigin(request: NextRequest): boolean {
  const origin = getConfiguredAppOrigin();
  return Boolean(origin && request.headers.get('origin') === origin);
}

export async function POST(request: NextRequest) {
  if (!hasTrustedOrigin(request)) return json({ error: 'Request origin is not allowed.' }, 403);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid request.' }, 400);
  }

  const values = body && typeof body === 'object' && !Array.isArray(body)
    ? body as Record<string, unknown>
    : {};
  const validation = validateEmailInput(values.email);
  if (!validation.ok) return json({ error: 'Please provide a valid email address.' }, 400);

  let client: Awaited<ReturnType<typeof createRecoveryServerClient>>;
  try {
    client = await createRecoveryServerClient();
  } catch {
    logAuthFlowFailure('password_recovery', 'client_initialization');
    return json({ error: GENERIC_503 }, 503);
  }

  try {
    const redirectTo = `${getConfiguredAppOrigin()}/auth/callback?type=recovery`;
    const { error } = await client.auth.resetPasswordForEmail(validation.value, { redirectTo });
    if (error) {
      logAuthFlowFailure('password_recovery', 'email_provider', error);
      // Never reveal whether the address exists. The Auth provider's own
      // enumeration protections may return errors that we swallow here.
      return json({ message: GENERIC_OK }, 202);
    }
    return json({ message: GENERIC_OK }, 202);
  } catch (error) {
    logAuthFlowFailure('password_recovery', 'email_provider_exception', error);
    return json({ error: GENERIC_503 }, 503);
  }
}

export async function GET() {
  return json({ error: 'Method not allowed.' }, 405);
}
