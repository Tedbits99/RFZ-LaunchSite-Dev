// Edge-side copy of lib/reconciliationSecurity.ts (kept in sync manually).
// The Edge Function bundler cannot resolve imports outside supabase/functions/,
// so workers import from this directory instead.
export type ReconciliationSupplier = {
  code?: unknown;
  adapter?: unknown;
  enabled?: unknown;
};

/**
 * Compare scheduler credentials without allowing a length-dependent early exit.
 * Empty or missing values are never valid credentials.
 */
export function hasValidReconciliationSecret(provided: string | null, expected: string | null | undefined): boolean {
  if (!provided || !expected) return false;

  const providedBytes = new TextEncoder().encode(provided);
  const expectedBytes = new TextEncoder().encode(expected);
  let difference = providedBytes.length ^ expectedBytes.length;
  const comparisonLength = Math.max(providedBytes.length, expectedBytes.length);

  for (let index = 0; index < comparisonLength; index += 1) {
    difference |= (providedBytes[index] ?? 0) ^ (expectedBytes[index] ?? 0);
  }

  return difference === 0;
}

/**
 * Reconciliation is intentionally FazerCards-only until another adapter has a
 * separately reviewed polling implementation.
 */
export function isEnabledFazerCardsSupplier(supplier: ReconciliationSupplier): boolean {
  return supplier.enabled === true
    && supplier.code === 'fazercards'
    && supplier.adapter === 'custom';
}

export function mapReconciliationSupplierStatus(raw: string): 'completed' | 'failed' | 'processing' {
  const status = raw.toLowerCase();
  if (status.includes('complet') || status.includes('success') || status.includes('done')) return 'completed';
  if (status.includes('fail') || status.includes('error') || status.includes('cancel')) return 'failed';
  return 'processing';
}

export function getReconciliationDecision(raw: string, failReason: unknown): 'completed' | 'failed' | 'processing' {
  const mapped = mapReconciliationSupplierStatus(raw);
  if (mapped === 'completed') return 'completed';
  if (mapped === 'failed' && typeof failReason === 'string' && failReason.trim().length > 0) return 'failed';
  return 'processing';
}

export function isInFlightSupplierTransactionStatus(status: unknown): boolean {
  return status === 'submitted' || status === 'pending';
}
