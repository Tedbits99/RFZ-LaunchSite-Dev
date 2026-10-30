import type { SupabaseClient } from '@supabase/supabase-js';
import { getCatalogSourceMode, isDisposableCatalogFixtureMode, type CatalogSourceMode } from './fazercardsCatalog';

export type ResolvedCatalogSource = {
  mode: CatalogSourceMode | null;
  supplierId: string | null;
  reason: string;
};

export async function resolveFazerCardsCatalogSource(db: SupabaseClient): Promise<ResolvedCatalogSource> {
  if (isDisposableCatalogFixtureMode()) {
    const { data: supplier, error } = await db.from('suppliers').select('id').eq('code', 'fazercards').maybeSingle();
    if (error || !supplier) return { mode: null, supplierId: null, reason: 'Disposable supplier fixture is unavailable.' };
    return {
      mode: 'synthetic_fixture',
      supplierId: supplier.id,
      reason: 'Synthetic disposable fixture mode; no provider request is made.',
    };
  }

  const { data: supplier, error } = await db.from('suppliers').select('id,enabled').eq('code', 'fazercards').maybeSingle();
  if (error) return { mode: null, supplierId: null, reason: 'Supplier configuration could not be checked.' };
  if (!supplier) return { mode: null, supplierId: null, reason: 'FazerCards is not configured. Add the approved supplier record before catalog access.' };
  const mode = getCatalogSourceMode(supplier.enabled === true);
  if (!mode) {
    return {
      mode: null,
      supplierId: supplier.id,
      reason: 'Live catalog access is locked pending supplier enablement, upstream credential revocation verification, separate access authorization, and server-only credential configuration.',
    };
  }
  return { mode, supplierId: supplier.id, reason: 'Live catalog access is authorized by server-side release gates.' };
}
