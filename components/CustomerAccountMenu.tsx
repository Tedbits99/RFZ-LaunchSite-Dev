'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { ChevronDown, CircleUserRound, LogOut, Package, Settings, WalletCards } from 'lucide-react';

type Account = { display_name: string; email: string };
type AccountState = 'checking' | 'anonymous' | 'authenticated' | 'unavailable';

export default function CustomerAccountMenu({ compact = false }: { compact?: boolean }) {
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const [account, setAccount] = useState<Account | null>(null);
  const [accountState, setAccountState] = useState<AccountState>('checking');
  const [retryKey, setRetryKey] = useState(0);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/account/profile', { credentials: 'same-origin', cache: 'no-store', signal: controller.signal })
      .then(async (response) => {
        if (response.status === 401) {
          if (!controller.signal.aborted) setAccountState('anonymous');
          return;
        }
        if (!response.ok) {
          if (!controller.signal.aborted) setAccountState('unavailable');
          return;
        }
        const profile = await response.json() as Account;
        if (!controller.signal.aborted) {
          setAccount(profile);
          setAccountState('authenticated');
        }
      })
      .catch(() => { if (!controller.signal.aborted) setAccountState('unavailable'); });
    return () => controller.abort();
  }, [retryKey]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && !root.current?.contains(event.target)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
        trigger.current?.focus();
      }
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

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
      try { window.sessionStorage.setItem('rfz-customer-signed-out', '1'); } catch { /* API sign-out remains authoritative. */ }
      window.location.replace('/login');
    } catch {
      setError('Sign out was not completed. Please try again.');
      setBusy(false);
    }
  }

  if (accountState === 'checking' || accountState === 'unavailable') {
    return (
      <div className={`flex items-center gap-2 ${compact ? 'flex-col items-stretch' : ''}`}>
        <Link href="/account" className="inline-flex min-h-10 items-center justify-center gap-1 rounded-lg border border-[#253451] px-3 text-xs text-slate-200 hover:border-cyan-400">
          Account
        </Link>
        {accountState === 'unavailable' ? <button type="button" onClick={() => setRetryKey((key) => key + 1)} className="min-h-10 rounded-lg px-3 text-xs text-slate-400 hover:text-cyan-200">Retry account status</button> : null}
      </div>
    );
  }

  if (accountState === 'anonymous' || !account) {
    return (
      <div className={`flex items-center gap-2 ${compact ? 'flex-col items-stretch' : ''}`}>
        <Link href="/login" className="inline-flex min-h-10 items-center justify-center gap-1 rounded-lg border border-[#253451] px-3 text-xs text-slate-200 hover:border-cyan-400">
          Sign in
        </Link>
        <Link href="/register" className="inline-flex min-h-10 items-center justify-center rounded-lg bg-gradient-to-r from-blue-500 to-violet-600 px-3 text-xs font-semibold text-white">
          Create account
        </Link>
      </div>
    );
  }

  const initials = (account.display_name || account.email).trim().slice(0, 1).toUpperCase() || 'P';
  return (
    <div ref={root} className="relative">
      <button ref={trigger} type="button" aria-haspopup="true" aria-expanded={open} aria-label={`Account menu for ${account.display_name || account.email}`} onClick={() => setOpen((value) => !value)} className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-[#253451] px-3 text-xs text-slate-200 hover:border-cyan-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-300">
        <span className="grid size-6 place-items-center rounded-full bg-cyan-400/15 font-semibold text-cyan-200" aria-hidden="true">{initials}</span>
        <span className={compact ? 'max-w-32 truncate' : 'max-w-36 truncate'}>{account.display_name || 'My account'}</span>
        <ChevronDown size={14} aria-hidden="true" />
      </button>
      {open ? <nav aria-label="Customer account menu" className={`absolute right-0 z-50 mt-2 w-60 rounded-xl border border-[#20304b] bg-[#080f20] p-2 shadow-2xl ${compact ? 'left-0 right-auto' : ''}`}>
        <p className="truncate px-3 py-2 text-xs text-slate-500">{account.email}</p>
        <Link onClick={() => setOpen(false)} className="flex min-h-11 items-center gap-2 rounded-lg px-3 text-sm text-slate-200 hover:bg-[#13213a]" href="/account"><CircleUserRound size={16} />My Account</Link>
        <Link onClick={() => setOpen(false)} className="flex min-h-11 items-center gap-2 rounded-lg px-3 text-sm text-slate-200 hover:bg-[#13213a]" href="/account/orders"><Package size={16} />My Orders</Link>
        <Link onClick={() => setOpen(false)} className="flex min-h-11 items-center gap-2 rounded-lg px-3 text-sm text-slate-200 hover:bg-[#13213a]" href="/account/wallet"><WalletCards size={16} />RF Coins Wallet</Link>
        <Link onClick={() => setOpen(false)} className="flex min-h-11 items-center gap-2 rounded-lg px-3 text-sm text-slate-200 hover:bg-[#13213a]" href="/account/profile"><Settings size={16} />Profile &amp; Settings</Link>
        {error ? <p role="alert" className="px-3 py-2 text-xs text-rose-300">{error}</p> : null}
        <button type="button" disabled={busy} onClick={() => void signOut()} className="flex min-h-11 w-full items-center gap-2 rounded-lg px-3 text-left text-sm text-rose-200 hover:bg-rose-400/10 disabled:opacity-60"><LogOut size={16} />{busy ? 'Signing out…' : 'Sign out'}</button>
      </nav> : null}
    </div>
  );
}
