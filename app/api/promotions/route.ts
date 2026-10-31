import { NextRequest, NextResponse } from 'next/server';
import { adminSupabase } from '@/lib/supabaseAdmin';
import { requireAdminPermission } from '@/lib/adminGuard';

const ALLOWED_FIELDS = new Set(['image_url', 'is_active', 'cta_text', 'cta_href', 'sort_order', 'title', 'body', 'target_type', 'starts_at', 'ends_at', 'placement', 'target_game_id']);
const VALID_PLACEMENTS = new Set(['HOMEPAGE_HERO', 'GAME_CARD', 'GAME_DETAIL_HERO']);
const PROMOTION_ADMIN_COLUMNS = [
  'id',
  'title',
  'body',
  'target_type',
  'game_id',
  'package_id',
  'image_url',
  'cta_text',
  'cta_href',
  'starts_at',
  'ends_at',
  'is_active',
  'sort_order',
  'placement',
  'target_game_id',
] as const;
const PROMOTION_ADMIN_SELECT = PROMOTION_ADMIN_COLUMNS.join(', ');
const PRIVATE_NO_STORE = { 'Cache-Control': 'private, no-store' };

type PromotionAdminColumn = typeof PROMOTION_ADMIN_COLUMNS[number];

function projectPromotionForAdmin(row: Record<string, unknown>): Record<PromotionAdminColumn, unknown> {
  return Object.fromEntries(
    PROMOTION_ADMIN_COLUMNS.map((column) => [column, row[column]]),
  ) as Record<PromotionAdminColumn, unknown>;
}

function privateNoStore(response: Response): Response {
  response.headers.set('Cache-Control', 'private, no-store');
  return response;
}

/** Admin management API only. Storefront promotion reads use separate public paths. */
export async function GET(req: NextRequest) {
  const auth = await requireAdminPermission(req, 'marketing.manage');
  if (!auth.ok) return privateNoStore(auth.response);

  if (req.nextUrl.searchParams.toString()) {
    return NextResponse.json({ error: 'Unsupported query parameters.' }, { status: 400, headers: PRIVATE_NO_STORE });
  }

  const db = adminSupabase;
  if (!db) {
    return NextResponse.json({ error: 'Database not configured.' }, { status: 503, headers: PRIVATE_NO_STORE });
  }

  try {
    const { data, error } = await db
      .from('promotions')
      .select(PROMOTION_ADMIN_SELECT)
      .order('sort_order');

    if (error) {
      return NextResponse.json({ error: 'Promotions are temporarily unavailable.' }, { status: 500, headers: PRIVATE_NO_STORE });
    }

    const rows = (data || []) as unknown as Record<string, unknown>[];
    return NextResponse.json({ data: rows.map(projectPromotionForAdmin) }, { headers: PRIVATE_NO_STORE });
  } catch {
    return NextResponse.json({ error: 'Promotions are temporarily unavailable.' }, { status: 500, headers: PRIVATE_NO_STORE });
  }
}

export async function POST(req: NextRequest) {
  const auth = await requireAdminPermission(req, 'marketing.manage');
  if (!auth.ok) return auth.response;

  const db = adminSupabase;
  if (!db) return NextResponse.json({ error: 'Database not configured.' }, { status: 503 });

  try {
    const body = await req.json();
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return NextResponse.json({ error: 'A JSON object is required.' }, { status: 400 });
    }
    const title = String(body.title || '').trim();
    if (!title || title.length > 160) {
      return NextResponse.json({ error: 'Title is required and must be at most 160 characters.' }, { status: 400 });
    }
    if (typeof body.body !== 'string' || body.body.length > 10000) return NextResponse.json({ error: 'Promotion body must be text up to 10000 characters.' }, { status: 400 });
    if (body.target_type !== undefined && !['GLOBAL', 'GAME', 'PACKAGE'].includes(body.target_type)) return NextResponse.json({ error: 'Invalid promotion target type.' }, { status: 400 });
    if (body.placement !== undefined && (typeof body.placement !== 'string' || !VALID_PLACEMENTS.has(body.placement))) return NextResponse.json({ error: 'Invalid banner placement.' }, { status: 400 });
    if (body.sort_order !== undefined && (!Number.isSafeInteger(body.sort_order) || body.sort_order < 0)) return NextResponse.json({ error: 'sort_order must be a non-negative integer.' }, { status: 400 });
    if (body.is_active !== undefined && typeof body.is_active !== 'boolean') return NextResponse.json({ error: 'is_active must be boolean.' }, { status: 400 });
    if (body.cta_text !== undefined && (typeof body.cta_text !== 'string' || body.cta_text.length > 100)) return NextResponse.json({ error: 'CTA text must be at most 100 characters.' }, { status: 400 });
    if (body.starts_at !== undefined && body.starts_at !== null && (typeof body.starts_at !== 'string' || !Number.isFinite(Date.parse(body.starts_at)))) return NextResponse.json({ error: 'Invalid promotion start time.' }, { status: 400 });
    if (body.ends_at !== undefined && body.ends_at !== null && (typeof body.ends_at !== 'string' || !Number.isFinite(Date.parse(body.ends_at)))) return NextResponse.json({ error: 'Invalid promotion end time.' }, { status: 400 });

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
        const url = new URL(cta_href);
        if (!['https:', 'http:'].includes(url.protocol)) throw new Error('unsupported protocol');
      } catch {
        return NextResponse.json({ error: 'Invalid CTA link format.' }, { status: 400 });
      }
    }

    const target_type = body.target_type ?? 'GLOBAL';
    const placement = VALID_PLACEMENTS.has(body.placement) ? body.placement : 'HOMEPAGE_HERO';
    const target_game_id = body.target_game_id || null;
    if (target_game_id !== null && (typeof target_game_id !== 'string' || target_game_id.length > 80)) return NextResponse.json({ error: 'Invalid target game.' }, { status: 400 });

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
      is_active: body.is_active ?? false,
      sort_order: body.sort_order ?? 0,
      created_by: auth.session.userId,
      updated_by: auth.session.userId,
    };

    if (body.starts_at) insert.starts_at = body.starts_at;
    if (body.ends_at) insert.ends_at = body.ends_at;
    if (insert.starts_at && insert.ends_at && Date.parse(String(insert.ends_at)) <= Date.parse(String(insert.starts_at))) return NextResponse.json({ error: 'Promotion end time must be after its start time.' }, { status: 400 });

    const { data, error } = await db
      .from('promotions')
      .insert(insert)
      .select()
      .single();

    if (error) return NextResponse.json({ error: 'Promotion could not be saved.' }, { status: 500 });

    return NextResponse.json({ data });
  } catch (error) {
    return NextResponse.json({ error: error instanceof SyntaxError ? 'A valid JSON object is required.' : 'Promotion could not be saved.' }, { status: error instanceof SyntaxError ? 400 : 500 });
  }
}

export async function PATCH(req: NextRequest) {
  const auth = await requireAdminPermission(req, 'marketing.manage');
  if (!auth.ok) return auth.response;

  const db = adminSupabase;
  if (!db) return NextResponse.json({ error: 'Database not configured.' }, { status: 503 });

  try {
    const body = await req.json();
    if (!body || typeof body !== 'object' || Array.isArray(body)) return NextResponse.json({ error: 'A JSON object is required.' }, { status: 400 });
    const { id, ...rawUpdates } = body;

    if (!id || typeof id !== 'string') {
      return NextResponse.json({ error: 'Promotion id is required.' }, { status: 400 });
    }
    if (Object.keys(rawUpdates).some((key) => !ALLOWED_FIELDS.has(key))) return NextResponse.json({ error: 'Unsupported promotion field.' }, { status: 400 });

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
    if (rawUpdates.target_type !== undefined && !['GLOBAL', 'GAME', 'PACKAGE'].includes(rawUpdates.target_type)) return NextResponse.json({ error: 'Invalid promotion target type.' }, { status: 400 });
    if (rawUpdates.title !== undefined && (typeof rawUpdates.title !== 'string' || !rawUpdates.title.trim() || rawUpdates.title.length > 160)) return NextResponse.json({ error: 'Title must be non-empty and at most 160 characters.' }, { status: 400 });
    if (rawUpdates.body !== undefined && (typeof rawUpdates.body !== 'string' || rawUpdates.body.length > 10000)) return NextResponse.json({ error: 'Promotion body must be text up to 10000 characters.' }, { status: 400 });
    if (rawUpdates.is_active !== undefined && typeof rawUpdates.is_active !== 'boolean') return NextResponse.json({ error: 'is_active must be boolean.' }, { status: 400 });
    if (rawUpdates.sort_order !== undefined && (!Number.isSafeInteger(rawUpdates.sort_order) || rawUpdates.sort_order < 0)) return NextResponse.json({ error: 'sort_order must be a non-negative integer.' }, { status: 400 });
    if (rawUpdates.cta_text !== undefined && rawUpdates.cta_text !== null && (typeof rawUpdates.cta_text !== 'string' || rawUpdates.cta_text.length > 100)) return NextResponse.json({ error: 'CTA text must be at most 100 characters.' }, { status: 400 });
    if (rawUpdates.starts_at !== undefined && rawUpdates.starts_at !== null && (typeof rawUpdates.starts_at !== 'string' || !Number.isFinite(Date.parse(rawUpdates.starts_at)))) return NextResponse.json({ error: 'Invalid promotion start time.' }, { status: 400 });
    if (rawUpdates.ends_at !== undefined && rawUpdates.ends_at !== null && (typeof rawUpdates.ends_at !== 'string' || !Number.isFinite(Date.parse(rawUpdates.ends_at)))) return NextResponse.json({ error: 'Invalid promotion end time.' }, { status: 400 });
    if (rawUpdates.starts_at && rawUpdates.ends_at && Date.parse(String(rawUpdates.ends_at)) <= Date.parse(String(rawUpdates.starts_at))) return NextResponse.json({ error: 'Promotion end time must be after its start time.' }, { status: 400 });
    if (rawUpdates.cta_href !== undefined && rawUpdates.cta_href !== null && rawUpdates.cta_href !== '') {
      try {
        const url = new URL(rawUpdates.cta_href);
        if (!['https:', 'http:'].includes(url.protocol)) throw new Error('unsupported protocol');
      } catch {
        return NextResponse.json({ error: 'CTA links must be valid HTTP or HTTPS URLs.' }, { status: 400 });
      }
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
    updates.updated_by = auth.session.userId;

    const { data, error } = await db
      .from('promotions')
      .update(updates)
      .eq('id', id)
      .select();

    if (error) return NextResponse.json({ error: 'Promotion could not be updated.' }, { status: 500 });

    if (!data || data.length === 0) {
      return NextResponse.json({ error: 'Promotion not found or you do not have permission to update it.' }, { status: 404 });
    }

    return NextResponse.json({ data: data[0] });
  } catch (error) {
    return NextResponse.json({ error: error instanceof SyntaxError ? 'A valid JSON object is required.' : 'Promotion could not be updated.' }, { status: error instanceof SyntaxError ? 400 : 500 });
  }
}
