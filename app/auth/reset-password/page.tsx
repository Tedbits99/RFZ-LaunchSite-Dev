'use client';

import { FormEvent, useState } from 'react';
import { Lock, CheckCircle2 } from 'lucide-react';

type PageState = 'form' | 'pending' | 'success' | 'error';

const GENERIC_INVALID = 'This reset link is invalid or has expired. Please request a new one.';
const GENERIC_OK = 'Password updated. You can now sign in with your new password.';
const GENERIC_503 = 'Password reset is temporarily unavailable. Please try again later.';

export default function ResetPasswordPage() {
  const [state, setState] = useState<PageState>('form');
  const [error, setError] = useState<string>('');

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (state === 'pending') return;
    setState('pending');
    setError('');

    const password = String(new FormData(event.currentTarget).get('password') ?? '');

    try {
      const { createRecoveryBrowserClient } = await import('@/lib/authSessionBrowserClients');
      const supabase = createRecoveryBrowserClient();

      // Only a session in the recovery namespace — established by a genuine
      // email-link exchange in the callback — can authorize a password update.
      // Default, customer and admin sessions live in separate cookies and are
      // invisible to this client.
      const { data: recoveryData, error: sessionError } = await supabase.auth.getSession();
      const recoverySession = recoveryData?.session;
      if (sessionError || !recoverySession) {
        setError(GENERIC_INVALID);
        setState('error');
        return;
      }

      const { data: userData } = await supabase.auth.getUser();
      if (!userData?.user) {
        setError(GENERIC_INVALID);
        setState('error');
        return;
      }

      const { error: updateError } = await supabase.auth.updateUser({ password });
      if (updateError) {
        setError(GENERIC_INVALID);
        setState('error');
        return;
      }

      // Sign out ONLY the recovery namespace; customer/admin/default sessions
      // live in other cookies and remain untouched.
      await supabase.auth.signOut({ scope: 'local' });
      document.cookie = 'rfz-recovery-proof=; Max-Age=0; Path=/auth/reset-password; Secure; SameSite=Lax';
      setState('success');
    } catch {
      setError(GENERIC_503);
      setState('error');
    }
  }

  return (
    <main className="grid min-h-screen place-items-center bg-[#030718] px-5 text-slate-100">
      <div className="w-full max-w-sm rounded-2xl border border-[#1b2a45] bg-[#0b1225] p-8">
        {state === 'success' ? (
          <div className="text-center">
            <CheckCircle2 size={36} className="mx-auto text-emerald-400" />
            <h1 className="font-display mt-3 text-2xl font-bold">Password set</h1>
            <p className="mt-2 text-sm text-slate-400">{GENERIC_OK}</p>
            <a href="/login" className="mt-6 inline-block rounded-lg border border-[#22314d] px-4 py-2 text-sm text-slate-300 transition-colors hover:border-[#31456b] hover:text-slate-100">Sign in</a>
          </div>
        ) : (
          <>
            <h1 className="font-display text-2xl font-bold">Choose a new password</h1>
            <p className="mt-1 text-sm text-slate-400">Enter a new password for your account.</p>
            <form className="mt-6 space-y-3" onSubmit={submit}>
              <label className="block">
                <span className="mb-1 block text-xs text-slate-400">New password</span>
                <div className="flex items-center gap-2 rounded-lg border border-[#22314d] bg-[#0a1124] px-3">
                  <Lock size={15} className="text-slate-500" />
                  <input name="password" type="password" autoComplete="new-password" required minLength={8} maxLength={128} className="w-full bg-transparent py-2.5 text-sm outline-none" />
                </div>
              </label>
              {state === 'error' && error ? (
                <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-200" role="alert">{error}</div>
              ) : null}
              <button type="submit" disabled={state === 'pending'} className="w-full rounded-lg bg-gradient-to-r from-blue-500 to-violet-600 py-3 text-sm font-semibold disabled:opacity-50">
                {state === 'pending' ? 'Updating…' : 'Update password'}
              </button>
            </form>
            <p className="mt-4 text-center text-xs text-slate-500"><a href="/login" className="text-cyan-300">Back to sign in</a></p>
          </>
        )}
      </div>
    </main>
  );
}
