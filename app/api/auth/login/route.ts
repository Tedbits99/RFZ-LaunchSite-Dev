import { NextRequest, NextResponse } from 'next/server';
import { createCustomerServerClient } from '@/lib/authSessionClients';
import { getConfiguredAppOrigin } from '@/lib/authRedirect';
import { validateRegistrationInput } from '@/lib/authValidation';

const genericLoginError = 'Unable to sign in with those credentials.';
const emailUnconfirmedError = 'Please confirm your email address to activate your account.';

type ActivationResult = { status?: string; error?: string | null } | null;

function activationResult(data: unknown): ActivationResult {
  const row = Array.isArray(data) ? data[0] : data;
  if (!row || typeof row !== 'object') return null;
  const record = row as Record<string, unknown>;
  return {
    status: typeof record.out_status === 'string' ? record.out_status : undefined,
    error: typeof record.out_error === 'string' ? record.out_error : record.out_error === null ? null : undefined,
  };
}

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
    return json({ error: genericLoginError }, 400);
  }

  const values = body && typeof body === 'object' && !Array.isArray(body)
    ? body as Record<string, unknown>
    : {};
  const email = typeof values.email === 'string' ? values.email.trim().toLowerCase() : '';
  const password = typeof values.password === 'string' ? values.password : '';
  const validation = validateRegistrationInput({ email, password, name: 'Customer' });
  if (!validation.ok) return json({ error: genericLoginError }, 401);

  let client: Awaited<ReturnType<typeof createCustomerServerClient>>;
  try {
    client = await createCustomerServerClient();
  } catch {
    return json({ error: 'Customer authentication is temporarily unavailable.' }, 503);
  }

  try {
    const { error: signInError } = await client.auth.signInWithPassword({
      email: validation.value.email,
      password: validation.value.password,
    });

    if (signInError) {
      await client.auth.signOut({ scope: 'local' });
      return json({ error: genericLoginError }, 401);
    }

    const { data: userData, error: userError } = await client.auth.getUser();
    const user = userData.user;
    if (userError || !user) {
      await client.auth.signOut({ scope: 'local' });
      return json({ error: genericLoginError }, 401);
    }

    // Correct credentials with an unconfirmed address can never reach this
    // response without the right password, so the guidance leaks nothing.
    if (!user.email_confirmed_at) {
      await client.auth.signOut({ scope: 'local' });
      return json({ error: emailUnconfirmedError }, 403);
    }

    const { data: profile, error: profileError } = await client
      .from('customer_profiles')
      .select('user_id, status')
      .eq('user_id', user.id)
      .maybeSingle();

    if (profileError || !profile || profile.user_id !== user.id) {
      await client.auth.signOut({ scope: 'local' });
      return json({ error: genericLoginError }, 401);
    }

    // The email link may have confirmed the address on another device where
    // the PKCE session exchange could not complete. The provider already
    // recorded the confirmation, so finish activation here through the same
    // server-verified RPC used by the confirmation callback. It refuses
    // suspended and deactivated accounts on its own.
    if (profile.status === 'pending_verification') {
      const { data: activation, error: activationError } = await client.rpc('activate_customer_profile');
      const result = activationError ? null : activationResult(activation);
      if (!result || result.error === 'ACCOUNT_RESTRICTED' || result.status === 'suspended' || result.status === 'deactivated') {
        await client.auth.signOut({ scope: 'local' });
        return json({ error: genericLoginError }, 401);
      }
      if (result.status !== 'active') {
        await client.auth.signOut({ scope: 'local' });
        return json({ error: genericLoginError }, 401);
      }
      return json({ message: 'Signed in.' }, 200);
    }

    if (profile.status !== 'active') {
      await client.auth.signOut({ scope: 'local' });
      return json({ error: genericLoginError }, 401);
    }

    return json({ message: 'Signed in.' }, 200);
  } catch {
    try {
      await client.auth.signOut({ scope: 'local' });
    } catch {
      // The response remains generic even if local cleanup encounters an error.
    }
    return json({ error: 'Customer authentication is temporarily unavailable.' }, 503);
  }
}

export async function GET() {
  return json({ error: 'Method not allowed.' }, 405);
}
