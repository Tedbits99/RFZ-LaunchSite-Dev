'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useState } from 'react';
import Link from 'next/link';
import { CircleUserRound, LogOut, Package, ShieldCheck, WalletCards } from 'lucide-react';

const links = [
  { href: '/account', label: 'Overview', icon: CircleUserRound, exact: true },
  { href: '/account/orders', label: 'Orders', icon: Package },
  { href: '/account/wallet', label: 'RF Coins wallet', icon: WalletCards },
  { href: '/account/profile', label: 'Profile & security', icon: ShieldCheck },
];

function isCurrent(pathname: string | null, href: string, exact = false) {
  if (!pathname) return false;
  return exact ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);
}

export default function AccountNavigation() {
  const pathname = usePathname();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function signOut() {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const response = await fetch('/api/auth/logout', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
      });
      if (!response.ok) throw new Error('logout failed');
      router.replace('/login');
      router.refresh();
    } catch {
      setError('Sign out was not completed. Please try again.');
      setBusy(false);
    }
  }

  const item = (link: (typeof links)[number]) => {
    const Icon = link.icon;
    const current = isCurrent(pathname, link.href, link.exact);
    return (
      <Link
        key={link.href}
        href={link.href}
        aria-current={current ? 'page' : undefined}
        className={`inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm transition-colors ${current
          ? 'bg-cyan-400/10 text-cyan-200 ring-1 ring-cyan-400/25'
          : 'text-slate-400 hover:bg-[#101b34] hover:text-slate-100'}`}
      >
        <Icon size={16} aria-hidden="true" />
        <span>{link.label}</span>
      </Link>
    );
  };

  return (
    <>
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col border-r border-[#14203a] bg-[#050a1b] px-4 py-6 lg:flex">
        <Link href="/account" className="mb-8 px-3 text-xs font-semibold uppercase tracking-[.2em] text-cyan-300">
          Customer hub
        </Link>
        <nav aria-label="Account navigation" className="flex flex-col gap-1">
          {links.map(item)}
          <Link href="/track-order" className="inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-slate-400 transition-colors hover:bg-[#101b34] hover:text-slate-100">
            <Package size={16} aria-hidden="true" />
            <span>Guest order tracking</span>
          </Link>
        </nav>
        <div className="mt-auto">
          {error ? <p className="mb-3 px-3 text-xs text-rose-300" role="alert">{error}</p> : null}
          <button type="button" onClick={() => void signOut()} disabled={busy} className="inline-flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-slate-400 transition-colors hover:bg-rose-400/10 hover:text-rose-200 disabled:cursor-wait disabled:opacity-60">
            <LogOut size={16} aria-hidden="true" />
            <span>{busy ? 'Signing out…' : 'Sign out'}</span>
          </button>
        </div>
      </aside>

      <div className="border-b border-[#14203a] bg-[#050a1b] px-4 py-3 lg:hidden">
        <div className="flex items-center gap-2 overflow-x-auto pb-1" aria-label="Account navigation">
          {links.map(item)}
          <Link href="/track-order" className="inline-flex shrink-0 items-center gap-2 rounded-lg px-3 py-2 text-sm text-slate-400 hover:bg-[#101b34] hover:text-slate-100">
            <Package size={16} aria-hidden="true" />
            <span>Track guest order</span>
          </Link>
          <button type="button" onClick={() => void signOut()} disabled={busy} className="inline-flex shrink-0 items-center gap-2 rounded-lg border border-rose-400/25 px-3 py-2 text-sm text-rose-200 disabled:cursor-wait disabled:opacity-60">
            <LogOut size={16} aria-hidden="true" />
            <span>{busy ? 'Signing out…' : 'Sign out'}</span>
          </button>
        </div>
        {error ? <p className="mt-2 text-xs text-rose-300" role="alert">{error}</p> : null}
      </div>
    </>
  );
}
