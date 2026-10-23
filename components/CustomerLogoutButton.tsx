'use client';

import { useState } from 'react';

export default function CustomerLogoutButton() {
  const [pending, setPending] = useState(false);

  return (
    <form action="/api/auth/logout" method="post" onSubmit={() => setPending(true)} className="flex flex-col items-end gap-1">
      <button type="submit" disabled={pending} className="rounded-lg border border-[var(--rfz-line-strong)] px-3 py-2 text-xs font-semibold text-[var(--rfz-muted)] transition hover:border-[var(--rfz-accent)] hover:text-[var(--rfz-text)] disabled:cursor-wait disabled:opacity-60">
        {pending ? 'Signing out…' : 'Sign out'}
      </button>
    </form>
  );
}
