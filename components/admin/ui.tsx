import { ReactNode } from 'react';
import { LucideIcon } from 'lucide-react';

export function PageHeader({ title, subtitle, action }: { title: string; subtitle?: string; action?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
      <div>
        <h1 className="font-display text-2xl font-bold">{title}</h1>
        {subtitle && <p className="text-xs text-slate-500">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

export function DbNotReady() {
  return (
    <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-5 text-sm text-amber-300">
      Database connection is not available. Please check your server configuration.
    </div>
  );
}

export function EmptyState({ icon: Icon, label, hint }: { icon: LucideIcon; label: string; hint?: string }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-[#1b2a45] bg-[#0b1225] py-16 text-center">
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
