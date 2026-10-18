import { NextRequest, NextResponse } from 'next/server';
import { adminSupabase } from '@/lib/supabaseAdmin';
import { requireAdmin } from '@/lib/adminGuard';

export async function GET(req: NextRequest) {
  const auth = await requireAdmin(req);
  if (!auth.ok) return auth.response;
  const db = adminSupabase || auth.client;
  if (!db) return NextResponse.json({ error: 'Database not configured' }, { status: 503 });

  const { searchParams } = new URL(req.url);
  const supplierId = searchParams.get('supplier_id');

  let query = db.from('supplier_package_mappings').select('*, packages(id, name, game_id, price_cents, games(name)), suppliers(id, name, code)').order('priority', { ascending: false });

  if (supplierId) query = query.eq('supplier_id', supplierId);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ data });
}

export async function POST(req: NextRequest) {
  const auth = await requireAdmin(req);
  if (!auth.ok) return auth.response;
  const db = adminSupabase || auth.client;
  if (!db) return NextResponse.json({ error: 'Database not configured' }, { status: 503 });

  const body = await req.json();
  const row = {
    package_id: body.package_id,
    supplier_id: body.supplier_id,
    supplier_product_id: String(body.supplier_product_id || ''),
    supplier_cost_cents: Number(body.supplier_cost_cents) || 0,
    priority: Number(body.priority) || 0,
    enabled: body.enabled !== false,
    metadata: body.metadata || {},
  };

  if (!row.package_id || !row.supplier_id) return NextResponse.json({ error: 'package_id and supplier_id required' }, { status: 400 });

  const { data, error } = await db.from('supplier_package_mappings').upsert(row, { onConflict: 'package_id,supplier_id' }).select().maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ data });
}

export async function DELETE(req: NextRequest) {
  const auth = await requireAdmin(req);
  if (!auth.ok) return auth.response;
  const db = adminSupabase || auth.client;
  if (!db) return NextResponse.json({ error: 'Database not configured' }, { status: 503 });

  const { searchParams } = new URL(req.url);
  const id = searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

  const { error } = await db.from('supplier_package_mappings').delete().eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
