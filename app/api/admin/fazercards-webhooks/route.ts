import { NextRequest, NextResponse } from 'next/server';
import { requireAdminPermission } from '@/lib/adminGuard';
import { adminSupabase } from '@/lib/supabaseAdmin';

export async function GET(request: NextRequest) {
  const auth = await requireAdminPermission(request, 'suppliers.view');
  if (!auth.ok) return auth.response;
  if (!adminSupabase) return NextResponse.json({ error: 'Database not configured' }, { status: 503 });
  const { data, error } = await adminSupabase.from('fazercards_webhook_events')
    .select('id,event_id,event_type,supplier_reference,supplier_status,previous_status,received_at,linked_order_id,processing_status')
    .order('received_at', { ascending: false }).limit(30);
  if (error) return NextResponse.json({ error: 'Supplier notifications unavailable' }, { status: 503 });
  return NextResponse.json({ events: data ?? [] }, { headers: { 'Cache-Control': 'no-store' } });
}
