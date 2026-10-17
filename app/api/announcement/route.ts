import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { adminSupabase } from '@/lib/supabaseAdmin';
import { requireAdmin } from '@/lib/adminGuard';

export async function GET() {
  const sb = supabase;
  if (!sb) return NextResponse.json({ data: null, error: 'Database not configured' }, { status: 503 });

  const { data, error } = await sb
    .from('global_announcement')
    .select('*')
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) return NextResponse.json({ data: null, error: error.message }, { status: 500 });
  return NextResponse.json({ data });
}

export async function POST(req: NextRequest) {
  const auth = await requireAdmin(req);
  if (!auth.ok) return auth.response;
  const sb = adminSupabase || auth.client;
  if (!sb) return NextResponse.json({ error: 'Database not configured' }, { status: 503 });

  const body = await req.json();
  const { id, enabled, display_mode, type, title, message, button_text, button_link, return_date_time, show_countdown, image_url } = body;

  const row = {
    enabled: Boolean(enabled),
    display_mode: display_mode || 'normal',
    type: type || 'Maintenance',
    title: String(title || ''),
    message: String(message || ''),
    button_text: String(button_text || 'OK'),
    button_link: button_link || null,
    return_date_time: return_date_time || null,
    show_countdown: Boolean(show_countdown),
    image_url: image_url || null,
    updated_at: new Date().toISOString(),
  };

  let result;
  if (id) {
    result = await sb.from('global_announcement').update(row).eq('id', id).select().maybeSingle();
  } else {
    result = await sb.from('global_announcement').insert(row).select().maybeSingle();
  }

  if (result.error) return NextResponse.json({ error: result.error.message }, { status: 500 });
  return NextResponse.json({ data: result.data });
}
