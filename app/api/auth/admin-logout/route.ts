import { NextRequest, NextResponse } from 'next/server';
import { createAdminServerClient } from '@/lib/authSessionClients';
import { getConfiguredAppOrigin } from '@/lib/authRedirect';

function json(body: Record<string, string>, status: number) {
  return NextResponse.json(body, {
    status,
    headers: { 'Cache-Control': 'no-store' },
  });
}

export async function POST(request: NextRequest) {
  const origin = getConfiguredAppOrigin();
  if (!origin || request.headers.get('origin') !== origin) {
    return json({ error: 'Request origin is not allowed.' }, 403);
  }

  try {
    const client = await createAdminServerClient();
    const { error } = await client.auth.signOut({ scope: 'local' });
    if (error) return json({ error: 'Could not sign out.' }, 503);
    return json({ message: 'Signed out.' }, 200);
  } catch {
    return json({ error: 'Administrator authentication is temporarily unavailable.' }, 503);
  }
}

export async function GET() {
  return json({ error: 'Method not allowed.' }, 405);
}
