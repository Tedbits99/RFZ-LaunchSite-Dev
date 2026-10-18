import { NextRequest, NextResponse } from 'next/server';
import { adminSupabase } from '@/lib/supabaseAdmin';
import { requireAdmin } from '@/lib/adminGuard';

export async function GET(req: NextRequest) {
  const auth = await requireAdmin(req);
  if (!auth.ok) return auth.response;
  const db = adminSupabase || auth.client;
  if (!db) {
    return NextResponse.json(
      { error: 'Database connection is not available. Please check server configuration.' },
      { status: 503 }
    );
  }
  const { data, error } = await db.rpc('admin_get_all_games');
  if (error) {
    return NextResponse.json(
      { error: `Failed to load games: ${error.message}` },
      { status: 500 }
    );
  }
  return NextResponse.json(data);
}

export async function PATCH(req: NextRequest) {
  const auth = await requireAdmin(req);
  if (!auth.ok) return auth.response;
  const db = adminSupabase || auth.client;
  if (!db) {
    return NextResponse.json(
      { error: 'Database connection is not available. Please check server configuration.' },
      { status: 503 }
    );
  }
  let body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
  }
  const { id, is_active } = body as { id?: string; is_active?: boolean };
  if (!id || typeof id !== 'string') {
    return NextResponse.json({ error: 'Invalid request: a valid game id is required.' }, { status: 400 });
  }
  if (typeof is_active !== 'boolean') {
    return NextResponse.json({ error: 'Invalid request: is_active must be a boolean.' }, { status: 400 });
  }
  const { data, error } = await db.rpc('admin_set_game_active', { game_id: id, active: is_active });
  if (error) {
    return NextResponse.json(
      { error: `Failed to update game visibility: ${error.message}` },
      { status: 500 }
    );
  }
  if (!data || data.length === 0) {
    return NextResponse.json({ error: 'Game not found.' }, { status: 404 });
  }
  return NextResponse.json({ id: data[0].id, is_active: data[0].is_active });
}
