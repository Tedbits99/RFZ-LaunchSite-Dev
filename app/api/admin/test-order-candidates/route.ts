import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/adminGuard';
import { adminSupabase } from '@/lib/supabaseAdmin';

export async function GET(req: NextRequest) {
  const authorization = await requireAdmin(req);
  if (!authorization.ok) return authorization.response;

  const db = adminSupabase;
  if (!db) return NextResponse.json({ error: 'Admin data access is not configured.' }, { status: 503 });

  const requestedLimit = Number(new URL(req.url).searchParams.get('limit') || 10);
  const limit = Number.isInteger(requestedLimit) ? Math.min(Math.max(requestedLimit, 1), 10) : 10;
  const { data, error } = await db
    .from('orders')
    .select('id, reference, player_inputs, status, game_id, package_id')
    .not('player_inputs->>user_id', 'is', null)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) return NextResponse.json({ error: 'Unable to load test-order candidates.' }, { status: 500 });
  return NextResponse.json({ data: data || [] });
}
