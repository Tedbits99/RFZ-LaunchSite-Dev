import { NextRequest, NextResponse } from 'next/server';
import { adminSupabase } from '@/lib/supabaseAdmin';
import { supabase } from '@/lib/supabase';
import { requireAdminPermission } from '@/lib/adminGuard';
import { pollFulfillmentStatus } from '@/lib/suppliers/fulfillment';

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await requireAdminPermission(req, 'suppliers.manage');
  if (!session.ok) return session.response;

  const client = adminSupabase || supabase;
  if (!client) return NextResponse.json({ error: 'Database not configured.' }, { status: 503 });

  try {
    const result = await pollFulfillmentStatus(id);

    if (!result.success) {
      return NextResponse.json({ error: result.error || 'Poll failed' }, { status: 400 });
    }

    return NextResponse.json({
      ok: true,
      fulfillment_status: result.fulfillmentStatus,
    });
  } catch {
    return NextResponse.json({ error: 'Server error.' }, { status: 500 });
  }
}
