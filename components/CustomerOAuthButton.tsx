'use client';

import { useState } from 'react';
import { createCustomerBrowserClient } from '@/lib/authSessionBrowserClients';

const GENERIC_ERROR = 'Google sign-in is temporarily unavailable. Please use email and password or try again later.';

function GoogleMark() {
  return (
    <svg aria-hidden="true" className="size-5" viewBox="0 0 24 24" role="img">
      <path fill="#4285F4" d="M21.35 12.27c0-.72-.06-1.42-.18-2.09H12v3.96h5.24a4.48 4.48 0 0 1-1.94 2.94v2.45h3.14c1.84-1.69 2.91-4.18 2.91-7.26Z" />
      <path fill="#34A853" d="M12 21.5c2.63 0 4.84-.87 6.45-2.36l-3.14-2.45c-.87.58-1.98.92-3.31.92-2.54 0-4.7-1.72-5.47-4.03H3.28v2.53A9.74 9.74 0 0 0 12 21.5Z" />
      <path fill="#FBBC05" d="M6.53 13.58a5.86 5.86 0 0 1 0-3.16V7.89H3.28a9.5 9.5 0 0 0 0 8.22l3.25-2.53Z" />
      <path fill="#EA4335" d="M12 6.39c1.43 0 2.72.49 3.73 1.46l2.8-2.8C16.84 3.47 14.63 2.5 12 2.5a9.74 9.74 0 0 0-8.72 5.39l3.25 2.53C7.3 8.11 9.46 6.39 12 6.39Z" />
    </svg>
  );
}

export default function CustomerOAuthButton() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function continueWithGoogle() {
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      const client = createCustomerBrowserClient();
      const { error: oauthError } = await client.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: `${window.location.origin}/auth/customer/callback`,
          queryParams: { access_type: 'offline', prompt: 'select_account' },
        },
      });
      if (oauthError) {
        setError(GENERIC_ERROR);
        setPending(false);
      }
    } catch {
      setError(GENERIC_ERROR);
      setPending(false);
    }
  }

  return (
    <div className="mt-5">
      <button type="button" onClick={continueWithGoogle} disabled={pending} className="flex min-h-11 w-full items-center justify-center gap-3 rounded-[.65rem] border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-800 shadow-sm transition hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-400 disabled:cursor-wait disabled:opacity-60">
        <GoogleMark />
        {pending ? 'Connecting to Google…' : 'Continue with Google'}
      </button>
      {error && <p role="alert" className="mt-3 text-center text-xs text-rose-300">{error}</p>}
    </div>
  );
}
