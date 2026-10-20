import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { adminSupabase } from '@/lib/supabaseAdmin';
import { requireAdmin } from '@/lib/adminGuard';

const ALLOWED_FIELDS = new Set(['image_url', 'is_active', 'cta_text', 'cta_href', 'sort_order', 'title', 'body', 'target_type', 'starts_at', 'ends_at', 'placement', 'target_game_id']);
const VALID_PLACEMENTS = new Set(['HOMEPAGE_HERO', 'GAME_CARD', 'GAME_DETAIL_HERO']);

export async function GET() {
  const db = adminSupabase || supabase;
  if (!db) return NextResponse.json({ error: 'Database not configured.' }, { status: 503 });

  const { data, error } = await db
    .from('promotions')
    .select('*')
    .order('sort_order');

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ data: data || [] });
}

export async function POST(req: NextRequest) {
  const auth = await requireAdmin(req);
  if (!auth.ok) return auth.response;

  const db = adminSupabase || auth.client;
  if (!db) return NextResponse.json({ error: 'Database not configured.' }, { status: 503 });

  try {
    const body = await req.json();
    const title = String(body.title || '').trim();
    if (!title) {
      return NextResponse.json({ error: 'Title is required.' }, { status: 400 });
    }

    const image_url = String(body.image_url || '').trim();
    if (image_url) {
      try {
        const u = new URL(image_url);
        if (u.protocol !== 'https:') {
          return NextResponse.json({ error: 'Image URL must use HTTPS.' }, { status: 400 });
        }
      } catch {
        return NextResponse.json({ error: 'Invalid image URL format.' }, { status: 400 });
      }
    }

    const cta_href = String(body.cta_href || '').trim();
    if (cta_href) {
      try {
        new URL(cta_href);
      } catch {
        return NextResponse.json({ error: 'Invalid CTA link format.' }, { status: 400 });
      }
    }

    const target_type = ['GLOBAL', 'GAME', 'PACKAGE'].includes(body.target_type) ? body.target_type : 'GLOBAL';
    const placement = VALID_PLACEMENTS.has(body.placement) ? body.placement : 'HOMEPAGE_HERO';
    const target_game_id = body.target_game_id || null;

    if ((placement === 'GAME_CARD' || placement === 'GAME_DETAIL_HERO') && !target_game_id) {
      return NextResponse.json({ error: 'A target game is required for this banner placement.' }, { status: 400 });
    }

    const insert: Record<string, unknown> = {
      title,
      body: String(body.body || '').trim(),
      target_type,
      placement,
      target_game_id,
      image_url: image_url || null,
      cta_text: String(body.cta_text || '').trim() || null,
      cta_href: cta_href || null,
      is_active: Boolean(body.is_active),
      sort_order: Number(body.sort_order) || 0,
    };

    if (body.starts_at) insert.starts_at = body.starts_at;
    if (body.ends_at) insert.ends_at = body.ends_at;

    const { data, error } = await db
      .from('promotions')
      .insert(insert)
      .select()
      .single();

    if (error) {
      console.error('[promotions POST] DB error:', error.message);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ data });
  } catch {
    return NextResponse.json({ error: 'Server error.' }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  const auth = await requireAdmin(req);
  if (!auth.ok) return auth.response;

  const db = adminSupabase || auth.client;
  if (!db) return NextResponse.json({ error: 'Database not configured.' }, { status: 503 });

  try {
    const body = await req.json();
    const { id, ...rawUpdates } = body;

    if (!id || typeof id !== 'string') {
      return NextResponse.json({ error: 'Promotion id is required.' }, { status: 400 });
    }

    if (typeof rawUpdates.image_url === 'string' && rawUpdates.image_url !== '') {
      try {
        const u = new URL(rawUpdates.image_url);
        if (u.protocol !== 'https:') {
          return NextResponse.json({ error: 'Image URL must use HTTPS.' }, { status: 400 });
        }
      } catch {
        return NextResponse.json({ error: 'Invalid image URL format.' }, { status: 400 });
      }
    }

    if (typeof rawUpdates.placement === 'string' && !VALID_PLACEMENTS.has(rawUpdates.placement)) {
      return NextResponse.json({ error: 'Invalid banner placement.' }, { status: 400 });
    }

    const updates: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(rawUpdates)) {
      if (ALLOWED_FIELDS.has(key)) {
        updates[key] = value;
      }
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: 'No valid fields to update.' }, { status: 400 });
    }

    const { data, error } = await db
      .from('promotions')
      .update(updates)
      .eq('id', id)
      .select();

    if (error) {
      console.error('[promotions PATCH] DB error:', error.message);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    if (!data || data.length === 0) {
      return NextResponse.json({ error: 'Promotion not found or you do not have permission to update it.' }, { status: 404 });
    }

    return NextResponse.json({ data: data[0] });
  } catch {
    return NextResponse.json({ error: 'Server error.' }, { status: 500 });
  }
}
