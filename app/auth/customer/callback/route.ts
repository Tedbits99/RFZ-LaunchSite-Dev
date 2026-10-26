import { NextRequest, NextResponse } from 'next/server';
import { createCustomerServerClient } from '@/lib/authSessionClients';
import { getConfiguredAppOrigin } from '@/lib/authRedirect';

const GENERIC_ERROR = 'Customer sign-in could not be completed. Please try again.';

function loginRedirect(origin: string, status: 'oauth_error' | 'restricted' = 'oauth_error') {
  return NextResponse.redirect(`${origin}/login?auth=${status}`);
}

export async function GET(request: NextRequest) {
  const origin = getConfiguredAppOrigin();
  if (!origin || request.nextUrl.origin !== origin) return new NextResponse(GENERIC_ERROR, { status: 400 });

  const params = request.nextUrl.searchParams;
  if (params.has('error') || params.has('error_code') || params.has('error_description')) return loginRedirect(origin);
  const code = params.get('code');
  if (!code || params.has('next')) return loginRedirect(origin);

  try {
    const customer = await createCustomerServerClient();
    const { error: exchangeError } = await customer.auth.exchangeCodeForSession(code);
    if (exchangeError) return loginRedirect(origin);

    const { data: userData, error: userError } = await customer.auth.getUser();
    const user = userData.user;
    if (userError || !user?.id || !user.email_confirmed_at) {
      await customer.auth.signOut({ scope: 'local' });
      return loginRedirect(origin);
    }

    const { data: profile, error: profileError } = await customer.from('customer_profiles').select('user_id, status').eq('user_id', user.id).maybeSingle();
    if (profileError || !profile || profile.user_id !== user.id) {
      await customer.auth.signOut({ scope: 'local' });
      return loginRedirect(origin);
    }

    if (profile.status === 'pending_verification') {
      const { data: activation, error: activationError } = await customer.rpc('activate_customer_profile');
      const row = Array.isArray(activation) ? activation[0] : activation;
      const result = row && typeof row === 'object' ? row as { out_status?: string; out_error?: string | null } : null;
      if (activationError || result?.out_status !== 'active' || result.out_error) {
        await customer.auth.signOut({ scope: 'local' });
        return loginRedirect(origin, 'restricted');
      }
    } else if (profile.status !== 'active') {
      await customer.auth.signOut({ scope: 'local' });
      return loginRedirect(origin, 'restricted');
    }

    return NextResponse.redirect(`${origin}/account`);
  } catch {
    return loginRedirect(origin);
  }
}
