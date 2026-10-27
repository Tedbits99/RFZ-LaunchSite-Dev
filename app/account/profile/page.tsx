'use client';

import { FormEvent, useEffect, useState } from 'react';
import Link from 'next/link';
import { ChevronRight, CheckCircle2 } from 'lucide-react';
import AccountFooter from '@/components/account/AccountFooter';

type PageState = 'loading' | 'idle' | 'pending' | 'saved' | 'load-error' | 'save-error';

export default function AccountProfile() {
  const [displayName, setDisplayName] = useState('');
  const [savedDisplayName, setSavedDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [accountStatus, setAccountStatus] = useState('');
  const [state, setState] = useState<PageState>('loading');
  const [error, setError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/account/profile', { credentials: 'same-origin' });
        if (res.status === 401) {
          window.location.href = '/login?next=%2Faccount%2Fprofile';
          return;
        }
        if (!res.ok) throw new Error('load failed');
        const body = await res.json() as { display_name?: string; email?: string; status?: string };
        if (cancelled) return;
        setDisplayName(body.display_name ?? '');
        setSavedDisplayName(body.display_name ?? '');
        setEmail(body.email ?? '');
        setAccountStatus(body.status || 'active');
        setState('idle');
      } catch {
        if (!cancelled) {
          setError('Unable to load your profile right now.');
          setState('load-error');
        }
      }
    })();
    return () => { cancelled = true; };
  }, [reloadKey]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (state === 'pending') return;
    setState('pending');
    setError('');
    try {
      const res = await fetch('/api/account/profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ display_name: displayName }),
      });
      if (res.status === 401) {
        window.location.href = '/login?next=%2Faccount%2Fprofile';
        return;
      }
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string };
        setError(body.error || 'Unable to save your profile right now.');
        setState('save-error');
        return;
      }
      setSavedDisplayName(displayName);
      setState('saved');
    } catch {
      setError('Unable to save your profile right now.');
      setState('save-error');
    }
  }

  return (
    <main className="min-h-screen bg-[#030718] text-slate-100">
      <div className="mx-auto max-w-2xl px-5 py-10">
        <nav className="flex items-center gap-2 text-xs text-slate-500"><Link href="/account">Account</Link><ChevronRight size={12} /><span className="text-slate-300">Profile</span></nav>
        <h1 className="font-display mt-4 text-2xl font-bold">Profile Settings</h1>
        {accountStatus ? <p className="mt-2 text-sm text-slate-400">Account status: <span className="font-medium capitalize text-emerald-300">{accountStatus.replaceAll('_', ' ')}</span></p> : null}
        <section className="mt-6 rounded-xl border border-cyan-400/15 bg-[#0b1225] p-5" aria-labelledby="profile-security-heading">
          <h2 id="profile-security-heading" className="font-display text-base font-semibold">Password &amp; security</h2>
          <p className="mt-1 text-sm text-slate-400">Keep your account protected with a password you do not reuse elsewhere.</p>
          <Link href="/forgot-password" className="mt-3 inline-flex rounded-lg border border-cyan-400/30 px-3 py-2 text-xs font-medium text-cyan-200 hover:border-cyan-300">
            Reset password securely
          </Link>
        </section>

        {state === 'loading' ? (
          <div className="mt-6 rounded-xl border border-[#1b2a45] bg-[#0b1225] p-6 text-sm text-slate-400">Loading your profile…</div>
        ) : state === 'load-error' ? (
          <div className="mt-6 rounded-xl border border-rose-400/25 bg-rose-400/5 p-6 text-sm text-rose-200" role="alert">
            <p>{error}</p>
            <button type="button" onClick={() => { setError(''); setState('loading'); setReloadKey((key) => key + 1); }} className="mt-3 min-h-11 rounded-lg border border-rose-300/30 px-4 text-sm hover:bg-rose-400/10">Try again</button>
          </div>
        ) : state === 'saved' ? (
          <div className="mt-6 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-6 text-sm text-emerald-200">
            <CheckCircle2 size={20} className="mb-2 text-emerald-400" />
            <p>Profile updated.</p>
            <button onClick={() => setState('idle')} className="mt-3 rounded-lg border border-[#22314d] px-3 py-1.5 text-xs text-slate-300 hover:border-[#31456b]">Continue editing</button>
          </div>
        ) : (
          <form className="mt-6 space-y-4 rounded-xl border border-[#1b2a45] bg-[#0b1225] p-6" onSubmit={submit}>
            <label className="block">
              <span className="mb-1 block text-xs text-slate-400">Email (read-only)</span>
              <div className="rounded-lg border border-[#22314d] bg-[#0a1124] px-3 py-2.5 text-sm text-slate-400">{email || '—'}</div>
            </label>
            <label className="block">
              <span className="mb-1 block text-xs text-slate-400">Display name</span>
              <input
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                required
                maxLength={120}
                disabled={state === 'pending'}
                className="w-full rounded-lg border border-[#22314d] bg-[#0a1124] px-3 py-2.5 text-sm outline-none focus:border-cyan-500/50"
              />
            </label>
            {state === 'save-error' && error ? (
              <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-200" role="alert">{error}</div>
            ) : null}
            <div className="flex flex-wrap gap-3">
              <button type="submit" disabled={state === 'pending'} className="min-h-11 rounded-lg bg-gradient-to-r from-blue-500 to-violet-600 px-5 py-2.5 text-sm font-semibold disabled:opacity-50">
                {state === 'pending' ? 'Saving…' : 'Save changes'}
              </button>
              <button type="button" disabled={state === 'pending' || displayName === savedDisplayName} onClick={() => { setDisplayName(savedDisplayName); setError(''); setState('idle'); }} className="min-h-11 rounded-lg border border-[#22314d] px-5 py-2.5 text-sm text-slate-300 hover:border-cyan-400 disabled:cursor-not-allowed disabled:opacity-50">
                Cancel
              </button>
            </div>
          </form>
        )}
      </div>
      <AccountFooter />
    </main>
  );
}
