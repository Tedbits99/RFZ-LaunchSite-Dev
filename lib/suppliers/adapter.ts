/*
  Supplier adapter interface.
  Each top-up provider (Reloadly, SEAGM, etc.) implements this interface.
  Adapters are stateless — all config comes from the SupplierConfig passed to each call.
*/

export interface SupplierConfig {
  id: string;
  code: string;
  adapter: string;
  apiUrl: string;
  sandboxApiUrl: string | null;
  environment: 'sandbox' | 'live';
  timeoutMs: number;
  retryCount: number;
  authType: string;
  authConfig: Record<string, unknown>;
  metadata: Record<string, unknown>;
  credentials: Record<string, string>;
}

export interface CatalogProduct {
  supplierProductId: string;
  name: string;
  denomination: string | null;
  priceCents: number;
  currency: string;
  category: string | null;
}

export interface BalanceResult {
  balanceCents: number;
  currency: string;
}

export interface ValidationResult {
  valid: boolean;
  accountName: string | null;
  error: string | null;
}

export interface FulfillmentRequest {
  idempotencyKey: string;
  supplierProductId: string;
  playerId: string;
  serverId?: string;
  quantity: number;
  metadata: Record<string, unknown>;
}

export interface FulfillmentResult {
  success: boolean;
  supplierReference: string | null;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  error: string | null;
  rawResponse: unknown;
}

export interface TransactionStatusResult {
  status: 'pending' | 'processing' | 'completed' | 'failed' | 'refunded';
  supplierReference: string | null;
  error: string | null;
  rawResponse: unknown;
}

export interface RefundResult {
  success: boolean;
  refundReference: string | null;
  error: string | null;
}

export interface TestConnectionResult {
  success: boolean;
  latencyMs: number;
  message: string;
}

export interface SupplierAdapter {
  readonly adapterName: string;

  testConnection(config: SupplierConfig): Promise<TestConnectionResult>;
  getBalance(config: SupplierConfig): Promise<BalanceResult>;
  getCatalog(config: SupplierConfig): Promise<CatalogProduct[]>;
  validateAccount(config: SupplierConfig, playerId: string, serverId?: string): Promise<ValidationResult>;
  createOrder(config: SupplierConfig, request: FulfillmentRequest): Promise<FulfillmentResult>;
  queryStatus(config: SupplierConfig, supplierReference: string): Promise<TransactionStatusResult>;
  refund(config: SupplierConfig, supplierReference: string): Promise<RefundResult>;
}

function effectiveUrl(config: SupplierConfig): string {
  return config.environment === 'sandbox' && config.sandboxApiUrl
    ? config.sandboxApiUrl
    : config.apiUrl;
}

function buildHeaders(config: SupplierConfig): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const creds = config.credentials;

  switch (config.authType) {
    case 'api_key':
      if (creds.api_key) {
        const headerName = (config.authConfig.header_name as string) || 'X-Api-Key';
        headers[headerName] = creds.api_key;
      }
      break;
    case 'bearer':
      if (creds.access_token) headers['Authorization'] = `Bearer ${creds.access_token}`;
      break;
    case 'basic':
      if (creds.username && creds.password) {
        const encoded = Buffer.from(`${creds.username}:${creds.password}`).toString('base64');
        headers['Authorization'] = `Basic ${encoded}`;
      }
      break;
    case 'oauth2':
      if (creds.access_token) headers['Authorization'] = `Bearer ${creds.access_token}`;
      break;
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

/* ─── Generic REST adapter ─── */
export class GenericAdapter implements SupplierAdapter {
  readonly adapterName = 'generic';

  async testConnection(config: SupplierConfig): Promise<TestConnectionResult> {
    const start = Date.now();
    try {
      const base = effectiveUrl(config);
      const testPath = (config.metadata.test_endpoint as string) || '/ping';
      const res = await timedFetch(`${base}${testPath}`, { method: 'GET', headers: buildHeaders(config) }, config.timeoutMs);
      return { success: res.ok, latencyMs: Date.now() - start, message: res.ok ? 'Connected' : `HTTP ${res.status}` };
    } catch (e) {
      return { success: false, latencyMs: Date.now() - start, message: e instanceof Error ? e.message : 'Connection failed' };
    }
  }

  async getBalance(config: SupplierConfig): Promise<BalanceResult> {
    const base = effectiveUrl(config);
    const path = (config.metadata.balance_endpoint as string) || '/balance';
    const res = await timedFetch(`${base}${path}`, { method: 'GET', headers: buildHeaders(config) }, config.timeoutMs);
    if (!res.ok) throw new Error(`Balance check failed: HTTP ${res.status}`);
    const data = await res.json();
    const field = (config.metadata.balance_field as string) || 'balance';
    const raw = typeof data === 'object' && data !== null ? (data as Record<string, unknown>)[field] : 0;
    return { balanceCents: Math.round(Number(raw) * 100), currency: (config.metadata.currency as string) || 'PHP' };
  }

  async getCatalog(config: SupplierConfig): Promise<CatalogProduct[]> {
    const base = effectiveUrl(config);
    const path = (config.metadata.catalog_endpoint as string) || '/products';
    const res = await timedFetch(`${base}${path}`, { method: 'GET', headers: buildHeaders(config) }, config.timeoutMs);
    if (!res.ok) throw new Error(`Catalog fetch failed: HTTP ${res.status}`);
    const data = await res.json();
    const items = Array.isArray(data) ? data : (Array.isArray((data as Record<string, unknown>).products) ? (data as Record<string, unknown>).products as unknown[] : []);
    return items.map((p: unknown) => {
      const item = p as Record<string, unknown>;
      return {
        supplierProductId: String(item.id || item.product_id || ''),
        name: String(item.name || item.title || ''),
        denomination: item.denomination ? String(item.denomination) : null,
        priceCents: Math.round(Number(item.price || item.amount || 0) * 100),
        currency: String(item.currency || 'PHP'),
        category: item.category ? String(item.category) : null,
      };
    });
  }

  async validateAccount(config: SupplierConfig, playerId: string, serverId?: string): Promise<ValidationResult> {
    const base = effectiveUrl(config);
    const path = (config.metadata.validate_endpoint as string) || '/validate';
    const body: Record<string, string> = { player_id: playerId };
    if (serverId) body.server_id = serverId;
    const res = await timedFetch(`${base}${path}`, { method: 'POST', headers: buildHeaders(config), body: JSON.stringify(body) }, config.timeoutMs);
    if (!res.ok) return { valid: false, accountName: null, error: `HTTP ${res.status}` };
    const data = (await res.json()) as Record<string, unknown>;
    return { valid: Boolean(data.valid ?? data.success), accountName: data.name ? String(data.name) : null, error: null };
  }

  async createOrder(config: SupplierConfig, request: FulfillmentRequest): Promise<FulfillmentResult> {
    const base = effectiveUrl(config);
    const path = (config.metadata.order_endpoint as string) || '/orders';
    const payload = {
      idempotency_key: request.idempotencyKey,
      product_id: request.supplierProductId,
      player_id: request.playerId,
      server_id: request.serverId,
      quantity: request.quantity,
      ...request.metadata,
    };
    const res = await timedFetch(`${base}${path}`, { method: 'POST', headers: buildHeaders(config), body: JSON.stringify(payload) }, config.timeoutMs);
    const data = (await res.json()) as Record<string, unknown>;
    if (!res.ok) return { success: false, supplierReference: null, status: 'failed', error: String(data.error || data.message || `HTTP ${res.status}`), rawResponse: data };
    return {
      success: true,
      supplierReference: String(data.reference || data.order_id || data.transaction_id || ''),
      status: 'processing',
      error: null,
      rawResponse: data,
    };
  }

  async queryStatus(config: SupplierConfig, supplierReference: string): Promise<TransactionStatusResult> {
    const base = effectiveUrl(config);
    const pathTpl = (config.metadata.status_endpoint as string) || '/orders/{ref}';
    const path = pathTpl.replace('{ref}', encodeURIComponent(supplierReference));
    const res = await timedFetch(`${base}${path}`, { method: 'GET', headers: buildHeaders(config) }, config.timeoutMs);
    const data = (await res.json()) as Record<string, unknown>;
    if (!res.ok) return { status: 'failed', supplierReference, error: String(data.error || `HTTP ${res.status}`), rawResponse: data };
    const rawStatus = String(data.status || '').toLowerCase();
    const mapped = rawStatus.includes('complet') || rawStatus.includes('success') ? 'completed'
      : rawStatus.includes('fail') || rawStatus.includes('error') ? 'failed'
      : rawStatus.includes('refund') ? 'refunded'
      : 'processing';
    return { status: mapped as TransactionStatusResult['status'], supplierReference, error: null, rawResponse: data };
  }

  async refund(config: SupplierConfig, supplierReference: string): Promise<RefundResult> {
    const base = effectiveUrl(config);
    const pathTpl = (config.metadata.refund_endpoint as string) || '/orders/{ref}/refund';
    const path = pathTpl.replace('{ref}', encodeURIComponent(supplierReference));
    const res = await timedFetch(`${base}${path}`, { method: 'POST', headers: buildHeaders(config) }, config.timeoutMs);
    const data = (await res.json()) as Record<string, unknown>;
    if (!res.ok) return { success: false, refundReference: null, error: String(data.error || `HTTP ${res.status}`) };
    return { success: true, refundReference: String(data.refund_id || data.reference || supplierReference), error: null };
  }
}

/* ─── Custom adapter (supplier-specific implementation placeholder) ─── */
export class CustomAdapter implements SupplierAdapter {
  readonly adapterName = 'custom';

  private notImplemented(method: string): never {
    throw new Error(`Not implemented for this custom supplier: ${method}. A supplier-specific adapter implementation is required.`);
  }

  async testConnection(_config: SupplierConfig): Promise<TestConnectionResult> {
    this.notImplemented('testConnection');
  }
  async getBalance(_config: SupplierConfig): Promise<BalanceResult> {
    this.notImplemented('getBalance');
  }
  async getCatalog(_config: SupplierConfig): Promise<CatalogProduct[]> {
    this.notImplemented('getCatalog');
  }
  async validateAccount(_config: SupplierConfig, _playerId: string, _serverId?: string): Promise<ValidationResult> {
    this.notImplemented('validateAccount');
  }
  async createOrder(_config: SupplierConfig, _request: FulfillmentRequest): Promise<FulfillmentResult> {
    this.notImplemented('createOrder');
  }
  async queryStatus(_config: SupplierConfig, _supplierReference: string): Promise<TransactionStatusResult> {
    this.notImplemented('queryStatus');
  }
  async refund(_config: SupplierConfig, _supplierReference: string): Promise<RefundResult> {
    this.notImplemented('refund');
  }
}

/* ─── Dedicated custom adapters by supplier code ─── */
import { FazerCardsAdapter } from './fazercards';

const customAdapters: Record<string, SupplierAdapter> = {
  fazercards: new FazerCardsAdapter(),
};

/* ─── Adapter registry ─── */
const adapters: Record<string, SupplierAdapter> = {
  generic: new GenericAdapter(),
  custom: new CustomAdapter(),
};

export const SUPPORTED_ADAPTERS = ['generic', 'custom'] as const;
export type SupportedAdapter = (typeof SUPPORTED_ADAPTERS)[number];

export function registerAdapter(name: string, adapter: SupplierAdapter) {
  adapters[name] = adapter;
}

export function getAdapter(adapter: string, supplierCode?: string): SupplierAdapter {
  if (adapter === 'custom' && supplierCode) {
    const code = supplierCode.toLowerCase();
    const dedicated = customAdapters[code];
    if (dedicated) return dedicated;
  return adapters.custom;
  }
  const found = adapters[adapter];
  if (!found) throw new Error(`Unsupported supplier adapter: ${adapter}`);
  return found;
}
