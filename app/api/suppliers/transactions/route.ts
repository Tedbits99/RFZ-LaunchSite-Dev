import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

function getDb() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

export async function GET(req: Request) {
  const db = getDb();
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
