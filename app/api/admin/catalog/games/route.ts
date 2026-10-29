import { NextRequest, NextResponse } from 'next/server';
import { adminSupabase } from '@/lib/supabaseAdmin';
import { requireAdmin } from '@/lib/adminGuard';

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const ALLOWED_IMAGE = /^https:\/\//;

type GameField = {
  label: string;
  field_key: string;
  placeholder?: string;
  help_text?: string;
  is_required?: boolean;
  sort_order?: number;
};

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function validateGame(body: Record<string, unknown>) {
  const slug = text(body.slug);
  const name = text(body.name);
  const region = text(body.region);
  if (!slug || !SLUG.test(slug)) return 'Slug must use lowercase letters, numbers, and hyphens.';
  if (!name || name.length > 120) return 'A game name up to 120 characters is required.';
  if (!region || region.length > 80) return 'A region up to 80 characters is required.';
  for (const key of ['logo_url', 'cover_url', 'banner_url']) {
    const value = body[key];
    if (value !== undefined && value !== null && value !== '' && (typeof value !== 'string' || !ALLOWED_IMAGE.test(value))) {
      return `${key} must be an HTTPS URL.`;
    }
  }
  if (body.fields !== undefined && !Array.isArray(body.fields)) return 'fields must be an array.';
  return null;
}

function normalizeFields(value: unknown): GameField[] {
  if (!Array.isArray(value)) return [];
  return value.map((field, index) => {
    const row = field as Record<string, unknown>;
    return {
      label: String(row.label || '').trim(),
      field_key: String(row.field_key || '').trim().toLowerCase(),
      placeholder: String(row.placeholder || '').trim(),
      help_text: String(row.help_text || '').trim(),
      is_required: row.is_required !== false,
      sort_order: typeof row.sort_order === 'number' ? Math.round(row.sort_order) : index,
    };
  });
}

export async function GET(req: NextRequest) {
  const auth = await requireAdmin(req);
  if (!auth.ok) return auth.response;
  const db = adminSupabase || auth.client;
  const query = new URL(req.url).searchParams.get('q')?.trim() || '';
  let request = db.from('games').select('*, game_input_fields(*)').order('sort_order').order('name');
  if (query) request = request.or(`name.ilike.%${query}%,slug.ilike.%${query}%`);
  const { data, error } = await request;
  if (error) return NextResponse.json({ error: 'Could not load games.' }, { status: 500 });
  return NextResponse.json({ data: data || [] });
}

export async function POST(req: NextRequest) {
  const auth = await requireAdmin(req);
  if (!auth.ok) return auth.response;
  const db = adminSupabase || auth.client;
  const body = await req.json().catch(() => null) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
  const validationError = validateGame(body);
  if (validationError) return NextResponse.json({ error: validationError }, { status: 400 });
  const fields = normalizeFields(body.fields);
  if (fields.some((field) => !field.label || !/^[a-z][a-z0-9_]*$/.test(field.field_key))) {
    return NextResponse.json({ error: 'Every player field needs a valid label and field key.' }, { status: 400 });
  }
  if (new Set(fields.map((field) => field.field_key)).size !== fields.length) {
    return NextResponse.json({ error: 'Player field keys must be unique.' }, { status: 400 });
  }
  const row = {
    slug: String(body.slug).trim(), name: String(body.name).trim(), short_name: text(body.short_name),
    description: text(body.description) || '', region: String(body.region).trim(), currency: text(body.currency) || 'PHP',
    logo_url: text(body.logo_url), cover_url: text(body.cover_url), banner_url: text(body.banner_url),
    is_active: false, is_featured: body.is_featured === true, sort_order: typeof body.sort_order === 'number' ? Math.round(body.sort_order) : 100,
    catalog_status: 'DRAFT',
  };
  const { data: game, error } = await db.from('games').insert(row).select().single();
  if (error) {
    if (error.code === '23505') return NextResponse.json({ error: 'A game with this slug already exists.' }, { status: 409 });
    return NextResponse.json({ error: 'Game could not be created.' }, { status: 500 });
  }
  if (fields.length) {
    const { error: fieldError } = await db.from('game_input_fields').insert(fields.map((field) => ({ ...field, game_id: game.id })));
    if (fieldError) {
      await db.from('games').delete().eq('id', game.id);
      return NextResponse.json({ error: 'Game fields could not be created.' }, { status: 400 });
    }
  }
  return NextResponse.json({ data: game }, { status: 201 });
}
