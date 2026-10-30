import type { SupabaseClient } from '@supabase/supabase-js';
import type { CatalogField, CatalogOffer } from './suppliers/fazercardsCatalog';

// Retained as a named constant for older catalog and fulfillment contracts.
// Import eligibility is no longer hard-coded to this one category.
export const MOBILE_LEGENDS_CATEGORY_ID = 'mobile_legends_philippines';

export type SupplierOfferInput = { offer_id: unknown; name: unknown; price_usd: unknown };
export type ParsedSupplierOffer = CatalogOffer;

const VALID_ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,119}$/;

export function validateSupplierOffers(input: unknown): { offers?: ParsedSupplierOffer[]; error?: string } {
  if (!Array.isArray(input) || input.length === 0 || input.length > 2000) return { error: 'Offer list must contain 1 to 2000 items.' };
  const offers: ParsedSupplierOffer[] = [];
  const ids = new Set<string>();
  for (const value of input) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return { error: 'Offer list contains an invalid item.' };
    const row = value as SupplierOfferInput;
    const offerId = typeof row.offer_id === 'string' ? row.offer_id.trim() : '';
    const name = typeof row.name === 'string' ? row.name.trim() : '';
    const price = typeof row.price_usd === 'number' ? row.price_usd : typeof row.price_usd === 'string' ? Number(row.price_usd) : Number.NaN;
    if (!VALID_ID.test(offerId) || !name || name.length > 180 || !Number.isFinite(price) || price <= 0 || price > 1_000_000) {
      return { error: 'Offer list contains an invalid ID, name, or positive USD cost.' };
    }
    if (ids.has(offerId)) return { error: 'Offer list contains duplicate offer IDs.' };
    ids.add(offerId);
    offers.push({ offer_id: offerId, name, price_usd: Math.round(price * 10_000) / 10_000 });
  }
  return { offers };
}

export type ImportOptions = {
  gameId: string;
  supplierId: string;
  categoryId: string;
  offers: ParsedSupplierOffer[];
  fields?: CatalogField[];
  region?: string | null;
  currency?: string;
  completeSnapshot: boolean;
  actorId?: string | null;
  source?: 'live_provider' | 'synthetic_fixture';
};

export type ImportResult = {
  run_id: string | null;
  status: 'complete' | 'partial' | 'failed';
  created: number;
  updated: number;
  deactivated: number;
  failed: number;
  requires_review: number;
  failed_offer_ids: string[];
  error?: string;
};

const emptyResult = (error: string): ImportResult => ({
  run_id: null, status: 'failed', created: 0, updated: 0, deactivated: 0,
  failed: 0, requires_review: 0, failed_offer_ids: [], error,
});

function parseResult(value: unknown): ImportResult | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (!['complete', 'partial', 'failed'].includes(String(row.status))) return null;
  const number = (key: string) => Number.isSafeInteger(row[key]) && Number(row[key]) >= 0 ? Number(row[key]) : null;
  const created = number('created');
  const updated = number('updated');
  const deactivated = number('deactivated');
  const failed = number('failed');
  const requiresReview = number('requires_review');
  if ([created, updated, deactivated, failed, requiresReview].some((count) => count === null)) return null;
  return {
    run_id: typeof row.run_id === 'string' ? row.run_id : null,
    status: row.status as ImportResult['status'],
    created: created!, updated: updated!, deactivated: deactivated!, failed: failed!,
    requires_review: requiresReview!,
    failed_offer_ids: Array.isArray(row.failed_offer_ids)
      ? row.failed_offer_ids.filter((id): id is string => typeof id === 'string')
      : [],
  };
}

/**
 * The caller must pass offers resolved from the trusted server catalog source.
 * All package/mapping/field writes are performed in the database RPC so each
 * offer is all-or-nothing, snapshots are audited, and reimports serialize.
 */
export async function importSupplierOffers(db: SupabaseClient, options: ImportOptions): Promise<ImportResult> {
  const validation = validateSupplierOffers(options.offers);
  if (validation.error || !validation.offers) return emptyResult(validation.error || 'Offer list is invalid.');
  if (!VALID_ID.test(options.categoryId)) return emptyResult('Supplier category ID is invalid.');
  if (options.fields && (options.fields.length > 32 || new Set(options.fields.map((field) => field.key)).size !== options.fields.length)) {
    return emptyResult('Supplier player-field metadata is invalid.');
  }
  const { data, error } = await db.rpc('admin_import_supplier_catalog', {
    p_supplier_id: options.supplierId,
    p_game_id: options.gameId,
    p_category_id: options.categoryId,
    p_offers: validation.offers,
    p_fields: (options.fields || []).map((field, index) => ({
      field_key: field.key,
      label: field.label,
      placeholder: field.placeholder,
      help_text: field.help_text,
      is_required: field.required,
      sort_order: index,
    })),
    p_region: options.region || null,
    p_currency: options.currency || 'USD',
    p_complete_snapshot: options.completeSnapshot,
    p_actor_id: options.actorId || null,
    p_source: options.source || 'synthetic_fixture',
  });
  if (error) {
    if (error.code === '22023') return emptyResult('Supplier offers or player fields failed database validation.');
    if (error.code === '23503') return emptyResult('The target game or supplier is unavailable.');
    if (error.code === '23505') return emptyResult('An offer identity is already assigned to a different package or game.');
    return emptyResult('The supplier catalog import could not be committed.');
  }
  const result = parseResult(data);
  return result || emptyResult('The database returned an invalid catalog import result.');
}
