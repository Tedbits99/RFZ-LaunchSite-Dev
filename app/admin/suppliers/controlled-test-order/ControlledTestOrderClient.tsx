'use client';

import { useState, useCallback, useEffect } from 'react';
import { getSupabaseBrowserClient } from '@/lib/supabaseBrowser';
import {
  Loader2, AlertTriangle, Check, ArrowLeft, Shield, Zap,
  Package, RefreshCw, Clock,
} from 'lucide-react';

interface Category {
  category_id: string;
  name: string;
  note?: string | null;
}

interface Offer {
  offer_id: string;
  name: string;
  price_usd: string;
}

interface Field {
  key: string;
  label: string;
  type: string;
}

interface ExistingOrder {
  id: string;
  reference: string;
  player_inputs: Record<string, string>;
  status: string;
  game_id: string;
  package_id: string;
}

interface TestRun {
  id: string;
  supplier_id: string;
  supplier_code: string;
  category_id: string;
  offer_id: string;
  player_inputs: Record<string, string>;
  supplier_reference: string | null;
  local_status: string;
  supplier_status: string | null;
  error: string | null;
  response_payload: Record<string, unknown> | null;
  status_payload: Record<string, unknown> | null;
  last_polled_at: string | null;
  created_at: string;
  updated_at: string;
}

interface OrderResult {
  httpStatus: number;
  latencyMs: number;
  success: boolean;
  data: Record<string, unknown>;
}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const EDGE_URL = `${SUPABASE_URL}/functions/v1/fazercards-test`;
const FAZERCARDS_SUPPLIER_ID = '4b574181-1c62-436e-838d-658adda615e0';

const ML_CATEGORY_IDS = [
  'mobile_legends_philippines',
  'mobile_legends_global',
  'mobile_legends_indonesia',
  'mobile_legends_malaysia',
  'mobile_legends_singapore',
  'mobile_legends_brazil',
  'mobile_legends_exclusive',
  'mobile_legends_special',
  'mobile_legends_united_states',
  'mobile_legends_turkey',
  'mobile_legends_ru',
];

async function edgeAuthHeaders(): Promise<Record<string, string>> {
  const client = getSupabaseBrowserClient();
  const { data: { session } } = client ? await client.auth.getSession() : { data: { session: null } };
  if (!session?.access_token) throw new Error('Admin session required');
  return { Authorization: `Bearer ${session.access_token}`, apikey: ANON_KEY || '' };
}

type Step = 'loading' | 'ready' | 'offers' | 'confirm' | 'submitting' | 'result';

function maskValue(key: string, value: string): string {
  if (!value) return '—';
  if (key === 'player_id' || key === 'server_id') {
    if (value.length <= 4) return value.slice(0, 2) + '**';
    return value.slice(0, 4) + '***' + value.slice(-2);
  }
  return value;
}

function statusBadgeClass(status: string): string {
  switch (status) {
    case 'SUCCESS': return 'bg-emerald-500/20 text-emerald-400';
    case 'FAILED': return 'bg-rose-500/20 text-rose-400';
    case 'PROCESSING': return 'bg-blue-500/20 text-blue-300';
    case 'CREATED': return 'bg-amber-500/20 text-amber-300';
    default: return 'bg-slate-500/20 text-slate-400';
  }
}

async function safeJson<T = Record<string, unknown>>(res: Response): Promise<T | null> {
  const ct = res.headers.get('content-type') || '';
  if (!ct.includes('application/json')) return null;
  try {
    return await res.json() as T;
  } catch {
    return null;
  }
}

export default function ControlledTestOrderClient() {
  const [step, setStep] = useState<Step>('loading');
  const [error, setError] = useState<string | null>(null);

  const [categories, setCategories] = useState<Category[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<Category | null>(null);
  const [offers, setOffers] = useState<Offer[]>([]);
  const [fields, setFields] = useState<Field[]>([]);
  const [loadingOffers, setLoadingOffers] = useState(false);

  const [existingOrders, setExistingOrders] = useState<ExistingOrder[]>([]);
  const [selectedOrder, setSelectedOrder] = useState<ExistingOrder | null>(null);

  const [selectedOffer, setSelectedOffer] = useState<Offer | null>(null);

  const [orderResult, setOrderResult] = useState<OrderResult | null>(null);
  const [statusResult, setStatusResult] = useState<Record<string, unknown> | null>(null);
  const [pollingStatus, setPollingStatus] = useState(false);

  const [testRuns, setTestRuns] = useState<TestRun[]>([]);
  const [loadingRuns, setLoadingRuns] = useState(true);
  const [pollingRunId, setPollingRunId] = useState<string | null>(null);
  const [currentRunId, setCurrentRunId] = useState<string | null>(null);

  const fetchTestRuns = useCallback(async () => {
    try {
      const res = await fetch('/api/suppliers/test-runs?limit=20');
      if (!res.ok) return;
      const json = await safeJson<{ data?: TestRun[] }>(res);
      if (json) setTestRuns(json.data || []);
    } catch {
      // silent
    } finally {
      setLoadingRuns(false);
    }
  }, []);

  const loadInitial = useCallback(async () => {
    setStep('loading');
    setError(null);
    try {
      const [catsRes] = await Promise.all([
        fetch(`${EDGE_URL}/categories?limit=305`, { headers: await edgeAuthHeaders() }),
        fetchTestRuns(),
      ]);

      const catsJson = await catsRes.json();
      if (!catsJson.success) throw new Error('Failed to fetch FazerCards categories');
      const allCats = (catsJson.data as Record<string, unknown>).items as Category[];
      const mlCats = allCats.filter(c =>
        ML_CATEGORY_IDS.includes(c.category_id) ||
        c.name.toLowerCase().includes('mobile legends')
      );
      setCategories(mlCats);

      const dbRes = await fetch('/api/admin/test-order-candidates?limit=10');
      let dbOrders: ExistingOrder[] = [];
      if (dbRes.ok) {
        const dbJson = await dbRes.json();
        dbOrders = (dbJson.data ?? dbJson.orders ?? []).filter(
          (o: ExistingOrder) => o.player_inputs && (o.player_inputs.user_id || o.player_inputs.player_id)
        );
      }
      setExistingOrders(dbOrders);

      setStep('ready');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load data');
      setStep('ready');
    }
  }, [fetchTestRuns]);

  useEffect(() => {
    loadInitial();
  }, [loadInitial]);

  async function handleSelectCategory(cat: Category) {
    setSelectedCategory(cat);
    setSelectedOffer(null);
    setOffers([]);
    setFields([]);
    setLoadingOffers(true);
    setError(null);
    try {
      const res = await fetch(`${EDGE_URL}/offers?category_id=${encodeURIComponent(cat.category_id)}`, {
        headers: await edgeAuthHeaders(),
      });
      const json = await res.json();
      if (!json.success) throw new Error('Failed to fetch offers');
      const data = json.data as Record<string, unknown>;
      setOffers((data.offers as Offer[]) || []);
      setFields((data.fields as Field[]) || []);
      setStep('offers');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoadingOffers(false);
    }
  }

  function handleSelectOrder(order: ExistingOrder) {
    setSelectedOrder(order);
  }

  function handleSelectOffer(offer: Offer) {
    setSelectedOffer(offer);
    setStep('confirm');
  }

  function buildFields(): Record<string, string> {
    if (!selectedOrder || !fields.length) return {};
    const inputs = selectedOrder.player_inputs;
    const mapped: Record<string, string> = {};
    for (const f of fields) {
      if (f.key === 'player_id') {
        mapped[f.key] = inputs.user_id || inputs.player_id || '';
      } else if (f.key === 'server_id') {
        mapped[f.key] = inputs.server_id || inputs.zone_id || '';
      } else {
        mapped[f.key] = inputs[f.key] || inputs.user_id || '';
      }
    }
    return mapped;
  }

  async function handleCreateOrder() {
    if (!selectedCategory || !selectedOffer || !selectedOrder) return;
    setStep('submitting');
    setError(null);
    setOrderResult(null);
    setStatusResult(null);

    const idempotencyKey = `test_${selectedOrder.id}_${Date.now()}`;
    const orderFields = buildFields();

    // Create a test run record first (persisted before supplier call)
    let runId: string | null = null;
    try {
      const createRunRes = await fetch('/api/suppliers/test-runs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          supplier_id: FAZERCARDS_SUPPLIER_ID,
          supplier_code: 'fazercards',
          category_id: selectedCategory.category_id,
          offer_id: selectedOffer.offer_id,
          player_inputs: orderFields,
        }),
      });
      const runJson = await safeJson<{ data?: { id: string } }>(createRunRes);
      if (createRunRes.ok && runJson?.data) {
        runId = runJson.data.id;
        setCurrentRunId(runId);
      }
    } catch {
      // non-fatal — test can proceed without persistence
    }

    try {
      const res = await fetch(`${EDGE_URL}/order`, {
        method: 'POST',
        headers: {
          ...(await edgeAuthHeaders()),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          category_id: selectedCategory.category_id,
          offer_id: selectedOffer.offer_id,
          fields: orderFields,
          idempotency_key: idempotencyKey,
          confirmed: true,
        }),
      });
      const json = await res.json();
      setOrderResult(json);

      if (json.success) {
        const data = json.data as Record<string, unknown>;
        const order = (data.order as Record<string, unknown>) || {};
        const supplierRef = String(order.id ?? data.order_id ?? '');
        const supplierStatus = String(order.status ?? 'processing');

        // Update test run with supplier reference
        if (runId) {
          await fetch('/api/suppliers/test-runs', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              id: runId,
              supplier_reference: supplierRef,
              local_status: 'PROCESSING',
              supplier_status: supplierStatus,
              response_payload: json.data,
            }),
          });
        }

        if (supplierRef) {
          setPollingStatus(true);
          try {
            const statusRes = await fetch(`${EDGE_URL}/order-status?supplier_ref=${encodeURIComponent(supplierRef)}`, {
              headers: await edgeAuthHeaders(),
            });
            const statusJson = await statusRes.json();
            setStatusResult(statusJson.data ?? null);

            // Update test run with status
            if (runId && statusJson.data) {
              const ss = (statusJson.data as Record<string, unknown>).order as Record<string, unknown> | undefined;
              const rawStatus = String(ss?.status ?? 'processing');
              let localStatus = 'PROCESSING';
              if (rawStatus === 'completed') localStatus = 'SUCCESS';
              else if (rawStatus === 'failed') localStatus = 'FAILED';

              await fetch('/api/suppliers/test-runs', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  id: runId,
                  supplier_status: rawStatus,
                  local_status: localStatus,
                  status_payload: statusJson.data,
                  last_polled_at: new Date().toISOString(),
                }),
              });
            }
          } catch {
            // status poll is best-effort
          } finally {
            setPollingStatus(false);
          }
        }
      } else if (runId) {
        await fetch('/api/suppliers/test-runs', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id: runId,
            local_status: 'FAILED',
            error: 'Supplier order creation failed',
            response_payload: json.data,
          }),
        });
      }
      setStep('result');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
      if (runId) {
        await fetch('/api/suppliers/test-runs', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id: runId,
            local_status: 'FAILED',
            error: err instanceof Error ? err.message : 'Unknown error',
          }),
        });
      }
      setStep('result');
    } finally {
      void fetchTestRuns();
    }
  }

  async function handlePollRun(runId: string) {
    setPollingRunId(runId);
    setError(null);
    try {
      const res = await fetch(`/api/suppliers/test-runs/poll?id=${runId}`, { method: 'GET' });
      const json = await safeJson<{ data?: TestRun; error?: string; supplier_status?: string; local_status?: string }>(res);
      if (!res.ok || !json) {
        setError(json?.error || 'Poll failed');
        return;
      }
      if (json.data) {
        const updated = json.data;
        setStatusResult(updated.status_payload);
        if (updated.supplier_status) {
          setOrderResult(prev => {
            if (!prev) return prev;
            const prevData = prev.data as Record<string, unknown>;
            const prevOrder = (prevData.order as Record<string, unknown>) || {};
            return {
              ...prev,
              data: { ...prevData, order: { ...prevOrder, status: updated.supplier_status } },
            };
          });
        }
      }
      void fetchTestRuns();
    } catch {
      setError('Could not reach the server.');
    } finally {
      setPollingRunId(null);
    }
  }

  function fieldMappingDisplay(): { fazercardsKey: string; ourKey: string; value: string }[] {
    if (!selectedOrder || !fields.length) return [];
    const inputs = selectedOrder.player_inputs;
    return fields.map(f => {
      let ourKey = '';
      let value = '';
      if (f.key === 'player_id') {
        ourKey = 'user_id';
        value = inputs.user_id || inputs.player_id || '';
      } else if (f.key === 'server_id') {
        ourKey = 'server_id';
        value = inputs.server_id || inputs.zone_id || '';
      } else {
        ourKey = f.key;
        value = inputs[f.key] || '';
      }
      return { fazercardsKey: f.key, ourKey, value };
    });
  }

  if (step === 'loading') {
    return (
      <div className="flex flex-col items-center justify-center py-32">
        <Loader2 className="h-8 w-8 animate-spin text-slate-500" />
        <p className="mt-3 text-sm text-slate-500">Loading FazerCards ML categories and test history…</p>
      </div>
    );
  }

  if (step === 'result' && orderResult) {
    const data = orderResult.data as Record<string, unknown>;
    const order = (data.order as Record<string, unknown>) || {};
    const supplierRef = String(order.id ?? data.order_id ?? '');
    const supplierStatus = String(order.status ?? 'processing');
    const ok = Boolean(data.ok ?? orderResult.success);

    return (
      <div className="space-y-6">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => { setStep('ready'); setSelectedCategory(null); setSelectedOffer(null); setOrderResult(null); setStatusResult(null); setCurrentRunId(null); }}
            className="inline-flex items-center gap-1.5 rounded-lg border border-[#253451] px-3 py-2 text-sm text-slate-300 transition hover:border-cyan-400 hover:text-cyan-300"
          >
            <ArrowLeft className="h-4 w-4" />
            Start Over
          </button>
          <h1 className="font-display text-xl font-bold text-slate-100">Test Order Result</h1>
        </div>

        <div className={`rounded-xl border p-5 ${ok ? 'border-emerald-500/20 bg-emerald-500/5' : 'border-rose-500/20 bg-rose-500/5'}`}>
          <div className="flex items-center gap-2">
            {ok ? <Check className="h-5 w-5 text-emerald-400" /> : <AlertTriangle className="h-5 w-5 text-rose-400" />}
            <span className={`font-medium ${ok ? 'text-emerald-300' : 'text-rose-300'}`}>
              {ok ? 'Supplier order created successfully' : 'Supplier order failed'}
            </span>
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <div><span className="text-xs text-slate-500">HTTP Status</span><p className="text-sm text-slate-200">{orderResult.httpStatus}</p></div>
            <div><span className="text-xs text-slate-500">Latency</span><p className="text-sm text-slate-200">{orderResult.latencyMs}ms</p></div>
            <div><span className="text-xs text-slate-500">Internal Order ID</span><p className="font-mono text-sm text-slate-200">{selectedOrder?.id ?? '—'}</p></div>
            <div><span className="text-xs text-slate-500">Internal Reference</span><p className="font-mono text-sm text-slate-200">{selectedOrder?.reference ?? '—'}</p></div>
            <div><span className="text-xs text-slate-500">FazerCards Order ID</span><p className="font-mono text-sm text-cyan-300">{supplierRef || '—'}</p></div>
            <div><span className="text-xs text-slate-500">Supplier Status</span><p className="text-sm text-slate-200">{supplierStatus}</p></div>
            {currentRunId && <div><span className="text-xs text-slate-500">Test Run ID</span><p className="font-mono text-sm text-slate-200">{currentRunId.slice(0, 8)}…</p></div>}
          </div>
        </div>

        {pollingStatus ? (
          <div className="flex items-center gap-2 text-sm text-slate-500">
            <Loader2 className="h-4 w-4 animate-spin" />
            Polling supplier status…
          </div>
        ) : statusResult ? (
          <div className="rounded-xl border border-[#1b2a45] bg-[#0b1225] p-5">
            <h3 className="mb-3 text-sm font-semibold text-slate-300">Supplier Status Query Result</h3>
            <pre className="overflow-x-auto rounded-lg bg-[#0a1124] p-3 text-xs text-slate-400">{JSON.stringify(statusResult, null, 2)}</pre>
          </div>
        ) : null}

        {currentRunId && supplierRef && (supplierStatus === 'created' || supplierStatus === 'processing' || supplierStatus === 'pending') && (
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => void handlePollRun(currentRunId)}
              disabled={pollingRunId === currentRunId}
              className="inline-flex items-center gap-2 rounded-lg border border-cyan-500/40 bg-cyan-500/10 px-4 py-2 text-sm font-medium text-cyan-300 transition hover:bg-cyan-500/20 disabled:opacity-40"
            >
              {pollingRunId === currentRunId ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              Poll Supplier Status
            </button>
            {pollingRunId === currentRunId && <span className="text-xs text-slate-500">Querying FazerCards (GET only, no new order)…</span>}
          </div>
        )}

        <div className="rounded-xl border border-[#1b2a45] bg-[#0b1225] p-5">
          <h3 className="mb-3 text-sm font-semibold text-slate-300">Raw Supplier Response</h3>
          <pre className="overflow-x-auto rounded-lg bg-[#0a1124] p-3 text-xs text-slate-400">{JSON.stringify(orderResult.data, null, 2)}</pre>
        </div>

        <div className="rounded-lg border border-cyan-500/20 bg-cyan-500/5 p-4">
          <div className="flex items-start gap-2">
            <Shield className="mt-0.5 h-4 w-4 shrink-0 text-cyan-400" />
            <p className="text-xs leading-relaxed text-cyan-300/80">
              This test run has been persisted separately from customer orders. The API key was never exposed to the browser.
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (step === 'submitting') {
    return (
      <div className="flex flex-col items-center justify-center py-32">
        <Loader2 className="h-8 w-8 animate-spin text-cyan-400" />
        <p className="mt-3 text-sm text-slate-300">Creating real FazerCards supplier order…</p>
        <p className="mt-1 text-xs text-slate-500">This is a real transaction. Please wait.</p>
      </div>
    );
  }

  if (step === 'confirm' && selectedCategory && selectedOffer && selectedOrder) {
    const mapping = fieldMappingDisplay();
    const idempotencyKey = `test_${selectedOrder.id}_${Date.now()}`;

    return (
      <div className="space-y-6">
        <div className="flex items-center gap-3">
          <button type="button" onClick={() => setStep('offers')} className="inline-flex items-center gap-1.5 rounded-lg border border-[#253451] px-3 py-2 text-sm text-slate-300 transition hover:border-cyan-400 hover:text-cyan-300">
            <ArrowLeft className="h-4 w-4" /> Back to Offers
          </button>
          <h1 className="font-display text-xl font-bold text-slate-100">Confirm Test Order</h1>
        </div>

        <div className="rounded-xl border border-rose-500/30 bg-rose-500/5 p-4">
          <div className="flex items-start gap-2">
            <Shield className="mt-0.5 h-5 w-5 shrink-0 text-rose-400" />
            <div>
              <p className="font-medium text-rose-300">REAL SUPPLIER ORDER</p>
              <p className="mt-1 text-xs leading-relaxed text-rose-300/70">
                Clicking &quot;Create Test Order&quot; will send a real order to FazerCards and charge your balance. This action cannot be undone.
              </p>
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-[#1b2a45] bg-[#0b1225] p-5">
          <h3 className="mb-4 text-sm font-semibold text-slate-300">Order Summary</h3>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-3">
              <div><span className="text-xs text-slate-500">Game</span><p className="text-sm text-slate-200">Mobile Legends</p></div>
              <div><span className="text-xs text-slate-500">Internal Order ID</span><p className="font-mono text-sm text-slate-200">{selectedOrder.id}</p></div>
              <div><span className="text-xs text-slate-500">Internal Reference</span><p className="font-mono text-sm text-slate-200">{selectedOrder.reference}</p></div>
            </div>
            <div className="space-y-3">
              <div><span className="text-xs text-slate-500">FazerCards Category</span><p className="font-mono text-sm text-cyan-300">{selectedCategory.category_id}</p><p className="text-xs text-slate-500">{selectedCategory.name}</p></div>
              <div><span className="text-xs text-slate-500">FazerCards Offer</span><p className="font-mono text-sm text-cyan-300">{selectedOffer.offer_id}</p><p className="text-xs text-slate-500">{selectedOffer.name}</p></div>
              <div><span className="text-xs text-slate-500">Supplier Cost (USD)</span><p className="text-sm text-amber-400">${selectedOffer.price_usd}</p></div>
              <div><span className="text-xs text-slate-500">Idempotency Key</span><p className="font-mono text-xs text-slate-400">{idempotencyKey}</p></div>
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-[#1b2a45] bg-[#0b1225] p-5">
          <h3 className="mb-3 text-sm font-semibold text-slate-300">Field Mapping (Our DB → FazerCards)</h3>
          <div className="overflow-hidden rounded-lg border border-[#1b2a45]">
            <table className="w-full text-left text-sm">
              <thead><tr className="border-b border-[#1b2a45] bg-[#0a1124] text-slate-400"><th className="px-4 py-2.5 font-medium">FazerCards Field</th><th className="px-4 py-2.5 font-medium">Our DB Field</th><th className="px-4 py-2.5 font-medium">Value</th></tr></thead>
              <tbody className="divide-y divide-[#1b2a45]">
                {mapping.map(m => (<tr key={m.fazercardsKey} className="bg-[#0a1124]"><td className="px-4 py-2.5 font-mono text-cyan-300">{m.fazercardsKey}</td><td className="px-4 py-2.5 font-mono text-slate-400">{m.ourKey}</td><td className="px-4 py-2.5 text-slate-200">{m.value}</td></tr>))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="flex justify-end gap-3">
          <button type="button" onClick={() => setStep('offers')} className="rounded-lg border border-[#253451] px-5 py-2.5 text-sm font-medium text-slate-300 transition hover:border-cyan-400">Cancel</button>
          <button type="button" onClick={handleCreateOrder} className="inline-flex items-center gap-2 rounded-lg bg-gradient-to-r from-rose-500 to-rose-600 px-6 py-2.5 text-sm font-medium text-white shadow-lg transition hover:brightness-110"><Zap className="h-4 w-4" /> Create Test Order</button>
        </div>
      </div>
    );
  }

  if (step === 'offers' && selectedCategory) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-3">
          <button type="button" onClick={() => { setStep('ready'); setSelectedCategory(null); setSelectedOffer(null); }} className="inline-flex items-center gap-1.5 rounded-lg border border-[#253451] px-3 py-2 text-sm text-slate-300 transition hover:border-cyan-400 hover:text-cyan-300"><ArrowLeft className="h-4 w-4" /> Back to Categories</button>
          <div><h1 className="font-display text-xl font-bold text-slate-100">{selectedCategory.name}</h1><p className="text-xs text-slate-500">category_id: <span className="font-mono">{selectedCategory.category_id}</span></p></div>
        </div>

        {fields.length > 0 && (
          <div className="rounded-xl border border-[#1b2a45] bg-[#0b1225] p-5">
            <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-300"><Package className="h-4 w-4 text-cyan-400" /> Required Fields from FazerCards</h3>
            <div className="grid gap-3 sm:grid-cols-3">
              {fields.map(f => (<div key={f.key} className="rounded-lg border border-[#1b2a45] bg-[#0a1124] px-4 py-3"><div className="text-sm font-medium text-slate-200">{f.label}</div><div className="mt-1 flex items-center gap-3 text-xs text-slate-500"><span className="font-mono">key: {f.key}</span><span className="rounded bg-[#1b2a45] px-1.5 py-0.5">type: {f.type}</span></div></div>))}
            </div>
          </div>
        )}

        {existingOrders.length > 0 && (
          <div className="rounded-xl border border-[#1b2a45] bg-[#0b1225] p-5">
            <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-300"><Shield className="h-4 w-4 text-cyan-400" /> Existing Mobile Legends Orders (with stored player data)</h3>
            <div className="space-y-2">
              {existingOrders.map(order => (
                <button key={order.id} type="button" onClick={() => handleSelectOrder(order)} className={`w-full rounded-lg border p-3 text-left transition ${selectedOrder?.id === order.id ? 'border-cyan-400 bg-cyan-400/5' : 'border-[#1b2a45] bg-[#0a1124] hover:border-cyan-400/40'}`}>
                  <div className="flex items-center justify-between">
                    <div><span className="font-mono text-sm text-slate-200">{order.reference}</span><span className="ml-2 rounded bg-[#1b2a45] px-1.5 py-0.5 text-xs text-slate-400">{order.status}</span></div>
                    <div className="text-xs text-slate-500">user_id: <span className="font-mono text-slate-300">{order.player_inputs.user_id || order.player_inputs.player_id}</span>{' · '}server_id: <span className="font-mono text-slate-300">{order.player_inputs.server_id}</span></div>
                  </div>
                </button>
              ))}
            </div>
            {!selectedOrder && <p className="mt-2 text-xs text-amber-400/70">Select an order above to use its stored player data.</p>}
          </div>
        )}

        {loadingOffers ? (
          <div className="flex flex-col items-center py-12"><Loader2 className="h-6 w-6 animate-spin text-slate-500" /><p className="mt-2 text-sm text-slate-500">Loading offers…</p></div>
        ) : offers.length === 0 ? (
          <p className="text-sm text-slate-500">No offers available.</p>
        ) : (
          <>
            <h3 className="text-sm font-semibold text-slate-300">Available Offers ({offers.length})</h3>
            <div className="overflow-hidden rounded-xl border border-[#1b2a45]">
              <table className="w-full text-left text-sm">
                <thead><tr className="border-b border-[#1b2a45] bg-[#0b1225] text-slate-400"><th className="px-4 py-3 font-medium">offer_id</th><th className="px-4 py-3 font-medium">Name</th><th className="px-4 py-3 font-medium">Supplier Cost (USD)</th><th className="px-4 py-3 font-medium">Action</th></tr></thead>
                <tbody className="divide-y divide-[#1b2a45]">
                  {offers.map(o => (
                    <tr key={o.offer_id} className={`bg-[#0a1124] transition hover:bg-[#0e1530] ${selectedOffer?.offer_id === o.offer_id ? 'ring-1 ring-inset ring-cyan-400/30' : ''}`}>
                      <td className="px-4 py-3 font-mono text-slate-400">{o.offer_id}</td><td className="px-4 py-3 text-slate-200">{o.name}</td><td className="px-4 py-3 text-amber-400">${o.price_usd}</td>
                      <td className="px-4 py-3"><button type="button" disabled={!selectedOrder} onClick={() => handleSelectOffer(o)} className="rounded-lg border border-[#253451] px-3 py-1.5 text-xs font-medium text-slate-300 transition hover:border-cyan-400 hover:text-cyan-300 disabled:cursor-not-allowed disabled:opacity-40">{selectedOrder ? 'Select' : 'Pick order first'}</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    );
  }

  // Default: category selection + test run history
  return (
    <div className="space-y-6">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
        <div>
          <h1 className="font-display text-2xl font-bold text-slate-100">Controlled Test Order</h1>
          <p className="mt-1 text-sm text-slate-400">Create controlled FazerCards test orders. Results are persisted separately from customer orders.</p>
        </div>
        <button type="button" onClick={loadInitial} className="inline-flex items-center gap-1.5 rounded-lg border border-[#253451] px-3 py-2 text-sm text-slate-300 transition hover:border-cyan-400 hover:text-cyan-300"><RefreshCw className="h-3.5 w-3.5" /> Refresh</button>
      </div>

      {error && <div className="rounded-xl border border-rose-500/20 bg-rose-500/5 p-4"><div className="flex items-center gap-2 text-rose-400"><AlertTriangle className="h-4 w-4" /><span className="text-sm">{error}</span></div></div>}

      {/* Test Run History */}
      <div className="rounded-xl border border-[#1b2a45] bg-[#0b1225] p-5">
        <div className="flex items-center justify-between">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-300"><Clock className="h-4 w-4 text-cyan-400" /> Test Run History</h3>
          <button type="button" onClick={() => void fetchTestRuns()} className="text-xs text-slate-500 hover:text-cyan-300">Refresh list</button>
        </div>
        {loadingRuns ? (
          <div className="flex items-center gap-2 py-6 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading test runs…</div>
        ) : testRuns.length === 0 ? (
          <p className="py-6 text-sm text-slate-500">No test runs yet.</p>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead><tr className="border-b border-[#1b2a45] text-slate-500">
                <th className="pb-2 pr-4 font-medium">Run ID</th><th className="pb-2 pr-4 font-medium">Supplier</th><th className="pb-2 pr-4 font-medium">Category</th><th className="pb-2 pr-4 font-medium">Offer</th>
                <th className="pb-2 pr-4 font-medium">Player/Server</th><th className="pb-2 pr-4 font-medium">Supplier Ref</th><th className="pb-2 pr-4 font-medium">Local Status</th><th className="pb-2 pr-4 font-medium">Supplier Status</th><th className="pb-2 pr-4 font-medium">Error</th><th className="pb-2 pr-4 font-medium">Created</th><th className="pb-2 pr-4 font-medium">Last Polled</th><th className="pb-2 font-medium">Action</th>
              </tr></thead>
              <tbody className="divide-y divide-[#1b2a45]">
                {testRuns.map(r => (
                  <tr key={r.id} className="bg-[#0a1124]">
                    <td className="py-2 pr-4 font-mono text-slate-400">{r.id.slice(0, 8)}…</td>
                    <td className="py-2 pr-4 text-slate-300">{r.supplier_code}</td>
                    <td className="py-2 pr-4 font-mono text-slate-400">{r.category_id}</td>
                    <td className="py-2 pr-4 font-mono text-slate-400">{r.offer_id}</td>
                    <td className="py-2 pr-4 text-slate-400">{Object.entries(r.player_inputs || {}).map(([k, v]) => `${k}: ${maskValue(k, String(v))}`).join(', ') || '—'}</td>
                    <td className="py-2 pr-4 font-mono text-cyan-300">{r.supplier_reference || '—'}</td>
                    <td className="py-2 pr-4"><span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${statusBadgeClass(r.local_status)}`}>{r.local_status}</span></td>
                    <td className="py-2 pr-4 text-slate-300">{r.supplier_status || '—'}</td>
                    <td className="py-2 pr-4 text-rose-300 max-w-[120px] truncate">{r.error || '—'}</td>
                    <td className="py-2 pr-4 text-slate-500">{new Date(r.created_at).toLocaleString()}</td>
                    <td className="py-2 pr-4 text-slate-500">{r.last_polled_at ? new Date(r.last_polled_at).toLocaleString() : 'Never'}</td>
                    <td className="py-2">
                      {r.supplier_reference && (r.local_status === 'PROCESSING' || r.local_status === 'CREATED' || r.local_status === 'UNKNOWN') && (
                        <button type="button" onClick={() => void handlePollRun(r.id)} disabled={pollingRunId === r.id} className="inline-flex items-center gap-1 rounded-lg border border-[#22314d] px-2 py-1 text-[10px] font-medium text-cyan-300 transition hover:border-cyan-400 disabled:opacity-40">
                          {pollingRunId === r.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />} Poll Now
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ML Categories */}
      <div>
        <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-300"><Package className="h-4 w-4 text-cyan-400" /> Mobile Legends Categories ({categories.length})</h3>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {categories.map(cat => (
            <button key={cat.category_id} type="button" onClick={() => handleSelectCategory(cat)} className="group rounded-xl border border-[#1b2a45] bg-[#0b1225] p-4 text-left transition hover:border-cyan-400/40 hover:bg-[#0e1530]">
              <h4 className="truncate font-medium text-slate-200 group-hover:text-cyan-300">{cat.name}</h4>
              <p className="mt-1 font-mono text-xs text-slate-500">{cat.category_id}</p>
              {cat.note && <p className="mt-2 line-clamp-2 text-xs leading-relaxed text-slate-500">{cat.note}</p>}
            </button>
          ))}
        </div>
      </div>

      {existingOrders.length > 0 && (
        <div>
          <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-300"><Shield className="h-4 w-4 text-cyan-400" /> Existing ML Orders with Player Data ({existingOrders.length})</h3>
          <div className="space-y-2">
            {existingOrders.map(order => (
              <div key={order.id} className="rounded-lg border border-[#1b2a45] bg-[#0b1225] p-3">
                <div className="flex items-center justify-between">
                  <div><span className="font-mono text-sm text-slate-200">{order.reference}</span><span className="ml-2 rounded bg-[#1b2a45] px-1.5 py-0.5 text-xs text-slate-400">{order.status}</span></div>
                  <div className="text-xs text-slate-500">user_id: <span className="font-mono text-slate-300">{order.player_inputs.user_id || order.player_inputs.player_id}</span>{' · '}server_id: <span className="font-mono text-slate-300">{order.player_inputs.server_id}</span></div>
                </div>
              </div>
            ))}
          </div>
          <p className="mt-2 text-xs text-slate-500">These orders will be available for selection after you pick a category.</p>
        </div>
      )}
    </div>
  );
}
