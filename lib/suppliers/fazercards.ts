/*
  FazerCards supplier adapter.
  Implements the FazerCards reseller API (https://api.fzr.cards/api/v2).
  API key is resolved from server-side secrets via the existing credential convention.
*/

import type {
  SupplierConfig,
  SupplierAdapter,
  TestConnectionResult,
  BalanceResult,
  CatalogProduct,
  ValidationResult,
  FulfillmentRequest,
  FulfillmentResult,
  TransactionStatusResult,
  RefundResult,
} from './adapter';
import { isSupplierFulfillmentReleased } from '@/lib/supplierFulfillmentRelease';

const FAZERCARDS_BASE = 'https://api.fzr.cards/api/v2';

function fazercardsBaseUrl(config: SupplierConfig): string {
  return config.apiUrl || FAZERCARDS_BASE;
}

function authHeaders(config: SupplierConfig): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const apiKey = config.credentials.api_key;
  if (apiKey) {
    headers['X-API-Key'] = apiKey;
  } else if (config.credentials.access_token) {
    headers['Authorization'] = `Bearer ${config.credentials.access_token}`;
  }
  return headers;
}

async function timedFetch(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function normalizeHttpError(status: number, data: Record<string, unknown> | null): string {
  const msg = data && (data.error || data.message);
  switch (status) {
    case 400: return `FazerCards validation error: ${msg || 'bad request'}`;
    case 401: return 'FazerCards: invalid or missing API key';
    case 403: return 'FazerCards: account, product, or API access disabled';
    case 404: return 'FazerCards: unknown resource';
    case 409: return `FazerCards conflict: ${msg || 'conflict'}`;
    case 429: return 'FazerCards: rate limited';
    default:
      if (status >= 500) return `FazerCards upstream error: HTTP ${status}`;
      return `FazerCards error: HTTP ${status}`;
  }
}

function mapOrderStatus(raw: string): TransactionStatusResult['status'] {
  const s = raw.toLowerCase();
  if (s.includes('complet') || s.includes('success') || s.includes('done')) return 'completed';
  if (s.includes('fail') || s.includes('error') || s.includes('cancel')) return 'failed';
  if (s.includes('refund')) return 'refunded';
  return 'processing';
}

function hasExplicitCreateFailure(data: Record<string, unknown> | null): boolean {
  const order = data?.order as Record<string, unknown> | undefined;
  const rawStatus = order?.status ?? data?.status;
  const rawError = order?.error ?? order?.fail_reason ?? data?.error ?? data?.message;
  return typeof rawStatus === 'string'
    && mapOrderStatus(rawStatus) === 'failed'
    && typeof rawError === 'string'
    && rawError.trim().length > 0;
}

export class FazerCardsAdapter implements SupplierAdapter {
  readonly adapterName = 'fazercards';

  async testConnection(config: SupplierConfig): Promise<TestConnectionResult> {
    const start = Date.now();
    try {
      const res = await timedFetch(
        `${fazercardsBaseUrl(config)}/balance`,
        { method: 'GET', headers: authHeaders(config) },
        config.timeoutMs,
      );
      const latencyMs = Date.now() - start;
      if (res.ok) return { success: true, latencyMs, message: 'Connected — API key valid' };
      const data = (await res.json().catch(() => null)) as Record<string, unknown> | null;
      return { success: false, latencyMs, message: normalizeHttpError(res.status, data) };
    } catch (e) {
      return { success: false, latencyMs: Date.now() - start, message: e instanceof Error ? e.message : 'Connection failed' };
    }
  }

  async getBalance(config: SupplierConfig): Promise<BalanceResult> {
    const res = await timedFetch(
      `${fazercardsBaseUrl(config)}/balance`,
      { method: 'GET', headers: authHeaders(config) },
      config.timeoutMs,
    );
    const data = (await res.json().catch(() => null)) as Record<string, unknown> | null;
    if (!res.ok) throw new Error(normalizeHttpError(res.status, data));
    const balance = Number(data?.balance ?? 0);
    return {
      balanceCents: Math.round(balance * 100),
      currency: String(data?.currency || 'USD'),
    };
  }

  async getCatalog(config: SupplierConfig): Promise<CatalogProduct[]> {
    const products: CatalogProduct[] = [];
    let cursor: string | null = null;
    // Follow the supplier's cursor pagination until every page is fetched
    do {
      const url = new URL(`${fazercardsBaseUrl(config)}/topups`);
      url.searchParams.set('limit', '200');
      if (cursor) url.searchParams.set('cursor', cursor);
      const res = await timedFetch(
        url.toString(),
        { method: 'GET', headers: authHeaders(config) },
        config.timeoutMs,
      );
      const data = (await res.json().catch(() => null)) as Record<string, unknown> | null;
      if (!res.ok) throw new Error(normalizeHttpError(res.status, data));

      const categories = (Array.isArray(data) ? data : (data?.items as unknown[]) || (data?.categories as unknown[]) || []) as Record<string, unknown>[];
      for (const cat of categories) {
        products.push({
          supplierProductId: String(cat.category_id ?? cat.id ?? ''),
          name: String(cat.name ?? ''),
          denomination: cat.note ? String(cat.note) : null,
          priceCents: 0,
          currency: 'USD',
          category: String(cat.category_id ?? cat.id ?? ''),
        });
      }

      const meta = (data?.meta as Record<string, unknown> | null) || null;
      cursor = meta && meta.has_more === true && typeof meta.next_cursor === 'string' ? meta.next_cursor : null;
    } while (cursor);
    return products;
  }

  async validateAccount(
    config: SupplierConfig,
    playerId: string,
    _serverId?: string,
  ): Promise<ValidationResult> {
    const categoryId = (config.metadata.category_id as string) || '';
    const fields = (config.metadata.fields as Record<string, string>) || { player_id: playerId };

    const body = JSON.stringify({ category_id: categoryId, fields });
    const res = await timedFetch(
      `${fazercardsBaseUrl(config)}/topups/validate-id`,
      { method: 'POST', headers: authHeaders(config), body },
      config.timeoutMs,
    );
    const data = (await res.json().catch(() => null)) as Record<string, unknown> | null;
    if (!res.ok) {
      return { valid: false, accountName: null, error: normalizeHttpError(res.status, data) };
    }
    return {
      valid: Boolean(data?.valid ?? data?.ok),
      accountName: data?.player_name ? String(data.player_name) : null,
      error: null,
    };
  }

  async createOrder(config: SupplierConfig, request: FulfillmentRequest): Promise<FulfillmentResult> {
    if (!isSupplierFulfillmentReleased(process.env.RUNFAZONE_SUPPLIER_FULFILLMENT_RELEASE)) {
      return {
        success: false,
        supplierReference: null,
        status: 'failed',
        error: 'Supplier fulfillment is disabled',
        rawResponse: null,
      };
    }
    const metadata = request.metadata || {};
    const categoryId = (metadata.category_id as string) || '';
    const offerId = (metadata.offer_id as string) || request.supplierProductId;
    const fields = (metadata.fields as Record<string, string>) || {};

    const body = JSON.stringify({
      category_id: categoryId,
      offer_id: offerId,
      fields,
    });

    const headers: Record<string, string> = {
      ...authHeaders(config),
      'Idempotency-Key': request.idempotencyKey,
    };

    const res = await timedFetch(
      `${fazercardsBaseUrl(config)}/topups/order`,
      { method: 'POST', headers, body },
      config.timeoutMs,
    );
    const data = (await res.json().catch(() => null)) as Record<string, unknown> | null;

    if (res.status === 429) {
      const retryAfter = res.headers.get('Retry-After');
      return {
        success: false,
        supplierReference: null,
        status: 'pending',
        error: `FazerCards rate limited${retryAfter ? ` (retry after ${retryAfter}s)` : ''}`,
        rawResponse: data,
      };
    }

    if (!res.ok) {
      return {
        success: false,
        supplierReference: null,
        // HTTP status alone does not prove that the supplier never accepted
        // the request. Only an explicit terminal status in the response may
        // be finalized; all other errors remain recoverable.
        status: hasExplicitCreateFailure(data) ? 'failed' : 'pending',
        error: normalizeHttpError(res.status, data),
        rawResponse: data,
      };
    }

    const order = (data?.order as Record<string, unknown>) || {};
    return {
      success: Boolean(data?.ok ?? true),
      supplierReference: String(order.id ?? data?.order_id ?? ''),
      status: (mapOrderStatus(String(order.status ?? 'processing')) === 'refunded' ? 'completed' : mapOrderStatus(String(order.status ?? 'processing'))) as FulfillmentResult['status'],
      error: null,
      rawResponse: data,
    };
  }

  async queryStatus(config: SupplierConfig, supplierReference: string): Promise<TransactionStatusResult> {
    const res = await timedFetch(
      `${fazercardsBaseUrl(config)}/orders/${encodeURIComponent(supplierReference)}`,
      { method: 'GET', headers: authHeaders(config) },
      config.timeoutMs,
    );
    const data = (await res.json().catch(() => null)) as Record<string, unknown> | null;
    if (!res.ok) {
      return {
        status: 'failed',
        supplierReference,
        error: normalizeHttpError(res.status, data),
        rawResponse: data,
      };
    }

    const order = (data?.order as Record<string, unknown>) || data || {};
    return {
      status: mapOrderStatus(String(order.status ?? 'processing')),
      supplierReference,
      error: null,
      rawResponse: data,
    };
  }

  async refund(config: SupplierConfig, _supplierReference: string): Promise<RefundResult> {
    // FazerCards does not currently expose a refund endpoint.
    return {
      success: false,
      refundReference: null,
      error: 'FazerCards does not support automated refunds. Use the reseller hub to request a refund manually.',
    };
  }
}
