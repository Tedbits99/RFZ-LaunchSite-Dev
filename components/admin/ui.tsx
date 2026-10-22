import { ReactNode } from 'react';
import { LucideIcon } from 'lucide-react';

export function PageHeader({ title, subtitle, action }: { title: string; subtitle?: string; action?: ReactNode }) {
  return (
    <div className="rfz-page-header mb-6 flex flex-col justify-between gap-4 border-b pb-5 sm:flex-row sm:items-end">
      <div>
        <h1 className="font-display text-2xl font-bold tracking-tight text-[var(--rfz-ink)]">{title}</h1>
        {subtitle && <p className="mt-1 max-w-2xl text-sm text-[var(--rfz-muted)]">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

export function Surface({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <section className={`surface ${className}`}>{children}</section>;
}

export function MetricCard({ label, value, icon: Icon, tone = 'cyan', detail }: { label: string; value: ReactNode; icon: LucideIcon; tone?: 'blue' | 'cyan' | 'emerald' | 'amber' | 'violet' | 'rose'; detail?: string }) {
  const tones = {
    blue: 'from-blue-500/20 to-blue-600/5 text-blue-300',
    cyan: 'from-cyan-500/20 to-cyan-600/5 text-cyan-300',
    emerald: 'from-emerald-500/20 to-emerald-600/5 text-emerald-300',
    amber: 'from-amber-500/20 to-amber-600/5 text-amber-300',
    violet: 'from-violet-500/20 to-violet-600/5 text-violet-300',
    rose: 'from-rose-500/20 to-rose-600/5 text-rose-300',
  }[tone];
  return <div className={`rfz-metric-card rounded-xl border bg-gradient-to-br ${tones} p-4 shadow-lg shadow-black/5`}><div className="flex items-center justify-between gap-3"><span className="text-[11px] uppercase tracking-wider text-[var(--rfz-muted)]">{label}</span><Icon size={16} aria-hidden="true" /></div><p className="font-display mt-3 text-2xl font-bold tracking-tight text-[var(--rfz-ink)]">{value}</p>{detail && <p className="mt-1 text-[10px] text-[var(--rfz-subtle)]">{detail}</p>}</div>;
}

export function StatusBadge({ status }: { status: string }) {
  const tone = {
    COMPLETED: 'bg-emerald-400/10 text-emerald-300 ring-emerald-400/20',
    PAID: 'bg-emerald-400/10 text-emerald-300 ring-emerald-400/20',
    PROCESSING: 'bg-blue-400/10 text-blue-300 ring-blue-400/20',
    PENDING: 'bg-amber-400/10 text-amber-200 ring-amber-400/20',
    PAYMENT_PENDING: 'bg-amber-400/10 text-amber-200 ring-amber-400/20',
    FAILED: 'bg-rose-400/10 text-rose-300 ring-rose-400/20',
    CANCELLED: 'bg-rose-400/10 text-rose-300 ring-rose-400/20',
    REFUNDED: 'bg-slate-400/10 text-slate-300 ring-slate-400/20',
    REFUND_REQUESTED: 'bg-orange-400/10 text-orange-300 ring-orange-400/20',
  }[status] || 'bg-slate-400/10 text-slate-300 ring-slate-400/20';

  return <span className={`inline-flex rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide ring-1 ring-inset ${tone}`}>{status.replaceAll('_', ' ')}</span>;
}

export function DbNotReady() {
  return (
    <div role="status" className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-5 text-sm text-amber-300">
      Database connection is not available. Please check your server configuration.
    </div>
  );
}

export function EmptyState({ icon: Icon, label, hint }: { icon: LucideIcon; label: string; hint?: string }) {
  return (
    <div className="rfz-empty-state flex flex-col items-center justify-center rounded-xl border py-16 text-center">
      <Icon size={32} className="mb-3 text-slate-600" />
      <p className="text-sm font-medium text-slate-400">{label}</p>
      {hint && <p className="mt-1 text-xs text-slate-600">{hint}</p>}
    </div>
  );
}

export function ActiveBadge({ active }: { active: boolean }) {
  return (
    <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${active ? 'bg-emerald-500/20 text-emerald-300' : 'bg-slate-500/20 text-slate-400'}`}>
      {active ? 'ACTIVE' : 'DISABLED'}
    </span>
  );
}
