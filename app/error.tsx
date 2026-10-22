'use client';

import { useEffect } from 'react';
import { RefreshCw, TriangleAlert } from 'lucide-react';

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { console.error(error); }, [error]);
  return <main role="alert" className="mx-auto flex min-h-[60vh] max-w-xl flex-col items-center justify-center px-5 text-center"><TriangleAlert className="text-amber-300" size={30} /><h1 className="font-display mt-4 text-2xl font-bold">This page could not load</h1><p className="mt-2 text-sm text-[var(--rfz-muted)]">Your data was not changed. Try again, or return to the store.</p><div className="mt-6 flex flex-wrap justify-center gap-3"><button type="button" onClick={reset} className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-gradient-to-r from-cyan-400 to-blue-500 px-4 text-sm font-semibold text-slate-950"><RefreshCw size={15} /> Try again</button><a href="/" className="inline-flex min-h-11 items-center rounded-xl border border-[var(--rfz-line-strong)] px-4 text-sm font-semibold">Back to store</a></div></main>;
}
