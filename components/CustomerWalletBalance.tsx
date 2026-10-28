'use client';

import Link from 'next/link';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { Coins, Plus, WalletCards } from 'lucide-react';
import { resolveCustomerWalletSummary, type CustomerWalletSummaryState } from '@/lib/customerWalletSummary';

function formatBalance(balance: number) {
  return `${balance.toLocaleString('en-PH')} RF`;
}

export default function CustomerWalletBalance({ authenticated, compact = false }: { authenticated: boolean; compact?: boolean }) {
  const pathname = usePathname();
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const popoverId = useId();
  const request = useRef<AbortController | null>(null);
  const [state, setState] = useState<CustomerWalletSummaryState | { kind: 'loading' }>({ kind: 'loading' });
  const [open, setOpen] = useState(false);
  const [popoverPosition, setPopoverPosition] = useState<{ top: number; left: number; width: number } | null>(null);

  const positionPopover = useCallback(() => {
    const rect = trigger.current?.getBoundingClientRect();
    if (!rect) return;
    const width = Math.min(288, Math.max(0, window.innerWidth - 32));
    const left = Math.max(16, Math.min(rect.right - width, window.innerWidth - width - 16));
    const top = Math.max(8, Math.min(rect.bottom + 8, window.innerHeight - 200));
    setPopoverPosition({ top, left, width });
  }, []);

  const refresh = useCallback(async () => {
    if (!authenticated) {
      setState({ kind: 'anonymous' });
      return;
    }
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setState({ kind: 'loading' });
    try {
      const response = await fetch('/api/account/wallet', {
        credentials: 'same-origin',
        cache: 'no-store',
        signal: controller.signal,
      });
      const payload: unknown = await response.json().catch(() => null);
      if (!controller.signal.aborted) setState(resolveCustomerWalletSummary(response.status, payload));
    } catch {
      if (!controller.signal.aborted) {
        setState({ kind: 'unavailable', message: 'Wallet unavailable. Please try again later.' });
      }
    }
  }, [authenticated]);

  useEffect(() => {
    void refresh();
    const onFocus = () => { void refresh(); };
    const onWalletUpdated = () => { void refresh(); };
    const onAccountMenuOpen = () => setOpen(false);
    window.addEventListener('focus', onFocus);
    window.addEventListener('rfz:wallet-updated', onWalletUpdated);
    window.addEventListener('rfz:account-menu-open', onAccountMenuOpen);
    return () => {
      request.current?.abort();
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('rfz:wallet-updated', onWalletUpdated);
      window.removeEventListener('rfz:account-menu-open', onAccountMenuOpen);
    };
  }, [pathname, refresh]);

  useEffect(() => {
    if (!open) return;
    positionPopover();
    document.getElementById(popoverId)?.querySelector<HTMLElement>('a, button')?.focus({ preventScroll: true });
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
    window.addEventListener('resize', positionPopover);
    window.addEventListener('scroll', positionPopover, true);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('resize', positionPopover);
      window.removeEventListener('scroll', positionPopover, true);
    };
  }, [open, popoverId, positionPopover]);

  useEffect(() => { setOpen(false); }, [pathname]);

  if (!authenticated || state.kind === 'anonymous') return null;
  if (state.kind === 'loading') {
    return <span aria-label="Loading RF Coins wallet" role="status" className={`h-10 animate-pulse rounded-xl border border-[#253451] bg-[#0b1225] ${compact ? 'w-14' : 'w-28'}`} />;
  }

  const ready = state.kind === 'ready';
  const title = ready ? `RF Coins balance: ${formatBalance(state.balance)}` : 'RF Coins wallet unavailable';
  return (
    <div ref={root} className="relative">
      <button
        ref={trigger}
        type="button"
        aria-label={title}
        aria-haspopup="dialog"
        aria-controls={open ? popoverId : undefined}
        aria-expanded={open}
        title={title}
        onClick={() => {
          if (open) {
            setOpen(false);
            return;
          }
          window.dispatchEvent(new Event('rfz:wallet-popover-open'));
          positionPopover();
          setOpen(true);
        }}
        className={`inline-flex min-h-10 shrink-0 items-center justify-center gap-1.5 rounded-xl border px-2 text-xs font-semibold transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-300 ${ready ? 'border-cyan-400/25 bg-gradient-to-r from-cyan-400/10 to-violet-500/10 text-cyan-100 hover:border-cyan-300/60' : 'border-amber-400/25 bg-amber-400/5 text-amber-100 hover:border-amber-300/60'} ${compact ? 'min-w-14 gap-1 px-1.5' : 'sm:px-3'}`}
      >
        {ready ? <Coins aria-hidden="true" size={15} className="shrink-0 text-amber-300" /> : <WalletCards aria-hidden="true" size={15} className="shrink-0" />}
        {ready ? <span>{formatBalance(state.balance)}</span> : <span className={compact ? 'hidden sm:inline' : undefined}>Wallet unavailable</span>}
        {!ready && compact ? <span className="sm:hidden">Wallet</span> : null}
        {ready && state.canAddFunds && !compact ? <Plus aria-hidden="true" size={13} className="shrink-0" /> : null}
      </button>
      {open ? (
        <div id={popoverId} role="dialog" aria-label="RF Coins wallet" style={popoverPosition ? { top: popoverPosition.top, left: popoverPosition.left, width: popoverPosition.width } : undefined} className="fixed z-[60] max-h-[calc(100dvh-1rem)] overflow-y-auto rounded-2xl border border-[var(--rfz-line)] bg-[var(--rfz-surface)] p-4 text-left text-[var(--rfz-ink)] shadow-2xl shadow-black/40">
          <div className="flex items-start gap-3">
            <span className="grid size-9 shrink-0 place-items-center rounded-xl border border-cyan-300/20 bg-cyan-300/10 text-cyan-200"><WalletCards size={17} aria-hidden="true" /></span>
            <div className="min-w-0">
              <h2 className="text-sm font-semibold text-slate-100">RF Coins wallet</h2>
              {ready ? <p className="mt-1 font-display text-lg font-bold text-cyan-200">{formatBalance(state.balance)}</p> : <p className="mt-1 text-xs leading-5 text-amber-100">{state.message}</p>}
            </div>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-2">
            {ready && state.canAddFunds ? <Link href="/account/wallet#add-funds" onClick={() => setOpen(false)} className="inline-flex min-h-10 items-center justify-center gap-1 rounded-lg bg-gradient-to-r from-blue-500 to-violet-600 px-3 text-xs font-semibold text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-300"><Plus size={14} aria-hidden="true" />Add Funds</Link> : null}
            <Link href="/account/wallet" onClick={() => setOpen(false)} className={`inline-flex min-h-10 items-center justify-center rounded-lg border border-[#253451] px-3 text-xs text-slate-200 hover:border-cyan-300/50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-300 ${ready && state.canAddFunds ? '' : 'col-span-2'}`}>View Wallet</Link>
          </div>
        </div>
      ) : null}
    </div>
  );
}
