import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { adminSupabase } from '@/lib/supabaseAdmin';

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const client = adminSupabase || supabase;
  if (!client) {
    return NextResponse.json({ error: 'Service unavailable.' }, { status: 503 });
  }
  const { searchParams } = new URL(req.url);
  const email = searchParams.get('email');

  if (!email) {
    return NextResponse.json({ error: 'Email is required.' }, { status: 400 });
  }

  const { data: order } = await client
    .from('orders')
    .select('id, email')
    .eq('id', params.id)
    .ilike('email', email.trim())
    .maybeSingle();

  if (!order) {
    return NextResponse.json({ error: 'Order not found.' }, { status: 404 });
  }

  const { data: timeline } = await client
    .from('order_timeline')
    .select('id, status, actor_email, note, created_at')
    .eq('order_id', params.id)
    .order('created_at', { ascending: true });

  return NextResponse.json({ timeline: timeline || [] });
}
