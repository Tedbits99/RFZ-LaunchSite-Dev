'use client';

import { FormEvent, useEffect, useState } from 'react';
import { CheckCircle2, Eye, EyeOff, Lock } from 'lucide-react';

type PageState = 'form' | 'pending' | 'success' | 'error';

const GENERIC_INVALID = 'This reset link is invalid or has expired. Please request a new one.';
const GENERIC_OK = 'Password updated. You can now sign in with your new password.';
const GENERIC_503 = 'Password reset is temporarily unavailable. Please try again later.';
const PASSWORD_MIN = 8;
const PASSWORD_MAX = 128;

async function prepareRecoverySession(): Promise<Response> {
  return fetch('/auth/reset-password/prepare', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    body: '{}',
  });
}

function passwordStrength(password: string): { label: string; value: number } {
  if (!password) return { label: 'Not set', value: 0 };
  let score = password.length >= PASSWORD_MIN ? 1 : 0;
  if (/[a-z]/.test(password) && /[A-Z]/.test(password)) score += 1;
  if (/\d/.test(password) || /[^\p{L}\p{N}\s]/u.test(password)) score += 1;
  if (password.length >= 12) score += 1;
  return { label: score < 2 ? 'Needs improvement' : score === 2 ? 'Fair' : score === 3 ? 'Good' : 'Strong', value: score };
}

export default function ResetPasswordPage() {
  const [state, setState] = useState<PageState>('form');
  const [error, setError] = useState<string>('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [showPasswords, setShowPasswords] = useState(false);
  const [preparing, setPreparing] = useState(true);
  const [signInPath, setSignInPath] = useState('/login');

  useEffect(() => {
    let active = true;
    prepareRecoverySession()
      .then((response) => {
        if (!active) return;
        if (response.ok) return;
        setError(response.status === 503 ? GENERIC_503 : GENERIC_INVALID);
        setState('error');
      })
      .catch(() => {
        if (!active) return;
        setError(GENERIC_503);
        setState('error');
      })
      .finally(() => {
        if (active) setPreparing(false);
      });
    return () => { active = false; };
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (state === 'pending' || preparing) return;
    const formData = new FormData(event.currentTarget);
    const nextPassword = String(formData.get('password') ?? '');
    const nextConfirmation = String(formData.get('confirmPassword') ?? '');
    if (nextPassword !== nextConfirmation) {
      setError('Passwords do not match.');
      setState('error');
      return;
    }
    if (nextPassword.length < PASSWORD_MIN || nextPassword.length > PASSWORD_MAX || !/\S/.test(nextPassword)) {
      setError(`Password must be between ${PASSWORD_MIN} and ${PASSWORD_MAX} characters.`);
      setState('error');
      return;
    }
    setState('pending');
    setError('');
    setPreparing(true);

    try {
      // Rebind immediately before the password update. Auth may refresh the
      // recovery session while the user is reading or typing, so a proof
      // issued only during the initial page load can be stale by submission.
      // The prepare endpoint re-verifies the recovery session and refreshes
      // the HttpOnly proof without exposing any token to the browser.
      const prepareResponse = await prepareRecoverySession();
      if (!prepareResponse.ok) {
        setError(prepareResponse.status === 503 ? GENERIC_503 : GENERIC_INVALID);
        setState('error');
        return;
      }

      // The password change happens server-side: the endpoint re-verifies the
      // recovery-namespace session and the signed HttpOnly proof cookie. The
      // browser never calls the Auth provider directly and never touches the
      // proof cookie itself.
      const response = await fetch('/auth/reset-password/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: nextPassword }),
        credentials: 'same-origin',
      });

      if (response.ok) {
        // Only the server-verified recovery identity may select an admin
        // destination. Explicitly allowlist the two internal sign-in routes:
        // forged response destinations can never become open redirects.
        const body = await response.json().catch(() => null) as { signInPath?: unknown } | null;
        const destination = body?.signInPath;
        if (destination !== '/login' && destination !== '/secure-admin-login') {
          setState('success');
          return;
        }
        setSignInPath(destination);
        setState('success');
        window.location.replace(destination);
        return;
      }
      if (response.status === 503) {
        setError(GENERIC_503);
      } else {
        setError(GENERIC_INVALID);
      }
      setState('error');
    } catch {
      setError(GENERIC_503);
      setState('error');
    } finally {
      setPreparing(false);
    }
  }

  return (
    <main className="rfz-auth-page grid min-h-screen place-items-center bg-[#030718] px-5 py-8 text-slate-100">
      <div className="w-full max-w-sm rounded-2xl border border-[#1b2a45] bg-[#0b1225] p-8">
        {state === 'success' ? (
          <div className="text-center">
            <CheckCircle2 size={36} className="mx-auto text-emerald-400" />
            <h1 className="font-display mt-3 text-2xl font-bold">Password set</h1>
            <p className="mt-2 text-sm text-slate-400">{GENERIC_OK}</p>
            <a href={signInPath} className="mt-6 inline-block rounded-lg border border-[#22314d] px-4 py-2 text-sm text-slate-300 transition-colors hover:border-[#31456b] hover:text-slate-100">Sign in</a>
          </div>
        ) : (
          <>
            <h1 className="font-display text-2xl font-bold">Choose a new password</h1>
            <p className="mt-1 text-sm text-slate-400">Enter and confirm a new password for your account.</p>
            <form className="mt-6 space-y-3" method="post" action="/auth/reset-password/complete" onSubmit={submit}>
              <label className="block">
                <span className="mb-1 block text-xs text-slate-400">New password</span>
                <div className="flex items-center gap-2 rounded-lg border border-[#22314d] bg-[#0a1124] px-3">
                  <Lock size={15} className="text-slate-500" />
                  <input name="password" type={showPasswords ? 'text' : 'password'} autoComplete="new-password" required minLength={PASSWORD_MIN} maxLength={PASSWORD_MAX} value={password} onChange={(event) => setPassword(event.target.value)} className="w-full bg-transparent py-2.5 text-sm outline-none" />
                </div>
              </label>
              <div aria-live="polite" className="flex items-center justify-between text-[11px] text-slate-500">
                <span>Password strength: {passwordStrength(password).label}</span>
                <span aria-label={`${passwordStrength(password).value} of 4 strength`} role="progressbar" aria-valuemin={0} aria-valuemax={4} aria-valuenow={passwordStrength(password).value} className="flex gap-1">
                  {[1, 2, 3, 4].map((segment) => <span key={segment} aria-hidden="true" className={`h-1.5 w-7 rounded-full ${segment <= passwordStrength(password).value ? 'bg-cyan-300' : 'bg-slate-700'}`} />)}
                </span>
              </div>
              <label className="block">
                <span className="mb-1 block text-xs text-slate-400">Confirm new password</span>
                <div className="flex items-center gap-2 rounded-lg border border-[#22314d] bg-[#0a1124] px-3">
                  <Lock size={15} className="text-slate-500" />
                  <input name="confirmPassword" type={showPasswords ? 'text' : 'password'} autoComplete="new-password" required minLength={PASSWORD_MIN} maxLength={PASSWORD_MAX} value={confirmation} onChange={(event) => setConfirmation(event.target.value)} className="w-full bg-transparent py-2.5 text-sm outline-none" />
                </div>
              </label>
              <button type="button" aria-pressed={showPasswords} onClick={() => setShowPasswords((visible) => !visible)} className="inline-flex min-h-10 items-center gap-2 text-xs text-cyan-300 hover:text-cyan-200">
                {showPasswords ? <EyeOff size={15} aria-hidden="true" /> : <Eye size={15} aria-hidden="true" />}
                {showPasswords ? 'Hide passwords' : 'Show passwords'}
              </button>
              {state === 'error' && error ? (
                <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-200" role="alert">{error}</div>
              ) : null}
              <button type="submit" disabled={state === 'pending' || preparing} className="w-full rounded-lg bg-gradient-to-r from-blue-500 to-violet-600 py-3 text-sm font-semibold disabled:opacity-50">
                {preparing ? 'Verifying reset link…' : state === 'pending' ? 'Updating…' : 'Update password'}
              </button>
            </form>
            <p className="mt-4 text-center text-xs text-slate-500"><a href="/login" className="text-cyan-300">Customer sign in</a></p>
          </>
        )}
      </div>
    </main>
  );
}
