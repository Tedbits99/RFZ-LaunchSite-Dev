import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/adminGuard';
import { adminSupabase } from '@/lib/supabaseAdmin';

export async function GET(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (!auth.ok) return auth.response;
  if (!['ADMIN','SUPER_ADMIN'].includes(auth.session.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  if (!adminSupabase) return NextResponse.json({ error: 'Database not configured' }, { status: 503 });
  const { data, error } = await adminSupabase.from('fazercards_webhook_events')
    .select('id,event_id,event_type,supplier_reference,supplier_status,previous_status,received_at,linked_order_id,processing_status')
    .order('received_at', { ascending: false }).limit(30);
  if (error) return NextResponse.json({ error: 'Supplier notifications unavailable' }, { status: 503 });
  return NextResponse.json({ events: data ?? [] }, { headers: { 'Cache-Control': 'no-store' } });
}
