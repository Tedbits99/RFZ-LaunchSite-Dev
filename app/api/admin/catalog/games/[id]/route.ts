import { NextRequest, NextResponse } from 'next/server';
import { adminSupabase } from '@/lib/supabaseAdmin';
import { requireCatalogAdmin } from '@/lib/catalogAdminGuard';
import { minimumSalePriceCents } from '@/lib/catalogPricing';

const ALLOWED_IMAGE = /^https:\/\//;

function normalizeFields(value: unknown) {
  if (!Array.isArray(value)) return null;
  const fields = value.map((field, index) => {
    const row = field as Record<string, unknown>;
    return {
      label: typeof row.label === 'string' ? row.label.trim() : '',
      field_key: typeof row.field_key === 'string' ? row.field_key.trim().toLowerCase() : '',
      placeholder: typeof row.placeholder === 'string' ? row.placeholder.trim() : '',
      help_text: typeof row.help_text === 'string' ? row.help_text.trim() : '',
      is_required: row.is_required !== false,
      sort_order: typeof row.sort_order === 'number' ? Math.round(row.sort_order) : index,
    };
  });
  if (fields.some((field) => !field.label || !/^[a-z][a-z0-9_]*$/.test(field.field_key))) return null;
  if (new Set(fields.map((field) => field.field_key)).size !== fields.length) return null;
  return fields;
}

function validImage(value: unknown): boolean {
  return value === null || value === '' || (typeof value === 'string' && ALLOWED_IMAGE.test(value));
}

export async function PATCH(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const auth = await requireCatalogAdmin(req);
  if (!auth.ok) return auth.response;
  const { id } = await context.params;
  const body = await req.json().catch(() => null) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
  const action = typeof body.action === 'string' ? body.action : null;
  if (action && !adminSupabase) return NextResponse.json({ error: 'Server-side catalog database access is not configured.' }, { status: 503 });
  const db = adminSupabase || auth.client;
  const { data: current, error: currentError } = await db.from('games').select('id,catalog_status,is_active').eq('id', id).maybeSingle();
  if (currentError) return NextResponse.json({ error: 'Could not load game.' }, { status: 500 });
  if (!current) return NextResponse.json({ error: 'Game not found.' }, { status: 404 });

  if (action) {
    const transitions: Record<string, { catalog_status: string; is_active: boolean }> = {
      publish: { catalog_status: 'PUBLISHED', is_active: true },
      hide: { catalog_status: 'DRAFT', is_active: false },
      archive: { catalog_status: 'ARCHIVED', is_active: false },
      restore: { catalog_status: 'DRAFT', is_active: false },
    };
    const next = transitions[action];
    if (!next) return NextResponse.json({ error: 'Unsupported catalog action.' }, { status: 400 });
    if (action === 'publish') {
      const { count: requiredFieldCount, error: fieldsError } = await db.from('game_input_fields').select('id', { count: 'exact', head: true }).eq('game_id', id).eq('is_required', true);
      if (fieldsError) return NextResponse.json({ error: 'Could not validate required player fields.' }, { status: 500 });
      if (!requiredFieldCount) return NextResponse.json({ error: 'Publishing requires at least one required player input field.' }, { status: 409 });
      const { data: candidates, error } = await db.from('packages')
        .select('id,price_cents,supplier_offer_id,supplier_category_id,supplier_cost_usd,supplier_review_required')
        .eq('game_id', id).eq('catalog_status', 'PUBLISHED').eq('is_active', true).gt('price_cents', 0).eq('supplier_review_required', false);
      if (error) return NextResponse.json({ error: 'Could not validate publish eligibility.' }, { status: 500 });
      const directCatalogReady = (candidates || []).some((pkg) => !pkg.supplier_offer_id && !pkg.supplier_category_id);
      let supplierCatalogReady = false;
      const linked = (candidates || []).filter((pkg) => pkg.supplier_offer_id || pkg.supplier_category_id);
      if (linked.length) {
        const { data: settings } = await db.from('app_settings').select('reference_usd_php_rate,payment_fee_reserve_bps,payment_fee_fixed_cents,supplier_fulfillment_release_enabled').eq('id', 1).maybeSingle();
        const { data: supplier } = await db.from('suppliers').select('id').eq('code', 'fazercards').maybeSingle();
        if (supplier && settings?.payment_fee_reserve_bps != null && settings.payment_fee_fixed_cents != null) {
          const { data: mappings } = await db.from('supplier_package_mappings').select('package_id,supplier_product_id,metadata').eq('supplier_id', supplier.id).in('package_id', linked.map((pkg) => pkg.id));
          supplierCatalogReady = (mappings || []).some((mapping) => {
            const pkg = linked.find((candidate) => candidate.id === mapping.package_id);
            const metadata = mapping.metadata as { category_id?: string } | null;
            const minimum = pkg?.supplier_cost_usd == null
              ? null
              : minimumSalePriceCents(Number(pkg.supplier_cost_usd), Number(settings.reference_usd_php_rate), Number(settings.payment_fee_reserve_bps), Number(settings.payment_fee_fixed_cents));
            return pkg !== undefined
              && Boolean(pkg.supplier_offer_id && pkg.supplier_category_id && pkg.supplier_offer_id === mapping.supplier_product_id && metadata?.category_id === pkg.supplier_category_id)
              && minimum !== null && pkg.price_cents >= minimum;
          });
        }
      }
      if (!directCatalogReady && !supplierCatalogReady) return NextResponse.json({ error: 'Publish requires a priced, reviewed package with a valid supplier mapping and sufficient margin.' }, { status: 409 });
    }
    const { data, error } = await db.from('games').update({
      ...next,
      published_at: action === 'publish' ? new Date().toISOString() : null,
      archived_at: action === 'archive' ? new Date().toISOString() : null,
      archived_by: action === 'archive' ? auth.session.userId : null,
    }).eq('id', id).select().single();
    if (error) return NextResponse.json({ error: 'Game lifecycle update failed.' }, { status: 500 });
    return NextResponse.json({ data });
  }

  const updates: Record<string, unknown> = {};
  for (const key of ['name', 'short_name', 'description', 'region', 'currency', 'logo_url', 'cover_url', 'banner_url']) {
    if (body[key] !== undefined) {
      if (['logo_url', 'cover_url', 'banner_url'].includes(key) && !validImage(body[key])) return NextResponse.json({ error: `${key} must be an HTTPS URL.` }, { status: 400 });
      if (typeof body[key] !== 'string') return NextResponse.json({ error: `${key} must be text.` }, { status: 400 });
      updates[key] = String(body[key]).trim() || null;
    }
  }
  if (typeof body.sort_order === 'number') updates.sort_order = Math.round(body.sort_order);
  if (typeof body.is_featured === 'boolean') updates.is_featured = body.is_featured;
  if (!Object.keys(updates).length && body.fields === undefined) return NextResponse.json({ error: 'No fields to update.' }, { status: 400 });
  const fields = body.fields === undefined ? undefined : normalizeFields(body.fields);
  if (body.fields !== undefined && fields === null) return NextResponse.json({ error: 'Every player field needs a valid, unique label and field key.' }, { status: 400 });
  const { error: updateError } = await db.rpc('admin_update_catalog_game', { p_id: id, p_updates: updates, p_fields: fields ?? null });
  if (updateError) {
    if (/not found/i.test(updateError.message)) return NextResponse.json({ error: 'Game not found.' }, { status: 404 });
    if (/invalid|field/i.test(updateError.message)) return NextResponse.json({ error: 'Player fields could not be updated.' }, { status: 400 });
    return NextResponse.json({ error: 'Game could not be updated.' }, { status: 500 });
  }
  const { data, error: readError } = await db.from('games').select('*, game_input_fields(*)').eq('id', id).single();
  if (readError) return NextResponse.json({ error: 'Game could not be read after update.' }, { status: 500 });
  return NextResponse.json({ data });
}
