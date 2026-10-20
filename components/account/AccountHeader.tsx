'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

type AccountHeaderProps = { backHref?: string; backLabel?: string };

export default function AccountHeader({ backHref = '/', backLabel = 'Back to store' }: AccountHeaderProps) {
  const router = useRouter();
  const [signingOut, setSigningOut] = useState(false);

  async function signOut() {
    if (signingOut) return;
    setSigningOut(true);
    try {
      await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' });
    } finally {
      router.replace('/login');
      router.refresh();
    }
  }

  return (
    <header className="border-b border-[#14203a] bg-[#050a1b]/90">
      <div className="mx-auto flex max-w-[1180px] flex-wrap items-center justify-between gap-3 px-5 py-4">
        <Link href={backHref} className="text-xs text-cyan-300">← {backLabel}</Link>
        <nav aria-label="Account navigation" className="flex items-center gap-3 text-xs">
          <Link href="/account" className="text-slate-300 hover:text-white">Account</Link>
          <Link href="/account/orders" className="text-slate-300 hover:text-white">Orders</Link>
          <Link href="/account/profile" className="text-slate-300 hover:text-white">Profile</Link>
          <button type="button" onClick={() => void signOut()} disabled={signingOut} className="rounded-md border border-[#31456b] px-2.5 py-1.5 text-slate-300 hover:border-cyan-400 hover:text-white disabled:opacity-60">
            {signingOut ? 'Signing out…' : 'Sign out'}
          </button>
        </nav>
      </div>
    </header>
  );
}
