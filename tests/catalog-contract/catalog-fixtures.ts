import type { SupplierConfig } from '@/lib/suppliers/adapter';

/** Sanitized, provider-free fixtures. They must never be replaced with live credentials. */
export const syntheticCategoryPage = (cursor: string | null, categories: Array<Record<string, unknown>>, hasMore = false) => ({
  items: categories,
  meta: hasMore ? { has_more: true, next_cursor: cursor } : { has_more: false },
});

export const syntheticSupplierConfig = (overrides: Partial<SupplierConfig> = {}): SupplierConfig => ({
  id: 'supplier-synthetic-001',
  code: 'fazercards',
  adapter: 'custom',
  apiUrl: 'https://supplier.invalid/api/v2',
  sandboxApiUrl: 'https://supplier.invalid/sandbox',
  environment: 'sandbox',
  timeoutMs: 100,
  retryCount: 2,
  authType: 'api_key',
  authConfig: { header_name: 'X-API-Key' },
  metadata: {},
  credentials: { api_key: 'SYNTHETIC_NOT_A_CREDENTIAL' },
  ...overrides,
});

export const catalogPriceFixture = {
  supplierCostUsd: 1.25,
  fxRatePhpPerUsd: 56.4,
  markupPercent: 20,
  expectedSellingCents: 8460,
} as const;

export const catalogIdentities = {
  admin: 'admin-catalog-001b@example.invalid',
  staff: 'staff-catalog-001b@example.invalid',
  customer: 'customer-catalog-001b@example.invalid',
  anonymous: 'anonymous',
} as const;
