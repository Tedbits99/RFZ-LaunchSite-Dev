'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  Save, Loader2, CheckCircle2, Plus, Trash2, Wifi, WifiOff,
  CreditCard, Banknote, Settings2, ChevronDown, ChevronUp, X,
} from 'lucide-react';

type PaymentConfig = {
  id: string;
  method_key: string;
  display_name: string;
  provider: string;
  provider_type: string;
  provider_name: string;
  is_enabled: boolean;
  account_name: string;
  account_number: string;
  qr_data: string | null;
  instructions: string;
  webhook_url: string | null;
  is_test_mode: boolean;
  api_url: string;
  currency: string;
  supported_methods: string[];
  sort_order: number;
  min_amount_cents: number | null;
  max_amount_cents: number | null;
  notes: string;
  test_mode: boolean;
  logo_url: string | null;
};

const AVAILABLE_PROVIDERS = ['hitpay', 'paymongo', 'dragonpay', 'xendit', 'maya', 'paynamics', 'pesopay'];

const emptyConfig = (): Partial<PaymentConfig> => ({
  method_key: '',
  display_name: '',
  provider: 'manual',
  provider_type: 'manual',
  provider_name: '',
  is_enabled: true,
  account_name: '',
  account_number: '',
  qr_data: '',
  instructions: '',
  webhook_url: '',
  is_test_mode: false,
  api_url: '',
  currency: 'PHP',
  supported_methods: [],
  sort_order: 0,
  min_amount_cents: null,
  max_amount_cents: null,
  notes: '',
  logo_url: '',
});

export default function PaymentConfigEditor({ initialConfigs }: { initialConfigs: PaymentConfig[] }) {
  const [configs, setConfigs] = useState(initialConfigs);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [savedId, setSavedId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [newConfig, setNewConfig] = useState(emptyConfig());
  const [creating, setCreating] = useState(false);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<{ id: string; success: boolean; message: string } | null>(null);

  const reload = useCallback(async () => {
    try {
      const res = await fetch('/api/payment-config');
      const json = await res.json();
      if (json.data) setConfigs(json.data);
    } catch { /* silent */ }
  }, []);

  const update = (id: string, field: keyof PaymentConfig, value: unknown) => {
    setConfigs((prev) => prev.map((c) => c.id === id ? { ...c, [field]: value } : c));
  };

  const save = async (config: PaymentConfig) => {
    setSavingId(config.id);
    setError('');
    setSavedId(null);
    try {
      const res = await fetch('/api/payment-config', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: config.id,
          method_key: config.method_key,
          display_name: config.display_name,
          provider: config.provider || 'manual',
          provider_type: config.provider_type || 'manual',
          provider_name: config.provider_name || 'manual',
          is_enabled: config.is_enabled,
          account_name: config.account_name,
          account_number: config.account_number,
          qr_data: config.qr_data || '',
          instructions: config.instructions,
          api_url: config.api_url || '',
          is_test_mode: config.is_test_mode || config.test_mode || false,
          currency: config.currency || 'PHP',
          supported_methods: config.supported_methods || [],
          sort_order: config.sort_order,
          min_amount_cents: config.min_amount_cents ?? null,
          max_amount_cents: config.max_amount_cents ?? null,
          notes: config.notes || '',
          webhook_url: config.webhook_url,
          logo_url: config.logo_url || null,
        }),
      });
      if (!res.ok) {
        const data = await res.json();
        setError(data.error || 'Failed to save.');
        return;
      }
      setSavedId(config.id);
      setTimeout(() => setSavedId(null), 2000);
      await reload();
    } catch {
      setError('Could not reach the server.');
    } finally {
      setSavingId(null);
    }
  };

  const testConnection = async (config: PaymentConfig) => {
    setTestingId(config.id);
    setTestResult(null);
    try {
      const res = await fetch('/api/payment-config', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'test_connection', provider_name: config.provider_name, api_url: config.api_url, is_test_mode: config.is_test_mode, currency: config.currency }),
      });
      const data = await res.json();
      setTestResult({ id: config.id, success: data.success, message: data.message || (data.success ? 'Connected' : 'Failed') });
      setTimeout(() => setTestResult(null), 5000);
    } catch {
      setTestResult({ id: config.id, success: false, message: 'Network error' });
    } finally {
      setTestingId(null);
    }
  };

  const deleteConfig = async (id: string) => {
    if (!confirm('Delete this payment method?')) return;
    try {
      await fetch(`/api/payment-config?id=${id}`, { method: 'DELETE' });
      setConfigs((prev) => prev.filter((c) => c.id !== id));
    } catch {
      setError('Failed to delete.');
    }
  };

  const createConfig = async () => {
    setCreating(true);
    setError('');
    try {
      const res = await fetch('/api/payment-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newConfig),
      });
      const json = await res.json();
      if (!res.ok) { setError(json.error || 'Failed to create.'); return; }
      await reload();
      setShowAdd(false);
      setNewConfig(emptyConfig());
    } catch {
      setError('Network error.');
    } finally {
      setCreating(false);
    }
  };

  const inputCls = 'w-full rounded-lg border border-[#22314d] bg-[#0a1124] px-3 py-2 text-sm text-slate-300 outline-none focus:border-cyan-400';
  const labelCls = 'mb-1 block text-xs text-slate-400';

  return (
    <div className="space-y-4">
      {error && <div className="rounded-lg border border-rose-400/30 bg-rose-400/10 p-3 text-sm text-rose-300">{error}</div>}

      {configs.map((config) => {
        const isAutomated = config.provider_type === 'automated';
        const expanded = expandedId === config.id;
        return (
          <div key={config.id} className="rounded-xl border border-[#1b2a45] bg-[#0b1225] p-5">
            {/* Header */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <span className="grid h-8 w-8 place-items-center rounded-lg bg-cyan-400/10">
                  {isAutomated ? <CreditCard size={14} className="text-cyan-300" /> : <Banknote size={14} className="text-cyan-300" />}
                </span>
                <div>
                  <p className="text-sm font-semibold">{config.display_name}</p>
                  <div className="flex items-center gap-2 text-[10px] text-slate-500">
                    <span>{config.method_key}</span>
                    <span className={`rounded-full px-1.5 py-0.5 ${isAutomated ? 'bg-blue-500/20 text-blue-300' : 'bg-slate-500/20 text-slate-400'}`}>
                      {config.provider_type}
                    </span>
                    {isAutomated && config.provider_name && (
                      <span className="text-cyan-400">{config.provider_name}</span>
                    )}
                    {config.is_test_mode && <span className="rounded-full bg-amber-500/20 px-1.5 py-0.5 text-amber-300">TEST</span>}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <button
                  onClick={() => {
                    const updated = { ...config, is_enabled: !config.is_enabled };
                    setConfigs((prev) => prev.map((c) => c.id === config.id ? updated : c));
                    save(updated);
                  }}
                  className={`relative inline-flex h-5 w-9 items-center rounded-full transition ${config.is_enabled ? 'bg-emerald-500/80' : 'bg-slate-600/60'}`}
                >
                  <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition ${config.is_enabled ? 'translate-x-5' : 'translate-x-1'}`} />
                </button>
                <button onClick={() => setExpandedId(expanded ? null : config.id)} className="text-slate-500 hover:text-white">
                  {expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                </button>
              </div>
            </div>

            {/* Expanded config */}
            {expanded && (
              <div className="mt-4 space-y-4 border-t border-[#1b2a45] pt-4">
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="block"><span className={labelCls}>Method Key (read-only)</span><input value={config.method_key} readOnly className={`${inputCls} opacity-60 cursor-not-allowed`} /></label>
                  <label className="block"><span className={labelCls}>Display Name</span><input value={config.display_name} onChange={(e) => update(config.id, 'display_name', e.target.value)} className={inputCls} /></label>
                  <label className="block">
                    <span className={labelCls}>Type</span>
                    <select value={config.provider_type} onChange={(e) => update(config.id, 'provider_type', e.target.value)} className={inputCls}>
                      <option value="manual">Manual</option>
                      <option value="automated">Automated</option>
                    </select>
                  </label>
                </div>

                <label className="block">
                  <span className={labelCls}>Logo Image URL (optional)</span>
                  <input value={config.logo_url || ''} onChange={(e) => update(config.id, 'logo_url', e.target.value)} placeholder="https://example.com/logo.png" className={inputCls} />
                  {config.logo_url ? (
                    <span className="mt-2 inline-flex items-center gap-2 rounded-lg border border-[#253451] bg-[#0a1124] p-2">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={config.logo_url}
                        alt="Logo preview"
                        className="h-9 w-9 rounded-lg object-contain"
                        onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
                      />
                      <span className="text-[10px] text-slate-500">Preview</span>
                    </span>
                  ) : <span className="mt-1 block text-[10px] text-slate-600">No logo set — the default gradient icon will be used.</span>}
                </label>

                {config.provider_type === 'automated' && (
                  <div className="rounded-lg border border-blue-400/20 bg-blue-400/5 p-4 space-y-3">
                    <h3 className="flex items-center gap-2 text-xs font-semibold text-blue-300"><Settings2 size={13} /> Provider Configuration</h3>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <label className="block">
                        <span className={labelCls}>Provider</span>
                        <select value={config.provider_name} onChange={(e) => update(config.id, 'provider_name', e.target.value)} className={inputCls}>
                          <option value="">Select provider...</option>
                          {AVAILABLE_PROVIDERS.map((p) => <option key={p} value={p}>{p.charAt(0).toUpperCase() + p.slice(1)}</option>)}
                        </select>
                      </label>
                      <label className="block"><span className={labelCls}>API URL (optional override)</span><input value={config.api_url || ''} onChange={(e) => update(config.id, 'api_url', e.target.value)} placeholder="Leave empty for default" className={inputCls} /></label>
                      <label className="block"><span className={labelCls}>Currency</span><input value={config.currency || 'PHP'} onChange={(e) => update(config.id, 'currency', e.target.value)} className={inputCls} /></label>
                      <label className="block"><span className={labelCls}>Webhook URL (auto-generated)</span><input value={config.webhook_url || ''} onChange={(e) => update(config.id, 'webhook_url', e.target.value)} placeholder="/api/webhooks/payment?provider=..." className={inputCls} /></label>
                      <label className="flex items-center gap-2 self-end pb-2">
                        <button
                          onClick={() => update(config.id, 'is_test_mode', !config.is_test_mode)}
                          className={`relative inline-flex h-5 w-9 items-center rounded-full transition ${config.is_test_mode ? 'bg-amber-500/80' : 'bg-slate-600/60'}`}
                        >
                          <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition ${config.is_test_mode ? 'translate-x-5' : 'translate-x-1'}`} />
                        </button>
                        <span className="text-xs text-slate-400">Test/Sandbox mode</span>
                      </label>
                    </div>
                    <div className="rounded-lg border border-[#253451] bg-[#0a1124] p-3 text-[11px] text-slate-500">
                      API keys and secrets are stored as server environment variables (e.g. PAYMENT_HITPAY_API_KEY, PAYMENT_PAYMONGO_SECRET_KEY). They are never stored in the database.
                    </div>
                    {config.provider_name && (
                      <button
                        onClick={() => testConnection(config)}
                        disabled={testingId === config.id}
                        className="inline-flex items-center gap-2 rounded-lg border border-[#253451] px-3 py-2 text-xs text-slate-300 hover:border-cyan-400 disabled:opacity-40"
                      >
                        {testingId === config.id ? <Loader2 size={12} className="animate-spin" /> : <Wifi size={12} />}
                        Test Connection
                      </button>
                    )}
                    {testResult?.id === config.id && (
                      <div className={`rounded-lg border px-3 py-2 text-xs ${testResult.success ? 'border-emerald-400/30 bg-emerald-400/10 text-emerald-300' : 'border-rose-400/30 bg-rose-400/10 text-rose-300'}`}>
                        {testResult.success ? <Wifi size={12} className="inline mr-1" /> : <WifiOff size={12} className="inline mr-1" />}
                        {testResult.message}
                      </div>
                    )}
                  </div>
                )}

                {config.provider_type === 'manual' && (
                  <div className="grid gap-3 sm:grid-cols-2">
                    <label className="block"><span className={labelCls}>Account Name</span><input value={config.account_name} onChange={(e) => update(config.id, 'account_name', e.target.value)} className={inputCls} /></label>
                    <label className="block"><span className={labelCls}>Account Number / Wallet</span><input value={config.account_number} onChange={(e) => update(config.id, 'account_number', e.target.value)} className={inputCls} /></label>
                    <label className="block"><span className={labelCls}>QR Image URL (optional)</span><input value={config.qr_data || ''} onChange={(e) => update(config.id, 'qr_data', e.target.value)} placeholder="Paste QR image URL or data URI" className={inputCls} /></label>
                    <label className="block"><span className={labelCls}>Display Order</span><input type="number" value={config.sort_order} onChange={(e) => update(config.id, 'sort_order', Number(e.target.value))} className={inputCls} /></label>
                    <label className="block"><span className={labelCls}>Min Amount (₱, optional)</span><input type="number" value={config.min_amount_cents ?? ''} onChange={(e) => update(config.id, 'min_amount_cents', e.target.value ? Number(e.target.value) * 100 : null)} placeholder="e.g. 50" className={inputCls} /></label>
                    <label className="block"><span className={labelCls}>Max Amount (₱, optional)</span><input type="number" value={config.max_amount_cents ? config.max_amount_cents / 100 : ''} onChange={(e) => update(config.id, 'max_amount_cents', e.target.value ? Number(e.target.value) * 100 : null)} placeholder="e.g. 5000" className={inputCls} /></label>
                  </div>
                )}

                <label className="block"><span className={labelCls}>Instructions</span><textarea value={config.instructions} onChange={(e) => update(config.id, 'instructions', e.target.value)} rows={2} className={inputCls} /></label>

                {config.provider_type === 'manual' && (
                  <label className="block"><span className={labelCls}>Notes (internal, not shown to customers)</span><textarea value={config.notes || ''} onChange={(e) => update(config.id, 'notes', e.target.value)} rows={2} className={inputCls} /></label>
                )}

                <div className="flex items-center justify-between">
                  <button onClick={() => deleteConfig(config.id)} className="flex items-center gap-1 text-xs text-rose-400 hover:text-rose-300">
                    <Trash2 size={12} /> Delete
                  </button>
                  <button
                    onClick={() => save(config)}
                    disabled={savingId === config.id}
                    className="inline-flex items-center gap-2 rounded-lg bg-gradient-to-r from-blue-500 to-violet-600 px-4 py-2 text-xs font-semibold disabled:opacity-40"
                  >
                    {savingId === config.id ? <Loader2 size={14} className="animate-spin" /> : savedId === config.id ? <CheckCircle2 size={14} /> : <Save size={14} />}
                    {savingId === config.id ? 'Saving...' : savedId === config.id ? 'Saved!' : 'Save Configuration'}
                  </button>
                </div>
              </div>
            )}
          </div>
        );
      })}

      {/* Add new */}
      {!showAdd ? (
        <button onClick={() => setShowAdd(true)} className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-[#253451] py-4 text-xs text-slate-500 hover:border-cyan-400 hover:text-cyan-300">
          <Plus size={14} /> Add Payment Method
        </button>
      ) : (
        <div className="rounded-xl border border-cyan-400/30 bg-[#0b1225] p-5 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold">New Payment Method</h3>
            <button onClick={() => setShowAdd(false)} className="text-slate-500 hover:text-white"><X size={14} /></button>
          </div>
          <label className="block">
            <span className={labelCls}>Logo Image URL (optional)</span>
            <input value={newConfig.logo_url || ''} onChange={(e) => setNewConfig((p) => ({ ...p, logo_url: e.target.value }))} placeholder="https://example.com/logo.png" className={inputCls} />
            {newConfig.logo_url ? (
              <span className="mt-2 inline-flex items-center gap-2 rounded-lg border border-[#253451] bg-[#0a1124] p-2">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={newConfig.logo_url}
                  alt="Logo preview"
                  className="h-9 w-9 rounded-lg object-contain"
                  onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
                />
                <span className="text-[10px] text-slate-500">Preview</span>
              </span>
            ) : <span className="mt-1 block text-[10px] text-slate-600">No logo set — the default gradient icon will be used.</span>}
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block"><span className={labelCls}>Method Key (unique)</span><input value={newConfig.method_key || ''} onChange={(e) => setNewConfig((p) => ({ ...p, method_key: e.target.value }))} placeholder="e.g. gcash, bank_transfer" className={inputCls} /></label>
            <label className="block"><span className={labelCls}>Display Name</span><input value={newConfig.display_name || ''} onChange={(e) => setNewConfig((p) => ({ ...p, display_name: e.target.value }))} placeholder="e.g. GCash" className={inputCls} /></label>
            <label className="block">
              <span className={labelCls}>Type</span>
              <select value={newConfig.provider_type || 'manual'} onChange={(e) => setNewConfig((p) => ({ ...p, provider_type: e.target.value }))} className={inputCls}>
                <option value="manual">Manual</option>
                <option value="automated">Automated</option>
              </select>
            </label>
            {newConfig.provider_type === 'automated' && (
              <label className="block">
                <span className={labelCls}>Provider</span>
                <select value={newConfig.provider_name || ''} onChange={(e) => setNewConfig((p) => ({ ...p, provider_name: e.target.value }))} className={inputCls}>
                  <option value="">Select...</option>
                  {AVAILABLE_PROVIDERS.map((p) => <option key={p} value={p}>{p.charAt(0).toUpperCase() + p.slice(1)}</option>)}
                </select>
              </label>
            )}
            <label className="block"><span className={labelCls}>Account Name</span><input value={newConfig.account_name || ''} onChange={(e) => setNewConfig((p) => ({ ...p, account_name: e.target.value }))} placeholder="e.g. Juan Dela Cruz" className={inputCls} /></label>
            <label className="block"><span className={labelCls}>Account Number / Wallet</span><input value={newConfig.account_number || ''} onChange={(e) => setNewConfig((p) => ({ ...p, account_number: e.target.value }))} placeholder="e.g. 0917 123 4567" className={inputCls} /></label>
            <label className="block"><span className={labelCls}>QR Image URL (optional)</span><input value={newConfig.qr_data || ''} onChange={(e) => setNewConfig((p) => ({ ...p, qr_data: e.target.value }))} placeholder="Paste QR image URL or data URI" className={inputCls} /></label>
            <label className="block"><span className={labelCls}>Display Order</span><input type="number" value={newConfig.sort_order ?? 0} onChange={(e) => setNewConfig((p) => ({ ...p, sort_order: Number(e.target.value) }))} placeholder="0" className={inputCls} /></label>
            <label className="block"><span className={labelCls}>Min Amount (₱, optional)</span><input type="number" value={newConfig.min_amount_cents != null ? newConfig.min_amount_cents / 100 : ''} onChange={(e) => setNewConfig((p) => ({ ...p, min_amount_cents: e.target.value ? Number(e.target.value) * 100 : null }))} placeholder="e.g. 50" className={inputCls} /></label>
            <label className="block"><span className={labelCls}>Max Amount (₱, optional)</span><input type="number" value={newConfig.max_amount_cents != null ? newConfig.max_amount_cents / 100 : ''} onChange={(e) => setNewConfig((p) => ({ ...p, max_amount_cents: e.target.value ? Number(e.target.value) * 100 : null }))} placeholder="e.g. 5000" className={inputCls} /></label>
          </div>
          <label className="block"><span className={labelCls}>Instructions</span><textarea value={newConfig.instructions || ''} onChange={(e) => setNewConfig((p) => ({ ...p, instructions: e.target.value }))} rows={2} className={inputCls} /></label>
          {newConfig.provider_type === 'manual' && (
            <label className="block"><span className={labelCls}>Notes (internal, not shown to customers)</span><textarea value={newConfig.notes || ''} onChange={(e) => setNewConfig((p) => ({ ...p, notes: e.target.value }))} rows={2} className={inputCls} /></label>
          )}
          <div className="flex justify-end">
            <button onClick={createConfig} disabled={creating || !newConfig.method_key || !newConfig.display_name} className="inline-flex items-center gap-2 rounded-lg bg-gradient-to-r from-blue-500 to-violet-600 px-4 py-2 text-xs font-semibold disabled:opacity-40">
              {creating ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
              Create
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
