import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { adminSupabase } from '@/lib/supabaseAdmin';

export async function GET(req: NextRequest) {
  const db = adminSupabase || supabase;
  if (!db) {
    return NextResponse.json({ error: 'Service unavailable.' }, { status: 503 });
  }

  const { searchParams } = new URL(req.url);
  const ref = (searchParams.get('ref') || '').trim().toUpperCase();
  const email = (searchParams.get('email') || '').trim();

  if (!ref || !email) {
    return NextResponse.json({ error: 'Reference and email are required.' }, { status: 400 });
  }

  const { data: order, error } = await db
    .from('orders')
    .select('id, reference, status, total_cents, created_at, updated_at, payment_method, games(name), packages(name)')
    .eq('reference', ref)
    .ilike('email', email)
    .maybeSingle();

  if (error || !order) {
    return NextResponse.json({ error: 'No order found. Check your reference and email.' }, { status: 404 });
  }

  const { data: timeline } = await db
    .from('order_timeline')
    .select('id, status, actor_email, note, created_at')
    .eq('order_id', order.id)
    .order('created_at', { ascending: true });

  return NextResponse.json({ order, timeline: timeline || [] });
}
