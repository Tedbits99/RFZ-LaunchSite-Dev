'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function CustomerLogoutButton() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function signOut() {
    setPending(true);
    setError(null);
    try {
      const response = await fetch('/api/auth/logout', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
      });
      if (!response.ok) throw new Error('Sign out was not completed.');
      router.replace('/login?from=logout');
      router.refresh();
    } catch {
      setError('Could not sign out. Please try again.');
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button type="button" onClick={() => void signOut()} disabled={pending} className="rounded-lg border border-[var(--rfz-line-strong)] px-3 py-2 text-xs font-semibold text-[var(--rfz-muted)] transition hover:border-[var(--rfz-accent)] hover:text-[var(--rfz-text)] disabled:cursor-wait disabled:opacity-60">
        {pending ? 'Signing out…' : 'Sign out'}
      </button>
      {error && <span role="alert" className="text-[11px] text-[var(--rfz-danger)]">{error}</span>}
    </div>
  );
}
