import type { ReactNode } from 'react';
import { notFound } from 'next/navigation';
import { resolveAdminSession } from '@/lib/adminGuard';
import AdminShell from './AdminShell';

export const dynamic = 'force-dynamic';

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const result = await resolveAdminSession();
  if (!result.ok) {
    if (result.reason === 'unauthenticated') notFound();
    if (result.reason === 'forbidden') {
      return (
        <main data-admin-denial="forbidden" className="grid min-h-screen place-items-center bg-[var(--rfz-bg)] px-5 text-center text-[var(--rfz-ink)]">
          <div className="max-w-md rounded-2xl border border-rose-400/20 bg-[var(--rfz-surface)] p-8 shadow-xl">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-rose-300">Admin access required</p>
            <h1 className="mt-3 font-display text-2xl font-bold">This account cannot open the admin console.</h1>
            <p className="mt-3 text-sm text-[var(--rfz-muted)]">Use an active RunFazone administrator account or return to the sign-in page.</p>
            <a href="/secure-admin-login" className="mt-6 inline-flex min-h-11 items-center justify-center rounded-xl bg-cyan-400 px-4 text-sm font-semibold text-slate-950">Return to admin sign in</a>
          </div>
        </main>
      );
    }
    return (
      <main data-admin-denial="unavailable" role="alert" className="grid min-h-screen place-items-center bg-[var(--rfz-bg)] px-5 text-center text-[var(--rfz-ink)]">
        <div className="max-w-md rounded-2xl border border-amber-400/20 bg-[var(--rfz-surface)] p-8 shadow-xl">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-amber-300">Admin service unavailable</p>
          <h1 className="mt-3 font-display text-2xl font-bold">We could not verify this session.</h1>
          <p className="mt-3 text-sm text-[var(--rfz-muted)]">No admin data was loaded. Retry when the authentication service is available.</p>
          <a href="/secure-admin-login" className="mt-6 inline-flex min-h-11 items-center justify-center rounded-xl bg-cyan-400 px-4 text-sm font-semibold text-slate-950">Retry admin sign in</a>
        </div>
      </main>
    );
  }

  return <AdminShell>{children}</AdminShell>;
}
