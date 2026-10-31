import { NextRequest, NextResponse } from 'next/server';
import { getActiveCustomerSession } from '@/lib/customerSession';

const DISPLAY_NAME_MAX = 120;

function json(body: Record<string, unknown>, status: number) {
  return NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
}

export async function GET() {
  const session = await getActiveCustomerSession();
  if (!session) return json({ error: 'Not signed in.' }, 401);

  const { data, error } = await session.client
    .from('customer_profiles')
    .select('display_name, email_snapshot, status')
    .eq('user_id', session.user.id)
    .maybeSingle();

  if (error || !data) return json({ error: 'Unable to load your profile right now.' }, 503);

  return json({
    display_name: (data as { display_name: string }).display_name ?? '',
    email: (data as { email_snapshot: string }).email_snapshot ?? '',
    status: (data as { status: string }).status,
  }, 200);
}

export async function PUT(req: NextRequest) {
  const session = await getActiveCustomerSession();
  if (!session) return json({ error: 'Not signed in.' }, 401);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Invalid request.' }, 400);
  }

  const values = body && typeof body === 'object' && !Array.isArray(body)
    ? body as Record<string, unknown>
    : {};
  const rawName = values.display_name;
  const displayName = typeof rawName === 'string' ? rawName.trim() : '';

  if (!displayName || displayName.length > DISPLAY_NAME_MAX || /[\u0000-\u001f\u007f]/.test(displayName)) {
    return json({ error: 'Please provide a valid display name.' }, 400);
  }

  // RLS restricts UPDATE to the owning row, and the protect_customer_profile_
  // system_fields trigger blocks ownership/email/status changes server-side.
  const { error } = await session.client
    .from('customer_profiles')
    .update({ display_name: displayName })
    .eq('user_id', session.user.id);

  if (error) return json({ error: 'Unable to save your profile right now.' }, 503);

  return json({ message: 'Profile updated.' }, 200);
}

export async function POST() {
  return json({ error: 'Method not allowed.' }, 405);
}

export async function DELETE() {
  return json({ error: 'Method not allowed.' }, 405);
}
