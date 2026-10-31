'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ChevronDown, ChevronRight, X } from 'lucide-react';
import { PRIMARY_NAV, type NavDropdownItem } from './navData';

type AdminNavigationProps = {
  open: boolean;
  onClose: () => void;
  role: string;
  permissions: string[];
};

function permissionForPath(href: string): string | null {
  if (href === '/admin') return 'orders.view'
  if (href === '/admin/orders' || href.startsWith('/admin/orders/')) return 'orders.view'
  if (href === '/admin/games' || href.startsWith('/admin/games/')) return 'games.manage'
  if (href === '/admin/pricing' || href === '/admin/bulk-pricing') return 'pricing.manage'
  if (href === '/admin/promotions' || href.startsWith('/admin/promotions/') || href.startsWith('/admin/announcements') || href.startsWith('/admin/notifications')) return 'marketing.manage'
  if (href.startsWith('/admin/customers')) return 'customers.view'
  if (href === '/admin/staff') return 'staff.manage'
  if (href === '/admin/vouchers') return 'VOUCHERS_ADMIN_ONLY'
  if (href === '/admin/roles' || href === '/admin/activity-log' || href === '/admin/rf-coins') return 'SUPER_ADMIN_ONLY'
  if (href === '/admin/tickets') return 'tickets.manage'
  if (href === '/admin/tasks') return 'tasks.manage'
  if (href === '/admin/approvals' || href === '/admin/blocklist' || href === '/admin/risk-alerts' || href === '/admin/security' || href === '/admin/system-health') return 'system.view'
  if (href.startsWith('/admin/suppliers') || href.startsWith('/admin/ml-offer-pricing')) return 'suppliers.view'
  if (href === '/admin/payments' || href === '/admin/reconciliation' || href === '/admin/refunds') return 'payments.view'
  if (href === '/admin/export') return 'orders.view'
  if (href === '/admin/analytics') return 'analytics.view'
  if (href === '/admin/settings') return 'settings.manage'
  return null
}

function canVisitPath(href: string, role: string, permissions: string[]) {
  if (role === 'SUPER_ADMIN') return true
  if (href === '/admin/export') return permissions.includes('orders.view') || permissions.includes('games.manage')
  const required = permissionForPath(href)
  if (required === 'VOUCHERS_ADMIN_ONLY') return ['ADMIN', 'SUPER_ADMIN'].includes(role) && permissions.includes('marketing.manage')
  return required === null || (required !== 'SUPER_ADMIN_ONLY' && permissions.includes(required))
}

export default function AdminNavigation({ open, onClose, role, permissions }: AdminNavigationProps) {
  const pathname = usePathname();
  const [openGroups, setOpenGroups] = useState<string[]>([]);

  const isActive = (href: string) => pathname === href || (href !== '/admin' && pathname.startsWith(`${href}/`));
  const visibleItems = useCallback((item: NavDropdownItem) => item.items.filter((leaf) => canVisitPath(leaf.href, role, permissions)), [permissions, role]);
  const groupIsActive = (item: NavDropdownItem) => visibleItems(item).some((leaf) => isActive(leaf.href));

  useEffect(() => {
    const activeGroups = PRIMARY_NAV
      .filter((item): item is NavDropdownItem => 'items' in item && visibleItems(item).some((leaf) => pathname === leaf.href || (leaf.href !== '/admin' && pathname.startsWith(`${leaf.href}/`))))
      .map((item) => item.label);
    setOpenGroups((current) => Array.from(new Set([...current, ...activeGroups])));
  }, [pathname, visibleItems]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && open) onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose, open]);

  const toggleGroup = (label: string) => {
    setOpenGroups((current) => current.includes(label) ? current.filter((item) => item !== label) : [...current, label]);
  };

  return (
    <>
      {open && <button aria-label="Close admin navigation" className="fixed inset-0 z-40 bg-slate-950/70 lg:hidden" onClick={onClose} />}
      <aside
        aria-label="Admin navigation"
        style={open ? { transform: 'translateX(0)' } : undefined}
        className={`rfz-admin-nav fixed inset-y-0 left-0 z-50 w-72 overflow-y-auto border-r px-3 py-4 shadow-2xl shadow-black/30 transition-transform duration-200 lg:sticky lg:top-0 lg:z-30 lg:block lg:h-[calc(100vh-73px)] lg:translate-x-0 lg:shadow-none ${open ? 'translate-x-0' : '-translate-x-full'}`}
      >
        <div className="mb-5 flex items-center justify-between px-2 lg:hidden">
          <span className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Admin menu</span>
          <button aria-label="Close admin navigation" className="rounded-lg p-2 text-slate-400 hover:bg-white/5 hover:text-white" onClick={onClose}>
            <X size={18} />
          </button>
        </div>
        <div className="space-y-1">
          {PRIMARY_NAV.map((item) => {
            if (!('items' in item)) {
              if (!canVisitPath(item.href, role, permissions)) return null
              const active = isActive(item.href);
              const Icon = item.icon;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={active ? 'page' : undefined}
                  onClick={onClose}
                  className={`flex min-h-11 items-center gap-3 rounded-xl px-3 text-sm font-medium transition ${active ? 'bg-cyan-400/10 text-cyan-200 ring-1 ring-inset ring-cyan-300/20' : 'text-slate-300 hover:bg-white/5 hover:text-white'}`}
                >
                  <Icon size={17} className={active ? 'text-cyan-300' : 'text-slate-500'} />
                  <span>{item.label}</span>
                </Link>
              );
            }

            const active = groupIsActive(item);
            const expanded = openGroups.includes(item.label);
            const Icon = item.icon;
            return (
              <section key={item.label} className="pt-2">
                <button
                  type="button"
                  aria-expanded={expanded}
                  onClick={() => toggleGroup(item.label)}
                  className={`flex min-h-10 w-full items-center gap-3 rounded-xl px-3 text-left text-sm font-semibold transition ${active ? 'text-cyan-200' : 'text-slate-400 hover:bg-white/5 hover:text-slate-200'}`}
                >
                  <Icon size={17} className={active ? 'text-cyan-300' : 'text-slate-600'} />
                  <span className="flex-1">{item.label}</span>
                  {expanded ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
                </button>
                {expanded && (
                  <div className="ml-5 border-l border-[#20304d] pl-3">
                    {visibleItems(item).map((leaf) => {
                      const leafActive = isActive(leaf.href);
                      return (
                        <Link
                          key={leaf.href}
                          href={leaf.href}
                          aria-current={leafActive ? 'page' : undefined}
                          onClick={onClose}
                          className={`flex min-h-10 items-center rounded-lg px-3 text-sm transition ${leafActive ? 'bg-cyan-400/10 font-medium text-cyan-200' : 'text-slate-400 hover:bg-white/5 hover:text-slate-100'}`}
                        >
                          {leaf.label}
                        </Link>
                      );
                    })}
                  </div>
                )}
              </section>
            );
          })}
        </div>
      </aside>
    </>
  );
}
