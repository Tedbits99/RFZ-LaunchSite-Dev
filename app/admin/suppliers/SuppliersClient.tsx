'use client';

import { useState, useEffect, useCallback } from 'react';
import { Plus, Trash2, Loader2, Wifi, WifiOff, RefreshCw, DollarSign, Package, ChevronDown, ChevronUp, AlertTriangle, Check, X, Settings2, Zap, Shield, Clock, RotateCcw } from 'lucide-react';

// ─── Types ───────────────────────────────────────────────────────────────────

type AuthType = 'api_key' | 'bearer' | 'basic' | 'oauth2' | 'custom';
type Environment = 'sandbox' | 'live';

interface Supplier {
  id: string;
  name: string;
  code: string;
  adapter: string;
  api_url: string;
  sandbox_api_url: string | null;
  environment: Environment;
  enabled: boolean;
  priority: number;
  retry_count: number;
  timeout_ms: number;
  low_balance_threshold_cents: number;
  supports_balance: boolean;
  supports_validation: boolean;
  supports_refund: boolean;
  auth_type: AuthType;
  auth_config: Record<string, unknown>;
  last_success_at: string | null;
  last_failure_at: string | null;
  last_error: string | null;
  cached_balance_cents: number | null;
  balance_checked_at: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}

interface SupplierFormData {
  name: string;
  code: string;
  adapter: string;
  api_url: string;
  sandbox_api_url: string;
  environment: Environment;
  auth_type: AuthType;
  priority: number;
  retry_count: number;
  timeout_ms: number;
  low_balance_threshold_cents: number;
  enabled: boolean;
  supports_balance: boolean;
  supports_validation: boolean;
  supports_refund: boolean;
}

interface Transaction {
  id: string;
  order_id: string | null;
  supplier_id: string;
  action: string;
  status: string;
  supplier_reference: string | null;
  error_message: string | null;
  attempt: number;
  duration_ms: number | null;
  created_at: string;
  last_polled_at: string | null;
  suppliers: { name: string };
}

interface TestRun {
  id: string;
  supplier_code: string;
  category_id: string;
  offer_id: string;
  supplier_reference: string | null;
  local_status: string;
  supplier_status: string | null;
  error: string | null;
  last_polled_at: string | null;
  created_at: string;
  updated_at: string;
}

interface Mapping {
  id: string;
  supplier_id: string;
  [key: string]: unknown;
}

interface ActionResult {
  supplierId: string;
  action: string;
  success: boolean;
  message: string;
  timestamp: number;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatRelativeTime(dateStr: string | null): string {
  if (!dateStr) return '—';
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diffMs = now - then;
  if (diffMs < 0) return 'just now';
  const seconds = Math.floor(diffMs / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  return `${months}mo ago`;
}

function formatCurrency(cents: number | null): string {
  if (cents === null || cents === undefined) return '—';
  return (cents / 100).toLocaleString('en-PH', {
    minimumFractionDigits: 2,
    style: 'currency',
    currency: 'PHP',
  });
}

function generateCode(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '');
}

const defaultFormData: SupplierFormData = {
  name: '',
  code: '',
  adapter: 'custom',
  api_url: '',
  sandbox_api_url: '',
  environment: 'sandbox',
  auth_type: 'api_key',
  priority: 0,
  retry_count: 3,
  timeout_ms: 15000,
  low_balance_threshold_cents: 0,
  enabled: false,
  supports_balance: false,
  supports_validation: false,
  supports_refund: false,
};

// ─── Sub-components ──────────────────────────────────────────────────────────

function Toggle({
  on,
  onToggle,
  disabled,
}: {
  on: boolean;
  onToggle: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={disabled}
      className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition ${
        on ? 'bg-emerald-500' : 'bg-slate-600'
      } ${disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'}`}
    >
      <span
        className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition ${
          on ? 'translate-x-4' : 'translate-x-1'
        }`}
      />
    </button>
  );
}

function Badge({
  label,
  color,
}: {
  label: string;
  color: 'emerald' | 'amber' | 'rose' | 'slate' | 'cyan';
}) {
  const colors: Record<string, string> = {
    emerald: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
    amber: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
    rose: 'bg-rose-500/10 text-rose-400 border-rose-500/20',
    slate: 'bg-slate-500/10 text-slate-400 border-slate-500/20',
    cyan: 'bg-cyan-500/10 text-cyan-400 border-cyan-500/20',
  };
  return (
    <span
      className={`inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium ${colors[color]}`}
    >
      {label}
    </span>
  );
}

function ActionButton({
  label,
  icon: Icon,
  onClick,
  loading,
  disabled,
  variant = 'default',
}: {
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  onClick: () => void;
  loading?: boolean;
  disabled?: boolean;
  variant?: 'default' | 'danger';
}) {
  const base =
    variant === 'danger'
      ? 'border-rose-500/30 text-rose-400 hover:border-rose-400 hover:bg-rose-500/5'
      : 'border-[#253451] text-slate-300 hover:border-cyan-400 hover:text-cyan-300';
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || loading}
      className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition disabled:cursor-not-allowed disabled:opacity-50 ${base}`}
    >
      {loading ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
      ) : (
        <Icon className="h-3.5 w-3.5" />
      )}
      {label}
    </button>
  );
}

function InputField({
  label,
  value,
  onChange,
  type = 'text',
  placeholder,
  required,
  disabled,
}: {
  label: string;
  value: string | number;
  onChange: (val: string) => void;
  type?: string;
  placeholder?: string;
  required?: boolean;
  disabled?: boolean;
}) {
  return (
    <div>
      <label className="mb-1.5 block text-xs font-medium text-slate-300">
        {label}
        {required && <span className="text-rose-400">*</span>}
      </label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        required={required}
        disabled={disabled}
        className="w-full rounded-lg border border-[#253451] bg-[#0a1124] px-3 py-2.5 text-sm text-slate-200 outline-none focus:border-cyan-400 disabled:cursor-not-allowed disabled:opacity-50"
      />
    </div>
  );
}

function SelectField({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (val: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <div>
      <label className="mb-1.5 block text-xs font-medium text-slate-300">
        {label}
      </label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full appearance-none rounded-lg border border-[#253451] bg-[#0a1124] px-3 py-2.5 text-sm text-slate-200 outline-none focus:border-cyan-400"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}

// ─── Expanded Details ────────────────────────────────────────────────────────

function ExpandedSection({ supplier }: { supplier: Supplier }) {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [mappings, setMappings] = useState<Mapping[]>([]);
  const [testRuns, setTestRuns] = useState<TestRun[]>([]);
  const [loadingTx, setLoadingTx] = useState(true);
  const [loadingMap, setLoadingMap] = useState(true);
  const [loadingRuns, setLoadingRuns] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function loadData() {
      try {
        const [txRes, mapRes, runsRes] = await Promise.all([
          fetch(`/api/suppliers/transactions?supplier_id=${supplier.id}&limit=10`),
          fetch(`/api/suppliers/mappings?supplier_id=${supplier.id}`),
          fetch(`/api/suppliers/test-runs?supplier_id=${supplier.id}&limit=10`),
        ]);
        if (cancelled) return;
        const txJson = await txRes.json();
        const mapJson = await mapRes.json();
        const runsJson = await runsRes.json();
        if (!cancelled) {
          setTransactions(txJson.data ?? []);
          setMappings(mapJson.data ?? []);
          setTestRuns(runsJson.data ?? []);
        }
      } catch {
        // silently fail
      } finally {
        if (!cancelled) {
          setLoadingTx(false);
          setLoadingMap(false);
          setLoadingRuns(false);
        }
      }
    }

    loadData();
    return () => {
      cancelled = true;
    };
  }, [supplier.id]);

  return (
    <div className="mt-4 space-y-4 border-t border-[#1b2a45] pt-4">
      {/* Config Details */}
      <div>
        <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-400">
          Configuration
        </h4>
        <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-3">
          <div>
            <span className="text-slate-500">API URL:</span>{' '}
            <span className="break-all text-slate-300">
              {supplier.api_url || '—'}
            </span>
          </div>
          <div>
            <span className="text-slate-500">Sandbox URL:</span>{' '}
            <span className="break-all text-slate-300">
              {supplier.sandbox_api_url || '—'}
            </span>
          </div>
          <div>
            <span className="text-slate-500">Auth Type:</span>{' '}
            <span className="text-slate-300">{supplier.auth_type}</span>
          </div>
          <div>
            <span className="text-slate-500">Adapter:</span>{' '}
            <span className="text-slate-300">{supplier.adapter}</span>
          </div>
          <div>
            <span className="text-slate-500">Priority:</span>{' '}
            <span className="text-slate-300">{supplier.priority}</span>
          </div>
          <div>
            <span className="text-slate-500">Retries:</span>{' '}
            <span className="text-slate-300">{supplier.retry_count}</span>
          </div>
          <div>
            <span className="text-slate-500">Timeout:</span>{' '}
            <span className="text-slate-300">{supplier.timeout_ms}ms</span>
          </div>
          <div>
            <span className="text-slate-500">Low Balance Alert:</span>{' '}
            <span className="text-slate-300">
              {formatCurrency(supplier.low_balance_threshold_cents)}
            </span>
          </div>
          <div>
            <span className="text-slate-500">Capabilities:</span>{' '}
            <span className="text-slate-300">
              {[
                supplier.supports_balance && 'Balance',
                supplier.supports_validation && 'Validation',
                supplier.supports_refund && 'Refund',
              ]
                .filter(Boolean)
                .join(', ') || 'None'}
            </span>
          </div>
          {supplier.auth_config &&
            Object.keys(supplier.auth_config).length > 0 && (
              <div className="col-span-full">
                <span className="text-slate-500">Auth Config:</span>{' '}
                <span className="break-all text-slate-300">
                  {JSON.stringify(supplier.auth_config)}
                </span>
              </div>
            )}
          {supplier.metadata &&
            Object.keys(supplier.metadata).length > 0 && (
              <div className="col-span-full">
                <span className="text-slate-500">Metadata:</span>{' '}
                <span className="break-all text-slate-300">
                  {JSON.stringify(supplier.metadata)}
                </span>
              </div>
            )}
        </div>
      </div>

      {/* Transactions */}
      <div>
        <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-400">
          Recent Transactions
        </h4>
        {loadingTx ? (
          <div className="flex items-center gap-2 text-sm text-slate-500">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Loading transactions…
          </div>
        ) : transactions.length === 0 ? (
          <p className="text-sm text-slate-500">No transactions found.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-[#1b2a45] text-slate-500">
                  <th className="pb-2 pr-4 font-medium">Action</th>
                  <th className="pb-2 pr-4 font-medium">Status</th>
                  <th className="pb-2 pr-4 font-medium">Order</th>
                  <th className="pb-2 pr-4 font-medium">Reference</th>
                  <th className="pb-2 pr-4 font-medium">Attempt</th>
                  <th className="pb-2 pr-4 font-medium">Duration</th>
                  <th className="pb-2 font-medium">Time</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#1b2a45]">
                {transactions.slice(0, 20).map((tx) => (
                  <tr key={tx.id}>
                    <td className="py-2 pr-4 text-slate-300">{tx.action}</td>
                    <td className="py-2 pr-4">
                      <Badge
                        label={tx.status}
                        color={
                          tx.status === 'success'
                            ? 'emerald'
                            : tx.status === 'pending'
                              ? 'amber'
                              : 'rose'
                        }
                      />
                    </td>
                    <td className="py-2 pr-4 font-mono text-slate-400">
                      {tx.order_id ? String(tx.order_id).slice(0, 8) : '—'}…
                    </td>
                    <td className="py-2 pr-4 text-slate-400">
                      {tx.supplier_reference || '—'}
                    </td>
                    <td className="py-2 pr-4 text-slate-400">{tx.attempt}</td>
                    <td className="py-2 pr-4 text-slate-400">
                      {tx.duration_ms}ms
                    </td>
                    <td className="py-2 text-slate-500">
                      {formatRelativeTime(tx.created_at)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Active Processing Transactions */}
      <div>
        <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-400">Active Processing Transactions</h4>
        {loadingTx ? (
          <div className="flex items-center gap-2 text-sm text-slate-500"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading…</div>
        ) : (() => {
          const active = transactions.filter(t => t.status === 'submitted' || t.status === 'pending');
          return active.length === 0 ? (
            <p className="text-sm text-slate-500">No active processing transactions.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead><tr className="border-b border-[#1b2a45] text-slate-500"><th className="pb-2 pr-4 font-medium">Status</th><th className="pb-2 pr-4 font-medium">Order</th><th className="pb-2 pr-4 font-medium">Reference</th><th className="pb-2 pr-4 font-medium">Attempt</th><th className="pb-2 pr-4 font-medium">Last Polled</th><th className="pb-2 pr-4 font-medium">Error</th><th className="pb-2 font-medium">Created</th></tr></thead>
                <tbody className="divide-y divide-[#1b2a45]">
                  {active.map(tx => (
                    <tr key={tx.id}>
                      <td className="py-2 pr-4"><Badge label={tx.status} color={tx.status === 'submitted' ? 'amber' : 'slate'} /></td>
                      <td className="py-2 pr-4">{tx.order_id ? <a href={`/admin/orders/${tx.order_id}`} className="font-mono text-cyan-300 hover:underline">{String(tx.order_id).slice(0, 8)}…</a> : '—'}</td>
                      <td className="py-2 pr-4 text-slate-400">{tx.supplier_reference || '—'}</td>
                      <td className="py-2 pr-4 text-slate-400">{tx.attempt}</td>
                      <td className="py-2 pr-4 text-slate-500">{formatRelativeTime(tx.last_polled_at)}</td>
                      <td className="py-2 pr-4 text-rose-300 max-w-[120px] truncate">{tx.error_message || '—'}</td>
                      <td className="py-2 text-slate-500">{formatRelativeTime(tx.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        })()}
      </div>

      {/* Recent Test Runs */}
      <div>
        <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-400">Recent Test Runs</h4>
        {loadingRuns ? (
          <div className="flex items-center gap-2 text-sm text-slate-500"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading…</div>
        ) : testRuns.length === 0 ? (
          <p className="text-sm text-slate-500">No test runs found.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead><tr className="border-b border-[#1b2a45] text-slate-500"><th className="pb-2 pr-4 font-medium">Offer</th><th className="pb-2 pr-4 font-medium">Sup. Ref</th><th className="pb-2 pr-4 font-medium">Local Status</th><th className="pb-2 pr-4 font-medium">Sup. Status</th><th className="pb-2 pr-4 font-medium">Last Polled</th><th className="pb-2 pr-4 font-medium">Error</th><th className="pb-2 font-medium">Created</th></tr></thead>
              <tbody className="divide-y divide-[#1b2a45]">
                {testRuns.map(r => (
                  <tr key={r.id}>
                    <td className="py-2 pr-4 font-mono text-slate-400">{r.offer_id}</td>
                    <td className="py-2 pr-4 text-slate-400">{r.supplier_reference || '—'}</td>
                    <td className="py-2 pr-4"><Badge label={r.local_status} color={r.local_status === 'SUCCESS' ? 'emerald' : r.local_status === 'FAILED' ? 'rose' : 'amber'} /></td>
                    <td className="py-2 pr-4 text-slate-300">{r.supplier_status || '—'}</td>
                    <td className="py-2 pr-4 text-slate-500">{formatRelativeTime(r.last_polled_at)}</td>
                    <td className="py-2 pr-4 text-rose-300 max-w-[120px] truncate">{r.error || '—'}</td>
                    <td className="py-2 text-slate-500">{formatRelativeTime(r.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-2 text-xs text-amber-200">Live supplier test orders are disabled.</p>
      </div>

      {/* Mappings */}
      <div>
        <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-400">
          Package Mappings
        </h4>
        {loadingMap ? (
          <div className="flex items-center gap-2 text-sm text-slate-500">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Loading mappings…
          </div>
        ) : mappings.length === 0 ? (
          <p className="text-sm text-slate-500">No mappings configured.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-[#1b2a45] text-slate-500">
                  <th className="pb-2 pr-4 font-medium">ID</th>
                  {mappings[0] &&
                    Object.keys(mappings[0])
                      .filter((k) => k !== 'id' && k !== 'supplier_id')
                      .slice(0, 5)
                      .map((k) => (
                        <th key={k} className="pb-2 pr-4 font-medium">
                          {k}
                        </th>
                      ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-[#1b2a45]">
                {mappings.map((m) => (
                  <tr key={m.id}>
                    <td className="py-2 pr-4 font-mono text-slate-400">
                      {String(m.id).slice(0, 8)}…
                    </td>
                    {Object.keys(m)
                      .filter((k) => k !== 'id' && k !== 'supplier_id')
                      .slice(0, 5)
                      .map((k) => (
                        <td key={k} className="py-2 pr-4 text-slate-300">
                          {typeof m[k] === 'object'
                            ? JSON.stringify(m[k])
                            : String(m[k] ?? '—')}
                        </td>
                      ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Main Component ──────────────────────────────────────────────────────────

export default function SuppliersClient() {
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formData, setFormData] = useState<SupplierFormData>(defaultFormData);
  const [formSaving, setFormSaving] = useState(false);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [actionLoading, setActionLoading] = useState<Record<string, string>>(
    {}
  );
  const [actionResults, setActionResults] = useState<ActionResult[]>([]);

  // Fetch suppliers
  const fetchSuppliers = useCallback(async () => {
    try {
      const res = await fetch('/api/suppliers');
      const json = await res.json();
      setSuppliers(json.data ?? []);
    } catch {
      // fail silently
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSuppliers();
  }, [fetchSuppliers]);

  // Auto-dismiss action results
  useEffect(() => {
    if (actionResults.length === 0) return;
    const timer = setTimeout(() => {
      const now = Date.now();
      setActionResults((prev) =>
        prev.filter((r) => now - r.timestamp < 5000)
      );
    }, 5000);
    return () => clearTimeout(timer);
  }, [actionResults]);

  // Modal open handlers
  function openCreate() {
    setEditingId(null);
    setFormData({ ...defaultFormData });
    setShowModal(true);
  }

  function openEdit(supplier: Supplier) {
    setEditingId(supplier.id);
    setFormData({
      name: supplier.name,
      code: supplier.code,
      adapter: supplier.adapter,
      api_url: supplier.api_url,
      sandbox_api_url: supplier.sandbox_api_url ?? '',
      environment: supplier.environment,
      auth_type: supplier.auth_type,
      priority: supplier.priority,
      retry_count: supplier.retry_count,
      timeout_ms: supplier.timeout_ms,
      low_balance_threshold_cents: supplier.low_balance_threshold_cents,
      enabled: supplier.enabled,
      supports_balance: supplier.supports_balance,
      supports_validation: supplier.supports_validation,
      supports_refund: supplier.supports_refund,
    });
    setShowModal(true);
  }

  // Save (create or update)
  async function handleSave() {
    setFormSaving(true);
    try {
      const body = editingId
        ? { id: editingId, ...formData }
        : { ...formData };
      const res = await fetch('/api/suppliers', {
        method: editingId ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error('Failed to save');
      setShowModal(false);
      await fetchSuppliers();
    } catch {
      addActionResult('', 'save', false, 'Failed to save supplier');
    } finally {
      setFormSaving(false);
    }
  }

  // Delete
  async function handleDelete(supplier: Supplier) {
    if (!confirm(`Delete supplier "${supplier.name}"? This cannot be undone.`))
      return;
    try {
      const res = await fetch(`/api/suppliers?id=${supplier.id}`, {
        method: 'DELETE',
      });
      if (!res.ok) throw new Error('Failed to delete');
      await fetchSuppliers();
      addActionResult(supplier.id, 'delete', true, 'Supplier deleted');
    } catch {
      addActionResult(
        supplier.id,
        'delete',
        false,
        'Failed to delete supplier'
      );
    }
  }

  // Actions
  async function handleAction(
    supplier: Supplier,
    action: 'test_connection' | 'check_balance' | 'sync_catalog'
  ) {
    const key = `${supplier.id}-${action}`;
    setActionLoading((prev) => ({ ...prev, [key]: action }));
    try {
      const res = await fetch('/api/suppliers/actions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, supplier_id: supplier.id }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Action failed');
      addActionResult(
        supplier.id,
        action,
        true,
        json.message ?? `${action} succeeded`
      );
      if (action === 'check_balance') {
        await fetchSuppliers();
      }
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : 'Action failed';
      addActionResult(supplier.id, action, false, message);
    } finally {
      setActionLoading((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
    }
  }

  // Toggle enabled
  async function toggleEnabled(supplier: Supplier) {
    try {
      await fetch('/api/suppliers', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: supplier.id, enabled: !supplier.enabled }),
      });
      await fetchSuppliers();
    } catch {
      // fail silently
    }
  }

  // Expand / collapse
  function toggleExpand(id: string) {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function addActionResult(
    supplierId: string,
    action: string,
    success: boolean,
    message: string
  ) {
    setActionResults((prev) => [
      ...prev,
      { supplierId, action, success, message, timestamp: Date.now() },
    ]);
  }

  // Update form name → auto-generate code on create
  function handleNameChange(name: string) {
    const updates: Partial<SupplierFormData> = { name };
    if (!editingId) {
      updates.code = generateCode(name);
    }
    setFormData((prev) => ({ ...prev, ...updates }));
  }

  // ─── Render ──────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-[#030718] px-4 py-8 sm:px-6 lg:px-8">
      {/* Action result toasts */}
      {actionResults.length > 0 && (
        <div className="fixed right-4 top-4 z-[60] flex flex-col gap-2">
          {actionResults.map((r, i) => (
            <div
              key={`${r.timestamp}-${i}`}
              className={`flex items-center gap-2 rounded-lg border px-4 py-2.5 text-sm shadow-lg ${
                r.success
                  ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
                  : 'border-rose-500/30 bg-rose-500/10 text-rose-300'
              }`}
            >
              {r.success ? (
                <Check className="h-4 w-4 shrink-0" />
              ) : (
                <AlertTriangle className="h-4 w-4 shrink-0" />
              )}
              <span>{r.message}</span>
              <button
                type="button"
                onClick={() =>
                  setActionResults((prev) => prev.filter((_, idx) => idx !== i))
                }
                className="ml-2 shrink-0 text-current opacity-60 hover:opacity-100"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Header */}
      <div className="mx-auto max-w-6xl">
        <div className="mb-8 flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
          <div>
            <h1 className="font-display text-2xl font-bold text-slate-100">
              Suppliers
            </h1>
            <p className="mt-1 text-sm text-slate-400">
              Manage game top-up supplier connections and configurations
            </p>
          </div>
          <button
            type="button"
            onClick={openCreate}
            className="inline-flex items-center gap-2 rounded-lg bg-gradient-to-r from-blue-500 to-violet-600 px-4 py-2.5 text-sm font-medium text-white shadow-lg transition hover:brightness-110"
          >
            <Plus className="h-4 w-4" />
            Add Supplier
          </button>
        </div>

        {/* Loading state */}
        {loading && (
          <div className="flex flex-col items-center justify-center py-32">
            <Loader2 className="h-8 w-8 animate-spin text-slate-500" />
            <p className="mt-3 text-sm text-slate-500">
              Loading suppliers…
            </p>
          </div>
        )}

        {/* Empty state */}
        {!loading && suppliers.length === 0 && (
          <div className="flex flex-col items-center justify-center py-32">
            <div className="rounded-2xl bg-[#0b1225] p-6">
              <Package className="h-12 w-12 text-slate-600" />
            </div>
            <h3 className="mt-4 font-display text-lg font-semibold text-slate-300">
              No suppliers configured
            </h3>
            <p className="mt-1 text-sm text-slate-500">
              Add your first supplier to start processing game top-ups.
            </p>
            <button
              type="button"
              onClick={openCreate}
              className="mt-6 inline-flex items-center gap-2 rounded-lg bg-gradient-to-r from-blue-500 to-violet-600 px-4 py-2.5 text-sm font-medium text-white shadow-lg transition hover:brightness-110"
            >
              <Plus className="h-4 w-4" />
              Add Supplier
            </button>
          </div>
        )}

        {/* Supplier list */}
        {!loading && suppliers.length > 0 && (
          <div className="space-y-4">
            {suppliers.map((supplier) => {
              const isExpanded = expandedIds.has(supplier.id);
              const balanceLow =
                supplier.supports_balance &&
                supplier.cached_balance_cents !== null &&
                supplier.low_balance_threshold_cents > 0 &&
                supplier.cached_balance_cents <
                  supplier.low_balance_threshold_cents;

              return (
                <div
                  key={supplier.id}
                  className="rounded-xl border border-[#1b2a45] bg-[#0b1225] p-5"
                >
                  {/* Card header */}
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                    <div className="flex-1">
                      <div className="flex flex-wrap items-center gap-3">
                        <button
                          type="button"
                          onClick={() => openEdit(supplier)}
                          className="font-display text-lg font-semibold text-slate-100 hover:text-cyan-300 transition"
                        >
                          {supplier.name}
                        </button>
                        <span className="rounded bg-[#1b2a45] px-2 py-0.5 font-mono text-xs text-slate-400">
                          {supplier.code}
                        </span>
                        <Badge
                          label={supplier.adapter}
                          color="cyan"
                        />
                        <Badge
                          label={supplier.environment}
                          color={
                            supplier.environment === 'live'
                              ? 'emerald'
                              : 'amber'
                          }
                        />
                        {!supplier.enabled && (
                          <Badge label="Disabled" color="slate" />
                        )}
                      </div>

                      {/* Metadata row */}
                      <div className="mt-2 flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-slate-500">
                        <span className="flex items-center gap-1">
                          <Settings2 className="h-3 w-3" />
                          Priority: {supplier.priority}
                        </span>
                        <span className="flex items-center gap-1">
                          <RotateCcw className="h-3 w-3" />
                          Retries: {supplier.retry_count}
                        </span>
                        <span className="flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          Timeout: {supplier.timeout_ms}ms
                        </span>
                        {supplier.supports_balance && (
                          <span className="flex items-center gap-1">
                            <Shield className="h-3 w-3" />
                            Balance
                          </span>
                        )}
                        {supplier.supports_validation && (
                          <span className="flex items-center gap-1">
                            <Zap className="h-3 w-3" />
                            Validation
                          </span>
                        )}
                        {supplier.supports_refund && (
                          <span className="flex items-center gap-1">
                            <RefreshCw className="h-3 w-3" />
                            Refund
                          </span>
                        )}
                      </div>

                      {/* Status row */}
                      <div className="mt-2 flex flex-wrap items-center gap-x-5 gap-y-1 text-xs">
                        {supplier.last_success_at && (
                          <span className="flex items-center gap-1 text-emerald-400">
                            <Wifi className="h-3 w-3" />
                            Last success:{' '}
                            {formatRelativeTime(supplier.last_success_at)}
                          </span>
                        )}
                        {supplier.last_failure_at && (
                          <span className="flex items-center gap-1 text-rose-400">
                            <WifiOff className="h-3 w-3" />
                            Last failure:{' '}
                            {formatRelativeTime(supplier.last_failure_at)}
                          </span>
                        )}
                        {supplier.last_error && (
                          <span className="flex items-center gap-1 text-rose-400">
                            <AlertTriangle className="h-3 w-3" />
                            {supplier.last_error.length > 80
                              ? `${supplier.last_error.slice(0, 80)}…`
                              : supplier.last_error}
                          </span>
                        )}
                      </div>

                      {/* Balance */}
                      {supplier.supports_balance && (
                        <div className="mt-2 flex items-center gap-2">
                          <DollarSign
                            className={`h-4 w-4 ${balanceLow ? 'text-amber-400' : 'text-emerald-400'}`}
                          />
                          <span
                            className={`text-sm font-medium ${balanceLow ? 'text-amber-300' : 'text-slate-200'}`}
                          >
                            {formatCurrency(supplier.cached_balance_cents)}
                          </span>
                          {supplier.balance_checked_at && (
                            <span className="text-xs text-slate-500">
                              (checked{' '}
                              {formatRelativeTime(supplier.balance_checked_at)})
                            </span>
                          )}
                          {balanceLow && (
                            <Badge label="Low Balance" color="amber" />
                          )}
                        </div>
                      )}
                    </div>

                    {/* Enabled toggle */}
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-slate-500">
                        {supplier.enabled ? 'Enabled' : 'Disabled'}
                      </span>
                      <Toggle
                        on={supplier.enabled}
                        onToggle={() => toggleEnabled(supplier)}
                      />
                    </div>
                  </div>

                  {/* Action buttons */}
                  <div className="mt-4 flex flex-wrap items-center gap-2">
                    <ActionButton
                      label="Test Connection"
                      icon={Wifi}
                      loading={
                        !!actionLoading[
                          `${supplier.id}-test_connection`
                        ]
                      }
                      onClick={() =>
                        handleAction(supplier, 'test_connection')
                      }
                    />
                    {supplier.supports_balance && (
                      <ActionButton
                        label="Check Balance"
                        icon={DollarSign}
                        loading={
                          !!actionLoading[
                            `${supplier.id}-check_balance`
                          ]
                        }
                        onClick={() =>
                          handleAction(supplier, 'check_balance')
                        }
                      />
                    )}
                    <ActionButton
                      label="Sync Catalog"
                      icon={RefreshCw}
                      loading={
                        !!actionLoading[
                          `${supplier.id}-sync_catalog`
                        ]
                      }
                      onClick={() =>
                        handleAction(supplier, 'sync_catalog')
                      }
                    />
                    <div className="flex-1" />
                    <ActionButton
                      label="Delete"
                      icon={Trash2}
                      variant="danger"
                      onClick={() => handleDelete(supplier)}
                    />
                    <button
                      type="button"
                      onClick={() => toggleExpand(supplier.id)}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-[#253451] px-3 py-1.5 text-xs font-medium text-slate-300 transition hover:border-cyan-400 hover:text-cyan-300"
                    >
                      {isExpanded ? (
                        <>
                          <ChevronUp className="h-3.5 w-3.5" />
                          Collapse
                        </>
                      ) : (
                        <>
                          <ChevronDown className="h-3.5 w-3.5" />
                          Details
                        </>
                      )}
                    </button>
                  </div>

                  {/* Inline action results for this supplier */}
                  {actionResults
                    .filter((r) => r.supplierId === supplier.id)
                    .map((r, i) => (
                      <div
                        key={`${r.timestamp}-${i}`}
                        className={`mt-3 flex items-center gap-2 rounded-lg px-3 py-2 text-xs ${
                          r.success
                            ? 'bg-emerald-500/5 text-emerald-400'
                            : 'bg-rose-500/5 text-rose-400'
                        }`}
                      >
                        {r.success ? (
                          <Check className="h-3.5 w-3.5 shrink-0" />
                        ) : (
                          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                        )}
                        <span>
                          {r.action}: {r.message}
                        </span>
                      </div>
                    ))}

                  {/* Expanded section */}
                  {isExpanded && <ExpandedSection supplier={supplier} />}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Modal overlay */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 px-4 py-12 backdrop-blur-sm">
          <div className="w-full max-w-2xl rounded-xl border border-[#1b2a45] bg-[#0b1225] p-6 shadow-2xl">
            <div className="mb-6 flex items-center justify-between">
              <h2 className="font-display text-xl font-bold text-slate-100">
                {editingId ? 'Edit Supplier' : 'Add Supplier'}
              </h2>
              <button
                type="button"
                onClick={() => setShowModal(false)}
                className="rounded-lg p-1 text-slate-400 transition hover:bg-[#1b2a45] hover:text-slate-200"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="space-y-5">
              {/* Row: Name & Code */}
              <div className="grid grid-cols-2 gap-4">
                <InputField
                  label="Name"
                  value={formData.name}
                  onChange={handleNameChange}
                  placeholder="e.g. FazerCards"
                  required
                />
                <InputField
                  label="Code"
                  value={formData.code}
                  onChange={(v) =>
                    setFormData((p) => ({ ...p, code: v }))
                  }
                  placeholder="e.g. fazercards"
                  required
                  disabled={!!editingId}
                />
              </div>

              {/* Row: Adapter & Auth Type */}
              <div className="grid grid-cols-2 gap-4">
                <SelectField
                  label="Adapter"
                  value={formData.adapter}
                  onChange={(v) =>
                    setFormData((p) => ({ ...p, adapter: v }))
                  }
                  options={[
                    { value: 'generic', label: 'Generic' },
                    { value: 'custom', label: 'Custom' },
                  ]}
                />
                <SelectField
                  label="Auth Type"
                  value={formData.auth_type}
                  onChange={(v) =>
                    setFormData((p) => ({
                      ...p,
                      auth_type: v as AuthType,
                    }))
                  }
                  options={[
                    { value: 'api_key', label: 'API Key' },
                    { value: 'bearer', label: 'Bearer Token' },
                    { value: 'basic', label: 'Basic Auth' },
                    { value: 'oauth2', label: 'OAuth2' },
                    { value: 'custom', label: 'Custom' },
                  ]}
                />
              </div>

              {/* Row: API URLs */}
              <div className="grid grid-cols-2 gap-4">
                <InputField
                  label="API URL"
                  value={formData.api_url}
                  onChange={(v) =>
                    setFormData((p) => ({ ...p, api_url: v }))
                  }
                  placeholder="https://api.supplier.com/v1"
                  required
                />
                <InputField
                  label="Sandbox API URL"
                  value={formData.sandbox_api_url}
                  onChange={(v) =>
                    setFormData((p) => ({ ...p, sandbox_api_url: v }))
                  }
                  placeholder="https://sandbox.supplier.com/v1"
                />
              </div>

              {/* Row: Environment & Priority */}
              <div className="grid grid-cols-3 gap-4">
                <SelectField
                  label="Environment"
                  value={formData.environment}
                  onChange={(v) =>
                    setFormData((p) => ({
                      ...p,
                      environment: v as Environment,
                    }))
                  }
                  options={[
                    { value: 'sandbox', label: 'Sandbox' },
                    { value: 'live', label: 'Live' },
                  ]}
                />
                <InputField
                  label="Priority"
                  type="number"
                  value={formData.priority}
                  onChange={(v) =>
                    setFormData((p) => ({
                      ...p,
                      priority: parseInt(v) || 0,
                    }))
                  }
                />
                <InputField
                  label="Low Balance Alert (cents)"
                  type="number"
                  value={formData.low_balance_threshold_cents}
                  onChange={(v) =>
                    setFormData((p) => ({
                      ...p,
                      low_balance_threshold_cents: parseInt(v) || 0,
                    }))
                  }
                />
              </div>

              {/* Row: Retry & Timeout */}
              <div className="grid grid-cols-2 gap-4">
                <InputField
                  label="Retry Count"
                  type="number"
                  value={formData.retry_count}
                  onChange={(v) =>
                    setFormData((p) => ({
                      ...p,
                      retry_count: parseInt(v) || 0,
                    }))
                  }
                />
                <InputField
                  label="Timeout (ms)"
                  type="number"
                  value={formData.timeout_ms}
                  onChange={(v) =>
                    setFormData((p) => ({
                      ...p,
                      timeout_ms: parseInt(v) || 0,
                    }))
                  }
                />
              </div>

              {/* Toggles */}
              <div className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4">
                <div className="flex items-center gap-2">
                  <Toggle
                    on={formData.enabled}
                    onToggle={() =>
                      setFormData((p) => ({
                        ...p,
                        enabled: !p.enabled,
                      }))
                    }
                  />
                  <span className="text-sm text-slate-300">Enabled</span>
                </div>
                <div className="flex items-center gap-2">
                  <Toggle
                    on={formData.supports_balance}
                    onToggle={() =>
                      setFormData((p) => ({
                        ...p,
                        supports_balance: !p.supports_balance,
                      }))
                    }
                  />
                  <span className="text-sm text-slate-300">Balance</span>
                </div>
                <div className="flex items-center gap-2">
                  <Toggle
                    on={formData.supports_validation}
                    onToggle={() =>
                      setFormData((p) => ({
                        ...p,
                        supports_validation: !p.supports_validation,
                      }))
                    }
                  />
                  <span className="text-sm text-slate-300">Validation</span>
                </div>
                <div className="flex items-center gap-2">
                  <Toggle
                    on={formData.supports_refund}
                    onToggle={() =>
                      setFormData((p) => ({
                        ...p,
                        supports_refund: !p.supports_refund,
                      }))
                    }
                  />
                  <span className="text-sm text-slate-300">Refund</span>
                </div>
              </div>

              {/* Security note */}
              <div className="flex items-start gap-2 rounded-lg border border-amber-500/20 bg-amber-500/5 px-4 py-3">
                <Shield className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
                <p className="text-xs leading-relaxed text-amber-300/80">
                  API credentials are configured as server secrets
                  (SUPPLIER_{'{CODE}'}_API_KEY etc.) and are never stored in the
                  database.
                </p>
              </div>

              {/* Actions */}
              <div className="flex items-center justify-end gap-3 border-t border-[#1b2a45] pt-5">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="rounded-lg border border-[#253451] px-4 py-2.5 text-sm font-medium text-slate-300 transition hover:border-cyan-400"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleSave}
                  disabled={formSaving || !formData.name || !formData.code}
                  className="inline-flex items-center gap-2 rounded-lg bg-gradient-to-r from-blue-500 to-violet-600 px-5 py-2.5 text-sm font-medium text-white shadow-lg transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {formSaving && (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  )}
                  {editingId ? 'Update Supplier' : 'Create Supplier'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
