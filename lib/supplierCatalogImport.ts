import type { SupabaseClient } from '@supabase/supabase-js';
import { minimumSalePriceCents } from './catalogPricing';

export const MOBILE_LEGENDS_CATEGORY_ID = 'mobile_legends_philippines';

export type SupplierOfferInput = { offer_id: unknown; name: unknown; price_usd: unknown };
export type ParsedSupplierOffer = { offer_id: string; name: string; price_usd: number };

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
    if (!offerId || offerId.length > 180 || !name || name.length > 180 || !Number.isFinite(price) || price <= 0) {
      return { error: 'Offer list contains an invalid ID, name, or positive USD cost.' };
    }
    if (ids.has(offerId)) return { error: 'Offer list contains duplicate offer IDs.' };
    ids.add(offerId);
    offers.push({ offer_id: offerId, name, price_usd: price });
  }
  return { offers };
}

type ImportOptions = {
  gameId: string;
  supplierId: string;
  categoryId: string;
  completeSnapshot: boolean;
  offers: ParsedSupplierOffer[];
  fxRate: number;
  feeReserveBps: number | null;
  fixedFeeCents: number | null;
};

export type ImportResult = {
  created: number;
  updated: number;
  deactivated: number;
  failed: number;
  requires_review: number;
  failed_offer_ids: string[];
  error?: string;
};

export async function importSupplierOffers(db: SupabaseClient, options: ImportOptions): Promise<ImportResult> {
  const empty: ImportResult = { created: 0, updated: 0, deactivated: 0, failed: 0, requires_review: 0, failed_offer_ids: [] };
  if (options.categoryId !== MOBILE_LEGENDS_CATEGORY_ID) return { ...empty, error: 'Only the approved Mobile Legends category can be imported.' };
  if (options.offers.length === 0) return { ...empty, error: 'Offer list is empty.' };

  const [targetRows, allLinkedRows] = await Promise.all([
    db.from('packages').select('id,game_id,name,sku,amount,price_cents,is_active,catalog_status,published_at,supplier_offer_id,supplier_category_id,supplier_cost_usd,supplier_review_required').eq('game_id', options.gameId),
    db.from('packages').select('id,game_id,supplier_offer_id,supplier_category_id').eq('supplier_category_id', options.categoryId).not('supplier_offer_id', 'is', null),
  ]);
  if (targetRows.error || allLinkedRows.error) return { ...empty, error: 'Could not read the current catalog.' };
  const target = targetRows.data || [];
  const allLinked = allLinkedRows.data || [];
  const targetByOffer = new Map<string, typeof target[number]>();
  const targetBySku = new Map<string, typeof target[number]>();
  for (const pkg of target) {
    if (pkg.supplier_offer_id && pkg.supplier_category_id === options.categoryId) {
      if (targetByOffer.has(pkg.supplier_offer_id)) return { ...empty, error: 'Catalog contains duplicate supplier offer mappings.' };
      targetByOffer.set(pkg.supplier_offer_id, pkg);
    }
    if (typeof pkg.sku === 'string') targetBySku.set(pkg.sku, pkg);
  }

  const foreignOffers = new Set(allLinked.filter((pkg) => pkg.game_id !== options.gameId).map((pkg) => pkg.supplier_offer_id));
  if (options.offers.some((offer) => foreignOffers.has(offer.offer_id))) return { ...empty, error: 'An offer is already assigned to a different game.' };
  const mappings = await db.from('supplier_package_mappings')
    .select('package_id,supplier_product_id')
    .eq('supplier_id', options.supplierId)
    .in('supplier_product_id', options.offers.map((offer) => offer.offer_id));
  if (mappings.error) return { ...empty, error: 'Could not validate supplier mappings.' };
  const mappingPackageIds = Array.from(new Set((mappings.data || []).map((mapping) => mapping.package_id)));
  if (mappingPackageIds.length) {
    const mappedPackages = await db.from('packages').select('id,game_id,supplier_category_id,supplier_offer_id').in('id', mappingPackageIds);
    if (mappedPackages.error) return { ...empty, error: 'Could not validate supplier mappings.' };
    const packageById = new Map((mappedPackages.data || []).map((pkg) => [pkg.id, pkg]));
    for (const mapping of mappings.data || []) {
      const pkg = packageById.get(mapping.package_id);
      if (!pkg || pkg.game_id !== options.gameId || pkg.supplier_category_id !== options.categoryId || pkg.supplier_offer_id !== mapping.supplier_product_id) {
        return { ...empty, error: 'A supplier mapping belongs to a different game or offer.' };
      }
    }
  }

  const seen = new Set<string>();
  const failures: string[] = [];
  for (const offer of options.offers) {
    seen.add(offer.offer_id);
    const sku = `FC-${options.categoryId}-${offer.offer_id}`;
    const byOffer = targetByOffer.get(offer.offer_id);
    const bySku = targetBySku.get(sku);
    if (byOffer && bySku && byOffer.id !== bySku.id) return { ...empty, error: 'Offer SKU conflicts with a different catalog package.' };
    const existing = byOffer || bySku;
    if (existing && existing.game_id !== options.gameId) return { ...empty, error: 'Offer SKU is already assigned to a different game.' };
    if (existing && (existing.supplier_offer_id !== offer.offer_id || existing.supplier_category_id !== options.categoryId)) {
      return { ...empty, error: 'Offer SKU conflicts with an existing manual or differently mapped package.' };
    }
    const minimum = options.feeReserveBps === null || options.fixedFeeCents === null ? null : minimumSalePriceCents(offer.price_usd, options.fxRate, options.feeReserveBps, options.fixedFeeCents);
    const needsReview = minimum === null || (existing?.price_cents ?? 0) < minimum;
    const supplierReview = Boolean(existing?.supplier_review_required) || needsReview;
    if (existing) {
      const patch: Record<string, unknown> = {
        supplier_offer_id: offer.offer_id,
        supplier_category_id: options.categoryId,
        supplier_cost_usd: offer.price_usd,
        supplier_last_seen_at: new Date().toISOString(),
        supplier_review_required: supplierReview,
      };
      if (needsReview) {
        patch.is_active = false;
        patch.catalog_status = 'DRAFT';
        patch.published_at = null;
      }
      const result = await db.from('packages').update(patch).eq('id', existing.id);
      if (result.error) failures.push(offer.offer_id);
      else {
        empty.updated++;
        if (supplierReview) empty.requires_review++;
      }
    } else {
      const result = await db.from('packages').insert({
        game_id: options.gameId,
        name: offer.name,
        amount: offer.name,
        sku,
        price_cents: 0,
        is_active: false,
        catalog_status: 'DRAFT',
        supplier_offer_id: offer.offer_id,
        supplier_category_id: options.categoryId,
        supplier_cost_usd: offer.price_usd,
        supplier_last_seen_at: new Date().toISOString(),
        supplier_review_required: true,
      });
      if (result.error) failures.push(offer.offer_id);
      else {
        empty.created++;
        empty.requires_review++;
      }
    }
  }
  empty.failed = failures.length;
  empty.failed_offer_ids = failures;

  // A snapshot only proves removal when every requested write succeeded.
  if (options.completeSnapshot && failures.length === 0) {
    const removed = target.filter((pkg) => pkg.supplier_category_id === options.categoryId && pkg.supplier_offer_id && !seen.has(pkg.supplier_offer_id));
    for (const pkg of removed) {
      const result = await db.from('packages').update({ is_active: false, catalog_status: 'DRAFT', published_at: null, supplier_review_required: true }).eq('id', pkg.id);
      if (result.error) empty.failed++;
      else { empty.deactivated++; empty.requires_review++; }
    }
  }
  return empty;
}
