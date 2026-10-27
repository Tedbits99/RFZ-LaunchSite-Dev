'use client';

import { useRouter } from 'next/navigation';
import { RefreshCw } from 'lucide-react';

export default function RetryServerDataButton({ label = 'Try again' }: { label?: string }) {
  const router = useRouter();

  return (
    <button
      type="button"
      onClick={() => router.refresh()}
      className="mt-3 inline-flex min-h-10 items-center gap-2 rounded-lg border border-rose-300/25 px-3 text-xs font-medium text-rose-100 transition hover:border-rose-200/60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-300"
    >
      <RefreshCw size={14} aria-hidden="true" />
      {label}
    </button>
  );
}
