'use client';

import { usePathname } from 'next/navigation';
import { useEffect } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { CircleUserRound, Package, ShieldCheck, WalletCards } from 'lucide-react';
import CustomerAccountMenu from '@/components/CustomerAccountMenu';
import ThemeSelector from '@/components/ThemeSelector';

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

  useEffect(() => {
    const onPageShow = (event: PageTransitionEvent) => {
      if (!event.persisted) return;
      let signedOut = false;
      try { signedOut = window.sessionStorage.getItem('rfz-customer-signed-out') === '1'; } catch { /* Storage can be disabled. */ }
      if (signedOut) window.location.replace('/login');
    };
    window.addEventListener('pageshow', onPageShow);
    return () => window.removeEventListener('pageshow', onPageShow);
  }, []);

  const item = (link: (typeof links)[number]) => {
    const Icon = link.icon;
    const current = isCurrent(pathname, link.href, link.exact);
    return (
      <Link
        key={link.href}
        href={link.href}
        aria-current={current ? 'page' : undefined}
        className={`inline-flex min-h-11 w-full items-center gap-2 rounded-lg px-3 py-2 text-sm transition-colors ${current
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
      <header className="sticky top-0 z-40 border-b border-[#14203a] bg-[#050a1b]/95 backdrop-blur">
        <div className="flex min-h-14 items-center justify-between gap-3 px-4 py-2 lg:px-8">
          <div className="min-w-0">
            <Link href="/" aria-label="RunFazone home" className="inline-flex min-h-10 items-center lg:hidden">
              <Image src="/runfazone-logo.png" alt="RunFazone" width={160} height={44} priority className="h-7 w-auto max-w-32 object-contain" />
            </Link>
            <div className="hidden items-center gap-2 text-xs lg:flex">
              <Link href="/" className="text-cyan-300 hover:text-cyan-200">← Store</Link>
              <span aria-hidden="true" className="text-slate-600">/</span>
              <span className="text-slate-400">Customer account</span>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <CustomerAccountMenu compactOnMobile />
            <ThemeSelector />
          </div>
        </div>
      </header>

      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col border-r border-[#14203a] bg-[#050a1b] px-4 py-6 lg:flex">
        <Link href="/" aria-label="RunFazone home" className="mb-3 inline-flex min-h-10 items-center px-3">
          <Image src="/runfazone-logo.png" alt="RunFazone" width={160} height={44} priority className="h-8 w-auto max-w-36 object-contain" />
        </Link>
        <p className="mb-6 px-3 text-[10px] font-semibold uppercase tracking-[.2em] text-slate-500">Customer account</p>
        <nav aria-label="Account navigation" className="flex flex-col gap-1">
          {links.map(item)}
          <Link href="/track-order" className="inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-slate-400 transition-colors hover:bg-[#101b34] hover:text-slate-100">
            <Package size={16} aria-hidden="true" />
            <span>Guest order tracking</span>
          </Link>
        </nav>
      </aside>
    </>
  );
}
