import { NextRequest, NextResponse } from 'next/server';
import { adminSupabase } from '@/lib/supabaseAdmin';
import { supabase } from '@/lib/supabase';

export async function GET(req: NextRequest) {
  const db = adminSupabase || supabase;
  if (!db) {
    return NextResponse.json({ error: 'Database not configured.' }, { status: 503 });
  }

  const { searchParams } = new URL(req.url);
  const q = searchParams.get('q')?.trim() || '';
  const status = searchParams.get('status')?.trim() || 'ALL';
  const date = searchParams.get('date')?.trim() || '';
  const archived = searchParams.get('archived')?.trim() || '';
  const showArchived = archived === '1';

  let query = db
    .from('orders')
    .select('id, reference, email, status, total_cents, created_at, payment_status, fulfillment_status, games(name), packages(name), supplier_transactions!left(supplier_id, supplier_reference, status, action, suppliers(code, name))')
    .order('created_at', { ascending: false })
    .limit(100);

  query = query.eq('is_archived', showArchived);

  if (status && status !== 'ALL') {
    query = query.eq('status', status);
  }
  if (q) {
    const escaped = q.replace(/[%_]/g, '\\$&');
    query = query.or(`reference.ilike.%${escaped}%,email.ilike.%${escaped}%`);
  }
  if (date) {
    const d = date;
    const next = new Date(d);
    next.setDate(next.getDate() + 1);
    query = query.gte('created_at', `${d}T00:00:00Z`).lt('created_at', `${next.toISOString().slice(0, 10)}T00:00:00Z`);
  }

  const { data: ordersData, error: ordersError } = await query;
  if (ordersError) {
    return NextResponse.json({ error: 'Could not load orders.' }, { status: 500 });
  }

  const { data: countsData } = await db
    .from('orders')
    .select('status')
    .eq('is_archived', false);

  const statusCounts: Record<string, number> = {};
  if (countsData) {
    for (const row of countsData as { status: string }[]) {
      statusCounts[row.status] = (statusCounts[row.status] || 0) + 1;
    }
  }

  return NextResponse.json({
    orders: ordersData || [],
    statusCounts,
  });
}
