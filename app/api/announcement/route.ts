import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { adminSupabase } from '@/lib/supabaseAdmin';
import { requireAdminPermission } from '@/lib/adminGuard';

export async function GET() {
  const sb = supabase;
  if (!sb) return NextResponse.json({ data: null, error: 'Database not configured' }, { status: 503 });

  const { data, error } = await sb
    .from('global_announcement')
    .select('*')
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) return NextResponse.json({ data: null, error: 'Announcement is temporarily unavailable.' }, { status: 500 });
  return NextResponse.json({ data });
}

export async function POST(req: NextRequest) {
  const auth = await requireAdminPermission(req, 'marketing.manage');
  if (!auth.ok) return auth.response;
  const sb = adminSupabase;
  if (!sb) return NextResponse.json({ error: 'Database not configured' }, { status: 503 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'A valid JSON object is required.' }, { status: 400 });
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return NextResponse.json({ error: 'A JSON object is required.' }, { status: 400 });
  const input = body as Record<string, unknown>;
  const allowed = new Set(['id', 'enabled', 'display_mode', 'type', 'title', 'message', 'button_text', 'button_link', 'return_date_time', 'show_countdown', 'image_url']);
  if (Object.keys(input).some((key) => !allowed.has(key))) return NextResponse.json({ error: 'Unsupported announcement field.' }, { status: 400 });
  if (input.id !== undefined && (typeof input.id !== 'string' || !input.id)) return NextResponse.json({ error: 'Invalid announcement id.' }, { status: 400 });
  if (input.enabled !== undefined && typeof input.enabled !== 'boolean') return NextResponse.json({ error: 'enabled must be boolean.' }, { status: 400 });
  if (input.show_countdown !== undefined && typeof input.show_countdown !== 'boolean') return NextResponse.json({ error: 'show_countdown must be boolean.' }, { status: 400 });
  if (input.display_mode !== undefined && !['normal', 'blocking'].includes(String(input.display_mode))) return NextResponse.json({ error: 'Invalid announcement display mode.' }, { status: 400 });
  for (const [key, maxLength] of [['title', 160], ['message', 10000], ['button_text', 100], ['type', 80]] as const) {
    const value = input[key];
    if (value !== undefined && (typeof value !== 'string' || value.length > maxLength)) return NextResponse.json({ error: `Invalid ${key}.` }, { status: 400 });
  }
  for (const key of ['button_link', 'image_url'] as const) {
    const value = input[key];
    if (value !== undefined && value !== null && value !== '') {
      try {
        const url = new URL(String(value));
        if (!['button_link'].includes(key) && url.protocol !== 'https:') throw new Error('https required');
        if (key === 'button_link' && !['https:', 'http:'].includes(url.protocol)) throw new Error('http(s) required');
      } catch {
        return NextResponse.json({ error: `Invalid ${key}.` }, { status: 400 });
      }
    }
  }
  if (input.return_date_time !== undefined && input.return_date_time !== null && input.return_date_time !== '') {
    if (typeof input.return_date_time !== 'string' || !Number.isFinite(Date.parse(input.return_date_time))) return NextResponse.json({ error: 'Invalid return date and time.' }, { status: 400 });
  }
  const bodyRecord = input;
  const { id, enabled, display_mode, type, title, message, button_text, button_link, return_date_time, show_countdown, image_url } = bodyRecord;

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
    updated_by: auth.session.userId,
    updated_at: new Date().toISOString(),
  };

  let result;
  if (id) {
    result = await sb.from('global_announcement').update(row).eq('id', id).select().maybeSingle();
  } else {
    result = await sb.from('global_announcement').insert(row).select().maybeSingle();
  }

  if (result.error) return NextResponse.json({ error: 'Announcement could not be saved.' }, { status: 500 });
  return NextResponse.json({ data: result.data });
}
