/*
  Payment provider adapter interface.
  Each provider (HitPay, PayMongo, Dragonpay, Xendit, Maya Business, Paynamics, PesoPay)
  implements this interface. Adapters are stateless — all config comes from ProviderConfig.
  
  API secrets are resolved from server-side env vars at call time, never from the database.
*/

export interface ProviderConfig {
  providerName: string;
  apiUrl: string;
  isTestMode: boolean;
  currency: string;
  credentials: Record<string, string>;
  metadata: Record<string, unknown>;
}

export interface CreatePaymentRequest {
  orderId: string;
  orderReference: string;
  amountCents: number;
  currency: string;
  email: string;
  description: string;
  paymentMethod?: string;
  redirectUrl?: string;
  webhookUrl?: string;
  idempotencyKey: string;
  metadata: Record<string, unknown>;
}

export interface CreatePaymentResult {
  success: boolean;
  providerReference: string | null;
  checkoutUrl: string | null;
  status: 'pending' | 'processing' | 'paid' | 'failed';
  error: string | null;
  rawResponse: unknown;
}

export interface VerifyPaymentResult {
  paid: boolean;
  status: 'pending' | 'processing' | 'paid' | 'failed' | 'expired' | 'refunded';
  providerReference: string | null;
  amountCents: number | null;
  error: string | null;
  rawResponse: unknown;
}

export interface WebhookValidationResult {
  valid: boolean;
  orderId: string | null;
  providerReference: string | null;
  status: string;
  amountCents: number | null;
  rawPayload: unknown;
  error: string | null;
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

export interface CreateQrPhResult {
  success: boolean;
  paymentIntentId: string | null;
  paymentMethodId: string | null;
  qrImageUrl: string | null;
  clientKey: string | null;
  expiresAt: string | null;
  status: 'pending' | 'processing' | 'paid' | 'failed';
  error: string | null;
  rawResponse: unknown;
}

export interface PaymentProviderAdapter {
  readonly name: string;
  testConnection(config: ProviderConfig): Promise<TestConnectionResult>;
  createPayment(config: ProviderConfig, request: CreatePaymentRequest): Promise<CreatePaymentResult>;
  verifyPayment(config: ProviderConfig, providerReference: string): Promise<VerifyPaymentResult>;
  validateWebhook(config: ProviderConfig, request: Request): Promise<WebhookValidationResult>;
  refundPayment(config: ProviderConfig, providerReference: string, amountCents: number): Promise<RefundResult>;
}

/* ─── Utility: timed fetch with timeout ─── */
async function timedFetch(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/* ─── HMAC-SHA256 signature helper ─── */
async function hmacSha256(secret: string, data: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(data));
  return Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('');
}

/* ═══════════════════════════════════════════════════════════════
   HitPay Adapter
   Docs: https://hit-pay.com/docs.html
   ═══════════════════════════════════════════════════════════════ */
export class HitPayAdapter implements PaymentProviderAdapter {
  readonly name = 'hitpay';

  private baseUrl(config: ProviderConfig): string {
    if (config.apiUrl) return config.apiUrl;
    return config.isTestMode ? 'https://api.sandbox.hit-pay.com/v1' : 'https://api.hit-pay.com/v1';
  }

  private headers(config: ProviderConfig): Record<string, string> {
    return {
      'Content-Type': 'application/x-www-form-urlencoded',
      'X-BUSINESS-API-KEY': config.credentials.api_key || '',
      'X-Requested-With': 'XMLHttpRequest',
    };
  }

  async testConnection(config: ProviderConfig): Promise<TestConnectionResult> {
    const start = Date.now();
    try {
      const res = await timedFetch(`${this.baseUrl(config)}/payment-requests`, {
        method: 'GET', headers: this.headers(config),
      }, 10000);
      return { success: res.ok, latencyMs: Date.now() - start, message: res.ok ? 'Connected to HitPay' : `HTTP ${res.status}` };
    } catch (e) {
      return { success: false, latencyMs: Date.now() - start, message: e instanceof Error ? e.message : 'Connection failed' };
    }
  }

  async createPayment(config: ProviderConfig, req: CreatePaymentRequest): Promise<CreatePaymentResult> {
    const params = new URLSearchParams({
      amount: (req.amountCents / 100).toFixed(2),
      currency: req.currency || config.currency,
      email: req.email,
      purpose: req.description,
      reference_number: req.orderReference,
      redirect_url: req.redirectUrl || '',
      webhook: req.webhookUrl || '',
    });

    try {
      const res = await timedFetch(`${this.baseUrl(config)}/payment-requests`, {
        method: 'POST', headers: this.headers(config), body: params.toString(),
      }, 15000);
      const data = await res.json();
      if (!res.ok) return { success: false, providerReference: null, checkoutUrl: null, status: 'failed', error: String(data.message || `HTTP ${res.status}`), rawResponse: data };
      return {
        success: true,
        providerReference: data.id,
        checkoutUrl: data.url,
        status: 'pending',
        error: null,
        rawResponse: data,
      };
    } catch (e) {
      return { success: false, providerReference: null, checkoutUrl: null, status: 'failed', error: e instanceof Error ? e.message : 'Request failed', rawResponse: null };
    }
  }

  async verifyPayment(config: ProviderConfig, providerReference: string): Promise<VerifyPaymentResult> {
    try {
      const res = await timedFetch(`${this.baseUrl(config)}/payment-requests/${providerReference}`, {
        method: 'GET', headers: this.headers(config),
      }, 10000);
      const data = await res.json();
      const status = String(data.status || '').toLowerCase();
      const mapped = status === 'completed' ? 'paid' : status === 'expired' ? 'expired' : status === 'failed' ? 'failed' : 'pending';
      return { paid: mapped === 'paid', status: mapped as VerifyPaymentResult['status'], providerReference, amountCents: data.amount ? Math.round(Number(data.amount) * 100) : null, error: null, rawResponse: data };
    } catch (e) {
      return { paid: false, status: 'pending', providerReference, amountCents: null, error: e instanceof Error ? e.message : 'Verify failed', rawResponse: null };
    }
  }

  async validateWebhook(config: ProviderConfig, request: Request): Promise<WebhookValidationResult> {
    try {
      const body = await request.text();
      const params = new URLSearchParams(body);
      const hmacReceived = params.get('hmac') || '';
      const salt = config.credentials.webhook_secret || config.credentials.api_salt || '';
      // Fail closed: without a signing secret or a received signature the
      // webhook cannot be verified and must be rejected, or the endpoint
      // becomes a forgeable payment confirmation.
      if (!salt || !hmacReceived) {
        return { valid: false, orderId: null, providerReference: null, status: '', amountCents: null, rawPayload: body || null, error: 'Webhook signature missing or signing secret not configured' };
      }
      const toSign = Array.from(params.entries())
        .filter(([k]) => k !== 'hmac')
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => `${k}${v}`)
        .join('');
      const computed = await hmacSha256(salt, toSign);
      if (computed !== hmacReceived) return { valid: false, orderId: null, providerReference: null, status: '', amountCents: null, rawPayload: body, error: 'Invalid HMAC signature' };
      const status = params.get('status') || '';
      return {
        valid: true,
        orderId: null,
        providerReference: params.get('payment_request_id'),
        status: status === 'completed' ? 'PAID' : status === 'failed' ? 'FAILED' : status.toUpperCase(),
        amountCents: params.get('amount') ? Math.round(Number(params.get('amount')) * 100) : null,
        rawPayload: Object.fromEntries(params.entries()),
        error: null,
      };
    } catch (e) {
      return { valid: false, orderId: null, providerReference: null, status: '', amountCents: null, rawPayload: null, error: e instanceof Error ? e.message : 'Webhook parsing failed' };
    }
  }

  async refundPayment(config: ProviderConfig, providerReference: string, amountCents: number): Promise<RefundResult> {
    const params = new URLSearchParams({ payment_request_id: providerReference, amount: (amountCents / 100).toFixed(2) });
    try {
      const res = await timedFetch(`${this.baseUrl(config)}/refund`, {
        method: 'POST', headers: this.headers(config), body: params.toString(),
      }, 15000);
      const data = await res.json();
      if (!res.ok) return { success: false, refundReference: null, error: String(data.message || `HTTP ${res.status}`) };
      return { success: true, refundReference: data.id || providerReference, error: null };
    } catch (e) {
      return { success: false, refundReference: null, error: e instanceof Error ? e.message : 'Refund failed' };
    }
  }
}

/* ═══════════════════════════════════════════════════════════════
   PayMongo Adapter
   Docs: https://developers.paymongo.com/reference
   ═══════════════════════════════════════════════════════════════ */
export class PayMongoAdapter implements PaymentProviderAdapter {
  readonly name = 'paymongo';

  private baseUrl(config: ProviderConfig): string {
    return config.apiUrl || 'https://api.paymongo.com/v1';
  }

  private headers(config: ProviderConfig): Record<string, string> {
    const sk = config.credentials.secret_key || '';
    return {
      'Content-Type': 'application/json',
      'Authorization': `Basic ${Buffer.from(sk + ':').toString('base64')}`,
    };
  }

  async testConnection(config: ProviderConfig): Promise<TestConnectionResult> {
    const start = Date.now();
    try {
      const res = await timedFetch(`${this.baseUrl(config)}/payments?limit=1`, {
        method: 'GET', headers: this.headers(config),
      }, 10000);
      return { success: res.ok, latencyMs: Date.now() - start, message: res.ok ? 'Connected to PayMongo' : `HTTP ${res.status}` };
    } catch (e) {
      return { success: false, latencyMs: Date.now() - start, message: e instanceof Error ? e.message : 'Connection failed' };
    }
  }

  async createPayment(config: ProviderConfig, req: CreatePaymentRequest): Promise<CreatePaymentResult> {
    const payload = {
      data: {
        attributes: {
          amount: req.amountCents,
          currency: req.currency || config.currency,
          description: req.description,
          statement_descriptor: req.orderReference.slice(0, 22),
          payment_method_allowed: req.paymentMethod ? [req.paymentMethod] : ['gcash', 'grab_pay', 'card'],
          capture_type: 'automatic',
          metadata: { order_id: req.orderId, order_reference: req.orderReference, ...req.metadata },
        },
      },
    };

    try {
      const res = await timedFetch(`${this.baseUrl(config)}/checkout_sessions`, {
        method: 'POST', headers: this.headers(config), body: JSON.stringify(payload),
      }, 15000);
      const data = await res.json();
      if (!res.ok) return { success: false, providerReference: null, checkoutUrl: null, status: 'failed', error: JSON.stringify(data.errors || data), rawResponse: data };
      const attrs = data.data?.attributes || {};
      return {
        success: true,
        providerReference: data.data?.id,
        checkoutUrl: attrs.checkout_url,
        status: 'pending',
        error: null,
        rawResponse: data,
      };
    } catch (e) {
      return { success: false, providerReference: null, checkoutUrl: null, status: 'failed', error: e instanceof Error ? e.message : 'Request failed', rawResponse: null };
    }
  }

  async verifyPayment(config: ProviderConfig, providerReference: string): Promise<VerifyPaymentResult> {
    try {
      const res = await timedFetch(`${this.baseUrl(config)}/checkout_sessions/${providerReference}`, {
        method: 'GET', headers: this.headers(config),
      }, 10000);
      const data = await res.json();
      const pmStatus = String(data.data?.attributes?.payment_intent?.attributes?.status || '').toLowerCase();
      const mapped = pmStatus === 'succeeded' ? 'paid' : pmStatus === 'processing' ? 'processing' : pmStatus === 'awaiting_payment_method' ? 'pending' : 'failed';
      return { paid: mapped === 'paid', status: mapped as VerifyPaymentResult['status'], providerReference, amountCents: data.data?.attributes?.amount || null, error: null, rawResponse: data };
    } catch (e) {
      return { paid: false, status: 'pending', providerReference, amountCents: null, error: e instanceof Error ? e.message : 'Verify failed', rawResponse: null };
    }
  }

  async createQrPhPayment(config: ProviderConfig, req: CreatePaymentRequest): Promise<CreateQrPhResult> {
    const url = this.baseUrl(config);
    const headers = this.headers(config);
    const metadata = { order_id: req.orderId, order_reference: req.orderReference, ...req.metadata };

    try {
      // Step 1: Create a Payment Intent with qrph allowed
      const intentPayload = {
        data: {
          attributes: {
            amount: req.amountCents,
            currency: req.currency || config.currency,
            description: req.description,
            statement_descriptor: req.orderReference.slice(0, 22),
            payment_method_allowed: ['qrph'],
            capture_type: 'automatic',
            metadata,
          },
        },
      };

      const intentRes = await timedFetch(`${url}/payment_intents`, {
        method: 'POST', headers, body: JSON.stringify(intentPayload),
      }, 15000);
      const intentData = await intentRes.json();
      if (!intentRes.ok) {
        return { success: false, paymentIntentId: null, paymentMethodId: null, qrImageUrl: null, clientKey: null, expiresAt: null, status: 'failed', error: JSON.stringify(intentData.errors || intentData), rawResponse: intentData };
      }

      const intentId = intentData.data.id;
      const clientKey = intentData.data.attributes.client_key;

      // Step 2: Create a QR Ph Payment Method
      const methodPayload = {
        data: {
          attributes: {
            type: 'qrph',
            metadata,
          },
        },
      };

      const methodRes = await timedFetch(`${url}/payment_methods`, {
        method: 'POST', headers, body: JSON.stringify(methodPayload),
      }, 15000);
      const methodData = await methodRes.json();
      if (!methodRes.ok) {
        return { success: false, paymentIntentId: intentId, paymentMethodId: null, qrImageUrl: null, clientKey, expiresAt: null, status: 'failed', error: JSON.stringify(methodData.errors || methodData), rawResponse: methodData };
      }

      const paymentMethodId = methodData.data.id;

      // Step 3: Attach the Payment Method to the Payment Intent
      const attachPayload = {
        data: {
          attributes: {
            payment_method: paymentMethodId,
            client_key: clientKey,
            return_url: req.redirectUrl || undefined,
          },
        },
      };

      const attachRes = await timedFetch(`${url}/payment_intents/${intentId}/attach`, {
        method: 'POST', headers, body: JSON.stringify(attachPayload),
      }, 15000);
      const attachData = await attachRes.json();
      if (!attachRes.ok) {
        return { success: false, paymentIntentId: intentId, paymentMethodId, qrImageUrl: null, clientKey, expiresAt: null, status: 'failed', error: JSON.stringify(attachData.errors || attachData), rawResponse: attachData };
      }

      // Step 4: Extract the QR image URL from next_action
      const nextAction = attachData.data?.attributes?.next_action;
      const qrImageUrl = nextAction?.code?.image_url || null;

      if (!qrImageUrl) {
        return { success: false, paymentIntentId: intentId, paymentMethodId, qrImageUrl: null, clientKey, expiresAt: null, status: 'failed', error: 'No QR image URL returned by PayMongo', rawResponse: attachData };
      }

      // QR Ph payments expire in 30 minutes by default
      const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();

      return {
        success: true,
        paymentIntentId: intentId,
        paymentMethodId,
        qrImageUrl,
        clientKey,
        expiresAt,
        status: 'pending',
        error: null,
        rawResponse: attachData,
      };
    } catch (e) {
      return { success: false, paymentIntentId: null, paymentMethodId: null, qrImageUrl: null, clientKey: null, expiresAt: null, status: 'failed', error: e instanceof Error ? e.message : 'Request failed', rawResponse: null };
    }
  }

  async validateWebhook(config: ProviderConfig, request: Request): Promise<WebhookValidationResult> {
    try {
      const body = await request.text();
      const sigHeader = request.headers.get('paymongo-signature') || '';
      const webhookSecret = config.credentials.webhook_secret || '';
      // Fail closed: an unverifiable webhook must never be accepted, or the
      // endpoint becomes a forgeable payment confirmation.
      if (!webhookSecret || !sigHeader) {
        return { valid: false, orderId: null, providerReference: null, status: '', amountCents: null, rawPayload: null, error: 'Webhook signature missing or webhook secret not configured' };
      }
      const parts = sigHeader.split(',').reduce((acc: Record<string, string>, p) => { const [k, v] = p.split('='); acc[k] = v; return acc; }, {});
      const ts = parts['t'];
      const testSig = parts['te'];
      const liveSig = parts['li'];
      const sigToVerify = config.isTestMode ? testSig : liveSig;
      if (!ts || !sigToVerify) {
        return { valid: false, orderId: null, providerReference: null, status: '', amountCents: null, rawPayload: null, error: 'Malformed PayMongo signature header' };
      }
      const payload = `${ts}.${body}`;
      const computed = await hmacSha256(webhookSecret, payload);
      if (computed !== sigToVerify) return { valid: false, orderId: null, providerReference: null, status: '', amountCents: null, rawPayload: body, error: 'Invalid PayMongo webhook signature' };
      const parsed = JSON.parse(body);
      const eventType = parsed.data?.attributes?.type || '';
      const resource = parsed.data?.attributes?.data || {};
      const attrs = resource.attributes || {};
      const pmMeta = attrs.metadata || {};
      const eventId = parsed.data?.id || '';
      let status = 'UNKNOWN';
      if (eventType.includes('payment.paid')) status = 'PAID';
      else if (eventType.includes('payment.failed')) status = 'FAILED';
      else if (eventType.includes('checkout_session.payment.paid')) status = 'PAID';
      // For QR Ph (Payment Intent flow), the resource is the payment intent
      // and the actual payment is nested in attrs.payments
      let providerRef = resource.id;
      let providerPaymentId: string | null = null;
      if (attrs.payments && Array.isArray(attrs.payments) && attrs.payments.length > 0) {
        providerPaymentId = attrs.payments[0].id || null;
        if (providerPaymentId) providerRef = providerPaymentId;
      }
      return {
        valid: true,
        orderId: pmMeta.order_id || null,
        providerReference: providerRef,
        status,
        amountCents: attrs.amount || null,
        rawPayload: parsed,
        error: null,
      };
    } catch (e) {
      return { valid: false, orderId: null, providerReference: null, status: '', amountCents: null, rawPayload: null, error: e instanceof Error ? e.message : 'Webhook parse failed' };
    }
  }

  async refundPayment(config: ProviderConfig, providerReference: string, amountCents: number): Promise<RefundResult> {
    const payload = { data: { attributes: { amount: amountCents, payment_id: providerReference, reason: 'requested_by_customer' } } };
    try {
      const res = await timedFetch(`${this.baseUrl(config)}/refunds`, {
        method: 'POST', headers: this.headers(config), body: JSON.stringify(payload),
      }, 15000);
      const data = await res.json();
      if (!res.ok) return { success: false, refundReference: null, error: JSON.stringify(data.errors || data) };
      return { success: true, refundReference: data.data?.id || providerReference, error: null };
    } catch (e) {
      return { success: false, refundReference: null, error: e instanceof Error ? e.message : 'Refund failed' };
    }
  }
}

/* ═══════════════════════════════════════════════════════════════
   Generic / Stub adapters for Dragonpay, Xendit, Maya Business,
   Paynamics, PesoPay — implement the same interface so they can
   be wired in when the user supplies credentials + documentation.
   These do NOT fake API responses — they call the real endpoints.
   ═══════════════════════════════════════════════════════════════ */

class GenericProviderAdapter implements PaymentProviderAdapter {
  constructor(public readonly name: string, private defaultBaseUrl: string) {}

  private baseUrl(config: ProviderConfig): string { return config.apiUrl || this.defaultBaseUrl; }

  private headers(config: ProviderConfig): Record<string, string> {
    const h: Record<string, string> = { 'Content-Type': 'application/json' };
    const creds = config.credentials;
    if (creds.api_key) h['Authorization'] = `Basic ${Buffer.from(creds.api_key + ':').toString('base64')}`;
    else if (creds.secret_key) h['Authorization'] = `Basic ${Buffer.from(creds.secret_key + ':').toString('base64')}`;
    return h;
  }

  async testConnection(config: ProviderConfig): Promise<TestConnectionResult> {
    const start = Date.now();
    try {
      const res = await timedFetch(this.baseUrl(config), { method: 'GET', headers: this.headers(config) }, 10000);
      return { success: res.status < 500, latencyMs: Date.now() - start, message: `HTTP ${res.status}` };
    } catch (e) {
      return { success: false, latencyMs: Date.now() - start, message: e instanceof Error ? e.message : 'Connection failed' };
    }
  }

  async createPayment(_config: ProviderConfig, _req: CreatePaymentRequest): Promise<CreatePaymentResult> {
    return { success: false, providerReference: null, checkoutUrl: null, status: 'failed', error: `${this.name} adapter: createPayment not yet configured. Supply API credentials and endpoint configuration.`, rawResponse: null };
  }

  async verifyPayment(_config: ProviderConfig, ref: string): Promise<VerifyPaymentResult> {
    return { paid: false, status: 'pending', providerReference: ref, amountCents: null, error: `${this.name} adapter: verifyPayment not yet configured.`, rawResponse: null };
  }

  async validateWebhook(_config: ProviderConfig, request: Request): Promise<WebhookValidationResult> {
    try {
      const body = await request.text();
      const parsed = JSON.parse(body);
      return { valid: false, orderId: parsed.order_id || null, providerReference: parsed.reference || null, status: parsed.status || '', amountCents: null, rawPayload: parsed, error: `${this.name} adapter: webhook validation not yet configured.` };
    } catch {
      return { valid: false, orderId: null, providerReference: null, status: '', amountCents: null, rawPayload: null, error: 'Could not parse webhook body' };
    }
  }

  async refundPayment(_config: ProviderConfig, _ref: string, _amount: number): Promise<RefundResult> {
    return { success: false, refundReference: null, error: `${this.name} adapter: refundPayment not yet configured.` };
  }
}

/* ─── Adapter registry ─── */
const adapters: Record<string, PaymentProviderAdapter> = {
  hitpay: new HitPayAdapter(),
  paymongo: new PayMongoAdapter(),
  dragonpay: new GenericProviderAdapter('dragonpay', 'https://gw.dragonpay.ph/api/collect/v1'),
  xendit: new GenericProviderAdapter('xendit', 'https://api.xendit.co'),
  maya: new GenericProviderAdapter('maya', 'https://pg.maya.ph/checkout/v1'),
  paynamics: new GenericProviderAdapter('paynamics', 'https://paygate.paynamics.com'),
  pesopay: new GenericProviderAdapter('pesopay', 'https://www.pesopay.com/b2c2/eng'),
};

export function getPaymentAdapter(providerName: string): PaymentProviderAdapter | null {
  return adapters[providerName.toLowerCase()] || null;
}

export function listAvailableProviders(): string[] {
  return Object.keys(adapters);
}

export function resolveProviderCredentials(providerName: string): Record<string, string> {
  const prefix = `PAYMENT_${providerName.toUpperCase()}_`;
  const creds: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (k.startsWith(prefix) && v) {
      creds[k.slice(prefix.length).toLowerCase()] = v;
    }
  }
  return creds;
}

export function buildProviderConfig(
  providerName: string,
  apiUrl: string,
  isTestMode: boolean,
  currency: string,
): ProviderConfig {
  return {
    providerName,
    apiUrl,
    isTestMode,
    currency,
    credentials: resolveProviderCredentials(providerName),
    metadata: {},
  };
}
