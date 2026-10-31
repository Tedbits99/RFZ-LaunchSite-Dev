import { NextRequest, NextResponse } from 'next/server';
import { adminSupabase } from '@/lib/supabaseAdmin';
import { requireAdminPermission } from '@/lib/adminGuard';

export async function GET(req: NextRequest) {
  const auth = await requireAdminPermission(req, 'suppliers.view');
  if (!auth.ok) return auth.response;
  const db = adminSupabase || auth.client;
  if (!db) return NextResponse.json({ error: 'Database not configured' }, { status: 503 });

  const { searchParams } = new URL(req.url);
  const supplierId = searchParams.get('supplier_id');
  const orderId = searchParams.get('order_id');
  const limit = Math.min(Number(searchParams.get('limit')) || 50, 200);

  let query = db.from('supplier_transactions')
    .select('*, suppliers(name, code)')
    .order('created_at', { ascending: false })
    .limit(limit);

  if (supplierId) query = query.eq('supplier_id', supplierId);
  if (orderId) query = query.eq('order_id', orderId);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ data });
}
