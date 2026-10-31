import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { adminSupabase } from '@/lib/supabaseAdmin';
import { requireAdminPermission } from '@/lib/adminGuard';

function getDb() {
  if (adminSupabase) return adminSupabase;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

const ALLOWED_PATCH_FIELDS = new Set([
  'supplier_reference',
  'local_status',
  'supplier_status',
  'error',
  'response_payload',
  'status_payload',
  'last_polled_at',
]);

export async function GET(req: NextRequest) {
  const session = await requireAdminPermission(req, 'suppliers.view');
  if (!session.ok) return session.response;

  const db = getDb();
  if (!db) return NextResponse.json({ error: 'Database not configured' }, { status: 503 });

  const { searchParams } = new URL(req.url);
  const supplierId = searchParams.get('supplier_id');
  const limit = Math.min(Number(searchParams.get('limit')) || 20, 100);

  let query = db
    .from('supplier_test_runs')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit);

  if (supplierId) query = query.eq('supplier_id', supplierId);

  const { data, error } = await query;
  if (error) {
    console.error('[test-runs GET] DB error:', error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ data: data || [] });
}

export async function POST(req: NextRequest) {
  const session = await requireAdminPermission(req, 'suppliers.manage');
  if (!session.ok) return session.response;

  const db = getDb();
  if (!db) return NextResponse.json({ error: 'Database not configured' }, { status: 503 });

  try {
    const body = await req.json();
    const { supplier_id, supplier_code, category_id, offer_id, player_inputs } = body;

    if (!supplier_id || !category_id || !offer_id) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    const { data, error } = await db
      .from('supplier_test_runs')
      .insert({
        supplier_id,
        supplier_code: supplier_code || '',
        category_id,
        offer_id,
        player_inputs: player_inputs || {},
        local_status: 'CREATED',
      })
      .select()
      .single();

    if (error) {
      console.error('[test-runs POST] DB insert error:', error.message);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ data });
  } catch {
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  const session = await requireAdminPermission(req, 'suppliers.manage');
  if (!session.ok) return session.response;

  const db = getDb();
  if (!db) return NextResponse.json({ error: 'Database not configured' }, { status: 503 });

  try {
    const body = await req.json();
    const { id, ...rawUpdates } = body;

    if (!id) return NextResponse.json({ error: 'Missing test run ID' }, { status: 400 });

    const updates: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(rawUpdates)) {
      if (ALLOWED_PATCH_FIELDS.has(key)) {
        updates[key] = value;
      }
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 });
    }

    const { data, error } = await db
      .from('supplier_test_runs')
      .update(updates)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      console.error('[test-runs PATCH] DB update error:', error.message);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ data });
  } catch {
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}
