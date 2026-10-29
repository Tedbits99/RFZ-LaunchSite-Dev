export function minimumSalePriceCents(
  supplierCostUsd: number,
  fxRatePhpPerUsd: number,
  feeReserveBps: number,
  fixedFeeCents: number,
): number | null {
  if (![supplierCostUsd, fxRatePhpPerUsd, feeReserveBps, fixedFeeCents].every(Number.isFinite)) return null;
  if (supplierCostUsd < 0 || fxRatePhpPerUsd <= 0 || feeReserveBps < 0 || feeReserveBps >= 10_000 || fixedFeeCents < 0) return null;
  const supplierCostCents = supplierCostUsd * fxRatePhpPerUsd * 100;
  return Math.ceil((supplierCostCents + fixedFeeCents) / (1 - feeReserveBps / 10_000));
}

export function isValidCatalogFieldKey(value: string): boolean {
  return /^[a-z][a-z0-9_]*$/.test(value);
}
