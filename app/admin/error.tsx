'use client';

import { useEffect } from 'react';
import { RefreshCw, TriangleAlert } from 'lucide-react';

export default function AdminError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { console.error(error); }, [error]);
  return <main role="alert" className="rfz-admin-shell flex min-h-[calc(100vh-73px)] flex-col items-center justify-center px-5 text-center"><TriangleAlert className="text-amber-300" size={30} /><h1 className="font-display mt-4 text-2xl font-bold">Admin data is temporarily unavailable</h1><p className="mt-2 text-sm text-[var(--rfz-muted)]">No changes were applied. Retry when the service is available.</p><button type="button" onClick={reset} className="mt-6 inline-flex min-h-11 items-center gap-2 rounded-xl bg-gradient-to-r from-cyan-400 to-blue-500 px-4 text-sm font-semibold text-slate-950"><RefreshCw size={15} /> Retry</button></main>;
}
